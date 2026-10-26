"""页面使用的 HTTP 接口。演示版用 X-Role 区分职责，不作为登录凭证。"""

import asyncio
import json
import sqlite3
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Header, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .dialogue import hit_out, iter_chat, retrieve_knowledge_bases
from .scenarios import get_app, iter_app_run, list_apps
from .errors import AppError
from .pipeline import prepare_build, run_build, save_uploads
from .store import (
    delete_document,
    delete_knowledge_base,
    delete_model,
    delete_provider,
    get_knowledge_base,
    get_knowledge_base_row,
    get_model_bundle,
    get_provider_row,
    get_vision,
    insert_conversation,
    insert_knowledge_base,
    insert_log,
    insert_model,
    insert_provider,
    list_chunks,
    list_conversations,
    list_knowledge_bases,
    list_models,
    list_providers,
    query_logs,
    set_provider_connection,
    reset_workspace,
    set_vision,
    summarize_logs,
    update_knowledge_base,
    get_conversation,
)
from . import clients

router = APIRouter(prefix="/api")
_TASKS: set[asyncio.Task] = set()
PROVIDER_KINDS = {"aihubmix", "tongyi", "deepseek"}
CAPABILITIES = {
    "aihubmix": {"llm", "embedding", "rerank"},
    "tongyi": {"llm", "embedding", "rerank"},
    "deepseek": {"llm"},
}


def require_role(*allowed: str):
    def dependency(x_role: Annotated[str | None, Header()] = None) -> str:
        if x_role not in {"admin", "manager", "user"}:
            raise AppError("请先选择角色", 401)
        if x_role not in allowed:
            raise AppError("当前角色无法执行此操作", 403)
        return x_role

    return dependency


class ProviderIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    kind: str
    name: str
    base_url: str = Field(alias="baseUrl")
    api_key: str = Field(alias="apiKey")


class ModelIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    provider_id: str = Field(alias="providerId")
    display_name: str = Field(alias="displayName")
    model_id: str = Field(alias="modelId")
    capability: str
    supports_vision: bool = Field(default=False, alias="supportsVision")


class VisionIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    model_config_id: str | None = Field(alias="modelConfigId")


class SettingsIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    ocr_enabled: bool = Field(alias="ocrEnabled")
    table_recognition: bool = Field(alias="tableRecognition")
    image_text_recognition: bool = Field(alias="imageTextRecognition")
    embedding_model_id: str | None = Field(default=None, alias="embeddingModelId")
    rerank_model_id: str | None = Field(default=None, alias="rerankModelId")
    chunk_size: int = Field(alias="chunkSize")
    chunk_overlap: int = Field(alias="chunkOverlap")
    chunk_method: str = Field(default="recursive", alias="chunkMethod")
    child_chunk_size: int = Field(default=200, alias="childChunkSize")
    retrieval_mode: str = Field(alias="retrievalMode")
    retrieval_count: int = Field(alias="retrievalCount")
    score_threshold: float = Field(alias="scoreThreshold")
    max_context_tokens: int = Field(alias="maxContextTokens")
    query_optimization: bool = Field(alias="queryOptimization")
    rerank_enabled: bool = Field(alias="rerankEnabled")


class KnowledgeIn(BaseModel):
    name: str
    description: str = ""


class KnowledgeUpdate(BaseModel):
    name: str
    description: str = ""
    settings: SettingsIn


class BuildIn(BaseModel):
    rebuild: bool = False


class RetrieveIn(BaseModel):
    query: str


class MessageIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    content: str
    knowledge_base_ids: list[str] = Field(alias="knowledgeBaseIds")
    model_config_id: str = Field(alias="modelConfigId")


def _clean_url(value: str) -> str:
    candidate = value.strip().rstrip("/")
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise AppError("请填写有效的服务地址")
    return candidate


def _settings_dict(settings: SettingsIn, current) -> dict:
    if not 100 <= settings.chunk_size <= 4000:
        raise AppError("分块大小需要在 100 到 4000 之间")
    if not 0 <= settings.chunk_overlap <= 1000:
        raise AppError("重叠长度需要在 0 到 1000 之间")
    if settings.chunk_overlap >= settings.chunk_size:
        raise AppError("分块重叠长度必须小于分块大小")
    if settings.chunk_method not in {"fixed", "parent_child", "semantic", "recursive"}:
        raise AppError("请选择切分方式")
    if settings.chunk_method == "parent_child" and not 50 <= settings.child_chunk_size < settings.chunk_size:
        raise AppError("子块大小要小于分块大小，并且至少 50")
    if settings.retrieval_mode not in {"hybrid", "semantic", "keyword"}:
        raise AppError("请选择检索方式")
    if not 1 <= settings.retrieval_count <= 100:
        raise AppError("候选片段数量需要在 1 到 100 之间")
    if not 0 <= settings.score_threshold <= 1:
        raise AppError("最低相关度需要在 0 到 1 之间")
    if not 256 <= settings.max_context_tokens <= 100000:
        raise AppError("引用 Token 上限超出范围")
    embedding_model_id = settings.embedding_model_id or None
    rerank_model_id = settings.rerank_model_id or None
    if current["embedding_locked"] and embedding_model_id != current["embedding_model_id"]:
        raise AppError("知识库已经用当前 Embedding 模型构建。请先移除全部文件，再更换模型", 409)
    if embedding_model_id:
        bundle = get_model_bundle(embedding_model_id)
        if bundle is None or bundle[1]["capability"] != "embedding":
            raise AppError("请选择 Embedding 模型")
    if rerank_model_id:
        bundle = get_model_bundle(rerank_model_id)
        if bundle is None or bundle[1]["capability"] != "rerank":
            raise AppError("请选择 Rerank 模型")
    return {
        "ocr_enabled": settings.ocr_enabled,
        "table_recognition": settings.table_recognition,
        "image_text_recognition": settings.image_text_recognition,
        "embedding_model_id": embedding_model_id,
        "rerank_model_id": rerank_model_id,
        "chunk_size": settings.chunk_size,
        "chunk_overlap": settings.chunk_overlap,
        "chunk_method": settings.chunk_method,
        "child_chunk_size": settings.child_chunk_size,
        "retrieval_mode": settings.retrieval_mode,
        "retrieval_count": settings.retrieval_count,
        "score_threshold": settings.score_threshold,
        "max_context_tokens": settings.max_context_tokens,
        "query_optimization": settings.query_optimization,
        "rerank_enabled": settings.rerank_enabled,
    }


def _integrity(error: sqlite3.IntegrityError) -> AppError:
    text = str(error).lower()
    if "models.provider_id" in text or "model_id" in text:
        return AppError("该服务商下已经存在相同模型 ID")
    if "base_url" in text:
        return AppError("该服务地址已经存在")
    if "name" in text:
        return AppError("名称已存在")
    return AppError("保存失败，内容与已有记录重复")


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/providers")
def read_providers(_role: str = Depends(require_role("admin", "manager", "user"))) -> list[dict]:
    return list_providers()


@router.post("/providers")
def create_provider(payload: ProviderIn, _role: str = Depends(require_role("admin"))) -> dict:
    if payload.kind not in PROVIDER_KINDS:
        raise AppError("不支持这个服务商")
    name = payload.name.strip()
    api_key = payload.api_key.strip()
    if not name:
        raise AppError("请填写显示名称")
    if not api_key:
        raise AppError("请填写 API 密钥")
    try:
        return insert_provider(payload.kind, name, _clean_url(payload.base_url), api_key)
    except sqlite3.IntegrityError as error:
        raise _integrity(error) from error


@router.post("/providers/{provider_id}/test")
def test_provider(provider_id: str, _role: str = Depends(require_role("admin"))) -> dict:
    provider = get_provider_row(provider_id)
    if provider is None:
        raise AppError("服务商不存在", 404)
    try:
        message = clients.test_provider(dict(provider))
    except AppError as error:
        set_provider_connection(provider_id, "failed", error.message)
        return {"message": error.message, "connectionStatus": "failed"}
    set_provider_connection(provider_id, "connected", message)
    return {"message": message, "connectionStatus": "connected"}


@router.get("/providers/{provider_id}/models")
def read_provider_models(provider_id: str, _role: str = Depends(require_role("admin"))) -> dict:
    provider = get_provider_row(provider_id)
    if provider is None:
        raise AppError("服务商不存在", 404)
    try:
        models = clients.fetch_provider_models(dict(provider))
    except AppError as error:
        set_provider_connection(provider_id, "failed", error.message)
        return {"models": [], "error": error.message}
    set_provider_connection(provider_id, "connected", "已连通，服务商返回了模型列表")
    return {"models": models, "error": None}


@router.delete("/providers/{provider_id}")
def remove_provider(provider_id: str, _role: str = Depends(require_role("admin"))) -> dict:
    if get_provider_row(provider_id) is None:
        raise AppError("服务商不存在", 404)
    delete_provider(provider_id)
    return {"deleted": True}


@router.get("/models")
def read_models(_role: str = Depends(require_role("admin", "manager", "user"))) -> list[dict]:
    return list_models()


@router.post("/models")
def create_model(payload: ModelIn, _role: str = Depends(require_role("admin"))) -> dict:
    provider = get_provider_row(payload.provider_id)
    if provider is None:
        raise AppError("请选择模型服务商")
    if payload.capability not in CAPABILITIES[provider["kind"]]:
        raise AppError("这个服务商没有该类型的模型")
    display_name = payload.display_name.strip()
    model_id = payload.model_id.strip()
    if not display_name or not model_id:
        raise AppError("请填写模型名称和模型 ID")
    supports_vision = payload.supports_vision if payload.capability == "llm" else False
    try:
        return insert_model(payload.provider_id, display_name, model_id, payload.capability, supports_vision)
    except sqlite3.IntegrityError as error:
        raise _integrity(error) from error


@router.post("/models/{model_config_id}/test")
def test_model(model_config_id: str, _role: str = Depends(require_role("admin"))) -> dict:
    bundle = get_model_bundle(model_config_id)
    if bundle is None:
        raise AppError("模型不存在", 404)
    provider, model = bundle
    return {"message": clients.test_model(provider, model)}


@router.delete("/models/{model_config_id}")
def remove_model(model_config_id: str, _role: str = Depends(require_role("admin"))) -> dict:
    if get_model_bundle(model_config_id) is None:
        raise AppError("模型不存在", 404)
    delete_model(model_config_id)
    return {"deleted": True}


@router.get("/vision")
def read_vision(_role: str = Depends(require_role("admin", "manager", "user"))) -> dict:
    return get_vision()


@router.put("/vision")
def update_vision(payload: VisionIn, _role: str = Depends(require_role("admin"))) -> dict:
    if payload.model_config_id:
        bundle = get_model_bundle(payload.model_config_id)
        if bundle is None or bundle[1]["capability"] != "llm" or not bundle[1]["supports_vision"]:
            raise AppError("请选择一个支持图片输入的对话模型")
    return set_vision(payload.model_config_id)


@router.get("/knowledge-bases")
def read_knowledge_bases(_role: str = Depends(require_role("admin", "manager", "user"))) -> list[dict]:
    return list_knowledge_bases()


@router.post("/knowledge-bases")
def create_knowledge_base(payload: KnowledgeIn, _role: str = Depends(require_role("admin", "manager"))) -> dict:
    name = payload.name.strip()
    if not name or len(name) > 40:
        raise AppError("知识库名称需要在 1 到 40 个字符之间")
    if len(payload.description.strip()) > 200:
        raise AppError("说明不能超过 200 个字符")
    try:
        return insert_knowledge_base(name, payload.description.strip())
    except sqlite3.IntegrityError as error:
        raise _integrity(error) from error


@router.get("/knowledge-bases/{knowledge_base_id}")
def read_knowledge_base(knowledge_base_id: str, _role: str = Depends(require_role("admin", "manager", "user"))) -> dict:
    knowledge_base = get_knowledge_base(knowledge_base_id)
    if knowledge_base is None:
        raise AppError("知识库不存在", 404)
    return knowledge_base


@router.patch("/knowledge-bases/{knowledge_base_id}")
def patch_knowledge_base(
    knowledge_base_id: str,
    payload: KnowledgeUpdate,
    _role: str = Depends(require_role("admin", "manager")),
) -> dict:
    current = get_knowledge_base_row(knowledge_base_id)
    if current is None:
        raise AppError("知识库不存在", 404)
    name = payload.name.strip()
    if not name or len(name) > 40:
        raise AppError("知识库名称需要在 1 到 40 个字符之间")
    description = payload.description.strip()
    if len(description) > 200:
        raise AppError("说明不能超过 200 个字符")
    try:
        update_knowledge_base(knowledge_base_id, name, description, _settings_dict(payload.settings, current))
    except sqlite3.IntegrityError as error:
        raise _integrity(error) from error
    updated = get_knowledge_base(knowledge_base_id)
    assert updated is not None
    return updated


@router.delete("/knowledge-bases/{knowledge_base_id}")
def remove_knowledge_base(knowledge_base_id: str, _role: str = Depends(require_role("admin", "manager"))) -> dict:
    if get_knowledge_base_row(knowledge_base_id) is None:
        raise AppError("知识库不存在", 404)
    delete_knowledge_base(knowledge_base_id)
    return {"deleted": True}


@router.post("/knowledge-bases/{knowledge_base_id}/documents")
async def upload_documents(
    knowledge_base_id: str,
    files: list[UploadFile] = File(...),
    _role: str = Depends(require_role("admin", "manager")),
) -> list[dict]:
    return await save_uploads(knowledge_base_id, files)


@router.delete("/knowledge-bases/{knowledge_base_id}/documents/{document_id}")
def remove_document(
    knowledge_base_id: str,
    document_id: str,
    _role: str = Depends(require_role("admin", "manager")),
) -> dict:
    if delete_document(knowledge_base_id, document_id) is None:
        raise AppError("文件不存在", 404)
    return {"deleted": True}


@router.post("/knowledge-bases/{knowledge_base_id}/build")
async def build_knowledge_base(
    knowledge_base_id: str,
    payload: BuildIn,
    _role: str = Depends(require_role("admin", "manager")),
) -> dict:
    document_ids = prepare_build(knowledge_base_id, payload.rebuild)

    async def runner() -> None:
        await asyncio.to_thread(run_build, knowledge_base_id)

    task = asyncio.create_task(runner())
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return {"started": True, "documentIds": document_ids}


@router.get("/knowledge-bases/{knowledge_base_id}/chunks")
def read_chunks(knowledge_base_id: str, _role: str = Depends(require_role("admin", "manager"))) -> dict:
    if get_knowledge_base_row(knowledge_base_id) is None:
        raise AppError("知识库不存在", 404)
    return list_chunks(knowledge_base_id)


@router.post("/knowledge-bases/{knowledge_base_id}/retrieve")
def retrieve(
    knowledge_base_id: str,
    payload: RetrieveIn,
    role: str = Depends(require_role("admin", "manager")),
) -> dict:
    import time

    query = payload.query.strip()
    if not query:
        raise AppError("请输入测试问题")
    started = time.perf_counter()
    try:
        hits, _search_query = retrieve_knowledge_bases([knowledge_base_id], query)
    except Exception as error:
        duration_ms = int((time.perf_counter() - started) * 1000)
        message = error.message if isinstance(error, AppError) else "检索失败"
        row = get_knowledge_base_row(knowledge_base_id)
        insert_log(
            {
                "kind": "retrieval",
                "conversation_id": None,
                "query": query,
                "knowledge_base_ids": [knowledge_base_id],
                "knowledge_base_names": row["name"] if row else "",
                "model_name": "检索测试",
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "duration_ms": duration_ms,
                "status": "failed",
                "error": message,
                "role": role,
            }
        )
        raise
    duration_ms = int((time.perf_counter() - started) * 1000)
    row = get_knowledge_base_row(knowledge_base_id)
    insert_log(
        {
            "kind": "retrieval",
            "conversation_id": None,
            "query": query,
            "knowledge_base_ids": [knowledge_base_id],
            "knowledge_base_names": row["name"] if row else "",
            "model_name": "检索测试",
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "duration_ms": duration_ms,
            "status": "success",
            "error": None,
            "role": role,
        }
    )
    return {"items": [hit_out(hit) for hit in hits]}


class AppRunIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    knowledge_base_ids: list[str] = Field(alias="knowledgeBaseIds")
    model_config_id: str = Field(alias="modelConfigId")
    fields: dict[str, str] = Field(default_factory=dict)


@router.get("/apps")
def read_apps(_role: str = Depends(require_role("admin", "manager", "user"))) -> list[dict]:
    return list_apps()


@router.get("/apps/{app_id}")
def read_app(app_id: str, _role: str = Depends(require_role("admin", "manager", "user"))) -> dict:
    app = get_app(app_id)
    if app is None:
        raise AppError("应用不存在", 404)
    return app


@router.post("/apps/{app_id}/run")
def run_app(
    app_id: str,
    payload: AppRunIn,
    role: str = Depends(require_role("admin", "manager", "user")),
) -> StreamingResponse:
    def generate():
        try:
            for event in iter_app_run(
                app_id,
                payload.knowledge_base_ids,
                payload.model_config_id,
                payload.fields,
                role,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except AppError as error:
            yield f"data: {json.dumps({'type': 'error', 'message': error.message}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.get("/conversations")
def read_conversations(_role: str = Depends(require_role("admin", "manager", "user"))) -> list[dict]:
    return list_conversations()


@router.post("/conversations")
def create_conversation(_role: str = Depends(require_role("admin", "manager", "user"))) -> dict:
    return insert_conversation("新对话")


@router.get("/conversations/{conversation_id}")
def read_conversation(conversation_id: str, _role: str = Depends(require_role("admin", "manager", "user"))) -> dict:
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise AppError("对话不存在", 404)
    return conversation


@router.post("/conversations/{conversation_id}/messages")
def create_message(
    conversation_id: str,
    payload: MessageIn,
    role: str = Depends(require_role("admin", "manager", "user")),
) -> StreamingResponse:
    def generate():
        try:
            for event in iter_chat(
                conversation_id,
                payload.content,
                payload.knowledge_base_ids,
                payload.model_config_id,
                role,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except AppError as error:
            yield f"data: {json.dumps({'type': 'error', 'message': error.message}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.get("/logs/summary")
def read_summary(
    _role: str = Depends(require_role("admin")),
    role: str | None = None,
    status: str | None = None,
    model: str | None = None,
    knowledge_base_id: str | None = Query(default=None, alias="knowledgeBaseId"),
    q: str | None = None,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
) -> dict:
    return summarize_logs(
        {
            "role": role,
            "status": status,
            "model": model,
            "knowledge_base_id": knowledge_base_id,
            "q": q,
            "date_from": date_from,
            "date_to": date_to,
        }
    )


@router.get("/logs/queries")
def read_queries(
    _role: str = Depends(require_role("admin")),
    role: str | None = None,
    status: str | None = None,
    model: str | None = None,
    knowledge_base_id: str | None = Query(default=None, alias="knowledgeBaseId"),
    q: str | None = None,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
) -> list[dict]:
    return query_logs(
        {
            "role": role,
            "status": status,
            "model": model,
            "knowledge_base_id": knowledge_base_id,
            "q": q,
            "date_from": date_from,
            "date_to": date_to,
        }
    )


@router.delete("/workspace")
def clear_workspace(_role: str = Depends(require_role("admin", "manager", "user"))) -> dict:
    reset_workspace()
    return {"cleared": True}
