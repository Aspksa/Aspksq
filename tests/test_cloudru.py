"""Cloud.ru integration tests. Only fake credentials and simulated provider replies."""
from contextlib import closing, contextmanager
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import cloudru
import server
from test_local_db import request

KEY = "test-key-cloudru-not-a-real-credential"
MODEL = "test/русская-модель"
CATALOG = {"data": [
    {"id": MODEL, "metadata": {"name": "Русская модель", "endpoints": [{"path": "/v1/chat/completions"}], "output_modalities": ["text"]}},
    {"id": "test/embed", "metadata": {"endpoints": [{"path": "/v1/embeddings"}]}},
    {"id": "test/image", "metadata": {"output_modalities": ["image"]}},
    {"id": "test/basic"}]}


class QuietHandler(server.Handler):
    def log_message(self, *args):
        pass


@contextmanager
def application(database):
    server.initialize(database)
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, database=database)) as httpd:
        httpd.instance_id = "test-instance"
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            yield httpd.server_port
        finally:
            httpd.shutdown()
            thread.join(timeout=5)


def response(value):
    return io.BytesIO(json.dumps(value, ensure_ascii=False).encode("utf-8"))


class CloudRuTests(unittest.TestCase):
    def test_save_list_verify_persist_backup_remove(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "tracktor.sqlite3"
            with application(database) as port:
                self.assertEqual(request(port, "/api/cloud/settings")[1]["has_key"], False)
                status, saved = request(port, "/api/cloud/settings", {"api_key": " Bearer " + KEY + " ", "model": MODEL})
                self.assertEqual(status, 200)
                self.assertTrue(saved["has_key"])
                self.assertNotIn(KEY, json.dumps(saved))
                with patch("cloudru.build_opener") as opener:
                    opener.return_value.open.return_value = response(CATALOG)
                    status, models = request(port, "/api/cloud/models")
                    self.assertEqual(status, 200)
                    self.assertEqual({m["id"] for m in models["data"]}, {MODEL, "test/basic"})
                    outbound = opener.return_value.open.call_args.args[0]
                    self.assertEqual(outbound.full_url, cloudru.BASE_URL + "/models")
                    self.assertEqual(outbound.get_header("Authorization"), "Bearer " + KEY)
                # Public model discovery is not proof of key validity.
                self.assertIsNone(request(port, "/api/cloud/settings")[1]["verified_at"])
                with patch("cloudru.build_opener") as opener:
                    opener.return_value.open.return_value = response({"choices": [{"message": {"content": "Работает. " + KEY}, "finish_reason": "stop"}]})
                    status, checked = request(port, "/api/cloud/test", {})
                    self.assertEqual(status, 200)
                    self.assertIn("Работает", checked["reply"])
                    self.assertNotIn(KEY, json.dumps(checked))
                    outbound = opener.return_value.open.call_args.args[0]
                    body = json.loads(outbound.data)
                    self.assertEqual(body["model"], MODEL)
                    self.assertEqual(body["max_tokens"], 128)
                    self.assertFalse(body["stream"])
                    self.assertNotIn(KEY, json.dumps(body))
                self.assertTrue(request(port, "/api/cloud/settings")[1]["verified_at"])
                self.assertEqual(request(port, "/api/cloudru_settings")[0], 404)
                self.assertEqual(request(port, "/cloudru.py")[0], 404)
                status, backup = request(port, "/api/backup")
                self.assertEqual(status, 200)
                backup_path = Path(temporary) / "backup.sqlite3"
                backup_path.write_bytes(backup)
                with closing(sqlite3.connect(backup_path)) as connection:
                    # A local DB backup intentionally contains the stored credential.
                    self.assertEqual(connection.execute("SELECT api_key FROM cloudru_settings").fetchone()[0], KEY)
            with application(database) as port:
                settings = request(port, "/api/cloud/settings")[1]
                self.assertEqual(settings["model"], MODEL)
                self.assertTrue(settings["has_key"])
                self.assertTrue(settings["verified_at"])
                status, removed = request(port, "/api/cloud/settings", {"remove_key": True})
                self.assertEqual(status, 200)
                self.assertEqual(removed, {"has_key": False, "model": "", "verified_at": None})
                self.assertEqual(request(port, "/api/cloud/test", {})[0], 400)

    def test_migrate_v1_without_resetting_user_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "tracktor.sqlite3"
            server.initialize(database)
            with closing(server.connect(database)) as connection, connection:
                connection.execute("DROP TABLE cloudru_settings")
                connection.execute("PRAGMA user_version=1")
                connection.execute("INSERT INTO skills(id,name) VALUES('user-skill','Мой навык')")
                connection.execute("INSERT INTO user_preferences(id,preferences) VALUES(1,'{\"layout\":\"hex\"}')")
            server.initialize(database)
            with closing(server.connect(database)) as connection:
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 3)
                self.assertEqual(connection.execute("SELECT count(*) FROM clients").fetchone()[0], 19)
                self.assertEqual(connection.execute("SELECT name FROM skills").fetchone()[0], "Мой навык")
                self.assertEqual(json.loads(connection.execute("SELECT preferences FROM user_preferences").fetchone()[0])["layout"], "hex")
                self.assertEqual(connection.execute("SELECT count(*) FROM cloudru_settings").fetchone()[0], 0)

    def test_provider_errors_and_bad_input_do_not_leak_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "tracktor.sqlite3"
            with application(database) as port:
                for invalid in ("", "bad\nheader-key", "русский-ключ", 123):
                    self.assertEqual(request(port, "/api/cloud/settings", {"api_key": invalid})[0], 400)
                request(port, "/api/cloud/settings", {"api_key": KEY, "model": MODEL})
                failures = [
                    (HTTPError(cloudru.BASE_URL, code, "private " + KEY, {}, io.BytesIO(KEY.encode())), expected)
                    for code, expected in [(401,401), (403,403), (402,402), (429,429), (302,502), (500,502)]]
                failures += [(TimeoutError(KEY),504), (URLError(KEY),502)]
                for error, expected in failures:
                    with self.subTest(error=type(error).__name__, status=expected), patch("cloudru.build_opener") as opener:
                        opener.return_value.open.side_effect = error
                        status, result = request(port, "/api/cloud/test", {})
                        self.assertEqual(status, expected)
                        self.assertNotIn(KEY, json.dumps(result))
                        self.assertIsNone(request(port, "/api/cloud/settings")[1]["verified_at"])
                with patch("cloudru.build_opener") as opener:
                    opener.return_value.open.return_value = io.BytesIO(b"not json")
                    self.assertEqual(request(port, "/api/cloud/models")[0], 502)
                self.assertEqual(request(port, "/api/status")[0], 200)

    def test_configuration_race_and_reasoning_only_reply(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "tracktor.sqlite3"
            with application(database) as port:
                request(port, "/api/cloud/settings", {"api_key": KEY, "model": MODEL})
                with patch("cloudru.provider_request", return_value={"choices":[{"message":{"content":None}, "finish_reason":"length"}]}):
                    status, result = request(port, "/api/cloud/test", {})
                    self.assertEqual(status, 200)
                    self.assertEqual(result["reply"], "")
                    self.assertIn("лимит", result["message"])
                request(port, "/api/cloud/settings", {"model": "test/other"})
                self.assertIsNone(request(port, "/api/cloud/settings")[1]["verified_at"])
                def changed_settings(*args):
                    cloudru.CloudRu(database, server.connect).save({"model": "test/changed-in-another-window"})
                    return {"choices":[{"message":{"content":"Работает"}, "finish_reason":"stop"}]}
                with patch("cloudru.provider_request", side_effect=changed_settings):
                    self.assertEqual(request(port, "/api/cloud/test", {})[0], 409)
                self.assertIsNone(request(port, "/api/cloud/settings")[1]["verified_at"])
                with patch("cloudru.provider_request", return_value={"choices":[{"message":{"content":""}, "finish_reason":"stop"}]}):
                    self.assertEqual(request(port, "/api/cloud/test", {})[0], 502)
                with patch("cloudru.provider_request", return_value={"choices":[{"message":{"content":{"unexpected":"object"}}, "finish_reason":"stop"}]}):
                    self.assertEqual(request(port, "/api/cloud/test", {})[0], 502)

    def test_redirect_cannot_forward_credentials(self):
        received = []
        class RedirectTarget(BaseHTTPRequestHandler):
            def do_GET(self):
                received.append(self.headers.get("Authorization"))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{}')
            def log_message(self, *args):
                pass
        with ThreadingHTTPServer(("127.0.0.1", 0), RedirectTarget) as target:
            class RedirectSource(RedirectTarget):
                def do_GET(self):
                    self.send_response(302)
                    self.send_header("Location", f"http://127.0.0.1:{target.server_port}/stolen")
                    self.end_headers()
            with ThreadingHTTPServer(("127.0.0.1", 0), RedirectSource) as source:
                threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in (source,target)]
                for thread in threads:
                    thread.start()
                try:
                    with patch("cloudru.BASE_URL", f"http://127.0.0.1:{source.server_port}"), self.assertRaises(cloudru.CloudError):
                        cloudru.provider_request("models", KEY)
                    self.assertEqual(received, [])
                finally:
                    source.shutdown()
                    target.shutdown()
                    for thread in threads:
                        thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
