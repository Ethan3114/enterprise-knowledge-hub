from app.dialogue import previous_exchange
from app.retrieval import keyword_ranking, search
from app.store import (
    init_db,
    insert_document,
    insert_knowledge_base,
    normalize_vector,
    replace_document_chunks,
)
from app.db import transaction


def test_previous_exchange_uses_only_the_last_success():
    messages = [
        {"role": "user", "content": "第一问", "status": "success"},
        {"role": "assistant", "content": "第一答", "status": "success"},
        {"role": "user", "content": "失败问", "status": "success"},
        {"role": "assistant", "content": "失败答", "status": "failed"},
    ]
    assert previous_exchange(messages) == ("第一问", "第一答")


def test_semantic_search_ranks_the_closer_chunk():
    rows = [
        _row("a", [1, 0], "休假制度在员工手册"),
        _row("b", [0, 1], "午餐供应时间"),
    ]
    hits = search(
        rows=rows,
        query="年假",
        retrieval_mode="semantic",
        retrieval_count=1,
        score_threshold=0.2,
        max_context_tokens=1000,
        query_vector=[1, 0],
        keyword_ids=[],
    )
    assert [hit.chunk_id for hit in hits] == ["a"]


def test_keyword_search_finds_saved_tokens():
    init_db()
    knowledge_base = insert_knowledge_base("制度库", "")
    document = insert_document(knowledge_base["id"], "handbook.md", 12, "text/markdown", "ignored.md")
    blob, dimension = normalize_vector([1, 0])
    replace_document_chunks(
        document["id"],
        knowledge_base["id"],
        [
            {
                "location": "年假",
                "content": "员工享有十个工作日年假",
                "token_count": 8,
                "embedding": blob,
                "embedding_dim": dimension,
            }
        ],
    )
    with transaction() as connection:
        found = keyword_ranking(connection, [knowledge_base["id"]], "年假有几天")
    assert found


def _row(chunk_id: str, vector: list[float], content: str) -> dict:
    blob, dimension = normalize_vector(vector)
    return {
        "id": chunk_id,
        "embedding": blob,
        "embedding_dim": dimension,
        "content": content,
        "location": "全文",
        "token_count": 4,
        "document_name": "手册.md",
        "knowledge_base_name": "制度库",
    }
