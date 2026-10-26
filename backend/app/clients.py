"""调用模型服务商。

对话和向量走各家的 OpenAI 兼容地址。
通义的重排不在兼容地址上，单独走 DashScope 的重排接口。
其他服务商走各自 baseUrl 下的 /rerank。
"""

from collections.abc import Iterator

import httpx
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from .errors import AppError, redact

Row = dict


def _headers(_kind: str) -> dict[str, str] | None:
    return None


def chat_model(provider: Row, model: Row, *, temperature: float) -> ChatOpenAI:
    return ChatOpenAI(
        model=model["model_id"],
        api_key=provider["api_key"],
        base_url=provider["base_url"],
        temperature=temperature,
        timeout=90,
        max_retries=1,
        default_headers=_headers(provider["kind"]),
    )


def embedding_model(provider: Row, model: Row) -> OpenAIEmbeddings:
    # 关闭本地 token 预检，把原文直接交给服务商，避免兼容接口拒绝 tiktoken 结果。
    return OpenAIEmbeddings(
        model=model["model_id"],
        api_key=provider["api_key"],
        base_url=provider["base_url"],
        timeout=90,
        check_embedding_ctx_length=False,
        tiktoken_enabled=False,
        chunk_size=10,
        default_headers=_headers(provider["kind"]),
    )


def embed_texts(provider: Row, model: Row, texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    vectors = embedding_model(provider, model).embed_documents(texts)
    if len(vectors) != len(texts):
        raise AppError("Embedding 服务返回的向量数量和文本数量不一致")
    return vectors


def embed_query(provider: Row, model: Row, text: str) -> list[float]:
    return embedding_model(provider, model).embed_query(text)


def message_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
        return "".join(parts)
    return str(content or "")


def recognize_image(provider: Row, model: Row, image: bytes, mime: str) -> str:
    import base64

    encoded = base64.b64encode(image).decode("ascii")
    llm = chat_model(provider, model, temperature=0)
    result = llm.invoke(
        [
            HumanMessage(
                content=[
                    {
                        "type": "text",
                        "text": "提取图片中的文字。表格用 Markdown 表格。不要补充图片里没有的内容。",
                    },
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
                ]
            )
        ]
    )
    return message_text(result.content).strip()


def stream_answer(provider: Row, model: Row, messages: list, usage_box: dict) -> Iterator[str]:
    llm = chat_model(provider, model, temperature=0.2)
    for chunk in llm.stream(messages):
        usage = getattr(chunk, "usage_metadata", None)
        if usage:
            usage_box.update(usage)
        text = message_text(chunk.content)
        if text:
            yield text


def _rerank_url(provider: Row) -> str:
    if provider["kind"] == "tongyi":
        base = provider["base_url"]
        host = "https://dashscope-intl.aliyuncs.com" if "dashscope-intl" in base else "https://dashscope.aliyuncs.com"
        return f"{host}/api/v1/services/rerank/text-rerank/text-rerank"
    return provider["base_url"].rstrip("/") + "/rerank"


def _rerank_body(provider: Row, model_id: str, query: str, documents: list[str], top_n: int) -> dict:
    if provider["kind"] == "tongyi":
        return {
            "model": model_id,
            "input": {"query": query, "documents": documents},
            "parameters": {"return_documents": False, "top_n": top_n},
        }
    return {"model": model_id, "query": query, "documents": documents, "top_n": top_n}


def parse_rerank_payload(payload: dict) -> list[tuple[int, float]]:
    results = payload.get("results")
    output = payload.get("output")
    if results is None and isinstance(output, dict):
        results = output.get("results")
    if not isinstance(results, list):
        raise AppError("重排服务没有返回排序结果")
    parsed: list[tuple[int, float]] = []
    for item in results:
        if not isinstance(item, dict) or "index" not in item:
            continue
        score = item.get("relevance_score", item.get("score", 0))
        parsed.append((int(item["index"]), float(score)))
    if not parsed:
        raise AppError("重排服务没有返回排序结果")
    parsed.sort(key=lambda item: item[1], reverse=True)
    return parsed


def rerank(provider: Row, model: Row, query: str, documents: list[str], top_n: int) -> list[tuple[int, float]]:
    response = httpx.post(
        _rerank_url(provider),
        headers={"Authorization": f"Bearer {provider['api_key']}", "Content-Type": "application/json"},
        json=_rerank_body(provider, model["model_id"], query, documents, top_n),
        timeout=90,
    )
    if response.status_code >= 400:
        raise AppError(f"重排失败：{redact(response.text)}")
    return parse_rerank_payload(response.json())


def _provider_headers(provider: Row) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {provider['api_key']}"}
    extra = _headers(provider["kind"])
    if extra:
        headers.update(extra)
    return headers


def fetch_provider_models(provider: Row) -> list[dict[str, str]]:
    if not provider["api_key"]:
        raise AppError("请先填写 API 密钥")
    try:
        response = httpx.get(
            provider["base_url"].rstrip("/") + "/models",
            headers=_provider_headers(provider),
            timeout=12,
        )
    except httpx.HTTPError as error:
        raise AppError(f"连接失败：{redact(str(error))}") from error
    if response.status_code >= 400:
        raise AppError(f"连接失败：{redact(response.text)}")
    try:
        payload = response.json()
    except ValueError as error:
        raise AppError("服务商没有返回可识别的模型列表") from error
    models = parse_model_list(payload)
    if not models:
        raise AppError("服务商没有返回模型")
    return models


def parse_model_list(payload: object) -> list[dict[str, str]]:
    items: list = []
    if isinstance(payload, dict):
        raw = payload.get("data") or payload.get("models") or payload.get("output") or []
        if isinstance(raw, dict):
            raw = raw.get("models") or raw.get("data") or []
        if isinstance(raw, list):
            items = raw
    elif isinstance(payload, list):
        items = payload
    models: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        if isinstance(item, str):
            model_id = item.strip()
            name = model_id
        elif isinstance(item, dict):
            model_id = str(item.get("id") or item.get("model") or "").strip()
            name = str(item.get("name") or item.get("display_name") or model_id).strip()
        else:
            continue
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append({"id": model_id, "name": name or model_id})
    models.sort(key=lambda model: model["name"].lower())
    return models


def test_provider(provider: Row) -> str:
    fetch_provider_models(provider)
    return "已连通，服务商返回了模型列表"


def test_model(provider: Row, model: Row) -> str:
    if not provider["api_key"]:
        raise AppError("请先填写这个服务商的 API 密钥")
    try:
        if model["capability"] == "llm":
            answer = chat_model(provider, model, temperature=0).invoke("只回复 OK")
            if not message_text(answer.content).strip():
                raise AppError("模型没有返回内容")
            return "对话模型可用"
        if model["capability"] == "embedding":
            vector = embed_query(provider, model, "测试")
            if not vector:
                raise AppError("Embedding 模型没有返回向量")
            return f"Embedding 模型可用，向量维度 {len(vector)}"
        ranked = rerank(provider, model, "年假有几天", ["员工年假为十个工作日", "今天适合散步"], 2)
        if not ranked:
            raise AppError("重排模型没有返回结果")
        return "重排模型可用"
    except AppError:
        raise
    except Exception as error:
        raise AppError(f"模型测试失败：{redact(str(error))}") from error
