import pytest

from app.config import data_dir


@pytest.fixture(autouse=True)
def isolate_data(tmp_path, monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_HUB_DATA", str(tmp_path))
    assert data_dir() == tmp_path
