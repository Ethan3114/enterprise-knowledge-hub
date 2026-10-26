from app.chunking import chunk_blocks
from app.parsing import TextBlock


def test_fixed_windows_ignore_sentence_boundaries():
    text = "甲" * 30 + "。乙" * 10
    chunks = chunk_blocks([TextBlock(text, "全文")], 20, 0, method="fixed")
    assert len(chunks) > 1
    assert all(chunk.context == "" for chunk in chunks)
    assert "".join(chunk.content for chunk in chunks).replace(" ", "") == text.replace(" ", "")


def test_parent_child_keeps_parent_for_context():
    text = "员工年假为十个工作日。" * 40
    chunks = chunk_blocks(
        [TextBlock(text, "年假")],
        80,
        0,
        method="parent_child",
        child_chunk_size=50,
    )
    assert chunks
    assert any(chunk.context and len(chunk.context) > len(chunk.content) for chunk in chunks)
    assert all(chunk.location == "年假" for chunk in chunks)


def test_semantic_groups_similar_neighbors():
    def embed(texts: list[str]) -> list[list[float]]:
        vectors = []
        for text in texts:
            vectors.append([1.0, 0.0] if "苹果" in text else [0.0, 1.0])
        return vectors

    chunks = chunk_blocks(
        [TextBlock("苹果很好吃。苹果很甜。今天去公园。公园有湖。", "全文")],
        200,
        0,
        method="semantic",
        embed=embed,
    )
    contents = [chunk.content for chunk in chunks]
    assert len(contents) == 2
    assert "苹果" in contents[0]
    assert "公园" in contents[1]


def test_recursive_keeps_short_sentence_together():
    chunks = chunk_blocks([TextBlock("第一句。\n\n第二句比较长，但仍应留在自己的段落里。", "全文")], 20, 0)
    assert len(chunks) >= 2
    assert chunks[0].content.startswith("第一句")
