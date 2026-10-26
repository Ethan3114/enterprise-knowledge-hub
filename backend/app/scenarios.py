"""应用商店里的场景。

每个应用只描述自己的任务和需要填写的内容。
检索、引用和逐字生成都走在线对话同一条链路，所以新增场景不必重写模型调用。
"""

import time
from collections.abc import Iterator

from langchain_core.prompts import ChatPromptTemplate

from . import clients
from .dialogue import (
    NO_HIT_ANSWER,
    _bundle,
    _knowledge_base_names,
    grounded_context,
    hit_out,
    retrieve_knowledge_bases,
)
from .errors import AppError, redact
from .store import insert_log

SCENARIO_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "你正在执行企业知识库应用「{app_name}」。只根据给定资料完成任务，使用简体中文。"
            "资料不足以支持的内容要明确写出来，不要编造事实、数字或引用来源。",
        ),
        (
            "human",
            "任务要求：\n{instruction}\n\n用户填写：\n{request}\n\n资料：\n{context}",
        ),
    ]
)

APPS = [
    {
        "id": "article",
        "name": "写文章",
        "summary": "根据知识库资料写一篇有依据的文章。",
        "category": "写作",
        "instruction": "写成结构清楚的文章，包含标题、开头、分节正文和结尾。文中的事实必须能在资料中找到。",
        "fields": [
            {"key": "topic", "label": "文章主题", "type": "text", "required": True, "placeholder": "例如：新员工试用期考核说明"},
            {"key": "audience", "label": "阅读对象", "type": "text", "required": False, "placeholder": "例如：部门经理"},
            {"key": "length", "label": "篇幅", "type": "text", "required": False, "placeholder": "例如：800 字"},
        ],
    },
    {
        "id": "weekly-report",
        "name": "写周报",
        "summary": "根据知识库资料整理一份周报。",
        "category": "汇报",
        "instruction": "按「本周完成、进行中、风险与需要支持、下周计划」四部分来写。只写资料里能够支持的事项。",
        "fields": [
            {"key": "period", "label": "时间范围", "type": "text", "required": True, "placeholder": "例如：10月20日到10月26日"},
            {"key": "focus", "label": "关注重点", "type": "textarea", "required": False, "placeholder": "例如：制度修订、培训安排"},
        ],
    },
]


def list_apps() -> list[dict]:
    return [_public_app(app) for app in APPS]


def get_app(app_id: str) -> dict | None:
    for app in APPS:
        if app["id"] == app_id:
            return _public_app(app)
    return None


def iter_app_run(app_id: str, knowledge_base_ids: list[str], model_config_id: str, fields: dict, role: str) -> Iterator[dict]:
    app = next((item for item in APPS if item["id"] == app_id), None)
    if app is None:
        raise AppError("应用不存在", 404)
    if not knowledge_base_ids:
        raise AppError("请选择至少一个知识库")
    request_text = _request_text(app, fields)
    provider, model = _bundle(model_config_id, "llm", "对话")
    started = time.perf_counter()
    names = _knowledge_base_names(knowledge_base_ids)
    produced: list[str] = []
    try:
        yield {"type": "route", "mode": "manual", "knowledgeBaseIds": knowledge_base_ids, "appId": app_id}
        hits, _search_query = retrieve_knowledge_bases(knowledge_base_ids, request_text)
        citations = [hit_out(hit) for hit in hits]
        yield {"type": "citations", "items": citations}
        usage: dict = {}
        if not hits:
            answer = NO_HIT_ANSWER
            for character in answer:
                produced.append(character)
                yield {"type": "token", "text": character}
        else:
            messages = SCENARIO_PROMPT.format_messages(
                app_name=app["name"],
                instruction=app["instruction"],
                request=request_text,
                context=grounded_context(hits),
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
        insert_log(
            {
                "kind": "app",
                "conversation_id": None,
                "query": f"{app['name']}：{request_text}",
                "knowledge_base_ids": knowledge_base_ids,
                "knowledge_base_names": names,
                "model_name": model["display_name"],
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "duration_ms": duration_ms,
                "status": "success",
                "error": None,
                "role": role,
            }
        )
        yield {
            "type": "done",
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "durationMs": duration_ms,
        }
    except Exception as error:
        message = error.message if isinstance(error, AppError) else redact(str(error))
        duration_ms = int((time.perf_counter() - started) * 1000)
        insert_log(
            {
                "kind": "app",
                "conversation_id": None,
                "query": f"{app['name']}：{request_text}",
                "knowledge_base_ids": knowledge_base_ids,
                "knowledge_base_names": names,
                "model_name": model["display_name"],
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "duration_ms": duration_ms,
                "status": "failed",
                "error": message,
                "role": role,
            }
        )
        yield {"type": "error", "message": message}


def _public_app(app: dict) -> dict:
    return {
        "id": app["id"],
        "name": app["name"],
        "summary": app["summary"],
        "category": app["category"],
        "fields": app["fields"],
    }


def _request_text(app: dict, fields: dict) -> str:
    lines = []
    for field in app["fields"]:
        value = str(fields.get(field["key"]) or "").strip()
        if field["required"] and not value:
            raise AppError(f"请填写{field['label']}")
        if value:
            lines.append(f"{field['label']}：{value}")
    return "\n".join(lines)
