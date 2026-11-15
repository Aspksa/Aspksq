"""Graph reflects saved request/source/history records, not reconstructed model reasoning."""
from contextlib import closing
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_cloudru import application, KEY, MODEL
from test_local_db import request, running
from test_chat import session, payload, wait
from test_knowledge import material
import server
import cloudru


class ChatGraphTests(unittest.TestCase):
    def test_route_sources_model_result_and_actual_history(self):
        with tempfile.TemporaryDirectory() as directory, application(Path(directory)/'data.sqlite3') as port:
            doc=material(port);request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL});sid=session(port)
            with patch('cloudru.provider_request',return_value={'choices':[{'message':{'content':'Срок — 25 ноября [1].'},'finish_reason':'stop'}]}) as provider:
                first=payload(sid,'Срок проекта Кедр?');request(port,'/api/chat/turns',first);wait(port,first['request_id'])
                second=payload(sid,'А стоимость?');request(port,'/api/chat/turns',second);turn=wait(port,second['request_id'])
                self.assertEqual(turn['context_turns'],[first['request_id']])
                status,graph=request(port,'/api/chat/graph?session_id='+sid)
                self.assertEqual(status,200)
                self.assertEqual(graph['current_turn'],second['request_id'])
                self.assertEqual(graph['phase'],'succeeded')
                self.assertEqual({edge['kind'] for edge in graph['edges']},{'source','request','response','history'})
                model=next(node for node in graph['nodes'] if node['type']=='model')
                self.assertEqual(model['title'],MODEL)
                source=next(node for node in graph['nodes'] if node['type']=='document')
                self.assertEqual(source['id'],doc['id'])
                self.assertIn('25 ноября',source['excerpt'])
                self.assertNotIn(KEY,str(graph))
                self.assertEqual(provider.call_count,2,'Reading graph must not start a provider request')
                old=request(port,'/api/chat/graph?session_id='+sid+'&turn_id='+first['request_id'])[1]
                self.assertFalse(any(edge['kind']=='history' for edge in old['edges']))
                other=session(port)
                self.assertEqual(request(port,'/api/chat/graph?session_id='+other+'&turn_id='+first['request_id'])[0],404)

    def test_empty_failed_and_opt_out_graphs_are_honest(self):
        with tempfile.TemporaryDirectory() as directory, application(Path(directory)/'data.sqlite3') as port:
            sid=session(port)
            empty=request(port,'/api/chat/graph?session_id='+sid)[1]
            self.assertEqual(empty['nodes'],[])
            material(port);request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL})
            with patch('cloudru.provider_request',side_effect=cloudru.CloudError('Сеть недоступна',502)) as provider:
                data=payload(sid,'Проект Кедр');data['include_knowledge']=False
                request(port,'/api/chat/turns',data);wait(port,data['request_id'])
                graph=request(port,'/api/chat/graph?session_id='+sid)[1]
                self.assertEqual(graph['documents'],0)
                self.assertEqual(len(graph['nodes']),3)
                answer=next(node for node in graph['nodes'] if node['type']=='answer')
                self.assertEqual(answer['status'],'failed')
                self.assertEqual(answer['title'],'Ошибка запроса')
                self.assertEqual(graph['phase'],'failed')
                self.assertEqual(provider.call_count,1)

    def test_old_context_is_not_invented_after_upgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            database=Path(directory)/'data.sqlite3'
            with application(database) as port:
                request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL});sid=session(port)
                with patch('cloudru.provider_request',return_value={'choices':[{'message':{'content':'Ответ'},'finish_reason':'stop'}]}):
                    data=payload(sid);request(port,'/api/chat/turns',data);wait(port,data['request_id'])
            with closing(server.connect(database)) as db,db:
                db.execute('ALTER TABLE chat_turns DROP COLUMN context_turns')
                db.execute('PRAGMA user_version=5')
            with running(database) as port:
                graph=request(port,'/api/chat/graph?session_id='+sid)[1]
                self.assertFalse(graph['context_recorded'])
                self.assertFalse(any(node['type']=='history' for node in graph['nodes']))
                self.assertEqual(graph['current_turn'],data['request_id'])

    def test_preparing_and_waiting_are_based_on_saved_state(self):
        with tempfile.TemporaryDirectory() as directory:
            database=Path(directory)/'data.sqlite3'
            with application(database) as port:
                sid=session(port);data=payload(sid)
                with closing(server.connect(database)) as db,db:
                    db.execute("INSERT INTO chat_turns(id,session_id,task,model,max_tokens,status,created_at) VALUES(?,?,?,?,0,'running','now')",(data['request_id'],sid,data['task'],MODEL))
                self.assertEqual(request(port,'/api/chat/graph?session_id='+sid)[1]['phase'],'preparing')
                with closing(server.connect(database)) as db,db:
                    db.execute("UPDATE chat_turns SET context_turns='[]' WHERE id=?",(data['request_id'],))
                self.assertEqual(request(port,'/api/chat/graph?session_id='+sid)[1]['phase'],'waiting')


if __name__=='__main__':unittest.main()
