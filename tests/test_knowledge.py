"""Real SQLite materials/retrieval/snapshots; no external model calls."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import uuid

from test_cloudru import application, KEY, MODEL
from test_local_db import request, running
from test_chat import session, payload, wait
import server
from knowledge import Knowledge


def material(port, title='Проект Кедр: договор', body='Срок сдачи проекта Кедр — 25 ноября. Бюджет 42000 рублей.', tags=None):
    data={'id':str(uuid.uuid4()),'title':title,'body':body,'tags':tags or ['кедр','договоры'],'revision':0}
    status,value=request(port,'/api/knowledge',data)
    assert status==200,value
    return value


class KnowledgeTests(unittest.TestCase):
    def test_materials_revision_graph_backup_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            database=Path(directory)/'data.sqlite3'
            with application(database) as port:
                one=material(port);two=material(port,'План Кедр','Встреча с командой по пятницам.',['КЕДР','команда'])
                graph=request(port,'/api/knowledge/graph')[1]
                self.assertEqual(graph['documents'],2)
                self.assertEqual(len(graph['edges']),4)
                self.assertEqual(sum(node['id']=='tag:кедр' for node in graph['nodes']),1)
                self.assertNotIn('body',request(port,'/api/knowledge')[1]['documents'][0])
                edited=dict(one,body='Новый срок: 30 ноября.')
                self.assertEqual(request(port,'/api/knowledge',edited)[1]['revision'],2)
                self.assertEqual(request(port,'/api/knowledge',edited)[1]['revision'],2,'Identical retry must not create another revision')
                self.assertEqual(request(port,'/api/knowledge',dict(one,body='Устаревшая правка'))[0],409)
                backup=Path(directory)/'backup.sqlite3';backup.write_bytes(request(port,'/api/backup')[1])
                with closing(sqlite3.connect(backup)) as db:
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM knowledge_documents').fetchone()[0],2)
                    self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            with running(database) as port:
                self.assertEqual(request(port,'/api/knowledge/document/'+one['id'])[1]['body'],'Новый срок: 30 ноября.')

    def test_retrieval_cyrillic_inflections_tail_passage_and_irrelevant_documents(self):
        with tempfile.TemporaryDirectory() as directory,application(Path(directory)/'data.sqlite3') as port:
            doc=material(port,'Обзор реализации',('Техническое описание. '*160)+'Для проекта Кедр срок сдачи — 25 ноября.',['кедр'])
            material(port,'Звёзды','Созвездие Лира содержит Вегу.',['астрономия'])
            database=Path(directory)/'data.sqlite3';knowledge=Knowledge(database,server.connect)
            found=knowledge.retrieve('Какие сроки проекта КЕДР?')
            self.assertEqual(len(found),1)
            self.assertEqual(found[0]['id'],doc['id'])
            self.assertIn('25 ноября',found[0]['excerpt'])
            self.assertEqual(knowledge.retrieve('Пингвины в Антарктиде'),[])
            self.assertEqual(knowledge.retrieve('Пингвины в Антарктиде','Расскажи о проекте Кедр'),[])
            self.assertEqual(knowledge.retrieve('А сроки?','Расскажи о проекте Кедр')[0]['id'],doc['id'])

    def test_chat_omits_output_limit_and_saves_sources_snapshot(self):
        with tempfile.TemporaryDirectory() as directory,application(Path(directory)/'data.sqlite3') as port:
            doc=material(port);request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL});identifier=session(port)
            with patch('cloudru.provider_request',return_value={'choices':[{'message':{'content':'Срок — 25 ноября [1].'},'finish_reason':'stop'}]}) as provider:
                data=payload(identifier,'Какой срок по договору проекта Кедр?');data.pop('max_tokens');data['include_knowledge']=True
                self.assertEqual(request(port,'/api/chat/turns',data)[0],202)
                turn=wait(port,data['request_id']);sent=provider.call_args.args[2]
                self.assertNotIn('max_tokens',sent)
                self.assertNotIn('max_completion_tokens',sent)
                self.assertIn('25 ноября',sent['messages'][0]['content'])
                self.assertNotIn(KEY,json.dumps(turn))
                self.assertEqual(turn['sources'][0]['id'],doc['id'])
                self.assertEqual(turn['max_tokens'],0)
                request(port,'/api/knowledge',dict(doc,body='Срок изменён на 30 ноября.'))
                persisted=request(port,'/api/chat/turns/'+data['request_id'])[1]
                self.assertIn('25 ноября',persisted['sources'][0]['excerpt'])
                self.assertEqual(persisted['sources'][0]['revision'],1)
                self.assertEqual(request(port,'/api/chat/turns',data)[0],202)
                self.assertEqual(provider.call_count,1)

    def test_knowledge_opt_out_and_empty_search_are_explicit(self):
        with tempfile.TemporaryDirectory() as directory,application(Path(directory)/'data.sqlite3') as port:
            material(port);request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL});identifier=session(port)
            with patch('cloudru.provider_request',return_value={'choices':[{'message':{'content':'Ответ'},'finish_reason':'stop'}]}) as provider:
                data=payload(identifier,'Какой срок проекта Кедр?');data.pop('max_tokens');data['include_knowledge']=False
                request(port,'/api/chat/turns',data);turn=wait(port,data['request_id'])
                self.assertEqual(turn['sources'],[])
                self.assertNotIn('42000',provider.call_args.args[2]['messages'][0]['content'])
                other=session(port);data=payload(other,'Пингвины в Антарктиде');data['include_knowledge']=True
                request(port,'/api/chat/turns',data);wait(port,data['request_id'])
                self.assertIn('не нашёл подходящих',provider.call_args.args[2]['messages'][0]['content'])
                data['include_knowledge']=False
                self.assertEqual(request(port,'/api/chat/turns',data)[0],409)

    def test_invalid_material_and_no_secrets_or_source_file_access(self):
        with tempfile.TemporaryDirectory() as directory,application(Path(directory)/'data.sqlite3') as port:
            valid={'id':str(uuid.uuid4()),'title':'Материал','body':'Текст','tags':['русский'],'revision':0}
            for changes in ({'title':''},{'body':''},{'body':'a'*16001},{'tags':['a'*51]},{'tags':'bad'},{'revision':True},{'id':'bad'}):
                data=dict(valid,**changes);self.assertEqual(request(port,'/api/knowledge',data)[0],400)
            self.assertEqual(request(port,'/api/knowledge')[1]['documents'],[])
            self.assertEqual(request(port,'/knowledge.py')[0],404)
            self.assertEqual(request(port,'/api/knowledge',valid,{'Origin':'https://example.com'})[0],403)

    def test_v4_upgrade_preserves_accepted_chat_and_key(self):
        with tempfile.TemporaryDirectory() as directory:
            database=Path(directory)/'data.sqlite3';server.initialize(database)
            with closing(server.connect(database)) as db,db:
                db.execute('DROP TABLE knowledge_documents')
                db.execute('ALTER TABLE chat_turns DROP COLUMN include_knowledge')
                db.execute('ALTER TABLE chat_turns DROP COLUMN sources')
                db.execute('PRAGMA user_version=4')
                db.execute('INSERT INTO cloudru_settings(id,api_key,model) VALUES(1,?,?)',(KEY,MODEL))
                sid,tid=str(uuid.uuid4()),str(uuid.uuid4())
                db.execute("INSERT INTO chat_sessions(id,created_at) VALUES(?,'now')",(sid,))
                db.execute("INSERT INTO chat_turns(id,session_id,task,model,max_tokens,status,result,created_at) VALUES(?,?,?,? ,2048,'succeeded',?,'now')",(tid,sid,'Старая задача',MODEL,'Старый ответ'))
            with running(database) as port:
                self.assertEqual(request(port,'/api/cloud/settings')[1]['has_key'],True)
                turn=request(port,'/api/chat/turns/'+tid)[1]
                self.assertEqual(turn['result'],'Старый ответ')
                self.assertEqual(turn['sources'],[])
                self.assertEqual(turn['include_knowledge'],0)
                self.assertEqual(turn['max_tokens'],2048)


if __name__=='__main__':unittest.main()
