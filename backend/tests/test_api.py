import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


def test_app_store_lists_writing_scenarios(client: TestClient):
    response = client.get("/api/apps", headers={"X-Role": "user"})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == ["article", "weekly-report"]


def test_article_app_requires_topic(client: TestClient):
    response = client.post(
        "/api/apps/article/run",
        headers={"X-Role": "user"},
        json={"knowledgeBaseIds": ["kb"], "modelConfigId": "model", "fields": {}},
    )
    assert response.status_code == 200
    assert "请填写文章主题" in response.text


def test_role_is_required(client: TestClient):
    response = client.get("/api/knowledge-bases")
    assert response.status_code == 401


def test_user_cannot_create_knowledge_base(client: TestClient):
    response = client.post("/api/knowledge-bases", headers={"X-Role": "user"}, json={"name": "制度库", "description": ""})
    assert response.status_code == 403


def test_model_list_parser_uses_provider_names():
    from app.clients import parse_model_list

    models = parse_model_list(
        {
            "data": [
                {"id": "qwen-plus", "name": "通义千问 Plus"},
                {"id": "text-embedding-v4"},
                {"id": "qwen-plus", "name": "重复项"},
            ]
        }
    )
    assert models == [
        {"id": "text-embedding-v4", "name": "text-embedding-v4"},
        {"id": "qwen-plus", "name": "通义千问 Plus"},
    ]


def test_provider_key_is_not_returned(client: TestClient):
    created = client.post(
        "/api/providers",
        headers={"X-Role": "admin"},
        json={
            "kind": "tongyi",
            "name": "通义百炼",
            "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "apiKey": "sk-test-not-real",
        },
    )
    assert created.status_code == 200
    assert "apiKey" not in created.json()
    listed = client.get("/api/providers", headers={"X-Role": "admin"})
    body = listed.text
    assert "sk-test-not-real" not in body
    assert listed.json()[0]["hasApiKey"] is True


def test_upload_persists_and_build_requires_embedding(client: TestClient):
    created = client.post(
        "/api/knowledge-bases",
        headers={"X-Role": "manager"},
        json={"name": "人力资源制度库", "description": "年假与报销"},
    )
    assert created.status_code == 200
    knowledge_base_id = created.json()["id"]
    uploaded = client.post(
        f"/api/knowledge-bases/{knowledge_base_id}/documents",
        headers={"X-Role": "manager"},
        files=[("files", ("employee-handbook.md", "# 年假\n\n员工享有十个工作日年假。".encode(), "text/markdown"))],
    )
    assert uploaded.status_code == 200
    assert uploaded.json()[0]["status"] == "uploaded"
    listed = client.get(f"/api/knowledge-bases/{knowledge_base_id}", headers={"X-Role": "manager"})
    assert listed.json()["documents"][0]["name"] == "employee-handbook.md"
    build = client.post(
        f"/api/knowledge-bases/{knowledge_base_id}/build",
        headers={"X-Role": "manager"},
        json={"rebuild": False},
    )
    assert build.status_code == 400
    assert "Embedding" in build.json()["detail"]


def test_legacy_doc_is_rejected(client: TestClient):
    created = client.post(
        "/api/knowledge-bases",
        headers={"X-Role": "admin"},
        json={"name": "旧格式", "description": ""},
    )
    response = client.post(
        f"/api/knowledge-bases/{created.json()['id']}/documents",
        headers={"X-Role": "admin"},
        files=[("files", ("old.doc", b"binary", "application/msword"))],
    )
    assert response.status_code == 400
    assert "docx" in response.json()["detail"]


def test_workspace_reset_removes_provider(client: TestClient):
    client.post(
        "/api/providers",
        headers={"X-Role": "admin"},
        json={
            "kind": "deepseek",
            "name": "DeepSeek",
            "baseUrl": "https://api.deepseek.com",
            "apiKey": "sk-test-not-real",
        },
    )
    cleared = client.delete("/api/workspace", headers={"X-Role": "user"})
    assert cleared.status_code == 200
    listed = client.get("/api/providers", headers={"X-Role": "admin"})
    assert listed.json() == []
