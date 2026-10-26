"""混合检索。

语义用归一化向量的点积。关键词用分词后的全文索引。
混合模式把两边的名次做倒数排名融合，再按知识库设置决定要不要重排。
"""

from dataclasses import dataclass

import numpy as np

from .textutil import count_tokens, fts_match

CANDIDATE_LIMIT = 40


@dataclass
class Hit:
    chunk_id: str
    document_name: str
    knowledge_base_name: str
    location: str
    content: str
    context: str
    token_count: int
    semantic_score: float | None
    rerank_score: float | None


def _semantic_ranking(rows: list[dict], query_vector: list[float], threshold: float | None) -> list[tuple[str, float]]:
    if not rows:
        return []
    matrix = np.vstack([np.frombuffer(row["embedding"], dtype=np.float32).copy() for row in rows])
    query = np.asarray(query_vector, dtype=np.float32)
    norm = float(np.linalg.norm(query))
    if norm == 0:
        return []
    query = query / norm
    scores = matrix @ query
    order = np.argsort(-scores)
    ranked: list[tuple[str, float]] = []
    for index in order:
        score = float(scores[int(index)])
        if threshold is not None and score < threshold:
            continue
        ranked.append((rows[int(index)]["id"], score))
    return ranked


def keyword_ranking(connection, knowledge_base_ids: list[str], query: str) -> list[str]:
    match = fts_match(query)
    if not match or not knowledge_base_ids:
        return []
    placeholders = ",".join("?" * len(knowledge_base_ids))
    try:
        found = connection.execute(
            f"""
            SELECT chunks_fts.chunk_id
            FROM chunks_fts
            JOIN chunks ON chunks.id = chunks_fts.chunk_id
            WHERE chunks.knowledge_base_id IN ({placeholders})
              AND chunks_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            [*knowledge_base_ids, match, CANDIDATE_LIMIT],
        ).fetchall()
    except Exception:
        return []
    return [row["chunk_id"] for row in found]


def _fuse(rankings: list[list[str]]) -> list[str]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for position, chunk_id in enumerate(ranking):
            scores[chunk_id] = scores.get(chunk_id, 0) + 1 / (60 + position + 1)
    return sorted(scores, key=lambda chunk_id: scores[chunk_id], reverse=True)


def search(
    *,
    rows: list[dict],
    query: str,
    retrieval_mode: str,
    retrieval_count: int,
    score_threshold: float,
    max_context_tokens: int,
    query_vector: list[float] | None,
    keyword_ids: list[str] | None = None,
    rerank_fn=None,
) -> list[Hit]:
    by_id = {row["id"]: row for row in rows}
    # 混合检索会用相关度去掉明显不相关的语义结果，关键词命中仍然保留。
    semantic = (
        _semantic_ranking(rows, query_vector, score_threshold)
        if retrieval_mode in {"semantic", "hybrid"} and query_vector is not None
        else []
    )
    if keyword_ids is None:
        keyword_ids = []
    if retrieval_mode == "semantic":
        ordered = [chunk_id for chunk_id, _score in semantic]
    elif retrieval_mode == "keyword":
        ordered = keyword_ids
    else:
        ordered = _fuse([[chunk_id for chunk_id, _score in semantic], keyword_ids])

    semantic_scores = dict(semantic)
    chosen_ids = [chunk_id for chunk_id in ordered if chunk_id in by_id][:CANDIDATE_LIMIT]
    rerank_scores: dict[str, float] = {}
    if rerank_fn is not None and chosen_ids:
        results = rerank_fn(query, [by_id[chunk_id]["content"] for chunk_id in chosen_ids])
        reranked: list[str] = []
        for index, score in results:
            if 0 <= index < len(chosen_ids):
                chunk_id = chosen_ids[index]
                reranked.append(chunk_id)
                rerank_scores[chunk_id] = score
        chosen_ids = reranked[:retrieval_count]
    else:
        chosen_ids = chosen_ids[:retrieval_count]

    hits: list[Hit] = []
    used_tokens = 0
    for chunk_id in chosen_ids:
        row = by_id.get(chunk_id)
        if row is None:
            continue
        context = row.get("context_text") or ""
        token_count = count_tokens(context) if context else int(row["token_count"])
        if hits and used_tokens + token_count > max_context_tokens:
            break
        hits.append(
            Hit(
                chunk_id=chunk_id,
                document_name=row["document_name"],
                knowledge_base_name=row["knowledge_base_name"],
                location=row["location"],
                content=row["content"],
                context=context,
                token_count=token_count,
                semantic_score=semantic_scores.get(chunk_id),
                rerank_score=rerank_scores.get(chunk_id),
            )
        )
        used_tokens += token_count
        if used_tokens >= max_context_tokens:
            break
    return hits
