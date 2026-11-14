"""Real HTTP + SQLite tests, isolated from the user's database."""
from contextlib import closing, contextmanager
import http.client
import json
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def running(database, preferred_port=0, root=ROOT):
    process = subprocess.Popen([sys.executable, str(root / "server.py"), "--port", str(preferred_port), "--database", str(database)],
                               cwd=database.parent, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8")
    try:
        line = process.stdout.readline().strip()
        if not line.startswith("TRACKTOR: http://"):
            raise RuntimeError("Server startup failed: " + line)
        yield urlsplit(line.split(" ", 1)[1]).port
    finally:
        process.terminate()
        process.wait(timeout=10)
        process.stdout.close()


def request(port, path, data=None, headers=None, raw=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    body = json.dumps(data).encode() if data is not None else raw
    request_headers = {"Content-Type": "application/json"} if body is not None else {}
    request_headers.update(headers or {})
    try:
        connection.request("POST" if body is not None else "GET", path, body, request_headers)
        response = connection.getresponse()
        content = response.read()
        value = json.loads(content) if response.getheader("Content-Type", "").startswith("application/json") else content
        return response.status, value
    finally:
        connection.close()


class LocalDatabaseTests(unittest.TestCase):
    def test_occupied_port_and_repeated_launches(self):
        with tempfile.TemporaryDirectory() as temporary, socket.socket() as occupied:
            occupied.bind(("127.0.0.1", 0))
            occupied.listen()
            taken_port = occupied.getsockname()[1]
            database = Path(temporary) / "tracktor.sqlite3"
            with running(database, preferred_port=taken_port) as port:
                self.assertNotEqual(port, taken_port)
                status = request(port, "/api/status")[1]
                command = [sys.executable, str(ROOT / "server.py"), "--database", str(database)]
                # Concurrent double-clicks must converge on the same running instance.
                duplicates = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(4)]
                try:
                    for duplicate in duplicates:
                        output, errors = duplicate.communicate(timeout=20)
                        self.assertEqual(duplicate.returncode, 0, errors.decode("utf-8", errors="replace"))
                        self.assertIn(f"TRACKTOR: http://127.0.0.1:{port}/", output.decode("utf-8"))
                    self.assertEqual(request(port, "/api/status")[1]["instance_id"], status["instance_id"])
                finally:
                    for duplicate in duplicates:
                        if duplicate.poll() is None:
                            duplicate.kill()
                            duplicate.communicate()
            # A stale state file after a killed process must not block the next launch.
            with running(database) as port:
                self.assertNotEqual(request(port, "/api/status")[1]["instance_id"], status["instance_id"])

    def test_cyrillic_and_shell_characters_in_project_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary) / "Русский путь (скобки) & ! 100% О'Брайен [тест]"
            project.mkdir()
            for name in ("server.py", "seed-data.json", "sqlite-schema.sql", "index.html"):
                shutil.copyfile(ROOT / name, project / name)
            database = project / "tracktor.sqlite3"
            with running(database, root=project) as port:
                self.assertEqual(request(port, "/api/status")[1]["database"], str(database.resolve()))
                self.assertEqual(request(port, "/")[0], 200)
                self.assertEqual(request(port, "/api/skills", {"name": "Русский навык (тест) & ! % ' [1]"})[0], 201)

    def test_persistence_backup_and_first_run(self):
        with tempfile.TemporaryDirectory(prefix="tracktor test ") as temporary:
            database = Path(temporary) / "данные" / "tracktor.sqlite3"
            # Start from another folder, as a BAT launched from Explorer may do.
            database.parent.mkdir()
            with running(database) as port:
                self.assertEqual(request(port, "/api/status")[1]["storage"], "sqlite")
                clients = request(port, "/api/clients")[1]
                self.assertEqual(len(clients), 19)
                self.assertEqual(len(request(port, "/api/projects")[1]), 20)
                self.assertEqual(len(request(port, "/api/routines")[1]), 6)
                preferences = {"layout": "hex", "theme": "Бордо", "names": True, "angle": 0.4}
                self.assertEqual(request(port, "/api/preferences", preferences), (200, preferences))
                status, skill = request(port, "/api/skills", {"name": " /мой-навык ", "description": "Локальные данные"})
                self.assertEqual(status, 201)
                self.assertEqual(skill["name"], "/мой-навык")
                self.assertEqual(request(port, "/api/skills", {"name": "/мой-навык"})[0], 409)
                self.assertEqual(len(request(port, "/api/skills")[1]), 1)
                status, backup = request(port, "/api/backup")
                self.assertEqual(status, 200)
                backup_path = Path(temporary) / "backup.sqlite3"
                backup_path.write_bytes(backup)
                with closing(sqlite3.connect(backup_path)) as connection:
                    self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                    self.assertEqual(connection.execute("SELECT name FROM skills").fetchone()[0], "/мой-навык")
                    self.assertEqual(json.loads(connection.execute("SELECT preferences FROM user_preferences").fetchone()[0]), preferences)
            # Restart preserves rows and IDs, without resetting or duplicating seed data.
            with running(database) as port:
                self.assertEqual(request(port, "/api/preferences")[1], preferences)
                self.assertEqual(request(port, "/api/skills")[1][0]["id"], skill["id"])
                self.assertEqual(request(port, "/api/clients")[1], clients)

    def test_validation_and_local_access(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "tracktor.sqlite3"
            with running(database) as port:
                self.assertEqual(request(port, "/")[0], 200)
                for path in ("/data/tracktor.sqlite3", "/server.py", "/../server.py", "/api/missing"):
                    self.assertEqual(request(port, path)[0], 404)
                self.assertEqual(request(port, "/api/skills", {"name": ""})[0], 400)
                self.assertEqual(request(port, "/api/skills", {"name": "a", "description": 123})[0], 400)
                self.assertEqual(request(port, "/api/preferences", raw=b"{")[0], 400)
                self.assertEqual(request(port, "/api/preferences", raw=b"[]")[0], 400)
                self.assertEqual(request(port, "/api/preferences", raw=b"x" * 65537)[0], 400)
                self.assertEqual(request(port, "/api/preferences", {}, {"Content-Type": "text/plain"})[0], 400)
                self.assertEqual(request(port, "/api/status", headers={"Host": "other.example"})[0], 403)
                self.assertEqual(request(port, "/api/skills", {"name": "bad"}, {"Origin": "https://other.example"})[0], 403)
                self.assertEqual(request(port, "/api/skills")[1], [])
                self.assertIsNone(request(port, "/api/preferences")[1])


if __name__ == "__main__":
    unittest.main()
