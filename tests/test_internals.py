"""Indexed retrieval, atomic snapshots and bounded graph reads; no real model calls."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import tracemalloc
import unittest
from unittest.mock import patch
import uuid

from test_cloudru import application, KEY, MODEL
from test_local_db import request, running
from test_chat import session, payload, wait
from test_knowledge import material
from knowledge import Knowledge
from chatrunner import ChatRunner
import cloudru
import server


class InternalsTests(unittest.TestCase):
    def test_named_project_followups_and_comparison_do_not_mix_sources(self):
        with tempfile.TemporaryDirectory() as directory,application(Path(directory)/'data.sqlite3') as port:
            cedar=material(port,'Договор Кедр','Проект Кедр: срок 25 ноября, цена 42000 рублей.',['кедр'])
            orion=material(port,'Договор Орион','Проект Орион: срок 30 ноября, цена 99000 рублей.',['орион'])
            search=Knowledge(Path(directory)/'data.sqlite3',server.connect)
            self.assertEqual([doc['id'] for doc in search.retrieve('Какие сроки проекта Кедр?')],[cedar['id']])
            self.assertEqual([doc['id'] for doc in search.retrieve('А цена?','Расскажи о проекте Кедр')],[cedar['id']])
            self.assertEqual([doc['id'] for doc in search.retrieve('А сроки проекта Орион?','Расскажи о проекте Кедр')],[orion['id']])
            self.assertEqual(search.retrieve('Какие сроки проекта Несуществующий?'),[])
            self.assertEqual({doc['id'] for doc in search.retrieve('Сравни сроки проектов Кедр и Орион')},{cedar['id'],orion['id']})

    def test_offsets_hashes_revisions_and_incremental_reindex(self):
        with tempfile.TemporaryDirectory() as directory,application(Path(directory)/'data.sqlite3') as port:
            text='Ёжик и кириллица. '*130+'Уникальный термин телескопирование в конце текста.'
            doc=material(port,'Русская заметка',text,['наблюдения'])
            database=Path(directory)/'data.sqlite3';search=Knowledge(database,server.connect)
            result=search.retrieve('Телескопирование')[0];meta=result['retrieval']
            self.assertEqual(result['excerpt'],text[meta['start_char']:meta['end_char']])
            self.assertEqual(meta['body_sha256'],hashlib.sha256(text.encode()).hexdigest())
            self.assertEqual(meta['excerpt_sha256'],hashlib.sha256(result['excerpt'].encode()).hexdigest())
            self.assertIn('телескопирован',meta['matched_terms'][0])
            other=material(port,'Другой документ','Сохраняет свой независимый индекс.',['другой'])
            with closing(server.connect(database)) as db:
                original=[tuple(row) for row in db.execute('SELECT * FROM knowledge_terms WHERE document_id=?',(other['id'],))]
            request(port,'/api/knowledge',dict(doc,body='Теперь только микроскопирование.'))
            self.assertEqual(search.retrieve('Телескопирование'),[])
            self.assertEqual(search.retrieve('Микроскопирование')[0]['revision'],2)
            with closing(server.connect(database)) as db:
                self.assertEqual(db.execute('SELECT body FROM knowledge_revisions WHERE document_id=? AND revision=1',(doc['id'],)).fetchone()[0],text)
                self.assertEqual([tuple(row) for row in db.execute('SELECT * FROM knowledge_terms WHERE document_id=?',(other['id'],))],original)
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_index_failure_rolls_back_document_and_revision(self):
        with tempfile.TemporaryDirectory() as directory,application(Path(directory)/'data.sqlite3') as port:
            doc=material(port);database=Path(directory)/'data.sqlite3';search=Knowledge(database,server.connect)
            with closing(server.connect(database)) as db,db:
                db.execute("CREATE TRIGGER test_abort_index BEFORE INSERT ON knowledge_terms BEGIN SELECT RAISE(ABORT,'test index failure'); END")
            with self.assertRaises(sqlite3.IntegrityError):search.save(dict(doc,body='Новый текст с изменениями.'))
            status,error=request(port,'/api/knowledge',dict(doc,body='Другой новый текст.'))
            self.assertEqual(status,500);self.assertNotIn('Навык',error['error'])
            self.assertEqual(search.get(doc['id'])['body'],doc['body'])
            self.assertEqual(search.get(doc['id'])['revision'],1)
            self.assertIn('42000',search.retrieve('Проект Кедр')[0]['excerpt'])
            with closing(server.connect(database)) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM knowledge_revisions WHERE document_id=?',(doc['id'],)).fetchone()[0],1)

    def test_exact_request_is_archived_before_provider_without_credentials(self):
        with tempfile.TemporaryDirectory() as directory,application(Path(directory)/'data.sqlite3') as port:
            material(port);request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL});sid=session(port);data=payload(sid,'Расскажи о проекте Кедр');data.pop('max_tokens')
            def provider(path,key,sent,**kwargs):
                archived=request(port,'/api/chat/requests/'+data['request_id'])[1]
                self.assertTrue(archived['recorded']);self.assertEqual(archived['payload'],sent)
                self.assertNotIn(KEY,json.dumps(archived))
                self.assertNotIn('retrieval',sent['messages'][0]['content'])
                return {'choices':[{'message':{'content':'Ответ [1]'},'finish_reason':'stop'}]}
            with patch('cloudru.provider_request',side_effect=provider) as calls:
                request(port,'/api/chat/turns',data);self.assertEqual(wait(port,data['request_id'])['status'],'succeeded')
                record=request(port,'/api/chat/requests/'+data['request_id'])[1]
                self.assertNotIn('max_completion_tokens',record['payload'])
                request(port,'/api/knowledge',dict(request(port,'/api/knowledge')[1]['documents'][0],body='Новая версия 30 ноября.'))
                self.assertEqual(request(port,'/api/chat/requests/'+data['request_id'])[1],record)
                self.assertEqual(request(port,'/api/chat/turns',data)[0],202);self.assertEqual(calls.call_count,1)
                graph=request(port,'/api/chat/graph?session_id='+sid)[1]
                self.assertTrue(graph['request_recorded']);self.assertEqual(graph['request_sha256'],record['sha256'])
            database=Path(directory)/'data.sqlite3'
            with closing(server.connect(database)) as db,db:
                db.execute("UPDATE chat_requests SET payload='{}' WHERE turn_id=?",(data['request_id'],))
            self.assertEqual(request(port,'/api/chat/requests/'+data['request_id'])[0],409)

    def test_duplicate_workers_are_stopped_before_second_provider_call(self):
        with tempfile.TemporaryDirectory() as directory,application(Path(directory)/'data.sqlite3') as port:
            database=Path(directory)/'data.sqlite3';request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL});sid=session(port);data=payload(sid)
            entered=threading.Event();release=threading.Event()
            def provider(*args,**kwargs):
                entered.set();release.wait(5)
                return {'choices':[{'message':{'content':'Ответ'},'finish_reason':'stop'}]}
            with patch('cloudru.provider_request',side_effect=provider) as calls:
                try:
                    request(port,'/api/chat/turns',data);self.assertTrue(entered.wait(3))
                    ChatRunner(database,server.connect).execute(data['request_id'],{'api_key':KEY,'model':MODEL})
                    self.assertEqual(calls.call_count,1)
                finally:release.set()
                self.assertEqual(wait(port,data['request_id'])['status'],'succeeded')

    def test_graph_does_not_load_all_large_answers(self):
        with tempfile.TemporaryDirectory() as directory:
            database=Path(directory)/'data.sqlite3';server.initialize(database);runner=ChatRunner(database,server.connect)
            sid=str(uuid.uuid4());runner.session({'session_id':sid,'create':True})
            large='Ответ '*35000
            with closing(server.connect(database)) as db,db:
                db.executemany("INSERT INTO chat_turns(id,session_id,task,model,max_tokens,status,result,created_at) VALUES(?,?,?,?,0,'succeeded',?,'now')",
                               [(str(uuid.uuid4()),sid,'Задача '+str(index),MODEL,large) for index in range(60)])
            tracemalloc.start()
            try:graph=runner.graph(sid);peak=tracemalloc.get_traced_memory()[1]
            finally:tracemalloc.stop()
            self.assertEqual(len(graph['turns']),60)
            self.assertLess(peak,5*1024*1024,'Graph loaded the full answers of every old turn')

    def test_v6_upgrade_indexes_existing_materials_without_inventing_old_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            database=Path(directory)/'data.sqlite3'
            with application(database) as port:
                doc=material(port);sid=session(port);data=payload(sid)
                with closing(server.connect(database)) as db,db:
                    db.execute("INSERT INTO chat_turns(id,session_id,task,model,max_tokens,status,result,created_at) VALUES(?,?,?,?,0,'succeeded','Старый ответ','now')",(data['request_id'],sid,data['task'],MODEL))
            with closing(server.connect(database)) as db,db:
                for table in ('knowledge_terms','knowledge_chunks','knowledge_revisions','chat_requests'):db.execute('DROP TABLE '+table)
                db.execute('PRAGMA user_version=6')
            with running(database) as port:
                self.assertEqual(request(port,'/api/knowledge/document/'+doc['id'])[1]['body'],doc['body'])
                self.assertEqual(Knowledge(database,server.connect).retrieve('Проект Кедр')[0]['id'],doc['id'])
                self.assertFalse(request(port,'/api/chat/requests/'+data['request_id'])[1]['recorded'])

    def test_long_query_is_batched_below_sqlite_variable_limit(self):
        with tempfile.TemporaryDirectory() as directory,application(Path(directory)/'data.sqlite3') as port:
            doc=material(port,'Длинный поиск','Нужный маркер q1299 в тексте.',['маркер'])
            search=Knowledge(Path(directory)/'data.sqlite3',server.connect)
            self.assertEqual(search.retrieve(' '.join('q'+str(i) for i in range(1300)))[0]['id'],doc['id'])


if __name__=='__main__':unittest.main()
