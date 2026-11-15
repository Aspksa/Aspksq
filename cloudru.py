"""Cloud.ru Foundation Models client; credentials stay on the local server."""
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import http.client
import json
import socket
import ssl
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE_URL = "https://foundation-models.api.cloud.ru/v1"
MAX_RESPONSE = 2 * 1024 * 1024


class CloudError(Exception):
    def __init__(self, message, status=400, code="cloud_error"):
        super().__init__(message)
        self.status = status
        self.code = code


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        # Never forward an Authorization header to a redirected host.
        return None


def _validation_details(payload):
    value = payload.get("error", payload) if isinstance(payload, dict) else {}
    if not isinstance(value, dict):
        return "", "", ""
    return tuple(value.get(key, "") if isinstance(value.get(key, ""), str) else "" for key in ("code", "param", "message"))


def _alternate_limit(payload, data):
    if not isinstance(data, dict):
        return None
    code, param, message = _validation_details(payload)
    fields = ("max_completion_tokens", "max_tokens")
    # Retry only an explicit parameter-validation rejection, never a request
    # whose generation/charging outcome is unknown.
    if param in fields and param in data and code in ("unsupported_parameter", "unknown_parameter", "unrecognized_request_argument"):
        return param, fields[1] if param == fields[0] else fields[0]
    return None


def _retry_wait(headers):
    value = (headers or {}).get("Retry-After", "")
    try:
        seconds = int(value)
    except (ValueError, TypeError):
        try:
            date = parsedate_to_datetime(value)
            seconds = int((date - datetime.now(timezone.utc)).total_seconds()) + 1
        except (ValueError, TypeError, OverflowError):
            return ""
    return f" Подождите {min(max(seconds, 1), 86400)} сек." if seconds >= 0 else ""


def _http_failure(status, payload, headers):
    code, param, message = _validation_details(payload)
    details = (code + " " + message).lower()
    if code in ("content_filter", "content_policy_violation", "guardrail_blocked") or "content policy" in details:
        return CloudError("Запрос заблокирован моделью или правилом защиты Cloud.ru. Проверьте текст задачи и правила проекта.", 400, "content_filter")
    if status == 401:
        return CloudError("Cloud.ru отклонил ключ. Проверьте Key Secret сервиса Foundation Models, срок действия, проект, разрешённые IP и время работы ключа.", 401, "invalid_key")
    if status == 403:
        return CloudError("Cloud.ru запретил доступ. Проверьте права ключа на Foundation Models, IP/временные ограничения и доступ к выбранной модели.", 403, "access_denied")
    if status == 402:
        return CloudError("Cloud.ru требует оплату. Проверьте баланс и доступ к модели в личном кабинете.", 402, "payment_required")
    if status == 407:
        return CloudError("Прокси требует авторизацию. Проверьте настройки HTTPS-прокси Windows или корпоративной сети.", 502, "proxy_error")
    if status == 429:
        return CloudError("Достигнут лимит или квота Cloud.ru." + _retry_wait(headers) + " Проверьте квоты проекта; платный запрос автоматически не повторяется.", 429, "rate_limit")
    if status in (408, 504):
        return CloudError("Cloud.ru не завершил запрос вовремя. Он мог быть принят; автоматической повторной отправки нет.", 504, "timeout")
    if status == 413 or code == "context_length_exceeded" or any(text in details for text in ("maximum context length", "context window", "context length exceeded", "too many tokens")):
        return CloudError("Превышен размер запроса или контекст модели. Сократите задачу/описание навыка, уменьшите лимит ответа или выберите модель с большим контекстом.", 400, "context_limit")
    if status == 404:
        return CloudError("Модель или ресурс Cloud.ru недоступны. Обновите список моделей и проверьте выбранный идентификатор.", 400, "model_unavailable")
    if status in (400, 422):
        return CloudError("Cloud.ru отклонил параметры запроса. Проверьте модель, её поддержку текстового чата и выбранный лимит ответа.", 400, "invalid_request")
    return CloudError("Cloud.ru временно недоступен или изменил адрес API. Запрос автоматически не повторяется.", 502, "provider_unavailable")


def _network_failure(error):
    reason = error.reason if isinstance(error, URLError) else error
    if isinstance(reason, (socket.timeout, TimeoutError)):
        return CloudError("Cloud.ru не ответил вовремя. Запрос мог быть принят; автоматической повторной отправки нет.", 504, "timeout")
    if isinstance(reason, ssl.SSLCertVerificationError):
        return CloudError("Не удалось проверить HTTPS-сертификат Cloud.ru. Проверьте дату компьютера, корневые сертификаты Windows и настройки HTTPS-прокси/антивируса. Проверка TLS остаётся включённой.", 502, "tls_certificate")
    if isinstance(reason, ssl.SSLError):
        return CloudError("Ошибка защищённого соединения с Cloud.ru. Проверьте HTTPS-прокси и доступ к порту 443.", 502, "tls_error")
    if isinstance(reason, socket.gaierror):
        return CloudError("DNS не нашёл foundation-models.api.cloud.ru. Проверьте интернет, DNS и настройки сети.", 502, "dns_error")
    if "tunnel" in str(reason).lower() and "407" in str(reason):
        return CloudError("HTTPS-прокси требует авторизацию. Проверьте настройки прокси.", 502, "proxy_error")
    return CloudError("Соединение с Cloud.ru прервано или недоступно. Проверьте интернет, прокси, антивирус и исходящий HTTPS на порт 443. Запрос автоматически не повторяется.", 502, "connection_error")


def provider_request(path, api_key, data=None, timeout=40):
    if path not in ("models", "chat/completions"):
        raise CloudError("Неизвестный метод Cloud.ru")
    data = dict(data) if data is not None else None
    deadline = time.monotonic() + timeout
    for attempt in range(2):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None
        request = Request(BASE_URL + "/" + path, data=body,
                          headers={"Authorization": "Bearer " + api_key,
                                   "Content-Type": "application/json", "Accept": "application/json"})
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            with build_opener(NoRedirect()).open(request, timeout=remaining) as response:
                raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise CloudError("Cloud.ru вернул слишком большой ответ", 502, "invalid_response")
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise CloudError("Неожиданный формат ответа Cloud.ru", 502, "invalid_response")
            if "error" in value and "choices" not in value and "data" not in value:
                raise _http_failure(400, value, {})
            return value
        except HTTPError as error:
            status, headers = error.code, error.headers
            # Inspect only bounded JSON for known error categories. Never echo bodies.
            try:
                payload = json.loads(error.read(32768))
            except (ValueError, UnicodeError, OSError, http.client.HTTPException):
                payload = {}
            finally:
                error.close()
            alternate = _alternate_limit(payload, data)
            if attempt == 0 and status in (400, 422) and alternate and path == "chat/completions":
                previous, replacement = alternate
                if replacement not in data:
                    data[replacement] = data.pop(previous)
                    continue
            raise _http_failure(status, payload, headers) from None
        except (URLError, OSError, http.client.HTTPException) as error:
            raise _network_failure(error) from None
        except (ValueError, UnicodeError):
            raise CloudError("Cloud.ru вернул некорректный JSON-ответ.", 502, "invalid_response") from None


_VERIFY_LOCK = threading.Lock()
_VERIFY_ACTIVE = set()


@contextmanager
def _single_verification(database):
    name = str(database.resolve())
    with _VERIFY_LOCK:
        if name in _VERIFY_ACTIVE:
            raise CloudError("Проверка Cloud.ru уже выполняется. Дождитесь её результата или откройте окно снова позже.", 409, "verification_running")
        _VERIFY_ACTIVE.add(name)
    try:
        yield
    finally:
        with _VERIFY_LOCK:
            _VERIFY_ACTIVE.discard(name)


def completion_result(response, api_key):
    choices = response.get("choices") if isinstance(response, dict) else None
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise CloudError("Cloud.ru не вернул результат запроса к модели", 502)
    choice = choices[0]
    message = choice.get("message")
    if not isinstance(message, dict):
        raise CloudError("Cloud.ru вернул неожиданный ответ модели", 502)
    if choice.get("finish_reason") == "content_filter" or (message.get("refusal") and not message.get("content")):
        raise CloudError("Модель или правило защиты отказали в выполнении запроса. Проверьте текст задачи и правила проекта Cloud.ru.", 400, "content_filter")
    content = message.get("content")
    if isinstance(content, list):
        content = "\n".join(part.get("text", "") for part in content if isinstance(part, dict) and isinstance(part.get("text"), str))
    if content is not None and not isinstance(content, str):
        raise CloudError("Cloud.ru вернул неожиданный формат текста модели", 502)
    reply = content.replace(api_key, "[ключ скрыт]") if isinstance(content, str) else ""
    raw_usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
    usage = {key:raw_usage[key] for key in ("prompt_tokens","completion_tokens","total_tokens")
             if type(raw_usage.get(key)) is int and raw_usage[key] >= 0}
    return {"reply":reply, "finish_reason":choice.get("finish_reason"), "usage":usage}


def normalize_key(value):
    if not isinstance(value, str):
        raise CloudError("Введите Key Secret текстом")
    value = value.strip().lstrip("\ufeff").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        value = value[1:-1].strip()
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
            if isinstance(endpoints, list) and not any(isinstance(e, dict) and e.get("path") == "/v1/chat/completions" and e.get("method", "POST") in ("POST", "post") for e in endpoints):
                continue
            kind = metadata.get("type")
            if isinstance(kind, str) and kind.lower() in ("guard", "embedder", "embedding", "rerank", "reranker", "image+text-to-text", "audio-to-text", "tts", "text-to-image"):
                continue
            inputs = metadata.get("input_modalities")
            if isinstance(inputs, list) and "text" not in inputs:
                continue
            output = metadata.get("output_modalities")
            if isinstance(output, list) and "text" not in output:
                continue
            name = metadata.get("name")
            context = item.get("context_length")
            models[item["id"]] = {"id": item["id"], "name": name if isinstance(name, str) else item["id"],
                                   "context_length": context if type(context) is int and context > 0 else None,
                                   "reasoning": bool(item.get("reasoning")), "provider": metadata.get("provider") if metadata.get("provider") in ("cloud.ru", "external") else "unknown"}
        return {"data": sorted(models.values(), key=lambda m: str(m["name"]).casefold())}

    def verify(self, max_tokens=128):
        if type(max_tokens) is not int or max_tokens not in (128, 512, 1024):
            raise CloudError("Выберите лимит проверки: 128, 512 или 1024 токена")
        with _single_verification(self.database):
            return self._verify_once(max_tokens)

    def _verify_once(self, max_tokens):
        row = self.require_credentials(model=True)
        try:
            response = provider_request("chat/completions", row["api_key"], {
                "model": row["model"], "messages": [{"role": "user", "content": "Ответь одним словом: работает."}],
                "max_completion_tokens": max_tokens, "stream": False}, timeout=60)
            parsed = completion_result(response, row["api_key"])
            reply = parsed["reply"].strip()
            if not reply and parsed["finish_reason"] != "length":
                raise CloudError("Модель вернула пустой ответ. Выберите другую модель или повторите проверку.", 502)
            verified_at = datetime.now(timezone.utc).isoformat() if reply else None
            with closing(self.connect(self.database)) as connection, connection:
                changed = connection.execute("UPDATE cloudru_settings SET verified_at=? WHERE id=1 AND api_key=? AND model=?",
                                             (verified_at, row["api_key"], row["model"])).rowcount
            if not changed:
                raise CloudError("Настройки изменились во время проверки. Проверьте выбранную модель ещё раз.", 409)
            # No reasoning trace or full provider response is returned to the browser.
            return {"model": row["model"], "verified_at": verified_at, "reply": reply[:12000],
                    "message": "Cloud.ru принял ключ и запрос к выбранной модели." if reply else
                               "Ключ принят, но модель исчерпала лимит проверки без итогового текста. Работа модели ещё не подтверждена: увеличьте лимит проверки или выберите другую модель."}
        except CloudError:
            with closing(self.connect(self.database)) as connection, connection:
                connection.execute("UPDATE cloudru_settings SET verified_at=NULL WHERE id=1 AND api_key=? AND model=?", (row["api_key"], row["model"]))
            raise
