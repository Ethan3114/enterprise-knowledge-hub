"""从文档正文抽取元数据，作为每个知识片段的标签。

标签不单独做成一条可检索正文。关键词和可能的问题只补进关键词索引，
用来召回对应的正文片段。版本和可见范围留给后续的版本管理、权限过滤和答案溯源。
"""

import json
import re

from . import clients
from .errors import AppError

EMPTY_METADATA = {
    "time": "",
    "version": "",
    "subject": "",
    "owner": "",
    "visibility": "全员",
    "keywords": [],
    "questions": [],
}

_PROMPT = """阅读下面的文档，抽取元数据标签。只输出一个 JSON 对象，不要解释。
这些标签会贴在每个知识片段上，用于关键词检索、版本区分和可见范围，不要写成另一段正文。
字段：
- time：文档涉及的时间、生效日期或周期。没有就用空字符串。
- version：版本号或修订号。没有就用空字符串。
- subject：文档的主体，例如制度、产品、部门或事项名称。
- owner：负责人、发布部门或维护人。没有就用空字符串。
- visibility：哪些员工可以查看。没有限制时填“全员”。如果写明仅某部门或某角色可见，填那个范围。
- keywords：6 到 10 个便于检索的关键词，使用字符串数组。
- questions：4 到 8 个用户可能会问到的问题，使用字符串数组。问题要能被这篇文档回答。

文档名：{name}

正文：
{text}
"""


def extract_metadata(provider: dict, model: dict, name: str, text: str) -> dict:
    excerpt = text.strip()
    if len(excerpt) > 12000:
        excerpt = excerpt[:8000] + "\n\n……\n\n" + excerpt[-2000:]
    llm = clients.chat_model(provider, model, temperature=0)
    result = llm.invoke(_PROMPT.format(name=name, text=excerpt or "（正文为空）"))
    return parse_metadata(clients.message_text(result.content))


def parse_metadata(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    if match is None:
        raise AppError("元数据抽取没有返回可识别的 JSON")
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise AppError("元数据抽取结果不是有效的 JSON") from error
    if not isinstance(payload, dict):
        raise AppError("元数据抽取结果不是有效的 JSON")
    return normalize_metadata(payload)


def normalize_metadata(payload: dict) -> dict:
    visibility = _text(payload.get("visibility")) or "全员"
    return {
        "time": _text(payload.get("time")),
        "version": _text(payload.get("version")),
        "subject": _text(payload.get("subject")),
        "owner": _text(payload.get("owner")),
        "visibility": visibility,
        "keywords": _list(payload.get("keywords"), 10),
        "questions": _list(payload.get("questions"), 8),
    }


def tag_text(metadata: dict | None) -> str:
    """拼进关键词索引的标签文字。不进入向量，也不作为独立片段。"""
    if not metadata:
        return ""
    parts: list[str] = []
    for key in ("time", "version", "subject", "owner", "visibility"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip() and value.strip() != "全员":
            parts.append(value.strip())
    for key in ("keywords", "questions"):
        values = metadata.get(key) or []
        if isinstance(values, list):
            parts.extend(item.strip() for item in values if isinstance(item, str) and item.strip())
    return " ".join(parts)


def label_line(metadata: dict | None) -> str:
    """回答引用时带上的溯源标签，不是一段被检索出来的正文。"""
    if not metadata:
        return ""
    parts = []
    for label, key in (
        ("时间", "time"),
        ("版本", "version"),
        ("主体", "subject"),
        ("负责人", "owner"),
        ("可见范围", "visibility"),
    ):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(f"{label} {value.strip()}")
    return "；".join(parts)


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _list(value: object, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    items = []
    for item in value:
        if isinstance(item, str) and item.strip():
            items.append(item.strip())
        if len(items) >= limit:
            break
    return items
