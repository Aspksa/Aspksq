"""Persistent text chat; accepting a turn never depends on a browser staying open."""
from contextlib import closing
import json
import math
import sqlite3
import sys
import threading
import uuid

import cloudru
from skillrunner import TOKEN_LIMITS, now, public_run

SYSTEM = ("Ты помощник в локальном приложении TRACKTOR. Отвечай на русском, если пользователь не попросил другой язык. "
          "Помогай с задачами, планированием, текстами и анализом предоставленных данных. "
          "Не выдумывай факты. У тебя нет доступа к данным проекта, файлам, интернету или инструментам действий. "
          "Не утверждай, что ты прочитал проект, изменил файлы, отправил или опубликовал что-либо. "
          "Ты видишь только сообщения этого диалога.")


def identifier(value):
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise cloudru.CloudError("Некорректный идентификатор диалога или сообщения") from None


def recover_chat(database, connect):
    with closing(connect(database)) as connection, connection:
        connection.execute("UPDATE chat_turns SET status='interrupted',error=?,finished_at=? WHERE status='running'",
                           ("Сервер остановлен до сохранения ответа. Запрос мог быть обработан в Cloud.ru; автоматического повтора нет.", now()))


class ChatRunner:
    def __init__(self, database, connect):
        self.database, self.connect = database, connect

    def position(self, data=None):
        if data is not None:
            if any(type(data.get(key)) not in (int, float) or not math.isfinite(data[key]) or not 0 <= data[key] <= 1 for key in ('x', 'y')):
                raise cloudru.CloudError("Некорректное положение аватара")
        with closing(self.connect(self.database)) as connection, connection:
            if data is not None:
                connection.execute("INSERT OR IGNORE INTO assistant_state(id) VALUES(1)")
                connection.execute("UPDATE assistant_state SET x=?,y=? WHERE id=1", (data['x'], data['y']))
            row = connection.execute("SELECT x,y FROM assistant_state WHERE id=1").fetchone()
        return dict(row) if row else {'x': 1, 'y': 1}

    def snapshot(self, session_id=None):
        with closing(self.connect(self.database)) as connection:
            sessions = [dict(row) for row in connection.execute("SELECT * FROM chat_sessions ORDER BY rowid DESC")]
            if session_id is None:
                state = connection.execute("SELECT active_session FROM assistant_state WHERE id=1").fetchone()
                session_id = state[0] if state else None
                if not session_id and sessions:
                    session_id = sessions[0]['id']
            elif session_id:
                session_id = identifier(session_id)
            if session_id and not connection.execute("SELECT 1 FROM chat_sessions WHERE id=?", (session_id,)).fetchone():
                raise cloudru.CloudError("Диалог не найден", 404)
            turns = list(reversed(connection.execute("SELECT * FROM chat_turns WHERE session_id=? ORDER BY rowid DESC LIMIT 100", (session_id,)).fetchall()))
            active = connection.execute("SELECT id,session_id FROM chat_turns WHERE status='running' LIMIT 1").fetchone()
        return {'sessions': sessions, 'session_id': session_id, 'turns': [public_run(row) for row in turns],
                'active': dict(active) if active else None}

    def session(self, data):
        session_id = identifier(data.get('session_id'))
        with closing(self.connect(self.database)) as connection, connection:
            if data.get('create') is True:
                connection.execute("INSERT OR IGNORE INTO chat_sessions(id,created_at) VALUES(?,?)", (session_id, now()))
            elif not connection.execute("SELECT 1 FROM chat_sessions WHERE id=?", (session_id,)).fetchone():
                raise cloudru.CloudError("Диалог не найден", 404)
            connection.execute("INSERT OR IGNORE INTO assistant_state(id) VALUES(1)")
            connection.execute("UPDATE assistant_state SET active_session=? WHERE id=1", (session_id,))
        return self.snapshot(session_id)

    def get(self, turn_id):
        with closing(self.connect(self.database)) as connection:
            row = connection.execute("SELECT * FROM chat_turns WHERE id=?", (identifier(turn_id),)).fetchone()
        if row is None:
            raise cloudru.CloudError("Сообщение не найдено", 404)
        return public_run(row)

    def start(self, data):
        turn_id, session_id = identifier(data.get('request_id')), identifier(data.get('session_id'))
        task, limit, model = data.get('task'), data.get('max_tokens', 2048), data.get('expected_model')
        if not isinstance(task, str) or not task.strip() or len(task) > 10000:
            raise cloudru.CloudError("Введите сообщение длиной от 1 до 10000 символов")
        if type(limit) is not int or limit not in TOKEN_LIMITS:
            raise cloudru.CloudError("Выберите лимит ответа: 1024, 2048, 4096 или 8192 токена")
        if not isinstance(model, str) or not model:
            raise cloudru.CloudError("Сначала выберите модель Cloud.ru")
        task = task.strip()
        with closing(self.connect(self.database)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            previous = connection.execute("SELECT * FROM chat_turns WHERE id=?", (turn_id,)).fetchone()
            if previous:
                if (previous['session_id'], previous['task'], previous['model'], previous['max_tokens']) != (session_id, task, model, limit):
                    raise cloudru.CloudError("Этот идентификатор принадлежит другому сообщению", 409)
                return public_run(previous)
            if not connection.execute("SELECT 1 FROM chat_sessions WHERE id=?", (session_id,)).fetchone():
                raise cloudru.CloudError("Диалог не найден", 404)
            if (connection.execute("SELECT 1 FROM chat_turns WHERE status='running' LIMIT 1").fetchone()
                    or connection.execute("SELECT 1 FROM skill_runs WHERE status='running' LIMIT 1").fetchone()):
                raise cloudru.CloudError("Уже выполняется запрос чата или навыка. Дождитесь результата.", 409)
            credentials = cloudru.CloudRu(self.database, self.connect).require_credentials(model=True)
            if credentials['model'] != model:
                raise cloudru.CloudError("Модель изменилась. Закройте и откройте чат перед отправкой.", 409)
            connection.execute("INSERT INTO chat_turns(id,session_id,task,model,max_tokens,status,created_at) VALUES(?,?,?,?,?,'running',?)",
                               (turn_id, session_id, task, model, limit, now()))
            connection.execute("UPDATE chat_sessions SET title=? WHERE id=? AND (SELECT COUNT(*) FROM chat_turns WHERE session_id=?)=1",
                               (task.replace('\n', ' ')[:70], session_id, session_id))
        try:
            threading.Thread(target=self.execute, args=(turn_id, credentials), daemon=True).start()
        except RuntimeError:
            self.finish(turn_id, 'failed', error="Не удалось начать запрос. Автоматического повтора нет.")
        return self.get(turn_id)

    def messages(self, turn):
        # Keep complete exchanges, bounded by both count and characters; never include another dialog or failed replies.
        with closing(self.connect(self.database)) as connection:
            rows = connection.execute("SELECT task,result FROM chat_turns WHERE session_id=? AND status IN ('succeeded','partial') "
                                      "AND rowid < (SELECT rowid FROM chat_turns WHERE id=?) ORDER BY rowid DESC LIMIT 12",
                                      (turn['session_id'], turn['id'])).fetchall()
        history, size = [], 0
        for row in rows:
            size += len(row['task']) + len(row['result'])
            if size > 24000:
                break
            history.append(row)
        messages = [{'role': 'system', 'content': SYSTEM}]
        for row in reversed(history):
            messages.extend([{'role': 'user', 'content': row['task']}, {'role': 'assistant', 'content': row['result']}])
        return messages + [{'role': 'user', 'content': turn['task']}]

    def finish(self, turn_id, status, result='', error='', usage=None):
        with closing(self.connect(self.database)) as connection, connection:
            connection.execute("UPDATE chat_turns SET status=?,result=?,error=?,usage=?,finished_at=? WHERE id=? AND status='running'",
                               (status, result, error, json.dumps(usage or {}), now(), turn_id))

    def execute(self, turn_id, credentials):
        try:
            turn = self.get(turn_id)
            response = cloudru.provider_request('chat/completions', credentials['api_key'], {
                'model': turn['model'], 'messages': self.messages(turn),
                'max_completion_tokens': turn['max_tokens'], 'stream': False}, timeout=180)
            parsed = cloudru.completion_result(response, credentials['api_key'])
            if not parsed['reply'].strip():
                raise cloudru.CloudError("Модель не вернула итоговый текст. Если лимит ушёл на рассуждения, увеличьте его или выберите другую модель.", 502)
            partial = parsed['finish_reason'] == 'length'
            self.finish(turn_id, 'partial' if partial else 'succeeded', parsed['reply'],
                        "Ответ обрезан лимитом токенов." if partial else '', parsed['usage'])
        except Exception as error:
            message = str(error).replace(credentials['api_key'], '[ключ скрыт]') if isinstance(error, cloudru.CloudError) else "Не удалось получить или сохранить ответ. Проверьте базу и Cloud.ru; автоматического повтора нет."
            try:
                self.finish(turn_id, 'failed', error=message)
            except (OSError, sqlite3.Error):
                print("Не удалось сохранить ответ чата: проверьте носитель с базой.", file=sys.stderr, flush=True)
