import pytest

from app.limits import LimitError, check_upload


def test_rejects_legacy_office_formats():
    with pytest.raises(LimitError, match="docx"):
        check_upload("制度.doc", 100)
    with pytest.raises(LimitError, match="xlsx"):
        check_upload("名单.xls", 100)


def test_rejects_oversized_pdf():
    with pytest.raises(LimitError, match="50 MB"):
        check_upload("手册.pdf", 50 * 1024 * 1024 + 1)


def test_accepts_markdown_within_limit():
    assert check_upload("手册.md", 20) == "md"
