"""Local text knowledge, lexical retrieval and explicit document/tag graph."""
from collections import Counter
from contextlib import closing
import json
import re
import unicodedata
import uuid

from cloudru import CloudError
from skillrunner import now

STOP = set('а и в во на с со из по от до к у за о об обо для это этот эта эти что как какой какая какие когда где ли бы быть есть мне меня мой мои пожалуйста помоги расскажи скажи покажи дай про мы вы он она они его ее их или но то же не нет да'.split())


def clean(text):
    return unicodedata.normalize('NFKC', text).casefold().replace('ё', 'е')


def terms(text):
    words = re.findall(r'[^\W_]+', clean(text), re.UNICODE)
    result = []
    for word in words:
        if len(word) < 2 or word in STOP:
            continue
        if len(word) > 4 and re.fullmatch('[а-я]+', word):
            stem = re.sub(r'(иями|ами|ями|ого|ему|ому|ыми|ими|ий|ый|ая|ое|ие|ые|ой|ей|ам|ям|ах|ях|ов|ев|ом|ем|ть|ти|ет|ют|ут|ит|ат|ят|ы|и|а|я|у|ю|е|о)$', '', word)
            if len(stem) >= 3:
                word = stem
        result.append(word)
    return result


def public_document(row, full=False):
    value = dict(row)
    value['tags'] = json.loads(value['tags'])
    if not full:
        value['excerpt'] = value.pop('body')[:240]
    return value


class Knowledge:
    def __init__(self, database, connect):
        self.database, self.connect = database, connect

    def documents(self):
        with closing(self.connect(self.database)) as connection:
            return {'documents': [public_document(row) for row in connection.execute('SELECT * FROM knowledge_documents ORDER BY updated_at DESC,rowid DESC')]}

    def get(self, identifier):
        with closing(self.connect(self.database)) as connection:
            row = connection.execute('SELECT * FROM knowledge_documents WHERE id=?', (identifier,)).fetchone()
        if row is None:
            raise CloudError('Материал не найден в этой базе', 404)
        return public_document(row, full=True)

    def save(self, data):
        try:
            identifier = str(uuid.UUID(data.get('id', '')))
        except (ValueError, TypeError, AttributeError):
            raise CloudError('Некорректный идентификатор материала') from None
        title, body, tags, revision = data.get('title'), data.get('body'), data.get('tags', []), data.get('revision', 0)
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 200:
            raise CloudError('Введите название материала: до 200 символов')
        if not isinstance(body, str) or not 1 <= len(body.strip()) <= 16000:
            raise CloudError('Добавьте текст материала: до 16 000 символов')
        if not isinstance(tags, list) or len(tags) > 12 or any(not isinstance(tag, str) or not 1 <= len(tag.strip()) <= 50 for tag in tags):
            raise CloudError('Используйте до 12 меток, каждая до 50 символов')
        if type(revision) is not int or revision < 0:
            raise CloudError('Некорректная версия материала')
        tags = sorted(set(clean(tag.strip()) for tag in tags))
        title, body = title.strip(), body.strip()
        encoded = json.dumps(tags, ensure_ascii=False)
        with closing(self.connect(self.database)) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT * FROM knowledge_documents WHERE id=?', (identifier,)).fetchone()
            if row:
                if row['title'] == title and row['body'] == body and row['tags'] == encoded:
                    return public_document(row, full=True)
                if row['revision'] != revision:
                    raise CloudError('Материал изменён в другом окне. Откройте его заново перед сохранением.', 409)
                connection.execute('UPDATE knowledge_documents SET title=?,body=?,tags=?,revision=revision+1,updated_at=? WHERE id=?',
                                   (title, body, encoded, now(), identifier))
            else:
                if revision != 0:
                    raise CloudError('Материал не найден в этой базе', 404)
                stamp = now()
                connection.execute('INSERT INTO knowledge_documents(id,title,body,tags,created_at,updated_at) VALUES(?,?,?,?,?,?)',
                                   (identifier, title, body, encoded, stamp, stamp))
        return self.get(identifier)

    def graph(self):
        documents = self.documents()['documents']
        nodes, edges, tag_nodes = [], [], {}
        for document in documents:
            nodes.append({'id': document['id'], 'type': 'document', 'title': document['title'], 'tags': document['tags']})
            for tag in document['tags']:
                tag_id = 'tag:' + tag
                tag_nodes[tag_id] = {'id': tag_id, 'type': 'tag', 'title': tag}
                edges.append({'source': document['id'], 'target': tag_id})
        return {'nodes': nodes + list(tag_nodes.values()), 'edges': edges, 'documents': len(documents)}

    def retrieve(self, query, previous=''):
        query_terms = Counter(terms(query))
        # Short follow-ups can reuse a topic explicitly supplied earlier by this user.
        context_terms = Counter(terms(previous))
        followup = bool(re.search(r'(^а\b|\b(это|этот|эта|эти|нему|ней|них|подробнее|уточни|ещ[её])\b)', clean(query)))
        with closing(self.connect(self.database)) as connection:
            rows = connection.execute('SELECT * FROM knowledge_documents ORDER BY updated_at DESC,rowid DESC').fetchall()
        overview = bool(re.search(r'(что|покажи|обзор|список).{0,20}(баз|знани|материал)', clean(query)))
        candidates = []
        for row in rows:
            doc = public_document(row, full=True)
            header = Counter(terms(doc['title'] + ' ' + ' '.join(doc['tags'])))
            body = doc['body']
            best = None
            # Overlapping passages ensure matches in the middle/end of a material are included.
            for start in range(0, len(body), 1000):
                passage = body[max(0, start-160):start+1400]
                counts = Counter(terms(passage))
                direct = sum(min(counts[word], 4) + header[word]*5 for word in query_terms)
                prior = sum(min(counts[word], 2) + header[word]*2 for word in context_terms)
                score = direct*4 + (prior if direct or followup else 0)
                if best is None or score > best[0]:
                    best = (score, passage)
            if best and (best[0] > 0 or overview):
                candidates.append((best[0], {'id': doc['id'], 'title': doc['title'], 'tags': doc['tags'],
                                            'excerpt': best[1], 'revision': doc['revision'], 'updated_at': doc['updated_at']}))
        candidates.sort(key=lambda item: item[0], reverse=True)
        return [value for score, value in candidates[:6]]
