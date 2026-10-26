from app.db import transaction
from app.dialogue import grounded_context
from app.metadata import parse_metadata
from app.retrieval import Hit, keyword_ranking
from app.store import (
    init_db,
    insert_document,
    insert_knowledge_base,
    list_chunks,
    normalize_vector,
    replace_document_chunks,
)


def test_parse_metadata_reads_fenced_json_and_defaults_visibility():
    raw = """```json
    {"time":"2024年3月","version":"V2","subject":"年假制度","owner":"人力资源部","keywords":["年假","调休"],"questions":["年假有几天？"]}
    ```"""
    metadata = parse_metadata(raw)
    assert metadata["subject"] == "年假制度"
    assert metadata["keywords"] == ["年假", "调休"]
    assert metadata["questions"] == ["年假有几天？"]
    assert metadata["visibility"] == "全员"


def test_question_tag_finds_the_content_chunk():
    init_db()
    knowledge_base = insert_knowledge_base("制度库", "")
    document = insert_document(knowledge_base["id"], "leave.md", 20, "text/markdown", "ignored.md")
    metadata = {
        "time": "2024年",
        "version": "V1",
        "subject": "年假制度",
        "owner": "人力资源部",
        "visibility": "人力资源部",
        "keywords": ["年假"],
        "questions": ["年假到期怎么处理"],
    }
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
        metadata,
    )
    with transaction() as connection:
        found = keyword_ranking(connection, [knowledge_base["id"]], "年假到期怎么处理")
    assert found
    listed = list_chunks(knowledge_base["id"])
    assert listed["total"] == 1
    assert listed["items"][0]["content"] == "员工享有十个工作日年假"
    assert listed["items"][0]["tags"]["version"] == "V1"
    assert listed["items"][0]["tags"]["visibility"] == "人力资源部"
    assert "年假到期怎么处理" not in listed["items"][0]["content"]


def test_answer_context_keeps_tags_on_the_chunk():
    metadata = {
        "time": "2024年",
        "version": "V3",
        "subject": "报销制度",
        "owner": "财务部",
        "visibility": "财务部",
        "keywords": ["发票"],
        "questions": ["发票丢了怎么办"],
    }
    hits = [
        Hit("a", "报销.md", "财务", "第一节", "正文一", "", 4, 0.8, None, metadata),
        Hit("b", "报销.md", "财务", "第二节", "正文二", "", 4, 0.7, None, metadata),
    ]
    context = grounded_context(hits)
    assert "[元数据]" not in context
    assert context.count("标签：") == 2
    assert "版本 V3" in context
    assert "可见范围 财务部" in context
    assert "正文一" in context
    assert "正文二" in context
    assert "发票丢了怎么办" not in context
