"""SQLite 连接。所有写入共用一把锁，构建任务和页面请求不会互相踩坏。"""

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager

from .config import database_path

_LOCK = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL UNIQUE,
  api_key TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'unknown',
  connection_message TEXT NOT NULL DEFAULT '',
  connection_checked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS vision_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  model_config_id TEXT,
  saved_at TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  embedding_model_id TEXT,
  rerank_model_id TEXT,
  ocr_enabled INTEGER NOT NULL,
  table_recognition INTEGER NOT NULL,
  image_text_recognition INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  chunk_overlap INTEGER NOT NULL,
  chunk_method TEXT NOT NULL DEFAULT 'recursive',
  child_chunk_size INTEGER NOT NULL DEFAULT 200,
  retrieval_mode TEXT NOT NULL,
  retrieval_count INTEGER NOT NULL,
  score_threshold REAL NOT NULL,
  max_context_tokens INTEGER NOT NULL,
  query_optimization INTEGER NOT NULL,
  rerank_enabled INTEGER NOT NULL,
  embedding_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  metadata TEXT NOT NULL DEFAULT '',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  selected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  knowledge_base_id TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  location TEXT NOT NULL,
  content TEXT NOT NULL,
  context_text TEXT NOT NULL DEFAULT '',
  token_count INTEGER NOT NULL,
  embedding BLOB,
  embedding_dim INTEGER,
  tags TEXT NOT NULL DEFAULT ''
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  tokens
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  knowledge_base_ids TEXT NOT NULL,
  model_config_id TEXT,
  route_mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS query_logs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  conversation_id TEXT,
  query TEXT NOT NULL,
  knowledge_base_ids TEXT NOT NULL,
  knowledge_base_names TEXT NOT NULL,
  model_name TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_kb ON documents(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_chunks_kb ON chunks(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_created ON query_logs(created_at);
"""


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(database_path(), check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    with _LOCK:
        connection = connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def init_db() -> None:
    with transaction() as connection:
        connection.executescript(SCHEMA)
        connection.execute(
            "INSERT OR IGNORE INTO vision_settings(id, model_config_id, saved_at) VALUES (1, NULL, NULL)"
        )
