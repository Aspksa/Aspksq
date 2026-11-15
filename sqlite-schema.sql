CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, monthly_fee REAL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','attention','paused')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0 CHECK(file_count >= 0),
  color_index INTEGER NOT NULL DEFAULT 0 CHECK(color_index BETWEEN 0 AND 5),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'SONNET', mode TEXT NOT NULL DEFAULT 'СРЕДНИЙ',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'В ОЧЕРЕДИ', is_next INTEGER NOT NULL DEFAULT 0 CHECK(is_next IN (0,1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done','cancelled')),
  due_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'TRACKTOR', read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY CHECK(id=1), preferences TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cloudru_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  api_key TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', verified_at TEXT
);

CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, skill_name TEXT NOT NULL,
  description TEXT NOT NULL, model TEXT NOT NULL, task TEXT NOT NULL,
  max_tokens INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','partial','failed','interrupted')),
  result TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', usage TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS skill_runs_skill_idx ON skill_runs(skill_id);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Новый диалог', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_turns (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  task TEXT NOT NULL, model TEXT NOT NULL, max_tokens INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','partial','failed','interrupted')),
  result TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', usage TEXT NOT NULL DEFAULT '{}',
  include_knowledge INTEGER NOT NULL DEFAULT 0, sources TEXT NOT NULL DEFAULT '[]', context_turns TEXT,
  created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS chat_turns_session_idx ON chat_turns(session_id);
CREATE TABLE IF NOT EXISTS assistant_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  active_session TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
  x REAL NOT NULL DEFAULT 1, y REAL NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_revisions (
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL,
  body_sha256 TEXT NOT NULL, recorded_at TEXT NOT NULL,
  PRIMARY KEY(document_id,revision)
);
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_no INTEGER NOT NULL, revision INTEGER NOT NULL, start_char INTEGER NOT NULL, end_char INTEGER NOT NULL,
  excerpt TEXT NOT NULL, body_sha256 TEXT NOT NULL,
  PRIMARY KEY(document_id,chunk_no)
);
CREATE TABLE IF NOT EXISTS knowledge_terms (
  term TEXT NOT NULL, document_id TEXT NOT NULL, chunk_no INTEGER NOT NULL,
  body_tf INTEGER NOT NULL, header_tf INTEGER NOT NULL,
  PRIMARY KEY(term,document_id,chunk_no),
  FOREIGN KEY(document_id,chunk_no) REFERENCES knowledge_chunks(document_id,chunk_no) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS knowledge_terms_chunk_idx ON knowledge_terms(document_id,chunk_no);
CREATE TABLE IF NOT EXISTS chat_requests (
  turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
  payload TEXT NOT NULL, sha256 TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_turns_active_idx ON chat_turns(status) WHERE status='running';
CREATE INDEX IF NOT EXISTS skill_runs_active_idx ON skill_runs(status) WHERE status='running';
