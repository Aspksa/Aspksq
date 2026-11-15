"""Chat persistence, history isolation and paid-request idempotency; fake provider only."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

from test_cloudru import application, KEY, MODEL
from test_local_db import request, running
import cloudru
import server


def session(port):
    identifier = str(uuid.uuid4())
    status, value = request(port, '/api/chat/sessions', {'session_id': identifier, 'create': True})
    assert status == 200, value
    return identifier


def payload(identifier, task='Помоги составить план на русском'):
    return {'request_id':str(uuid.uuid4()), 'session_id':identifier, 'task':task, 'expected_model':MODEL, 'max_tokens':2048}


def wait(port, identifier):
    deadline = time.monotonic()+6
    while time.monotonic()<deadline:
        status, value = request(port, '/api/chat/turns/'+identifier)
        if status == 200 and value['status'] != 'running':
            return value
        time.sleep(.03)
    raise AssertionError('Chat did not finish')


class ChatTests(unittest.TestCase):
    def test_conversation_context_idempotency_isolation_and_backup(self):
        with tempfile.TemporaryDirectory() as directory, application(Path(directory)/'data.sqlite3') as port:
            request(port, '/api/cloud/settings', {'api_key':KEY, 'model':MODEL})
            first = session(port)
            with patch('cloudru.provider_request', return_value={'choices':[{'message':{'content':'Русский ответ <script>alert(1)</script>'}, 'finish_reason':'stop'}], 'usage':{'total_tokens':30}}) as provider:
                one = payload(first)
                self.assertEqual(request(port, '/api/chat/turns', one)[0],202)
                self.assertEqual(wait(port,one['request_id'])['status'],'succeeded')
                self.assertEqual(request(port, '/api/chat/turns', one)[0],202)
                self.assertEqual(provider.call_count,1)
                second = payload(first,'Уточни второй пункт')
                request(port, '/api/chat/turns', second);wait(port,second['request_id'])
                sent=provider.call_args.args[2]
                self.assertEqual([m['role'] for m in sent['messages']],['system','user','assistant','user'])
                self.assertEqual(sent['messages'][1]['content'],one['task'])
                self.assertEqual(sent['max_completion_tokens'],2048)
                other=session(port)
                three=payload(other,'Отдельный диалог')
                request(port, '/api/chat/turns',three);wait(port,three['request_id'])
                self.assertEqual(len(provider.call_args.args[2]['messages']),2)
                self.assertEqual(provider.call_count,3)
            snapshot=request(port,'/api/chat?session_id='+first)[1]
            self.assertEqual(len(snapshot['turns']),2)
            self.assertNotIn(KEY,json.dumps(snapshot))
            self.assertEqual(request(port,'/api/chat/sessions',{'session_id':first})[1]['session_id'],first)
            backup=Path(directory)/'backup.sqlite3';backup.write_bytes(request(port,'/api/backup')[1])
            with closing(sqlite3.connect(backup)) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM chat_turns').fetchone()[0],3)
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')

    def test_parallel_chat_and_skill_requests_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory, application(Path(directory)/'data.sqlite3') as port:
            request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL})
            identifier=session(port);data=payload(identifier);entered=threading.Event();release=threading.Event()
            def provider(*args,**kwargs):
                entered.set();release.wait(5)
                return {'choices':[{'message':{'content':'Готово'},'finish_reason':'stop'}]}
            with patch('cloudru.provider_request',side_effect=provider) as calls:
                try:
                    request(port,'/api/chat/turns',data);self.assertTrue(entered.wait(3))
                    self.assertEqual(request(port,'/api/chat/turns',data)[0],202)
                    self.assertEqual(request(port,'/api/chat/turns',payload(identifier))[0],409)
                    self.assertEqual(request(port,'/api/skill-runs',{'request_id':str(uuid.uuid4()),'skill_id':'builtin:account-optimization','task':'Проверка','max_tokens':1024,'expected_model':MODEL})[0],409)
                    self.assertEqual(calls.call_count,1)
                finally:release.set()
                self.assertEqual(wait(port,data['request_id'])['status'],'succeeded')

    def test_failure_reasoning_partial_and_no_automatic_retry(self):
        with tempfile.TemporaryDirectory() as directory, application(Path(directory)/'data.sqlite3') as port:
            request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL});identifier=session(port)
            outcomes=[cloudru.CloudError('Ошибка '+KEY,502), {'choices':[{'message':{'content':None},'finish_reason':'length'}]},
                      {'choices':[{'message':{'content':'Часть ответа '+KEY},'finish_reason':'length'}]}]
            with patch('cloudru.provider_request',side_effect=outcomes) as provider:
                values=[]
                for index in range(3):
                    data=payload(identifier,str(index));request(port,'/api/chat/turns',data);values.append(wait(port,data['request_id']))
                self.assertEqual([v['status'] for v in values],['failed','failed','partial'])
                self.assertNotIn(KEY,json.dumps(values))
                self.assertEqual(provider.call_count,3)
                self.assertEqual(len(provider.call_args.args[2]['messages']),2,'Failed messages must not enter model history')

    def test_validation_model_race_and_request_id_conflict(self):
        with tempfile.TemporaryDirectory() as directory, application(Path(directory)/'data.sqlite3') as port:
            identifier=session(port)
            with patch('cloudru.provider_request') as provider:
                self.assertEqual(request(port,'/api/chat/turns',payload(identifier))[0],400)
                request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL})
                for changes in ({'task':''},{'task':'x'*10001},{'max_tokens':True},{'request_id':'bad'},{'expected_model':'other'},{'session_id':str(uuid.uuid4())}):
                    data=payload(identifier);data.update(changes)
                    self.assertIn(request(port,'/api/chat/turns',data)[0],(400,404,409))
                provider.assert_not_called()
            with patch('cloudru.provider_request',return_value={'choices':[{'message':{'content':'Ответ'},'finish_reason':'stop'}]}) as provider:
                data=payload(identifier);request(port,'/api/chat/turns',data);wait(port,data['request_id'])
                data['task']='Изменённая задача'
                self.assertEqual(request(port,'/api/chat/turns',data)[0],409)
                self.assertEqual(provider.call_count,1)
            self.assertEqual(request(port,'/chatrunner.py')[0],404)
            self.assertEqual(request(port,'/api/chat/sessions',{'session_id':str(uuid.uuid4())})[0],404)

    def test_v3_migration_position_and_interrupted_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            database=Path(directory)/'data.sqlite3';server.initialize(database)
            with closing(server.connect(database)) as db,db:
                db.execute('DROP TABLE assistant_state');db.execute('DROP TABLE chat_turns');db.execute('DROP TABLE chat_sessions')
                db.execute('PRAGMA user_version=3')
                db.execute("INSERT INTO skills(id,name) VALUES('keep','Мой навык')")
                db.execute("INSERT INTO cloudru_settings(id,api_key,model) VALUES(1,?,?)",(KEY,MODEL))
            with running(database) as port:
                self.assertEqual(request(port,'/api/cloud/settings')[1]['model'],MODEL)
                self.assertEqual(request(port,'/api/skills')[1][0]['name'],'Мой навык')
                identifier=session(port)
                position={'x':.25,'y':.6}
                self.assertEqual(request(port,'/api/assistant-position',position),(200,position))
                for invalid in ({'x':-1,'y':0},{'x':True,'y':1},{'x':'1','y':.5},{'x':1}):
                    self.assertEqual(request(port,'/api/assistant-position',invalid)[0],400)
                data=payload(identifier)
                with closing(server.connect(database)) as db,db:
                    db.execute("INSERT INTO chat_turns(id,session_id,task,model,max_tokens,status,created_at) VALUES(?,?,?,?,?,'running','now')",(data['request_id'],identifier,data['task'],MODEL,2048))
            with running(database) as port:
                self.assertEqual(request(port,'/api/assistant-position')[1],position)
                self.assertEqual(request(port,'/api/chat')[1]['session_id'],identifier)
                self.assertEqual(request(port,'/api/chat/turns/'+data['request_id'])[1]['status'],'interrupted')
            with closing(server.connect(database)) as db:
                self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],5)

    def test_history_is_bounded_and_keeps_whole_exchanges(self):
        with tempfile.TemporaryDirectory() as directory, application(Path(directory)/'data.sqlite3') as port:
            request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL});identifier=session(port)
            with patch('cloudru.provider_request',return_value={'choices':[{'message':{'content':'x'*5000},'finish_reason':'stop'}]}) as provider:
                for i in range(7):
                    data=payload(identifier,'Сообщение '+str(i));request(port,'/api/chat/turns',data);wait(port,data['request_id'])
                messages=provider.call_args.args[2]['messages']
                self.assertEqual(len(messages),10) # system + four full exchanges + current message
                self.assertEqual(messages[1]['content'],'Сообщение 2')


if __name__=='__main__':unittest.main()
