"""业务数据的读写。页面拿到的字典不包含密钥和向量。"""

import json
import uuid
from datetime import datetime
from pathlib import Path

import numpy as np

from .config import files_dir
from .db import init_db, transaction
from .textutil import search_tokens

def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def new_id() -> str:
    return str(uuid.uuid4())


def _bool(value: object) -> bool:
    return bool(value)


def provider_out(row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "name": row["name"],
        "baseUrl": row["base_url"],
        "hasApiKey": bool(row["api_key"]),
        "connectionStatus": row["connection_status"] if "connection_status" in row.keys() else "unknown",
        "connectionMessage": row["connection_message"] if "connection_message" in row.keys() else "",
        "createdAt": row["created_at"],
    }


def model_out(row) -> dict:
    return {
        "id": row["id"],
        "providerId": row["provider_id"],
        "displayName": row["display_name"],
        "modelId": row["model_id"],
        "capability": row["capability"],
        "supportsVision": _bool(row["supports_vision"]),
        "createdAt": row["created_at"],
    }


def document_out(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "size": row["size"],
        "mimeType": row["mime_type"],
        "selectedAt": row["selected_at"],
        "status": row["status"],
        "error": row["error"],
        "chunkCount": row["chunk_count"],
    }


def settings_out(row) -> dict:
    return {
        "ocrEnabled": _bool(row["ocr_enabled"]),
        "tableRecognition": _bool(row["table_recognition"]),
        "imageTextRecognition": _bool(row["image_text_recognition"]),
        "embeddingModelId": row["embedding_model_id"],
        "rerankModelId": row["rerank_model_id"],
        "chunkSize": row["chunk_size"],
        "chunkOverlap": row["chunk_overlap"],
        "chunkMethod": row["chunk_method"] if "chunk_method" in row.keys() else "recursive",
        "childChunkSize": row["child_chunk_size"] if "child_chunk_size" in row.keys() else 200,
        "retrievalMode": row["retrieval_mode"],
        "retrievalCount": row["retrieval_count"],
        "scoreThreshold": row["score_threshold"],
        "maxContextTokens": row["max_context_tokens"],
        "queryOptimization": _bool(row["query_optimization"]),
        "rerankEnabled": _bool(row["rerank_enabled"]),
    }


def knowledge_base_out(row, documents: list[dict]) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "embeddingLocked": _bool(row["embedding_locked"]),
        "documents": documents,
        "settings": settings_out(row),
    }


def startup() -> None:
    init_db()
    with transaction() as connection:
        _migrate(connection)
        timestamp = now()
        connection.execute(
            """
            UPDATE documents
            SET status = 'failed', error = '服务重启了，请重新构建', updated_at = ?
            WHERE status = 'building'
            """,
            (timestamp,),
        )
        knowledge_base_ids = [
            row["id"] for row in connection.execute("SELECT id FROM knowledge_bases")
        ]
        for knowledge_base_id in knowledge_base_ids:
            recompute_status(connection, knowledge_base_id)


def recompute_status(connection, knowledge_base_id: str) -> None:
    statuses = {
        row["status"]
        for row in connection.execute(
            "SELECT status FROM documents WHERE knowledge_base_id = ?",
            (knowledge_base_id,),
        )
    }
    chunk_count = connection.execute(
        "SELECT COUNT(*) AS total FROM chunks WHERE knowledge_base_id = ?",
        (knowledge_base_id,),
    ).fetchone()["total"]
    if "building" in statuses:
        status = "building"
    elif chunk_count:
        status = "ready"
    elif "failed" in statuses:
        status = "failed"
    else:
        status = "draft"
    connection.execute(
        """
        UPDATE knowledge_bases
        SET status = ?, embedding_locked = ?, updated_at = ?
        WHERE id = ?
        """,
        (status, 1 if chunk_count else 0, now(), knowledge_base_id),
    )


def list_providers() -> list[dict]:
    with transaction() as connection:
        rows = connection.execute("SELECT * FROM providers ORDER BY created_at").fetchall()
    return [provider_out(row) for row in rows]


def get_provider_row(provider_id: str):
    with transaction() as connection:
        return connection.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()


def insert_provider(kind: str, name: str, base_url: str, api_key: str) -> dict:
    timestamp = now()
    provider_id = new_id()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO providers(id, kind, name, base_url, api_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (provider_id, kind, name, base_url, api_key, timestamp),
        )
        row = connection.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
    return provider_out(row)


def set_provider_connection(provider_id: str, status: str, message: str) -> None:
    with transaction() as connection:
        connection.execute(
            """
            UPDATE providers
            SET connection_status = ?, connection_message = ?, connection_checked_at = ?
            WHERE id = ?
            """,
            (status, message, now(), provider_id),
        )


def delete_provider(provider_id: str) -> None:
    with transaction() as connection:
        model_ids = [
            row["id"]
            for row in connection.execute("SELECT id FROM models WHERE provider_id = ?", (provider_id,))
        ]
        if model_ids:
            placeholders = ",".join("?" * len(model_ids))
            connection.execute(
                f"UPDATE vision_settings SET model_config_id = NULL, saved_at = NULL WHERE model_config_id IN ({placeholders})",
                model_ids,
            )
        connection.execute("DELETE FROM providers WHERE id = ?", (provider_id,))


def list_models() -> list[dict]:
    with transaction() as connection:
        rows = connection.execute("SELECT * FROM models ORDER BY created_at").fetchall()
    return [model_out(row) for row in rows]


def get_model_bundle(model_config_id: str) -> tuple[dict, dict] | None:
    with transaction() as connection:
        row = connection.execute(
            """
            SELECT models.*, providers.kind AS provider_kind, providers.base_url, providers.api_key, providers.name AS provider_name
            FROM models JOIN providers ON providers.id = models.provider_id
            WHERE models.id = ?
            """,
            (model_config_id,),
        ).fetchone()
    if row is None:
        return None
    provider = {
        "id": row["provider_id"],
        "kind": row["provider_kind"],
        "name": row["provider_name"],
        "base_url": row["base_url"],
        "api_key": row["api_key"],
    }
    model = {
        "id": row["id"],
        "provider_id": row["provider_id"],
        "display_name": row["display_name"],
        "model_id": row["model_id"],
        "capability": row["capability"],
        "supports_vision": row["supports_vision"],
    }
    return provider, model


def insert_model(provider_id: str, display_name: str, model_id: str, capability: str, supports_vision: bool) -> dict:
    timestamp = now()
    record_id = new_id()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO models(id, provider_id, display_name, model_id, capability, supports_vision, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (record_id, provider_id, display_name, model_id, capability, int(supports_vision), timestamp),
        )
        row = connection.execute("SELECT * FROM models WHERE id = ?", (record_id,)).fetchone()
    return model_out(row)


def delete_model(model_config_id: str) -> None:
    with transaction() as connection:
        connection.execute(
            "UPDATE vision_settings SET model_config_id = NULL, saved_at = NULL WHERE model_config_id = ?",
            (model_config_id,),
        )
        connection.execute("DELETE FROM models WHERE id = ?", (model_config_id,))


def get_vision() -> dict:
    with transaction() as connection:
        row = connection.execute("SELECT * FROM vision_settings WHERE id = 1").fetchone()
    return {"modelConfigId": row["model_config_id"], "savedAt": row["saved_at"]}


def set_vision(model_config_id: str | None) -> dict:
    timestamp = now() if model_config_id else None
    with transaction() as connection:
        connection.execute(
            "UPDATE vision_settings SET model_config_id = ?, saved_at = ? WHERE id = 1",
            (model_config_id, timestamp),
        )
    return get_vision()


def _documents_for(connection, knowledge_base_id: str) -> list[dict]:
    rows = connection.execute(
        "SELECT * FROM documents WHERE knowledge_base_id = ? ORDER BY selected_at",
        (knowledge_base_id,),
    ).fetchall()
    return [document_out(row) for row in rows]


def list_knowledge_bases() -> list[dict]:
    with transaction() as connection:
        rows = connection.execute("SELECT * FROM knowledge_bases ORDER BY updated_at DESC").fetchall()
        return [knowledge_base_out(row, _documents_for(connection, row["id"])) for row in rows]


def get_knowledge_base(knowledge_base_id: str) -> dict | None:
    with transaction() as connection:
        row = connection.execute("SELECT * FROM knowledge_bases WHERE id = ?", (knowledge_base_id,)).fetchone()
        if row is None:
            return None
        return knowledge_base_out(row, _documents_for(connection, knowledge_base_id))


def get_knowledge_base_row(knowledge_base_id: str):
    with transaction() as connection:
        return connection.execute("SELECT * FROM knowledge_bases WHERE id = ?", (knowledge_base_id,)).fetchone()


def insert_knowledge_base(name: str, description: str) -> dict:
    timestamp = now()
    knowledge_base_id = new_id()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO knowledge_bases(
              id, name, description, status, embedding_model_id, rerank_model_id,
              ocr_enabled, table_recognition, image_text_recognition,
              chunk_size, chunk_overlap, chunk_method, child_chunk_size, retrieval_mode, retrieval_count, score_threshold,
              max_context_tokens, query_optimization, rerank_enabled, embedding_locked,
              created_at, updated_at
            ) VALUES (?, ?, ?, 'draft', NULL, NULL, 1, 1, 1, 600, 80, 'recursive', 200, 'hybrid', 20, 0.3, 6000, 1, 1, 0, ?, ?)
            """,
            (knowledge_base_id, name, description, timestamp, timestamp),
        )
    created = get_knowledge_base(knowledge_base_id)
    assert created is not None
    return created


def update_knowledge_base(knowledge_base_id: str, name: str, description: str, settings: dict) -> None:
    with transaction() as connection:
        connection.execute(
            """
            UPDATE knowledge_bases SET
              name = ?, description = ?, embedding_model_id = ?, rerank_model_id = ?,
              ocr_enabled = ?, table_recognition = ?, image_text_recognition = ?,
              chunk_size = ?, chunk_overlap = ?, chunk_method = ?, child_chunk_size = ?, retrieval_mode = ?, retrieval_count = ?,
              score_threshold = ?, max_context_tokens = ?, query_optimization = ?, rerank_enabled = ?,
              updated_at = ?
            WHERE id = ?
            """,
            (
                name,
                description,
                settings["embedding_model_id"],
                settings["rerank_model_id"],
                int(settings["ocr_enabled"]),
                int(settings["table_recognition"]),
                int(settings["image_text_recognition"]),
                settings["chunk_size"],
                settings["chunk_overlap"],
                settings["chunk_method"],
                settings["child_chunk_size"],
                settings["retrieval_mode"],
                settings["retrieval_count"],
                settings["score_threshold"],
                settings["max_context_tokens"],
                int(settings["query_optimization"]),
                int(settings["rerank_enabled"]),
                now(),
                knowledge_base_id,
            ),
        )


def delete_knowledge_base(knowledge_base_id: str) -> None:
    with transaction() as connection:
        paths = [
            row["stored_path"]
            for row in connection.execute(
                "SELECT stored_path FROM documents WHERE knowledge_base_id = ?",
                (knowledge_base_id,),
            )
        ]
        chunk_ids = [
            row["id"]
            for row in connection.execute("SELECT id FROM chunks WHERE knowledge_base_id = ?", (knowledge_base_id,))
        ]
        _delete_fts(connection, chunk_ids)
        connection.execute("DELETE FROM knowledge_bases WHERE id = ?", (knowledge_base_id,))
    _remove_files(paths)


def insert_document(
    knowledge_base_id: str,
    name: str,
    size: int,
    mime_type: str,
    stored_path: str,
    document_id: str | None = None,
) -> dict:
    timestamp = now()
    document_id = document_id or new_id()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO documents(
              id, knowledge_base_id, name, size, mime_type, stored_path, status, error,
              chunk_count, selected_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', NULL, 0, ?, ?)
            """,
            (document_id, knowledge_base_id, name, size, mime_type, stored_path, timestamp, timestamp),
        )
        recompute_status(connection, knowledge_base_id)
        row = connection.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    return document_out(row)


def delete_document(knowledge_base_id: str, document_id: str) -> str | None:
    with transaction() as connection:
        row = connection.execute(
            "SELECT stored_path FROM documents WHERE id = ? AND knowledge_base_id = ?",
            (document_id, knowledge_base_id),
        ).fetchone()
        if row is None:
            return None
        chunk_ids = [
            item["id"]
            for item in connection.execute("SELECT id FROM chunks WHERE document_id = ?", (document_id,))
        ]
        _delete_fts(connection, chunk_ids)
        connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
        recompute_status(connection, knowledge_base_id)
    _remove_files([row["stored_path"]])
    return row["stored_path"]


def list_building_documents(knowledge_base_id: str) -> list[dict]:
    with transaction() as connection:
        rows = connection.execute(
            "SELECT * FROM documents WHERE knowledge_base_id = ? AND status = 'building' ORDER BY selected_at",
            (knowledge_base_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def mark_for_build(knowledge_base_id: str, rebuild: bool) -> list[str]:
    statuses = ("uploaded", "failed", "ready") if rebuild else ("uploaded", "failed")
    placeholders = ",".join("?" * len(statuses))
    with transaction() as connection:
        rows = connection.execute(
            f"""
            SELECT id FROM documents
            WHERE knowledge_base_id = ? AND status IN ({placeholders})
            ORDER BY selected_at
            """,
            (knowledge_base_id, *statuses),
        ).fetchall()
        document_ids = [row["id"] for row in rows]
        if not document_ids:
            return []
        id_placeholders = ",".join("?" * len(document_ids))
        connection.execute(
            f"UPDATE documents SET status = 'building', error = NULL, updated_at = ? WHERE id IN ({id_placeholders})",
            (now(), *document_ids),
        )
        connection.execute(
            "UPDATE knowledge_bases SET status = 'building', updated_at = ? WHERE id = ?",
            (now(), knowledge_base_id),
        )
    return document_ids


def mark_document_failed(document_id: str, message: str) -> None:
    with transaction() as connection:
        row = connection.execute("SELECT knowledge_base_id FROM documents WHERE id = ?", (document_id,)).fetchone()
        connection.execute(
            "UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
            (message, now(), document_id),
        )
        if row is not None:
            recompute_status(connection, row["knowledge_base_id"])


def replace_document_chunks(document_id: str, knowledge_base_id: str, chunks: list[dict]) -> None:
    with transaction() as connection:
        old_ids = [
            row["id"] for row in connection.execute("SELECT id FROM chunks WHERE document_id = ?", (document_id,))
        ]
        _delete_fts(connection, old_ids)
        connection.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))
        for position, chunk in enumerate(chunks):
            chunk_id = new_id()
            connection.execute(
                """
                INSERT INTO chunks(
                  id, knowledge_base_id, document_id, position, location, content, context_text,
                  token_count, embedding, embedding_dim
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk_id,
                    knowledge_base_id,
                    document_id,
                    position,
                    chunk["location"],
                    chunk["content"],
                    chunk.get("context", ""),
                    chunk["token_count"],
                    chunk["embedding"],
                    chunk["embedding_dim"],
                ),
            )
            connection.execute(
                "INSERT INTO chunks_fts(chunk_id, tokens) VALUES (?, ?)",
                (chunk_id, " ".join(search_tokens(chunk["content"]))),
            )
        connection.execute(
            "UPDATE documents SET status = 'ready', error = NULL, chunk_count = ?, updated_at = ? WHERE id = ?",
            (len(chunks), now(), document_id),
        )
        recompute_status(connection, knowledge_base_id)


def get_document(document_id: str):
    with transaction() as connection:
        return connection.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()


def list_chunks(knowledge_base_id: str, limit: int = 300) -> dict:
    with transaction() as connection:
        total = connection.execute(
            "SELECT COUNT(*) AS total FROM chunks WHERE knowledge_base_id = ?",
            (knowledge_base_id,),
        ).fetchone()["total"]
        rows = connection.execute(
            """
            SELECT chunks.*, documents.name AS document_name
            FROM chunks JOIN documents ON documents.id = chunks.document_id
            WHERE chunks.knowledge_base_id = ?
            ORDER BY documents.selected_at, chunks.position
            LIMIT ?
            """,
            (knowledge_base_id, limit),
        ).fetchall()
    return {
        "total": total,
        "items": [
            {
                "id": row["id"],
                "documentId": row["document_id"],
                "documentName": row["document_name"],
                "location": row["location"],
                "content": row["content"],
                "context": row["context_text"] if "context_text" in row.keys() else "",
                "tokenCount": row["token_count"],
            }
            for row in rows
        ],
    }


def chunk_rows_for(knowledge_base_ids: list[str]) -> list[dict]:
    if not knowledge_base_ids:
        return []
    placeholders = ",".join("?" * len(knowledge_base_ids))
    with transaction() as connection:
        rows = connection.execute(
            f"""
            SELECT chunks.id, chunks.knowledge_base_id, chunks.location, chunks.content,
                   chunks.context_text, chunks.token_count, chunks.embedding, chunks.embedding_dim,
                   documents.name AS document_name, knowledge_bases.name AS knowledge_base_name
            FROM chunks
            JOIN documents ON documents.id = chunks.document_id
            JOIN knowledge_bases ON knowledge_bases.id = chunks.knowledge_base_id
            WHERE chunks.knowledge_base_id IN ({placeholders}) AND chunks.embedding IS NOT NULL
            """,
            knowledge_base_ids,
        ).fetchall()
    return [dict(row) for row in rows]


def normalize_vector(vector: list[float]) -> tuple[bytes, int]:
    array = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(array))
    if norm > 0:
        array = array / norm
    return array.tobytes(), int(array.shape[0])


def insert_conversation(title: str) -> dict:
    timestamp = now()
    conversation_id = new_id()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO conversations(id, title, knowledge_base_ids, model_config_id, route_mode, created_at, updated_at)
            VALUES (?, ?, '[]', NULL, 'manual', ?, ?)
            """,
            (conversation_id, title, timestamp, timestamp),
        )
    return get_conversation(conversation_id)


def list_conversations() -> list[dict]:
    with transaction() as connection:
        rows = connection.execute("SELECT * FROM conversations ORDER BY updated_at DESC").fetchall()
    return [_conversation_out(row) for row in rows]


def get_conversation(conversation_id: str) -> dict | None:
    with transaction() as connection:
        row = connection.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if row is None:
            return None
        messages = connection.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid",
            (conversation_id,),
        ).fetchall()
    payload = _conversation_out(row)
    payload["messages"] = [_message_out(message) for message in messages]
    return payload


def previous_messages(conversation_id: str) -> list[dict]:
    with transaction() as connection:
        rows = connection.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid",
            (conversation_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def touch_conversation(conversation_id: str, title: str, knowledge_base_ids: list[str], model_config_id: str) -> None:
    with transaction() as connection:
        connection.execute(
            """
            UPDATE conversations
            SET title = ?, knowledge_base_ids = ?, model_config_id = ?, route_mode = 'manual', updated_at = ?
            WHERE id = ?
            """,
            (title, json.dumps(knowledge_base_ids), model_config_id, now(), conversation_id),
        )


def insert_message(conversation_id: str, role: str, content: str, status: str = "success") -> str:
    message_id = new_id()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO messages(
              id, conversation_id, role, content, citations, prompt_tokens, completion_tokens,
              duration_ms, status, created_at
            ) VALUES (?, ?, ?, ?, '[]', 0, 0, 0, ?, ?)
            """,
            (message_id, conversation_id, role, content, status, now()),
        )
    return message_id


def finish_message(
    message_id: str,
    *,
    content: str,
    citations: list[dict],
    prompt_tokens: int,
    completion_tokens: int,
    duration_ms: int,
    status: str,
) -> None:
    with transaction() as connection:
        connection.execute(
            """
            UPDATE messages
            SET content = ?, citations = ?, prompt_tokens = ?, completion_tokens = ?, duration_ms = ?, status = ?
            WHERE id = ?
            """,
            (
                content,
                json.dumps(citations, ensure_ascii=False),
                prompt_tokens,
                completion_tokens,
                duration_ms,
                status,
                message_id,
            ),
        )


def insert_log(entry: dict) -> None:
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO query_logs(
              id, kind, conversation_id, query, knowledge_base_ids, knowledge_base_names, model_name,
              prompt_tokens, completion_tokens, duration_ms, status, error, role, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id(),
                entry["kind"],
                entry.get("conversation_id"),
                entry["query"],
                json.dumps(entry["knowledge_base_ids"]),
                entry["knowledge_base_names"],
                entry["model_name"],
                entry["prompt_tokens"],
                entry["completion_tokens"],
                entry["duration_ms"],
                entry["status"],
                entry.get("error"),
                entry["role"],
                now(),
            ),
        )


def query_logs(filters: dict) -> list[dict]:
    where, params = _log_filters(filters)
    with transaction() as connection:
        rows = connection.execute(
            f"SELECT * FROM query_logs {where} ORDER BY created_at DESC LIMIT 200",
            params,
        ).fetchall()
    return [
        {
            "id": row["id"],
            "kind": row["kind"],
            "query": row["query"],
            "knowledgeBaseNames": row["knowledge_base_names"],
            "modelName": row["model_name"],
            "promptTokens": row["prompt_tokens"],
            "completionTokens": row["completion_tokens"],
            "durationMs": row["duration_ms"],
            "status": row["status"],
            "error": row["error"],
            "role": row["role"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def summarize_logs(filters: dict) -> dict:
    where, params = _log_filters({**filters, "kind": "chat"})
    with transaction() as connection:
        row = connection.execute(
            f"""
            SELECT COUNT(*) AS queries,
                   COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens,
                   COALESCE(AVG(duration_ms), 0) AS average_duration,
                   COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS errors
            FROM query_logs {where}
            """,
            params,
        ).fetchone()
        daily_rows = connection.execute(
            f"""
            SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS queries,
                   COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens
            FROM query_logs {where}
            GROUP BY day
            ORDER BY day
            """,
            params,
        ).fetchall()
    return {
        "queries": row["queries"],
        "tokens": row["tokens"],
        "averageDurationMs": round(row["average_duration"]),
        "errors": row["errors"],
        "daily": [
            {"date": item["day"], "queries": item["queries"], "tokens": item["tokens"]}
            for item in daily_rows
        ],
    }


def reset_workspace() -> None:
    with transaction() as connection:
        for table in (
            "query_logs",
            "messages",
            "conversations",
            "chunks_fts",
            "chunks",
            "documents",
            "knowledge_bases",
            "models",
            "providers",
        ):
            connection.execute(f"DELETE FROM {table}")
        connection.execute("UPDATE vision_settings SET model_config_id = NULL, saved_at = NULL WHERE id = 1")
    for child in files_dir().iterdir():
        if child.is_dir():
            for file in child.iterdir():
                file.unlink(missing_ok=True)
            child.rmdir()
        else:
            child.unlink(missing_ok=True)


def _delete_fts(connection, chunk_ids: list[str]) -> None:
    if not chunk_ids:
        return
    placeholders = ",".join("?" * len(chunk_ids))
    connection.execute(f"DELETE FROM chunks_fts WHERE chunk_id IN ({placeholders})", chunk_ids)


def _remove_files(relative_paths: list[str]) -> None:
    root = files_dir()
    for relative in relative_paths:
        path = root / relative
        path.unlink(missing_ok=True)
        parent = path.parent
        if parent != root and parent.exists() and not any(parent.iterdir()):
            parent.rmdir()


def _conversation_out(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "knowledgeBaseIds": json.loads(row["knowledge_base_ids"]),
        "modelConfigId": row["model_config_id"],
        "routeMode": row["route_mode"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _message_out(row) -> dict:
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "citations": json.loads(row["citations"] or "[]"),
        "promptTokens": row["prompt_tokens"],
        "completionTokens": row["completion_tokens"],
        "durationMs": row["duration_ms"],
        "status": row["status"],
        "createdAt": row["created_at"],
    }


def _log_filters(filters: dict) -> tuple[str, list]:
    clauses = []
    params: list = []
    if filters.get("kind"):
        clauses.append("kind = ?")
        params.append(filters["kind"])
    if filters.get("role"):
        clauses.append("role = ?")
        params.append(filters["role"])
    if filters.get("status"):
        clauses.append("status = ?")
        params.append(filters["status"])
    if filters.get("model"):
        clauses.append("model_name = ?")
        params.append(filters["model"])
    if filters.get("knowledge_base_id"):
        clauses.append("knowledge_base_ids LIKE ?")
        params.append(f"%{filters['knowledge_base_id']}%")
    if filters.get("q"):
        clauses.append("query LIKE ?")
        params.append(f"%{filters['q']}%")
    if filters.get("date_from"):
        clauses.append("substr(created_at, 1, 10) >= ?")
        params.append(filters["date_from"])
    if filters.get("date_to"):
        clauses.append("substr(created_at, 1, 10) <= ?")
        params.append(filters["date_to"])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where, params


def _migrate(connection) -> None:
    # 已经在用的数据库不会重建表，这里补上连接状态字段。
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(providers)")}
    if "connection_status" not in columns:
        connection.execute(
            "ALTER TABLE providers ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'unknown'"
        )
    if "connection_message" not in columns:
        connection.execute("ALTER TABLE providers ADD COLUMN connection_message TEXT NOT NULL DEFAULT ''")
    if "connection_checked_at" not in columns:
        connection.execute("ALTER TABLE providers ADD COLUMN connection_checked_at TEXT")
    knowledge_columns = {row["name"] for row in connection.execute("PRAGMA table_info(knowledge_bases)")}
    if "chunk_method" not in knowledge_columns:
        connection.execute("ALTER TABLE knowledge_bases ADD COLUMN chunk_method TEXT NOT NULL DEFAULT 'recursive'")
    if "child_chunk_size" not in knowledge_columns:
        connection.execute("ALTER TABLE knowledge_bases ADD COLUMN child_chunk_size INTEGER NOT NULL DEFAULT 200")
    chunk_columns = {row["name"] for row in connection.execute("PRAGMA table_info(chunks)")}
    if "context_text" not in chunk_columns:
        connection.execute("ALTER TABLE chunks ADD COLUMN context_text TEXT NOT NULL DEFAULT ''")
    _remove_openrouter(connection)


def _remove_openrouter(connection) -> None:
    model_ids = [
        row["id"]
        for row in connection.execute(
            """
            SELECT models.id
            FROM models JOIN providers ON providers.id = models.provider_id
            WHERE providers.kind = 'openrouter'
            """
        )
    ]
    if model_ids:
        placeholders = ",".join("?" * len(model_ids))
        connection.execute(
            f"UPDATE knowledge_bases SET embedding_model_id = NULL WHERE embedding_model_id IN ({placeholders})",
            model_ids,
        )
        connection.execute(
            f"UPDATE knowledge_bases SET rerank_model_id = NULL WHERE rerank_model_id IN ({placeholders})",
            model_ids,
        )
        connection.execute(
            f"UPDATE vision_settings SET model_config_id = NULL, saved_at = NULL WHERE model_config_id IN ({placeholders})",
            model_ids,
        )
    connection.execute("DELETE FROM providers WHERE kind = 'openrouter'")


def absolute_file(relative_path: str) -> Path:
    return files_dir() / relative_path
