"""四种切分方式。

固定长度按 Token 窗口硬切。
递归切分沿段落和句子边界拼到目标长度，这是原先的默认做法。
父子切分用较小的子块做检索，回答时带上对应的父块。
语义切分先按句子切开，再把相邻且语义接近的句子合成一块。
"""

import re
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from langchain_text_splitters import RecursiveCharacterTextSplitter

from .parsing import TextBlock
from .textutil import count_tokens

CHUNK_METHODS = ("fixed", "parent_child", "semantic", "recursive")
SEMANTIC_BREAK = 0.72
EmbedTexts = Callable[[list[str]], list[list[float]]]


@dataclass(frozen=True)
class TextChunk:
    content: str
    location: str
    token_count: int
    context: str = ""


def chunk_blocks(
    blocks: list[TextBlock],
    chunk_size: int,
    chunk_overlap: int,
    *,
    method: str = "recursive",
    child_chunk_size: int = 200,
    embed: EmbedTexts | None = None,
) -> list[TextChunk]:
    if method not in CHUNK_METHODS:
        raise ValueError("不支持的切分方式")
    if chunk_overlap >= chunk_size:
        raise ValueError("分块重叠长度必须小于分块大小")
    if method == "parent_child" and not 50 <= child_chunk_size < chunk_size:
        raise ValueError("子块大小要小于父块，并且至少 50")
    if method == "semantic" and embed is None:
        raise ValueError("语义切分需要先选择 Embedding 模型")

    chunks: list[TextChunk] = []
    if method == "semantic":
        assert embed is not None
        return _semantic_blocks(blocks, chunk_size, embed)
    for block in blocks:
        if method == "fixed":
            pieces = _fixed_windows(block.text, chunk_size, chunk_overlap)
            chunks.extend(_plain_chunks(pieces, block.location))
        elif method == "parent_child":
            chunks.extend(_parent_child(block, chunk_size, chunk_overlap, child_chunk_size))
        else:
            pieces = _recursive_pieces(block.text, chunk_size, chunk_overlap)
            chunks.extend(_plain_chunks(pieces, block.location))
    return chunks


def _plain_chunks(pieces: list[str], location: str) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    for piece in pieces:
        content = piece.strip()
        if not content:
            continue
        chunks.append(TextChunk(content, location, count_tokens(content)))
    return chunks


def _recursive_pieces(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        encoding_name="cl100k_base",
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],
    )
    return splitter.split_text(text) or [text]


def _fixed_windows(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """按原文切片，避免把 Token 从中间切开后出现乱码。"""
    if not text:
        return []
    pieces: list[str] = []
    start = 0
    length = len(text)
    while start < length:
        end = _fit_end(text, start, chunk_size)
        pieces.append(text[start:end])
        if end >= length:
            break
        if chunk_overlap <= 0:
            start = end
            continue
        next_start = end
        while next_start > start and count_tokens(text[next_start:end]) < chunk_overlap:
            next_start -= 1
        start = next_start if start < next_start < end else end
    return pieces


def _fit_end(text: str, start: int, chunk_size: int) -> int:
    low = start + 1
    high = len(text)
    best = min(len(text), start + 1)
    while low <= high:
        mid = (low + high) // 2
        if count_tokens(text[start:mid]) <= chunk_size:
            best = mid
            low = mid + 1
        else:
            high = mid - 1
    return best


def _parent_child(block: TextBlock, chunk_size: int, chunk_overlap: int, child_chunk_size: int) -> list[TextChunk]:
    parents = [piece.strip() for piece in _recursive_pieces(block.text, chunk_size, chunk_overlap) if piece.strip()]
    child_overlap = min(chunk_overlap, max(0, child_chunk_size // 5))
    chunks: list[TextChunk] = []
    for parent in parents:
        children = [piece.strip() for piece in _fixed_windows(parent, child_chunk_size, child_overlap) if piece.strip()]
        if not children:
            children = [parent]
        for child in children:
            chunks.append(
                TextChunk(
                    content=child,
                    location=block.location,
                    token_count=count_tokens(child),
                    context="" if child == parent else parent,
                )
            )
    return chunks


def _semantic_blocks(blocks: list[TextBlock], chunk_size: int, embed: EmbedTexts) -> list[TextChunk]:
    sentences: list[tuple[str, str]] = []
    for block in blocks:
        for sentence in _sentences(block.text):
            if count_tokens(sentence) > chunk_size:
                for piece in _fixed_windows(sentence, chunk_size, 0):
                    sentences.append((piece.strip(), block.location))
            else:
                sentences.append((sentence, block.location))
    sentences = [item for item in sentences if item[0]]
    if not sentences:
        return []
    vectors = [_normalize(vector) for vector in embed([sentence for sentence, _location in sentences])]
    if len(vectors) != len(sentences):
        raise ValueError("语义切分时向量数量和句子数量不一致")

    groups: list[list[int]] = [[0]]
    for index in range(1, len(sentences)):
        current = groups[-1]
        similarity = float(np.dot(vectors[index - 1], vectors[index]))
        merged = "".join(sentences[item][0] for item in current) + sentences[index][0]
        if similarity < SEMANTIC_BREAK or count_tokens(merged) > chunk_size:
            groups.append([index])
        else:
            current.append(index)

    chunks: list[TextChunk] = []
    for group in groups:
        content = "".join(sentences[item][0] for item in group).strip()
        if not content:
            continue
        chunks.append(TextChunk(content, sentences[group[0]][1], count_tokens(content)))
    return chunks


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[。！？!?；;\n])", text)
    return [part.strip() for part in parts if part.strip()]


def _normalize(vector: list[float]) -> np.ndarray:
    array = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(array))
    if norm == 0:
        return array
    return array / norm
