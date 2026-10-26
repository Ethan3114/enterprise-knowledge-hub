"""手动构建。管理员点击后才解析、识别、分块和写入向量。"""

import logging
import threading
from pathlib import Path

from fastapi import UploadFile

from . import clients
from .chunking import chunk_blocks
from .config import files_dir
from .errors import AppError, redact
from .limits import MAX_BATCH, MAX_DOCUMENTS, LimitError, check_upload, extension_of
from .parsing import ParseError, parse_file
from .store import (
    absolute_file,
    get_document,
    get_knowledge_base,
    get_knowledge_base_row,
    get_model_bundle,
    get_vision,
    insert_document,
    list_building_documents,
    mark_document_failed,
    mark_for_build,
    new_id,
    replace_document_chunks,
    normalize_vector,
)

logger = logging.getLogger(__name__)
_RUN_LOCK = threading.Lock()
_RUNNING: set[str] = set()


async def save_uploads(knowledge_base_id: str, uploads: list[UploadFile]) -> list[dict]:
    if not uploads:
        raise AppError("请选择文件")
    if len(uploads) > MAX_BATCH:
        raise AppError(f"一次最多选择 {MAX_BATCH} 个文件")
    knowledge_base = get_knowledge_base(knowledge_base_id)
    if knowledge_base is None:
        raise AppError("知识库不存在", 404)
    names = {document["name"] for document in knowledge_base["documents"]}
    if len(knowledge_base["documents"]) + len(uploads) > MAX_DOCUMENTS:
        raise AppError(f"一个知识库最多保存 {MAX_DOCUMENTS} 个文件")

    saved: list[dict] = []
    for upload in uploads:
        name = Path(upload.filename or "").name
        if not name:
            raise AppError("文件名为空")
        if name in names:
            raise AppError(f"“{name}”已在文件列表中")
        try:
            extension = check_upload(name, 1)
        except LimitError as error:
            if "空文件" in str(error):
                extension = extension_of(name)
            else:
                raise AppError(str(error)) from error
        document_id = new_id()
        relative = f"{knowledge_base_id}/{document_id}.{extension}"
        destination = files_dir() / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        try:
            with destination.open("wb") as handle:
                while piece := await upload.read(1024 * 1024):
                    size += len(piece)
                    handle.write(piece)
            try:
                check_upload(name, size)
            except LimitError as error:
                raise AppError(str(error)) from error
            saved.append(
                insert_document(
                    knowledge_base_id,
                    name,
                    size,
                    upload.content_type or "",
                    relative,
                    document_id,
                )
            )
            names.add(name)
        except Exception:
            destination.unlink(missing_ok=True)
            raise
    return saved


def prepare_build(knowledge_base_id: str, rebuild: bool) -> list[str]:
    with _RUN_LOCK:
        if knowledge_base_id in _RUNNING:
            raise AppError("这个知识库正在构建", 409)
        knowledge_base = get_knowledge_base_row(knowledge_base_id)
        if knowledge_base is None:
            raise AppError("知识库不存在", 404)
        _require_embedding(knowledge_base["embedding_model_id"])
        document_ids = mark_for_build(knowledge_base_id, rebuild)
        if not document_ids:
            raise AppError("没有需要构建的文件")
        _RUNNING.add(knowledge_base_id)
        return document_ids


def run_build(knowledge_base_id: str) -> None:
    try:
        for document in list_building_documents(knowledge_base_id):
            _process_document(document["id"])
        for document in list_building_documents(knowledge_base_id):
            mark_document_failed(document["id"], "构建中断，请重新构建")
    finally:
        with _RUN_LOCK:
            _RUNNING.discard(knowledge_base_id)


def _require_embedding(model_config_id: str | None):
    if not model_config_id:
        raise AppError("请先为知识库选择 Embedding 模型")
    bundle = get_model_bundle(model_config_id)
    if bundle is None or bundle[1]["capability"] != "embedding":
        raise AppError("找不到可用的 Embedding 模型")
    if not bundle[0]["api_key"]:
        raise AppError("请先填写 Embedding 服务商的 API 密钥")
    return bundle


def _process_document(document_id: str) -> None:
    try:
        document = get_document(document_id)
        if document is None:
            return
        knowledge_base = get_knowledge_base_row(document["knowledge_base_id"])
        if knowledge_base is None:
            raise ParseError("知识库不存在")
        provider, model = _require_embedding(knowledge_base["embedding_model_id"])
        blocks = parse_file(
            absolute_file(document["stored_path"]),
            ocr_enabled=bool(knowledge_base["ocr_enabled"]),
            table_recognition=bool(knowledge_base["table_recognition"]),
            image_text_recognition=bool(knowledge_base["image_text_recognition"]),
            recognize=_recognizer() if knowledge_base["ocr_enabled"] or knowledge_base["image_text_recognition"] else None,
        )
        chunk_method = knowledge_base["chunk_method"] if "chunk_method" in knowledge_base.keys() else "recursive"
        child_chunk_size = int(knowledge_base["child_chunk_size"]) if "child_chunk_size" in knowledge_base.keys() else 200

        def embed_sentences(texts: list[str]) -> list[list[float]]:
            return clients.embed_texts(provider, model, texts)

        chunks = chunk_blocks(
            blocks,
            int(knowledge_base["chunk_size"]),
            int(knowledge_base["chunk_overlap"]),
            method=chunk_method,
            child_chunk_size=child_chunk_size,
            embed=embed_sentences if chunk_method == "semantic" else None,
        )
        if not chunks:
            raise ParseError("没有提取到可索引的文字")
        vectors = clients.embed_texts(provider, model, [chunk.content for chunk in chunks])
        stored = []
        for chunk, vector in zip(chunks, vectors, strict=True):
            blob, dimension = normalize_vector(vector)
            stored.append(
                {
                    "location": chunk.location,
                    "content": chunk.content,
                    "context": chunk.context,
                    "token_count": chunk.token_count,
                    "embedding": blob,
                    "embedding_dim": dimension,
                }
            )
        replace_document_chunks(document_id, document["knowledge_base_id"], stored)
    except (AppError, ParseError, LimitError, ValueError) as error:
        mark_document_failed(document_id, redact(str(error)))
    except Exception as error:
        logger.exception("document build failed")
        mark_document_failed(document_id, redact(str(error)))


def _recognizer():
    vision = get_vision()
    model_config_id = vision["modelConfigId"]
    if not model_config_id:
        def missing(_image: bytes, _mime: str) -> str:
            raise ParseError("请管理员先选择视觉识别模型")

        return missing
    bundle = get_model_bundle(model_config_id)
    if bundle is None or not bundle[1]["supports_vision"]:
        def unavailable(_image: bytes, _mime: str) -> str:
            raise ParseError("视觉识别模型不存在，请重新选择")

        return unavailable
    provider, model = bundle
    if not provider["api_key"]:
        def missing_key(_image: bytes, _mime: str) -> str:
            raise ParseError("请先填写视觉模型服务商的 API 密钥")

        return missing_key

    def recognize(image: bytes, mime: str) -> str:
        return clients.recognize_image(provider, model, image, mime)

    return recognize
