import json

from fastapi.testclient import TestClient

from app.config import get_settings


def test_catalog_requires_login(client: TestClient):
    assert client.get("/api/v1/mcp/tools").status_code == 401
    assert client.get("/mcp").status_code == 401


def test_catalog_matches_mcp_discovery(auth_client: TestClient, monkeypatch):
    monkeypatch.setattr(get_settings(), "mcp_token", "test-catalog-token")
    assert auth_client.get("/mcp").status_code == 401
    with auth_client:
        discovery = auth_client.post(
            "/mcp",
            headers={
                "Authorization": "Bearer test-catalog-token",
                "Accept": "application/json, text/event-stream",
            },
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
    assert discovery.status_code == 200
    data = next(
        line.removeprefix("data: ")
        for line in discovery.text.splitlines()
        if line.startswith("data: ")
    )
    catalog = auth_client.get("/api/v1/mcp/tools")
    assert catalog.status_code == 200
    assert catalog.json() == json.loads(data)["result"]["tools"]
    assert any(tool["name"] == "list_tasks" for tool in catalog.json())
