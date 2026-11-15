"""Local text knowledge, lexical retrieval and explicit document/tag graph."""
from collections import Counter
from contextlib import closing
import hashlib
import json
import math
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
    if not full and 'body' in value:
        value['excerpt'] = value.pop('body')[:240]
    return value


GENERIC = set(terms('проект проекты клиент клиенты компания материал материалы текст вопрос ответ срок сроки сдача стоимость бюджет цена договор условия план задача отчет работа данные рубль ноябрь январь февраль март апрель май июнь июль август сентябрь октябрь декабрь'))


def index_document(connection, row):
    """Revision and postings change in the same transaction as the source document."""
    row = dict(row)
    digest = hashlib.sha256(row['body'].encode('utf-8')).hexdigest()
    connection.execute('INSERT OR IGNORE INTO knowledge_revisions(document_id,revision,title,body,tags,body_sha256,recorded_at) VALUES(?,?,?,?,?,?,?)',
                       (row['id'], row['revision'], row['title'], row['body'], row['tags'], digest, row['updated_at']))
    connection.execute('DELETE FROM knowledge_chunks WHERE document_id=?', (row['id'],))
    header = Counter(terms(row['title']+' '+' '.join(json.loads(row['tags']))))
    for number, offset in enumerate(range(0, len(row['body']), 1000)):
        start, end = max(0, offset-160), min(len(row['body']), offset+1400)
        excerpt = row['body'][start:end]
        connection.execute('INSERT INTO knowledge_chunks(document_id,chunk_no,revision,start_char,end_char,excerpt,body_sha256) VALUES(?,?,?,?,?,?,?)',
                           (row['id'], number, row['revision'], start, end, excerpt, digest))
        counts = Counter(terms(excerpt))
        connection.executemany('INSERT INTO knowledge_terms(term,document_id,chunk_no,body_tf,header_tf) VALUES(?,?,?,?,?)',
                               [(term,row['id'],number,counts[term],header[term]) for term in sorted(set(counts)|set(header))])


def explicit_topic(text):
    """Prefer the explicitly named project/client over generic question words."""
    found = re.search(r'\b(?:проект(?:а|у|е|ом)?|клиент(?:а|у|е|ом)?|компани[яию])\s+[«"\']?([^.,?!:\n]+)', clean(text))
    if not found:
        return set()
    result = set()
    for word in re.findall(r'[^\W_]+', found[1], re.UNICODE)[:5]:
        normalized = set(terms(word))
        if not normalized or normalized <= GENERIC:
            if result:
                break
            continue
        result.update(normalized)
    return result


class Knowledge:
    def __init__(self, database, connect):
        self.database, self.connect = database, connect

    def documents(self):
        with closing(self.connect(self.database)) as connection:
            return {'documents': [public_document(row) for row in connection.execute('SELECT id,title,tags,revision,created_at,updated_at,substr(body,1,240) AS excerpt FROM knowledge_documents ORDER BY updated_at DESC,rowid DESC')]}

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
            index_document(connection, connection.execute('SELECT * FROM knowledge_documents WHERE id=?', (identifier,)).fetchone())
        return self.get(identifier)

    def graph(self):
        with closing(self.connect(self.database)) as connection:
            documents = [dict(row, tags=json.loads(row['tags'])) for row in connection.execute('SELECT id,title,tags FROM knowledge_documents ORDER BY updated_at DESC,rowid DESC')]
        nodes, edges, tag_nodes = [], [], {}
        for document in documents:
            nodes.append({'id': document['id'], 'type': 'document', 'title': document['title'], 'tags': document['tags']})
            for tag in document['tags']:
                tag_id = 'tag:' + tag
                tag_nodes[tag_id] = {'id': tag_id, 'type': 'tag', 'title': tag}
                edges.append({'source': document['id'], 'target': tag_id})
        return {'nodes': nodes + list(tag_nodes.values()), 'edges': edges, 'documents': len(documents)}

    def retrieve(self, query, previous=''):
        query_terms = set(terms(query))
        followup = bool(re.search(r'(^а\b|\b(это|этот|эта|эти|нему|ней|них|подробнее|уточни|ещ[её])\b)', clean(query)))
        context_terms = set(terms(previous)) if followup else set()
        wanted = sorted(query_terms | context_terms)
        overview = bool(re.search(r'(что|покажи|обзор|список).{0,20}(баз|знани|материал)', clean(query)))
        if not wanted and not overview:
            return []
        with closing(self.connect(self.database)) as connection:
            connection.execute('BEGIN')
            count = connection.execute('SELECT COUNT(*) FROM knowledge_documents').fetchone()[0]
            postings = []
            # Stay below SQLite builds with a 999-variable limit, even for long questions.
            for offset in range(0, len(wanted), 250):
                batch = wanted[offset:offset+250]
                marks = ','.join('?' for _ in batch)
                postings.extend(connection.execute('SELECT term,document_id,chunk_no,body_tf,header_tf FROM knowledge_terms WHERE term IN ('+marks+')', batch).fetchall())
            frequency, header_matches, doc_matches = {}, {}, {}
            for row in postings:
                frequency.setdefault(row['term'], set()).add(row['document_id'])
                doc_matches.setdefault(row['document_id'], set()).add(row['term'])
                if row['header_tf']:
                    header_matches.setdefault(row['document_id'], set()).add(row['term'])
            explicit = explicit_topic(query)
            if not explicit and followup:
                explicit = explicit_topic(previous)
            all_headers = set().union(*header_matches.values()) if header_matches else set()
            if explicit and not explicit & set(frequency):
                return []
            scope = (explicit & set(frequency)) or ((query_terms & all_headers) - GENERIC)
            if not scope and followup:
                scope = (context_terms & all_headers) - GENERIC
            # Comparisons may legitimately name more than one project.
            comparison = bool(re.search(r'сравн|отлич|между|vs\b|versus', clean(query)))
            if comparison:
                scope |= (query_terms & all_headers) - GENERIC
            coverage = {doc: len(words & scope) for doc, words in doc_matches.items()}
            best_coverage = max(coverage.values(), default=0)
            scores, hits = {}, {}
            for row in postings:
                doc = row['document_id']
                if scope and (not coverage[doc] or not comparison and coverage[doc] != best_coverage):
                    continue
                key = (doc, row['chunk_no'])
                weight = 1 + math.log((count+1)/(len(frequency[row['term']])+1))
                multiplier = 4 if row['term'] in query_terms else 1
                scores[key] = scores.get(key, 0) + multiplier*weight*(min(row['body_tf'], 4)+min(row['header_tf'], 3)*5)
                hits.setdefault(key, set()).add(row['term'])
            best = {}
            for key, score in scores.items():
                if key[0] not in best or score > best[key[0]][1]:
                    best[key[0]] = (key, score)
            ranked = sorted(best.values(), key=lambda value: (-value[1], value[0]))[:6]
            if overview and not scope:
                # An explicit overview also works without lexical matches in the text.
                latest = connection.execute('SELECT id FROM knowledge_documents ORDER BY updated_at DESC,rowid DESC LIMIT 6').fetchall()
                ranked = [((row['id'], 0), 0) for row in latest]
            found = []
            for (doc_id, chunk_no), score in ranked:
                row = connection.execute('SELECT d.id,d.title,d.tags,d.updated_at,c.revision,c.start_char,c.end_char,c.excerpt,c.body_sha256 FROM knowledge_documents d JOIN knowledge_chunks c ON c.document_id=d.id WHERE d.id=? AND c.chunk_no=?', (doc_id, chunk_no)).fetchone()
                if row is None:
                    continue
                found.append({'id': row['id'], 'title': row['title'], 'tags': json.loads(row['tags']), 'excerpt': row['excerpt'],
                              'revision': row['revision'], 'updated_at': row['updated_at'],
                              'retrieval': {'method': 'sqlite-terms-v1', 'matched_terms': sorted(hits.get((doc_id, chunk_no), set())),
                                            'scope_terms': sorted(scope & doc_matches.get(doc_id, set())), 'score': round(score, 4),
                                            'start_char': row['start_char'], 'end_char': row['end_char'], 'body_sha256': row['body_sha256'],
                                            'excerpt_sha256': hashlib.sha256(row['excerpt'].encode('utf-8')).hexdigest()}})
            return found
