"""Single-user, persistent skill execution through the configured Cloud.ru model."""
from contextlib import closing
from datetime import datetime, timezone
import json
import sqlite3
import sys
import threading
import uuid

import cloudru

BUILTIN_SKILLS = [
    {"id":"builtin:account-optimization", "name":"/оптимизация-аккаунта",
     "description":"Проанализируй предоставленные показатели рекламного аккаунта. Выдели проблемы, сформулируй проверяемые гипотезы, предложи приоритетный план оптимизации с метриками успеха. Не выдумывай расходы, конверсии и выполненные изменения.",
     "hint":"Опишите аккаунт, цель, период, расходы, конверсии и ограничения."},
    {"id":"builtin:three-step-report", "name":"/отчёт-в-3-шага",
     "description":"Подготовь отчёт в трёх разделах: 1. Факты и результаты по предоставленным данным. 2. Выводы и проблемы. 3. Следующие действия с приоритетами и критериями успеха. Отмечай недостающие данные и предположения.",
     "hint":"Вставьте исходные данные и укажите, для кого нужен отчёт."},
    {"id":"builtin:campaign-dashboard", "name":"/панель-кампаний",
     "description":"Подготовь сводку рекламных кампаний: понятную таблицу предоставленных показателей, сравнение кампаний, проблемы и рекомендации. Вычисляй производные показатели только из данных пользователя, объясняй формулы и не подменяй неизвестные числа вымышленными.",
     "hint":"Вставьте показатели кампаний, период и цель сравнения."},
    {"id":"builtin:creative-cycle", "name":"/цикл-креативов",
     "description":"Разработай цикл тестирования рекламных креативов по брифу пользователя: аудитория и оффер, гипотезы, варианты текстов и концепций, план A/B-теста, метрики и правила следующей итерации. Подготовь материалы для проверки пользователем без заявлений об их публикации.",
     "hint":"Опишите продукт, аудиторию, предложение, площадку и ограничения."}
]
SYSTEM_GUIDANCE = ("Ты выполняешь текстовый навык по задаче пользователя. Отвечай на русском, если пользователь не попросил другой язык. "
                   "Отделяй факты от предположений. Если данных не хватает, укажи это и задай конкретные вопросы. "
                   "У тебя нет инструментов изменения файлов, рекламных аккаунтов или внешних сервисов. "
                   "Не заявляй, что ты изменил настройки, запустил рекламу, опубликовал или отправил материалы.\n\n")
TOKEN_LIMITS = (1024, 2048, 4096, 8192)


def now():
    return datetime.now(timezone.utc).isoformat()


def catalog(database, connect):
    with closing(connect(database)) as connection:
        rows = connection.execute("SELECT id,name,description FROM skills WHERE enabled=1 ORDER BY sort_order,name").fetchall()
    return BUILTIN_SKILLS + [{"id":"custom:"+row["id"], "name":row["name"], "description":row["description"],
                              "hint":"Опишите задачу и вставьте исходные данные для этого навыка."} for row in rows]


def public_run(row):
    if row is None:
        return None
    result = dict(row)
    result["usage"] = json.loads(result["usage"])
    return result


def recover_interrupted(database, connect):
    # Called only by the server holding the database's process lock. Never retry a paid request automatically.
    with closing(connect(database)) as connection, connection:
        connection.execute("UPDATE skill_runs SET status='interrupted',error=?,finished_at=? WHERE status='running'",
                           ("Сервер был остановлен до сохранения ответа. Запрос мог быть обработан в Cloud.ru. Повторный запуск расходует токены.", now()))


class SkillRunner:
    def __init__(self, database, connect):
        self.database = database
        self.connect = connect

    def get(self, run_id):
        with closing(self.connect(self.database)) as connection:
            row = connection.execute("SELECT * FROM skill_runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise cloudru.CloudError("Запуск навыка не найден", 404)
        return public_run(row)

    def latest(self, skill_id):
        with closing(self.connect(self.database)) as connection:
            last = connection.execute("SELECT * FROM skill_runs WHERE skill_id=? ORDER BY rowid DESC LIMIT 1", (skill_id,)).fetchone()
            active = connection.execute("SELECT * FROM skill_runs WHERE status='running' ORDER BY rowid DESC LIMIT 1").fetchone()
        return {"run": public_run(last), "active_run": public_run(active)}

    def start(self, data):
        try:
            run_id = str(uuid.UUID(data.get("request_id", "")))
        except (ValueError, TypeError, AttributeError):
            raise cloudru.CloudError("Некорректный идентификатор запуска") from None
        task = data.get("task")
        skill_id = data.get("skill_id")
        limit = data.get("max_tokens", 2048)
        expected_model = data.get("expected_model")
        if not isinstance(task, str) or not task.strip() or len(task) > 10000:
            raise cloudru.CloudError("Введите задачу длиной от 1 до 10000 символов")
        if not isinstance(skill_id, str) or len(skill_id) > 200:
            raise cloudru.CloudError("Выберите навык")
        if type(limit) is not int or limit not in TOKEN_LIMITS:
            raise cloudru.CloudError("Выберите лимит ответа: 1024, 2048, 4096 или 8192 токена")
        if not isinstance(expected_model, str) or not expected_model:
            raise cloudru.CloudError("Сначала выберите модель Cloud.ru")
        task = task.strip()
        with closing(self.connect(self.database)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute("SELECT * FROM skill_runs WHERE id=?", (run_id,)).fetchone()
            if existing:
                if (existing["skill_id"] != skill_id or existing["task"] != task
                        or existing["max_tokens"] != limit or existing["model"] != expected_model):
                    raise cloudru.CloudError("Этот идентификатор уже принадлежит другой задаче", 409)
                return public_run(existing)
            if connection.execute("SELECT 1 FROM skill_runs WHERE status='running' LIMIT 1").fetchone():
                raise cloudru.CloudError("Навык уже выполняется. Дождитесь результата текущего запуска.", 409)
            # Use server-side instructions and credentials, not a prompt/model supplied by the browser.
            skills = {skill["id"]:skill for skill in catalog(self.database, self.connect)}
            skill = skills.get(skill_id)
            if skill is None:
                raise cloudru.CloudError("Навык удалён или отключён. Обновите список.", 404)
            credentials = cloudru.CloudRu(self.database, self.connect).require_credentials(model=True)
            if credentials["model"] != expected_model:
                raise cloudru.CloudError("Выбранная модель изменилась. Обновите окно навыка перед запуском.", 409)
            description = skill["description"] or ("Выполни навык «"+skill["name"]+"» по задаче пользователя.")
            if len(description) > 16000:
                raise cloudru.CloudError("Описание навыка слишком длинное")
            connection.execute("INSERT INTO skill_runs(id,skill_id,skill_name,description,model,task,max_tokens,status,created_at) "
                               "VALUES(?,?,?,?,?,?,?,'running',?)",
                               (run_id,skill_id,skill["name"],description,credentials["model"],task,limit,now()))
        try:
            threading.Thread(target=self.execute, args=(run_id,credentials), daemon=True).start()
        except RuntimeError:
            self.finish(run_id, "failed", error="Не удалось запустить выполнение. Повторите попытку позже.")
        return self.get(run_id)

    def finish(self, run_id, status, result="", error="", usage=None):
        with closing(self.connect(self.database)) as connection, connection:
            connection.execute("UPDATE skill_runs SET status=?,result=?,error=?,usage=?,finished_at=? WHERE id=? AND status='running'",
                               (status,result,error,json.dumps(usage or {}),now(),run_id))

    def execute(self, run_id, credentials):
        try:
            job = self.get(run_id)
            response = cloudru.provider_request("chat/completions", credentials["api_key"], {
                "model":job["model"], "messages":[
                    {"role":"system", "content":SYSTEM_GUIDANCE+"Навык: "+job["skill_name"]+"\nИнструкция: "+job["description"]},
                    {"role":"user", "content":job["task"]}],
                "max_completion_tokens":job["max_tokens"], "stream":False}, timeout=180)
            parsed = cloudru.completion_result(response, credentials["api_key"])
            if not parsed["reply"].strip():
                raise cloudru.CloudError("Модель исчерпала лимит на рассуждениях без итогового текста. Увеличьте лимит ответа или выберите другую модель."
                                         if parsed["finish_reason"] == "length" else "Модель не вернула текст результата. Проверьте задачу и выбранную модель.", 502)
            partial = parsed["finish_reason"] == "length"
            self.finish(run_id, "partial" if partial else "succeeded", result=parsed["reply"], usage=parsed["usage"],
                        error="Ответ обрезан лимитом токенов. Можно увеличить лимит и запустить задачу повторно." if partial else "")
        except cloudru.CloudError as error:
            try:
                self.finish(run_id, "failed", error=str(error).replace(credentials["api_key"], "[ключ скрыт]"))
            except (OSError, sqlite3.Error):
                print("Не удалось сохранить ошибку навыка: проверьте носитель с базой.", file=sys.stderr, flush=True)
        except Exception:
            # Never put exception bodies, credentials or provider responses into a job/log.
            try:
                self.finish(run_id, "failed", error="Не удалось выполнить или сохранить результат навыка. Проверьте доступность базы и настройки Cloud.ru.")
            except (OSError, sqlite3.Error):
                print("Не удалось сохранить результат навыка: проверьте носитель с базой.", file=sys.stderr, flush=True)
