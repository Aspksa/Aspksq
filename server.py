"""Single-user TRACKTOR server. Python standard library only."""
import argparse
from contextlib import closing
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
from urllib.parse import urlsplit
import uuid
import webbrowser

ROOT = Path(__file__).resolve().parent
STATIC_FILES = {"index.html": "text/html; charset=utf-8",
                "styles.css": "text/css; charset=utf-8",
                "app.js": "text/javascript; charset=utf-8",
                "database.js": "text/javascript; charset=utf-8"}
TABLES = {"clients": "sort_order, name", "projects": "sort_order, name",
          "skills": "sort_order, name", "routines": "sort_order, scheduled_at",
          "tasks": "due_at", "notifications": "created_at DESC"}


def connect(database):
    connection = sqlite3.connect(database, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def initialize(database):
    database.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(database)) as connection, connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > 1:
            raise RuntimeError("Database was created by a newer version of TRACKTOR")
        if version == 1:
            return
        connection.execute("BEGIN IMMEDIATE")
        schema = (ROOT / "sqlite-schema.sql").read_text(encoding="utf-8")
        for statement in schema.split(";"):
            if statement.strip():
                connection.execute(statement)
        seed = json.loads((ROOT / "seed-data.json").read_text(encoding="utf-8"))
        for table in ("clients", "projects", "routines"):
            for row in seed[table]:
                row = {"id": str(uuid.uuid4()), **row}
                columns = ",".join(row)
                placeholders = ",".join("?" for _ in row)
                connection.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", list(row.values()))
        connection.execute("PRAGMA user_version=1")


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
            if path == "/api/status":
                with closing(connect(self.database)) as connection:
                    connection.execute("SELECT 1 FROM user_preferences LIMIT 1")
                self.send_json(200, {"storage": "sqlite", "single_user": True,
                                     "database": str(self.database)})
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
        except (OSError, sqlite3.Error):
            self.log_error("Failed to read local database or file")
            self.send_json(500, {"error": "Не удалось прочитать файл или локальную базу"})

    def do_POST(self):
        if not self.allowed_request():
            self.send_json(403, {"error": "Разрешён только локальный доступ"})
            return
        path = urlsplit(self.path).path
        if path not in ("/api/preferences", "/api/skills"):
            self.send_json(404, {"error": "Не найдено"})
            return
        try:
            data = self.read_json()
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
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "Навык с таким названием уже существует"})
        except (ValueError, UnicodeError):
            self.send_json(400, {"error": "Некорректный запрос: проверьте название, описание и формат JSON"})
        except sqlite3.Error:
            self.log_error("Failed to write local database")
            self.send_json(500, {"error": "Не удалось сохранить данные в локальной базе"})


def main():
    parser = argparse.ArgumentParser(description="TRACKTOR: local SQLite server (one user)")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--database", type=Path, default=ROOT / "data" / "tracktor.sqlite3")
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()
    database = args.database.resolve()
    try:
        with ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, database=database)) as server:
            initialize(database)
            url = f"http://127.0.0.1:{server.server_port}/"
            print(f"TRACKTOR: {url}\nSQLite: {database}\nPress Ctrl+C to stop.", flush=True)
            if args.open_browser:
                threading.Thread(target=webbrowser.open, args=(url,), daemon=True).start()
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
    except (OSError, sqlite3.Error, RuntimeError) as error:
        print(f"Cannot start TRACKTOR: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
