"""检索和对话。

发给模型的历史只有上一轮成功的问答。知识库列表由页面手动选择，
请求里记下 routeMode=manual，以后自动路由只替换这个列表。
"""

import time
from collections.abc import Iterator

from langchain_core.prompts import ChatPromptTemplate

from . import clients
from .errors import AppError, redact
from .db import transaction
from .retrieval import Hit, keyword_ranking, search
from .store import (
    chunk_rows_for,
    finish_message,
    get_conversation,
    get_knowledge_base_row,
    get_model_bundle,
    insert_log,
    insert_message,
    previous_messages,
    touch_conversation,
)

NO_HIT_ANSWER = "资料中没有找到足够相关的内容。可以换一种问法，或确认知识库已经构建完成。"
SYSTEM_PROMPT = """你是企业知识库助手。只根据给定资料回答，使用简体中文。
如果资料不足以回答，直接说资料中没有找到依据，不要编造。
提到事实时写出来源文件和位置。"""
ANSWER_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", SYSTEM_PROMPT),
        (
            "human",
            "上一轮问题：{previous_user}\n上一轮回答：{previous_assistant}\n\n资料：\n{context}\n\n当前问题：{question}",
        ),
    ]
)
REWRITE_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", "把当前问题改写成可以独立检索的一句话。结合上一轮补全省略的对象。只输出问句，不要回答。"),
        ("human", "上一轮问题：{previous_user}\n上一轮回答：{previous_assistant}\n当前问题：{question}"),
    ]
)


def previous_exchange(messages: list[dict]) -> tuple[str, str]:
    """取上一轮已经成功的问答。当前这次用户问题不应包含在 messages 里。"""
    assistant_index = None
    for index in range(len(messages) - 1, -1, -1):
        if messages[index]["role"] == "assistant" and messages[index]["status"] == "success":
            assistant_index = index
            break
    if assistant_index is None:
        return "", ""
    previous_user = ""
    for index in range(assistant_index - 1, -1, -1):
        if messages[index]["role"] == "user":
            previous_user = messages[index]["content"]
            break
    return previous_user[:2000], str(messages[assistant_index]["content"])[:1500]


def hit_out(hit: Hit) -> dict:
    return {
        "documentName": hit.document_name,
        "knowledgeBaseName": hit.knowledge_base_name,
        "location": hit.location,
        "content": hit.content,
        "semanticScore": None if hit.semantic_score is None else round(hit.semantic_score, 4),
        "rerankScore": None if hit.rerank_score is None else round(hit.rerank_score, 4),
    }


def retrieve_knowledge_bases(knowledge_base_ids: list[str], query: str, rewrite=None) -> tuple[list[Hit], str]:
    bases = []
    for knowledge_base_id in knowledge_base_ids:
        row = get_knowledge_base_row(knowledge_base_id)
        if row is None:
            raise AppError("有知识库不存在", 404)
        bases.append(row)
    rows = chunk_rows_for(knowledge_base_ids)
    active_ids = {row["knowledge_base_id"] for row in rows}
    active = [row for row in bases if row["id"] in active_ids]
    if not active:
        return [], query
    embedding_ids = {row["embedding_model_id"] for row in active}
    if len(embedding_ids) != 1:
        raise AppError("所选知识库使用了不同的 Embedding 模型，请分开提问")
    dimensions = {row["embedding_dim"] for row in rows}
    if len(dimensions) != 1:
        raise AppError("所选知识库的向量维度不一致，请分开提问")
    settings = _merge_settings(active)
    search_query = query
    if settings["query_optimization"] and rewrite is not None:
        try:
            rewritten = rewrite(query).strip()
            search_query = rewritten or query
        except Exception:
            search_query = query
    query_vector = None
    if settings["retrieval_mode"] != "keyword":
        provider, model = _bundle(next(iter(embedding_ids)), "embedding", "Embedding")
        query_vector = clients.embed_query(provider, model, search_query)
    rerank_fn = None
    if settings["rerank_enabled"]:
        provider, model = _bundle(settings["rerank_model_id"], "rerank", "Rerank")

        def rerank_fn(text: str, documents: list[str]):
            return clients.rerank(provider, model, text, documents, settings["retrieval_count"])

    found_keywords: list[str] = []
    if settings["retrieval_mode"] in {"keyword", "hybrid"}:
        with transaction() as connection:
            found_keywords = keyword_ranking(connection, [row["id"] for row in active], search_query)
    hits = search(
        rows=rows,
        query=search_query,
        retrieval_mode=settings["retrieval_mode"],
        retrieval_count=settings["retrieval_count"],
        score_threshold=settings["score_threshold"],
        max_context_tokens=settings["max_context_tokens"],
        query_vector=query_vector,
        keyword_ids=found_keywords,
        rerank_fn=rerank_fn,
    )
    return hits, search_query


def iter_chat(conversation_id: str, question: str, knowledge_base_ids: list[str], model_config_id: str, role: str) -> Iterator[dict]:
    started = time.perf_counter()
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise AppError("对话不存在", 404)
    if not question.strip():
        raise AppError("请输入问题")
    if not knowledge_base_ids:
        raise AppError("请选择至少一个知识库")
    provider, model = _bundle(model_config_id, "llm", "对话")
    history = previous_messages(conversation_id)
    previous_user, previous_assistant = previous_exchange(history)
    user_message_id = insert_message(conversation_id, "user", question.strip())
    title = conversation["title"]
    if title == "新对话":
        title = question.strip()[:24]
    touch_conversation(conversation_id, title, knowledge_base_ids, model_config_id)
    assistant_id = insert_message(conversation_id, "assistant", "", "building")
    names = _knowledge_base_names(knowledge_base_ids)
    produced: list[str] = []
    try:
        yield {"type": "route", "mode": "manual", "knowledgeBaseIds": knowledge_base_ids}
        def rewrite(text: str) -> str:
            if not previous_user:
                return text
            rewritten = clients.chat_model(provider, model, temperature=0).invoke(
                REWRITE_PROMPT.format_messages(
                    previous_user=previous_user,
                    previous_assistant=previous_assistant or "无",
                    question=text,
                )
            )
            return clients.message_text(rewritten.content)

        hits, _search_query = retrieve_knowledge_bases(
            knowledge_base_ids,
            question.strip(),
            rewrite if previous_user else None,
        )
        citations = [hit_out(hit) for hit in hits]
        yield {"type": "citations", "items": citations}
        usage: dict = {}
        if not hits:
            answer = NO_HIT_ANSWER
            for character in answer:
                produced.append(character)
                yield {"type": "token", "text": character}
        else:
            seen_context: list[str] = []
            parts: list[str] = []
            for hit in hits:
                body = hit.context or hit.content
                if body in seen_context:
                    continue
                seen_context.append(body)
                parts.append(f"[{len(parts) + 1}] {hit.document_name} | {hit.location}\n{body}")
            context = "\n\n".join(parts)
            messages = ANSWER_PROMPT.format_messages(
                previous_user=previous_user or "无",
                previous_assistant=previous_assistant or "无",
                context=context,
                question=question.strip(),
            )
            pieces: list[str] = []
            for text in clients.stream_answer(provider, model, messages, usage):
                pieces.append(text)
                produced.append(text)
                yield {"type": "token", "text": text}
            answer = "".join(pieces).strip() or "模型没有返回内容"
        duration_ms = int((time.perf_counter() - started) * 1000)
        prompt_tokens = int(usage.get("input_tokens") or 0)
        completion_tokens = int(usage.get("output_tokens") or 0)
        finish_message(
            assistant_id,
            content=answer,
            citations=citations,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            duration_ms=duration_ms,
            status="success",
        )
        _log(role, "chat", question.strip(), knowledge_base_ids, names, model["display_name"], prompt_tokens, completion_tokens, duration_ms, "success", None, conversation_id)
        yield {
            "type": "done",
            "messageId": assistant_id,
            "userMessageId": user_message_id,
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "durationMs": duration_ms,
        }
    except GeneratorExit:
        duration_ms = int((time.perf_counter() - started) * 1000)
        finish_message(
            assistant_id,
            content="".join(produced) or "回答已中断",
            citations=[],
            prompt_tokens=0,
            completion_tokens=0,
            duration_ms=duration_ms,
            status="cancelled",
        )
        _log(role, "chat", question.strip(), knowledge_base_ids, names, model["display_name"], 0, 0, duration_ms, "cancelled", None, conversation_id)
        raise
    except Exception as error:
        message = error.message if isinstance(error, AppError) else redact(str(error))
        duration_ms = int((time.perf_counter() - started) * 1000)
        finish_message(
            assistant_id,
            content=message,
            citations=[],
            prompt_tokens=0,
            completion_tokens=0,
            duration_ms=duration_ms,
            status="failed",
        )
        _log(role, "chat", question.strip(), knowledge_base_ids, names, model["display_name"], 0, 0, duration_ms, "failed", message, conversation_id)
        yield {"type": "error", "message": message}


def _merge_settings(active: list) -> dict:
    modes = {row["retrieval_mode"] for row in active}
    rerank_ids = {row["rerank_model_id"] for row in active if row["rerank_enabled"]}
    rerank_ids.discard(None)
    if len(rerank_ids) > 1:
        raise AppError("所选知识库的重排模型不一致")
    rerank_enabled = any(row["rerank_enabled"] for row in active)
    if rerank_enabled and not rerank_ids:
        raise AppError("请先为知识库选择 Rerank 模型")
    return {
        "retrieval_mode": next(iter(modes)) if len(modes) == 1 else "hybrid",
        "retrieval_count": max(int(row["retrieval_count"]) for row in active),
        "score_threshold": min(float(row["score_threshold"]) for row in active),
        "max_context_tokens": min(int(row["max_context_tokens"]) for row in active),
        "query_optimization": any(row["query_optimization"] for row in active),
        "rerank_enabled": rerank_enabled,
        "rerank_model_id": next(iter(rerank_ids)) if rerank_ids else None,
    }


def _bundle(model_config_id: str | None, capability: str, label: str):
    if not model_config_id:
        raise AppError(f"请先选择{label}模型")
    bundle = get_model_bundle(model_config_id)
    if bundle is None or bundle[1]["capability"] != capability:
        raise AppError(f"找不到可用的{label}模型")
    if not bundle[0]["api_key"]:
        raise AppError(f"请先填写{label}服务商的 API 密钥")
    return bundle


def _knowledge_base_names(knowledge_base_ids: list[str]) -> str:
    names = []
    for knowledge_base_id in knowledge_base_ids:
        row = get_knowledge_base_row(knowledge_base_id)
        if row is not None:
            names.append(row["name"])
    return "、".join(names)


def _log(role, kind, query, knowledge_base_ids, names, model_name, prompt_tokens, completion_tokens, duration_ms, status, error, conversation_id) -> None:
    insert_log(
        {
            "kind": kind,
            "conversation_id": conversation_id,
            "query": query,
            "knowledge_base_ids": knowledge_base_ids,
            "knowledge_base_names": names,
            "model_name": model_name,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "duration_ms": duration_ms,
            "status": status,
            "error": error,
            "role": role,
        }
    )
