"""Skill jobs use only simulated provider calls; no real Cloud.ru tokens are spent."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import cloudru
import server
import skillrunner
from test_cloudru import application, KEY, MODEL
from test_local_db import request, running

SKILL = 'builtin:three-step-report'


def payload(**overrides):
    data={'request_id':str(uuid.uuid4()),'skill_id':SKILL,'task':'Расходы 1000 рублей, заявок 10. Составь отчёт.', 'max_tokens':2048,'expected_model':MODEL}
    data.update(overrides)
    return data


def finished(port, run_id):
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        status,job=request(port,'/api/skill-runs/'+run_id)
        if status==200 and job['status']!='running':
            return job
        time.sleep(.03)
    raise AssertionError('Skill did not finish')


def answer(text='Отчёт готов.',reason='stop'):
    return {'choices':[{'message':{'content':text},'finish_reason':reason}],
            'usage':{'prompt_tokens':10,'completion_tokens':20,'total_tokens':30,'private':KEY}}


class SkillRunTests(unittest.TestCase):
    def test_builtin_job_is_idempotent_and_persistent(self):
        with tempfile.TemporaryDirectory() as temporary:
            database=Path(temporary)/'tracktor.sqlite3'
            with application(database) as port:
                request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL})
                block=threading.Event()
                def provider(*args,**kwargs):
                    block.wait(5)
                    return answer('Итог: <img src=x> '+KEY)
                body=payload()
                with patch('cloudru.provider_request',side_effect=provider) as call:
                    try:
                        status,job=request(port,'/api/skill-runs',body)
                        self.assertEqual(status,202)
                        self.assertEqual(job['status'],'running')
                        self.assertEqual(request(port,'/api/skill-runs',body)[1]['id'],job['id'])
                        self.assertEqual(request(port,'/api/skill-runs',dict(body,task='Другая задача'))[0],409)
                        self.assertEqual(request(port,'/api/skill-runs',payload())[0],409)
                        state=request(port,'/api/skill-runs?skill_id='+SKILL)[1]
                        self.assertEqual(state['active_run']['id'],job['id'])
                    finally:
                        block.set()
                    result=finished(port,body['request_id'])
                    self.assertEqual(result['status'],'succeeded')
                    self.assertNotIn(KEY,json.dumps(result))
                    self.assertIn('[ключ скрыт]',result['result'])
                    self.assertEqual(result['usage'],{'prompt_tokens':10,'completion_tokens':20,'total_tokens':30})
                    args=call.call_args
                    self.assertEqual(call.call_count,1)
                    self.assertEqual(args.args[1],KEY)
                    self.assertEqual(args.kwargs['timeout'],180)
                    sent=args.args[2]
                    self.assertEqual(sent['model'],MODEL)
                    self.assertEqual(sent['max_completion_tokens'],body['max_tokens'])
                    self.assertEqual(sent['messages'][1]['content'],body['task'])
                    self.assertIn('трёх разделах',sent['messages'][0]['content'])
                    self.assertNotIn(KEY,json.dumps(sent))
                    self.assertEqual(request(port,'/api/skill-runs',body)[1]['status'],'succeeded')
                    self.assertEqual(call.call_count,1)
            with application(database) as port:
                latest=request(port,'/api/skill-runs?skill_id='+SKILL)[1]
                self.assertEqual(latest['run']['id'],body['request_id'])
                self.assertEqual(latest['run']['result'],result['result'])
                self.assertIsNone(latest['active_run'])

    def test_custom_skill_uses_saved_description_and_model_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            database=Path(temporary)/'tracktor.sqlite3'
            with application(database) as port:
                request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL})
                custom=request(port,'/api/skills',{'name':'/мой-навык','description':'Составь три варианта письма на русском.'})[1]
                custom_id='custom:'+custom['id']
                self.assertIn(custom_id,[s['id'] for s in request(port,'/api/skill-catalog')[1]['data']])
                block=threading.Event()
                def provider(*args,**kwargs):
                    block.wait(5)
                    return answer()
                with patch('cloudru.provider_request',side_effect=provider) as call:
                    body=payload(skill_id=custom_id)
                    try:
                        self.assertEqual(request(port,'/api/skill-runs',body)[0],202)
                        request(port,'/api/cloud/settings',{'api_key':'another-fake-key-for-tests','model':'test/new-model'})
                    finally:
                        block.set()
                    result=finished(port,body['request_id'])
                    self.assertEqual(result['model'],MODEL)
                    self.assertIn(custom['description'],call.call_args.args[2]['messages'][0]['content'])
                    self.assertEqual(result['status'],'succeeded')

    def test_failure_partial_output_and_reasoning_limit(self):
        with tempfile.TemporaryDirectory() as temporary:
            with application(Path(temporary)/'tracktor.sqlite3') as port:
                request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL})
                with patch('cloudru.provider_request',side_effect=cloudru.CloudError('Ключ отклонён '+KEY,401)):
                    body=payload();request(port,'/api/skill-runs',body)
                    failed=finished(port,body['request_id'])
                    self.assertEqual(failed['status'],'failed')
                    self.assertNotIn(KEY,failed['error'])
                with patch('cloudru.provider_request',return_value=answer('Частичный ответ','length')):
                    body=payload();request(port,'/api/skill-runs',body)
                    partial=finished(port,body['request_id'])
                    self.assertEqual(partial['status'],'partial')
                    self.assertEqual(partial['result'],'Частичный ответ')
                with patch('cloudru.provider_request',return_value=answer(None,'length')):
                    body=payload();request(port,'/api/skill-runs',body)
                    empty=finished(port,body['request_id'])
                    self.assertEqual(empty['status'],'failed')
                    self.assertIn('рассуждениях',empty['error'])
                self.assertEqual(request(port,'/api/status')[0],200)

    def test_validation_prevents_unintended_provider_requests(self):
        with tempfile.TemporaryDirectory() as temporary:
            with application(Path(temporary)/'tracktor.sqlite3') as port, patch('cloudru.provider_request') as provider:
                self.assertEqual(request(port,'/api/skill-runs',payload())[0],400)
                request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL})
                for body,expected in [(payload(task=''),400),(payload(max_tokens=True),400),(payload(max_tokens=999999),400),
                                      (payload(request_id='bad'),400),(payload(skill_id='custom:missing'),404),
                                      (payload(expected_model='test/stale-model'),409)]:
                    self.assertEqual(request(port,'/api/skill-runs',body)[0],expected)
                provider.assert_not_called()

    def test_v2_migration_preserves_key_and_startup_marks_interrupted(self):
        with tempfile.TemporaryDirectory() as temporary:
            database=Path(temporary)/'tracktor.sqlite3'
            server.initialize(database)
            with closing(server.connect(database)) as connection,connection:
                connection.execute('DROP TABLE skill_runs')
                connection.execute('PRAGMA user_version=2')
                connection.execute("INSERT INTO cloudru_settings(id,api_key,model) VALUES(1,?,?)",(KEY,MODEL))
            server.initialize(database)
            run_id=str(uuid.uuid4())
            with closing(server.connect(database)) as connection,connection:
                self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0],4)
                self.assertEqual(connection.execute('SELECT api_key FROM cloudru_settings').fetchone()[0],KEY)
                self.assertEqual(connection.execute('SELECT count(*) FROM clients').fetchone()[0],19)
                connection.execute("INSERT INTO skill_runs(id,skill_id,skill_name,description,model,task,max_tokens,status,created_at) VALUES(?,?,?,?,?,?,2048,'running',?)",
                                   (run_id,SKILL,'Отчёт','Инструкция',MODEL,'Задача',skillrunner.now()))
            # Real startup takes the process lock, recovers interrupted work, and never automatically resends it.
            with running(database) as port:
                job=request(port,'/api/skill-runs/'+run_id)[1]
                self.assertEqual(job['status'],'interrupted')
                self.assertIn('мог быть обработан',job['error'])
                self.assertIsNone(request(port,'/api/skill-runs?skill_id='+SKILL)[1]['active_run'])


if __name__=='__main__':
    unittest.main()
