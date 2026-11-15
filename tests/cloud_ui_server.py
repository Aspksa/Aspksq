"""Browser-test server: same app/API/storage with a simulated Cloud.ru transport."""
from pathlib import Path
import sys
import time
import json
import os
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cloudru
import server


def fake_provider(path, api_key, data=None, timeout=40):
    if api_key == 'test-key-ui-down':
        raise cloudru.CloudError('Cloud.ru временно недоступен. Повторите позже.', 502)
    if path == 'models':
        return {'data': [
            {'id':'test/model-one','context_length':32768,'metadata':{'name':'Русская модель','type':'llm','provider':'cloud.ru','input_modalities':['text'],'output_modalities':['text']}},
            {'id':'test/model-two','context_length':40960,'reasoning':True,'metadata':{'name':'<img src=x onerror=alert(1)>','type':'llm','provider':'external'}},
            {'id':'test/ocr','metadata':{'type':'image+text-to-text','input_modalities':['text','image'],'output_modalities':['text']}},
            {'id':'test/guard','metadata':{'type':'guard','input_modalities':['text'],'output_modalities':['text']}},
            {'id':'test/embed','metadata':{'endpoints':[{'path':'/v1/embeddings'}]}}]}
    if api_key == 'test-key-ui-reasoning' and data.get('max_completion_tokens',128)==128:
        return {'choices':[{'message':{'content':None},'finish_reason':'length'}]}
    if api_key not in ('test-key-ui-valid','test-key-ui-reasoning'):
        raise cloudru.CloudError('Cloud.ru отклонил ключ. Укажите действующий Key Secret для Foundation Models.', 401)
    if data and len(data.get('messages',[])) > 1:
        time.sleep(float(os.environ.get('TRACKTOR_TEST_CHAT_DELAY','1')))
        prefix='Ответ помощника: ' if 'локальном приложении TRACKTOR' in data['messages'][0]['content'] else 'Результат навыка: '
        sources=[]
        if 'источники фактов:\n' in data['messages'][0]['content']:
            sources=json.loads(data['messages'][0]['content'].split('источники фактов:\n',1)[1])
        facts='\n'.join('['+str(index+1)+'] '+source['excerpt'] for index,source in enumerate(sources))
        return {'choices':[{'message':{'content':prefix+data['messages'][-1]['content']+'\n'+facts+'\nУчтено сообщений: '+str(len(data['messages']))+'\n<img src=x onerror=alert(1)>'},'finish_reason':'stop'}],
                'usage':{'prompt_tokens':10,'completion_tokens':20,'total_tokens':30}}
    return {'choices':[{'message':{'content':'Работает. Подключение к выбранной модели проверено.'},'finish_reason':'stop'}]}


cloudru.provider_request = fake_provider
if __name__ == '__main__':
    raise SystemExit(server.main())
