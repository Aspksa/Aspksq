"""Provider-specific compatibility and failure cases, without real model calls."""
import io
import json
from pathlib import Path
import socket
import ssl
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
import http.client

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import cloudru
from test_cloudru import application, response, KEY, MODEL
from test_local_db import request


def rejected(status,payload=None,headers=None):
    return HTTPError(cloudru.BASE_URL,status,'private '+KEY,headers or {},io.BytesIO(json.dumps(payload or {}).encode()))


def completion():
    return response({'choices':[{'message':{'content':'Работает'},'finish_reason':'stop'}]})


class CloudTransportTests(unittest.TestCase):
    def test_token_parameter_fallback_only_after_explicit_rejection(self):
        data={'model':MODEL,'messages':[{'role':'user','content':'Привет'}],'max_completion_tokens':512}
        failure={'error':{'code':'unsupported_parameter','param':'max_completion_tokens','message':KEY}}
        with patch('cloudru.build_opener') as opener:
            opener.return_value.open.side_effect=[rejected(400,failure),completion()]
            cloudru.provider_request('chat/completions',KEY,data)
            self.assertEqual(opener.return_value.open.call_count,2)
            first,second=[json.loads(call.args[0].data) for call in opener.return_value.open.call_args_list]
            self.assertEqual(first['max_completion_tokens'],512)
            self.assertNotIn('max_tokens',first)
            self.assertEqual(second['max_tokens'],512)
            self.assertNotIn('max_completion_tokens',second)
            self.assertEqual(first['messages'],second['messages'])
            self.assertEqual(data['max_completion_tokens'],512)  # Caller payload is not mutated.
        legacy=dict(data);legacy['max_tokens']=legacy.pop('max_completion_tokens')
        with patch('cloudru.build_opener') as opener:
            opener.return_value.open.side_effect=[rejected(422,{'error':{'code':'unknown_parameter','param':'max_tokens'}}),completion()]
            cloudru.provider_request('chat/completions',KEY,legacy)
            self.assertEqual(json.loads(opener.return_value.open.call_args.args[0].data)['max_completion_tokens'],512)

    def test_generation_is_not_retried_on_ambiguous_failures(self):
        cases=[rejected(400,{'error':{'message':'Something failed '+KEY}}), rejected(401), rejected(403),
               rejected(429,headers={'Retry-After':'30'}), rejected(500), rejected(503), rejected(504),
               URLError(TimeoutError(KEY)), http.client.IncompleteRead(KEY.encode())]
        for failure in cases:
            with self.subTest(kind=type(failure).__name__),patch('cloudru.build_opener') as opener:
                opener.return_value.open.side_effect=failure
                with self.assertRaises(cloudru.CloudError) as caught:
                    cloudru.provider_request('chat/completions',KEY,{'model':MODEL,'max_completion_tokens':128})
                self.assertEqual(opener.return_value.open.call_count,1)
                self.assertNotIn(KEY,str(caught.exception))
        with patch('cloudru.build_opener') as opener:
            failure={'error':{'code':'unsupported_parameter','param':'max_completion_tokens'}}
            opener.return_value.open.side_effect=[rejected(400,failure),rejected(400,{'error':{'code':'unsupported_parameter','param':'max_tokens'}})]
            with self.assertRaises(cloudru.CloudError):
                cloudru.provider_request('chat/completions',KEY,{'max_completion_tokens':128})
            self.assertEqual(opener.return_value.open.call_count,2)

    def test_dns_tls_proxy_timeout_and_quota_diagnostics(self):
        cases=[
            (URLError(socket.gaierror(socket.EAI_NONAME,KEY)),'dns_error',502),
            (URLError(ssl.SSLCertVerificationError(1,KEY)),'tls_certificate',502),
            (ssl.SSLError(1,KEY),'tls_error',502),
            (URLError(OSError('Tunnel connection failed: 407 '+KEY)),'proxy_error',502),
            (URLError(socket.timeout(KEY)),'timeout',504),
            (http.client.IncompleteRead(KEY.encode()),'connection_error',502),
            (rejected(429,headers={'Retry-After':'30'}),'rate_limit',429),
            (rejected(400,{'error':{'code':'context_length_exceeded','message':KEY}}),'context_limit',400),
            (rejected(403,{'error':{'code':'content_filter','message':KEY}}),'content_filter',400)]
        for failure,code,status in cases:
            with self.subTest(code=code),patch('cloudru.build_opener') as opener:
                opener.return_value.open.side_effect=failure
                with self.assertRaises(cloudru.CloudError) as caught:
                    cloudru.provider_request('chat/completions',KEY,{'max_completion_tokens':128})
                self.assertEqual(caught.exception.code,code)
                self.assertEqual(caught.exception.status,status)
                self.assertNotIn(KEY,str(caught.exception))
                if code=='rate_limit': self.assertIn('30 сек',str(caught.exception))

    def test_text_catalog_excludes_specialists_but_keeps_multimodal_llms(self):
        endpoint=[{'path':'/v1/chat/completions','method':'POST'}]
        def model(identifier,kind='llm',inputs=None,output=None,**extra):
            return {'id':identifier,'context_length':32768,'metadata':dict(type=kind,input_modalities=inputs or ['text'],output_modalities=output or ['text'],endpoints=endpoint,provider='external'),**extra}
        data={'data':[model('good/text'),model('good/vision',inputs=['text','image'],reasoning=True),model('bad/ocr','image+text-to-text',inputs=['text','image']),
                      model('bad/guard','guard'),model('bad/embedding','embedder'),model('bad/audio-only',inputs=['audio']),model('bad/image-only',output=['image']),
                      model('good/future-kind','future-text-chat')]}
        with tempfile.TemporaryDirectory() as temporary:
            import server
            database=Path(temporary)/'tracktor.sqlite3'
            server.initialize(database)
            client=cloudru.CloudRu(database,server.connect)
            client.save({'api_key':KEY})
            with patch('cloudru.provider_request',return_value=data):
                models=client.models()['data']
            self.assertEqual({item['id'] for item in models},{'good/text','good/vision','good/future-kind'})
            self.assertTrue(next(item for item in models if item['id']=='good/vision')['reasoning'])
            self.assertEqual(models[0]['context_length'],32768)

    def test_reasoning_only_check_is_not_verified_and_limit_is_explicit(self):
        with tempfile.TemporaryDirectory() as temporary:
            with application(Path(temporary)/'tracktor.sqlite3') as port:
                request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL})
                with patch('cloudru.provider_request',return_value={'choices':[{'message':{'content':'  '},'finish_reason':'length'}]}) as provider:
                    status,value=request(port,'/api/cloud/test',{'max_tokens':512})
                    self.assertEqual(status,200)
                    self.assertIsNone(value['verified_at'])
                    self.assertIsNone(request(port,'/api/cloud/settings')[1]['verified_at'])
                    self.assertEqual(provider.call_args.args[2]['max_completion_tokens'],512)
                with patch('cloudru.provider_request') as provider:
                    for limit in (True,0,8192,'512'):
                        self.assertEqual(request(port,'/api/cloud/test',{'max_tokens':limit})[0],400)
                    provider.assert_not_called()
                with self.assertRaises(cloudru.CloudError) as denied:
                    cloudru.completion_result({'choices':[{'message':{'content':None,'refusal':KEY},'finish_reason':'stop'}]},KEY)
                self.assertEqual(denied.exception.code,'content_filter')
                self.assertNotIn(KEY,str(denied.exception))

    def test_parallel_verification_does_not_send_a_second_paid_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            with application(Path(temporary)/'tracktor.sqlite3') as port:
                request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL})
                entered=threading.Event();release=threading.Event();results=[]
                def provider(*args,**kwargs):
                    entered.set();release.wait(5)
                    return {'choices':[{'message':{'content':'Работает'},'finish_reason':'stop'}]}
                with patch('cloudru.provider_request',side_effect=provider) as calls:
                    first=threading.Thread(target=lambda:results.append(request(port,'/api/cloud/test',{})))
                    first.start()
                    try:
                        self.assertTrue(entered.wait(3))
                        status,value=request(port,'/api/cloud/test',{})
                        self.assertEqual(status,409)
                        self.assertEqual(value['code'],'verification_running')
                        self.assertEqual(calls.call_count,1)
                    finally:
                        release.set();first.join(timeout=8)
                    self.assertEqual(results[0][0],200)

    def test_browser_disconnect_keeps_completed_check_without_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            with application(Path(temporary)/'tracktor.sqlite3') as port:
                request(port,'/api/cloud/settings',{'api_key':KEY,'model':MODEL})
                entered=threading.Event();release=threading.Event()
                def provider(*args,**kwargs):
                    entered.set();release.wait(5)
                    return {'choices':[{'message':{'content':'Работает'},'finish_reason':'stop'}]}
                with patch('cloudru.provider_request',side_effect=provider) as calls:
                    client=socket.create_connection(('127.0.0.1',port),timeout=5)
                    client.sendall(('POST /api/cloud/test HTTP/1.1\r\nHost: 127.0.0.1:'+str(port)+'\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}').encode())
                    try:
                        self.assertTrue(entered.wait(3))
                    finally:
                        client.close();release.set()
                    import time
                    deadline=time.monotonic()+5
                    while time.monotonic()<deadline:
                        settings=request(port,'/api/cloud/settings')[1]
                        if settings['verified_at']:break
                        time.sleep(.02)
                    self.assertTrue(settings['verified_at'])
                    self.assertEqual(calls.call_count,1)
                    self.assertEqual(request(port,'/api/status')[0],200)

    def test_copied_bearer_key_with_quotes_and_bom(self):
        self.assertEqual(cloudru.normalize_key('\ufeff  "Bearer '+KEY+'"  '),KEY)
        with self.assertRaises(cloudru.CloudError): cloudru.normalize_key(KEY+'\nInjected: header')


if __name__=='__main__':
    unittest.main()
