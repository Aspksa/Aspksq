"""Cloud.ru Foundation Models client; credentials stay on the local server."""
from contextlib import closing
from datetime import datetime, timezone
import json
import socket
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE_URL = "https://foundation-models.api.cloud.ru/v1"
MAX_RESPONSE = 2 * 1024 * 1024


class CloudError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        # Never forward an Authorization header to a redirected host.
        return None


def provider_request(path, api_key, data=None):
    if path not in ("models", "chat/completions"):
        raise CloudError("Неизвестный метод Cloud.ru")
    body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None
    request = Request(BASE_URL + "/" + path, data=body,
                      headers={"Authorization": "Bearer " + api_key,
                               "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with build_opener(NoRedirect()).open(request, timeout=40) as response:
            raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise CloudError("Cloud.ru вернул слишком большой ответ", 502)
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise CloudError("Неожиданный формат ответа Cloud.ru", 502)
        return value
    except HTTPError as error:
        # Provider bodies can echo credentials; do not return or log them.
        code = error.code
        error.close()
        if code == 401:
            raise CloudError("Cloud.ru отклонил ключ. Укажите действующий Key Secret для Foundation Models.", 401) from None
        if code == 403:
            raise CloudError("Cloud.ru запретил доступ. Проверьте права ключа на Foundation Models и выбранную модель.", 403) from None
        if code == 402:
            raise CloudError("Cloud.ru требует оплату. Проверьте баланс и доступ к модели в личном кабинете.", 402) from None
        if code == 429:
            raise CloudError("Достигнут лимит или квота Cloud.ru. Повторите запрос позже.", 429) from None
        if code in (400, 404, 422):
            raise CloudError("Cloud.ru не принял запрос к модели. Обновите список и проверьте доступ к выбранной модели.", 400) from None
        raise CloudError("Cloud.ru временно недоступен или изменил адрес API. Повторите проверку позже.", 502) from None
    except (socket.timeout, TimeoutError):
        raise CloudError("Cloud.ru не ответил вовремя. Повторите проверку позже.", 504) from None
    except (URLError, OSError):
        raise CloudError("Не удалось связаться с Cloud.ru. Проверьте интернет и доступ к foundation-models.api.cloud.ru.", 502) from None
    except (ValueError, UnicodeError):
        raise CloudError("Cloud.ru вернул некорректный JSON-ответ.", 502) from None


def normalize_key(value):
    if not isinstance(value, str):
        raise CloudError("Введите Key Secret текстом")
    value = value.strip()
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    if not 8 <= len(value) <= 4096 or any(ord(c) < 33 or ord(c) > 126 for c in value):
        raise CloudError("Введите Key Secret без пробелов и переносов строк")
    return value


def normalize_model(value):
    if not isinstance(value, str) or len(value) > 300 or any(ord(c) < 32 for c in value):
        raise CloudError("Некорректный идентификатор модели")
    return value.strip()


class CloudRu:
    def __init__(self, database, connect):
        self.database = database
        self.connect = connect

    def credentials(self):
        with closing(self.connect(self.database)) as connection:
            row = connection.execute("SELECT * FROM cloudru_settings WHERE id=1").fetchone()
        return dict(row) if row else {"api_key": "", "model": "", "verified_at": None}

    @staticmethod
    def public_settings(row):
        return {"has_key": bool(row["api_key"]), "model": row["model"], "verified_at": row["verified_at"]}

    def settings(self):
        return self.public_settings(self.credentials())

    def save(self, data):
        remove_key = data.get("remove_key", False)
        if not isinstance(remove_key, bool):
            raise CloudError("Некорректный запрос удаления ключа")
        new_key = normalize_key(data["api_key"]) if "api_key" in data and not remove_key else None
        new_model = normalize_model(data["model"]) if "model" in data else None
        with closing(self.connect(self.database)) as connection, connection:
            connection.execute("PRAGMA secure_delete=ON")
            connection.execute("INSERT OR IGNORE INTO cloudru_settings(id) VALUES(1)")
            row = dict(connection.execute("SELECT * FROM cloudru_settings WHERE id=1").fetchone())
            key = "" if remove_key else new_key if new_key is not None else row["api_key"]
            model = "" if remove_key else new_model if new_model is not None else row["model"]
            verified = row["verified_at"] if key == row["api_key"] and model == row["model"] else None
            connection.execute("UPDATE cloudru_settings SET api_key=?,model=?,verified_at=? WHERE id=1", (key, model, verified))
        return {"has_key": bool(key), "model": model, "verified_at": verified}

    def require_credentials(self, model=False):
        row = self.credentials()
        if not row["api_key"]:
            raise CloudError("Сначала сохраните Key Secret Cloud.ru")
        if model and not row["model"]:
            raise CloudError("Сначала выберите и сохраните модель")
        return row

    def models(self):
        row = self.require_credentials()
        response = provider_request("models", row["api_key"])
        if not isinstance(response.get("data"), list):
            raise CloudError("Cloud.ru не вернул список моделей", 502)
        models = {}
        for item in response["data"]:
            if (not isinstance(item, dict) or not isinstance(item.get("id"), str)
                    or not item["id"].strip() or len(item["id"]) > 300
                    or any(ord(c) < 32 for c in item["id"])):
                continue
            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            endpoints = metadata.get("endpoints")
            if isinstance(endpoints, list) and not any(isinstance(e, dict) and e.get("path") == "/v1/chat/completions" for e in endpoints):
                continue
            output = metadata.get("output_modalities")
            if isinstance(output, list) and "text" not in output:
                continue
            name = metadata.get("name")
            context = item.get("context_length")
            models[item["id"]] = {"id": item["id"], "name": name if isinstance(name, str) else item["id"],
                                   "context_length": context if type(context) is int and context > 0 else None,
                                   "reasoning": bool(item.get("reasoning"))}
        return {"data": sorted(models.values(), key=lambda m: str(m["name"]).casefold())}

    def verify(self):
        row = self.require_credentials(model=True)
        try:
            response = provider_request("chat/completions", row["api_key"], {
                "model": row["model"], "messages": [{"role": "user", "content": "Ответь одним словом: работает."}],
                "max_tokens": 128, "stream": False})
            choices = response.get("choices")
            if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                raise CloudError("Cloud.ru не вернул результат запроса к модели", 502)
            choice = choices[0]
            message = choice.get("message")
            if not isinstance(message, dict):
                raise CloudError("Cloud.ru вернул неожиданный ответ модели", 502)
            content = message.get("content")
            if isinstance(content, list):
                content = "\n".join(part.get("text", "") for part in content if isinstance(part, dict) and isinstance(part.get("text"), str))
            if not content and choice.get("finish_reason") != "length":
                raise CloudError("Модель вернула пустой ответ. Выберите другую модель или повторите проверку.", 502)
            reply = content.replace(row["api_key"], "[ключ скрыт]") if isinstance(content, str) else ""
            verified_at = datetime.now(timezone.utc).isoformat()
            with closing(self.connect(self.database)) as connection, connection:
                changed = connection.execute("UPDATE cloudru_settings SET verified_at=? WHERE id=1 AND api_key=? AND model=?",
                                             (verified_at, row["api_key"], row["model"])).rowcount
            if not changed:
                raise CloudError("Настройки изменились во время проверки. Проверьте выбранную модель ещё раз.", 409)
            # No reasoning trace or full provider response is returned to the browser.
            return {"model": row["model"], "verified_at": verified_at, "reply": reply[:12000],
                    "message": "Cloud.ru принял ключ и запрос к выбранной модели." if reply else
                               "Cloud.ru принял запрос. Модель исчерпала короткий лимит проверки до финального ответа."}
        except CloudError:
            with closing(self.connect(self.database)) as connection, connection:
                connection.execute("UPDATE cloudru_settings SET verified_at=NULL WHERE id=1 AND api_key=? AND model=?", (row["api_key"], row["model"]))
            raise
