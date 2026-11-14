"""Browser-test server: same app/API/storage with a simulated Cloud.ru transport."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cloudru
import server


def fake_provider(path, api_key, data=None):
    if api_key == 'test-key-ui-down':
        raise cloudru.CloudError('Cloud.ru временно недоступен. Повторите позже.', 502)
    if path == 'models':
        return {'data': [
            {'id':'test/model-one','metadata':{'name':'Русская модель'}},
            {'id':'test/model-two','metadata':{'name':'<img src=x onerror=alert(1)>'}},
            {'id':'test/embed','metadata':{'endpoints':[{'path':'/v1/embeddings'}]}}]}
    if api_key != 'test-key-ui-valid':
        raise cloudru.CloudError('Cloud.ru отклонил ключ. Укажите действующий Key Secret для Foundation Models.', 401)
    return {'choices':[{'message':{'content':'Работает. Подключение к выбранной модели проверено.'},'finish_reason':'stop'}]}


cloudru.provider_request = fake_provider
if __name__ == '__main__':
    raise SystemExit(server.main())
