"""Single-user TRACKTOR server. Python standard library only."""
import argparse
from contextlib import closing
import errno
from functools import partial
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit
import uuid
import webbrowser

from cloudru import CloudError, CloudRu
from skillrunner import SkillRunner, catalog as skill_catalog, recover_interrupted

ROOT = Path(__file__).resolve().parent
STATIC_FILES = {"index.html": "text/html; charset=utf-8",
                "styles.css": "text/css; charset=utf-8",
                "app.js": "text/javascript; charset=utf-8",
                "database.js": "text/javascript; charset=utf-8",
                "cloud.js": "text/javascript; charset=utf-8",
                "skills.js": "text/javascript; charset=utf-8"}
TABLES = {"clients": "sort_order, name", "projects": "sort_order, name",
          "skills": "sort_order, name", "routines": "sort_order, scheduled_at",
          "tasks": "due_at", "notifications": "created_at DESC"}


def connect(database, create=False):
    # Requests must never recreate a missing DB after a drive is disconnected
    # or the folder is moved. Only first-run initialization may create it.
    connection = sqlite3.connect(str(database) if create else database.as_uri() + "?mode=rw",
                                 timeout=10, uri=not create)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def initialize(database):
    database.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(database, create=True)) as connection, connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > 3:
            raise RuntimeError("Database was created by a newer version of TRACKTOR")
        if version == 3:
            return
        connection.execute("BEGIN IMMEDIATE")
        schema = (ROOT / "sqlite-schema.sql").read_text(encoding="utf-8")
        for statement in schema.split(";"):
            if statement.strip():
                connection.execute(statement)
        if version == 0:
            seed = json.loads((ROOT / "seed-data.json").read_text(encoding="utf-8"))
            for table in ("clients", "projects", "routines"):
                for row in seed[table]:
                    row = {"id": str(uuid.uuid4()), **row}
                    columns = ",".join(row)
                    placeholders = ",".join("?" for _ in row)
                    connection.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", list(row.values()))
        connection.execute("PRAGMA user_version=3")


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, database, **kwargs):
        self.database = database
        super().__init__(*args, **kwargs)

    def allowed_request(self):
        origins = {f"http://127.0.0.1:{self.server.server_port}",
                   f"http://localhost:{self.server.server_port}"}
        hosts = {urlsplit(origin).netloc for origin in origins}
        return (self.headers.get("Host") in hosts
                and self.headers.get("Origin", next(iter(origins))) in origins
                and self.headers.get("Sec-Fetch-Site") != "cross-site")

    def send_body(self, status, body, content_type, attachment=None):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if attachment:
                self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Closing/reloading a browser tab must not turn a completed paid
            # operation into a retry or an alarming server traceback.
            self.close_connection = True

    def send_json(self, status, value):
        self.send_body(status, json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                       "application/json; charset=utf-8")

    def read_json(self):
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Ожидается JSON")
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 65536:
            raise ValueError("Размер запроса должен быть от 1 до 65536 байт")
        value = json.loads(self.rfile.read(length), parse_constant=lambda value: None)
        if not isinstance(value, dict):
            raise ValueError("Ожидается JSON-объект")
        return value

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.allowed_request():
            self.send_json(403, {"error": "Разрешён только локальный доступ"})
            return
        path = urlsplit(self.path).path
        try:
            if path == "/api/skill-catalog":
                self.send_json(200, {"data": skill_catalog(self.database, connect)})
            elif path == "/api/skill-runs":
                skill_id = parse_qs(urlsplit(self.path).query).get("skill_id", [""])[0]
                self.send_json(200, SkillRunner(self.database, connect).latest(skill_id))
            elif path.startswith("/api/skill-runs/"):
                self.send_json(200, SkillRunner(self.database, connect).get(path.rsplit("/",1)[-1]))
            elif path in ("/api/cloud/settings", "/api/cloud/models"):
                cloud = CloudRu(self.database, connect)
                self.send_json(200, cloud.settings() if path.endswith("settings") else cloud.models())
            elif path == "/api/status":
                with closing(connect(self.database)) as connection:
                    connection.execute("SELECT 1 FROM user_preferences LIMIT 1")
                self.send_json(200, {"storage": "sqlite", "single_user": True,
                                     "database": str(self.database), "app": "tracktor-local",
                                     "instance_id": self.server.instance_id})
            elif path == "/api/preferences":
                with closing(connect(self.database)) as connection:
                    row = connection.execute("SELECT preferences FROM user_preferences WHERE id=1").fetchone()
                self.send_json(200, json.loads(row[0]) if row else None)
            elif path.startswith("/api/") and path[5:] in TABLES:
                table = path[5:]
                with closing(connect(self.database)) as connection:
                    rows = [dict(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY {TABLES[table]}")]
                if table in ("skills", "routines"):
                    rows = [row for row in rows if row["enabled"]]
                self.send_json(200, rows)
            elif path == "/api/backup":
                with tempfile.TemporaryDirectory() as temporary:
                    backup = Path(temporary) / "tracktor.sqlite3"
                    with closing(connect(self.database)) as source, closing(sqlite3.connect(backup)) as target:
                        source.backup(target)
                    self.send_body(200, backup.read_bytes(), "application/vnd.sqlite3", "tracktor-backup.sqlite3")
            else:
                name = "index.html" if path == "/" else path.lstrip("/")
                if name not in STATIC_FILES:
                    self.send_json(404, {"error": "Не найдено"})
                    return
                self.send_body(200, (ROOT / name).read_bytes(), STATIC_FILES[name])
        except CloudError as error:
            self.send_json(error.status, {"error": str(error), "code": error.code})
        except (OSError, sqlite3.Error):
            self.log_error("Failed to read local database or file")
            self.send_json(500, {"error": "Файл или база недоступны. Проверьте подключение носителя и папку приложения. Затем повторите запуск BAT."})

    def do_POST(self):
        if not self.allowed_request():
            self.send_json(403, {"error": "Разрешён только локальный доступ"})
            return
        path = urlsplit(self.path).path
        if path not in ("/api/preferences", "/api/skills", "/api/cloud/settings", "/api/cloud/test", "/api/skill-runs"):
            self.send_json(404, {"error": "Не найдено"})
            return
        try:
            data = self.read_json()
            if path == "/api/skill-runs":
                self.send_json(202, SkillRunner(self.database, connect).start(data))
                return
            if path in ("/api/cloud/settings", "/api/cloud/test"):
                cloud = CloudRu(self.database, connect)
                self.send_json(200, cloud.save(data) if path.endswith("settings") else cloud.verify(data.get("max_tokens", 128)))
                return
            with closing(connect(self.database)) as connection, connection:
                if path == "/api/preferences":
                    preferences = json.dumps(data, ensure_ascii=False, allow_nan=False)
                    connection.execute("INSERT INTO user_preferences(id,preferences) VALUES(1,?) "
                                       "ON CONFLICT(id) DO UPDATE SET preferences=excluded.preferences,updated_at=CURRENT_TIMESTAMP",
                                       (preferences,))
                    result = data
                else:
                    name, description = data.get("name"), data.get("description", "")
                    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 200:
                        raise ValueError("Название навыка должно содержать от 1 до 200 символов")
                    if not isinstance(description, str) or len(description) > 4000:
                        raise ValueError("Описание должно содержать не более 4000 символов")
                    skill_id = str(uuid.uuid4())
                    connection.execute("INSERT INTO skills(id,name,description) VALUES(?,?,?)", (skill_id, name.strip(), description.strip()))
                    result = dict(connection.execute("SELECT * FROM skills WHERE id=?", (skill_id,)).fetchone())
            self.send_json(201 if path == "/api/skills" else 200, result)
        except CloudError as error:
            self.send_json(error.status, {"error": str(error), "code": error.code})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "Навык с таким названием уже существует"})
        except (ValueError, UnicodeError):
            self.send_json(400, {"error": "Некорректный запрос: проверьте название, описание и формат JSON"})
        except sqlite3.Error:
            self.log_error("Failed to write local database")
            self.send_json(500, {"error": "Не удалось сохранить данные. Проверьте, что носитель подключён, на нём есть место и разрешена запись."})


class InstanceLock:
    """An OS lock, released even if a process or console is terminated."""
    def __init__(self, database):
        self.path = database.with_suffix(".lock")
        self.file = None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.file = self.path.open("a+b")
        if self.file.seek(0, 2) == 0:
            self.file.write(b"0")
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.file.close()
            self.file = None
            if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise
            return False
        return True

    def release(self):
        if self.file:
            # Closing the handle releases the OS lock on Windows and POSIX.
            self.file.close()
            self.file = None


def running_instance(database, state_file):
    """Never trust a saved URL: verify the loopback service, DB and instance ID."""
    connection = None
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
        port = state["port"]
        if type(port) is not int or not 1 <= port <= 65535:
            return None
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=0.5)
        connection.request("GET", "/api/status")
        response = connection.getresponse()
        info = json.loads(response.read(16384))
        if (response.status == 200 and info.get("app") == "tracktor-local"
                and info.get("instance_id") == state["instance_id"]
                and Path(info.get("database", "")).resolve() == database):
            return f"http://127.0.0.1:{port}/"
    except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
        pass
    finally:
        if connection:
            connection.close()
    return None


def wait_for_instance(database, state_file, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        url = running_instance(database, state_file)
        if url:
            return url
        time.sleep(0.1)
    raise RuntimeError("Сервер уже запускается, но пока не отвечает. Посмотрите data/launcher.log.")


def open_ready_browser(database, state_file):
    try:
        url = wait_for_instance(database, state_file)
        if not webbrowser.open(url):
            print(f"Не удалось открыть браузер автоматически. Откройте: {url}", flush=True)
    except (RuntimeError, webbrowser.Error) as error:
        print(f"Не удалось открыть сайт: {error}", flush=True)


def create_server(port, database):
    handler = partial(Handler, database=database)
    try:
        return ThreadingHTTPServer(("127.0.0.1", port), handler)
    except OSError as error:
        if not port or error.errno not in (errno.EADDRINUSE, errno.EACCES):
            raise
        # Let the OS choose and bind a free port in one operation (no race).
        return ThreadingHTTPServer(("127.0.0.1", 0), handler)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description="TRACKTOR: local SQLite server (one user)")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--database", type=Path, default=ROOT / "data" / "tracktor.sqlite3")
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("Порт должен быть в диапазоне 0–65535")
    database = args.database.resolve()
    state_file = database.with_suffix(".server.json")
    lock = InstanceLock(database)
    owns_lock = False
    try:
        owns_lock = lock.acquire()
        if not owns_lock:
            url = wait_for_instance(database, state_file)
            print(f"TRACKTOR: {url}\nПриложение уже работает. Второй сервер не запущен.", flush=True)
            if args.open_browser:
                webbrowser.open(url)
            return 0
        with create_server(args.port, database) as server:
            initialize(database)
            recover_interrupted(database, connect)
            server.instance_id = uuid.uuid4().hex
            state = {"port": server.server_port, "instance_id": server.instance_id, "pid": os.getpid()}
            temporary_state = state_file.with_suffix(".tmp")
            temporary_state.write_text(json.dumps(state), encoding="utf-8")
            temporary_state.replace(state_file)
            url = f"http://127.0.0.1:{server.server_port}/"
            print(f"TRACKTOR: {url}\nSQLite: {database}\nДля остановки нажмите Ctrl+C.", flush=True)
            if args.port and server.server_port != args.port:
                print(f"Порт {args.port} занят или недоступен. Выбран порт {server.server_port}.", flush=True)
            if args.open_browser:
                threading.Thread(target=open_ready_browser, args=(database, state_file), daemon=True).start()
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
    except (OSError, sqlite3.Error, RuntimeError, webbrowser.Error) as error:
        print(f"Не удалось запустить TRACKTOR: {error}", flush=True)
        return 1
    finally:
        if owns_lock:
            try:
                state_file.unlink(missing_ok=True)
            except OSError:
                pass
            lock.release()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
