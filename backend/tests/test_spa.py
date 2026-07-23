"""Regression: SPA routes must survive a full page load (fallback to index.html)."""

from fastapi.testclient import TestClient


def test_spa_fallback(client, tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html><body>SPA</body></html>")
    (tmp_path / "asset.js").write_text("console.log(1)")

    from app import main as main_module

    monkeypatch.setattr(main_module, "STATIC_DIR", tmp_path)
    spa_client = TestClient(main_module.create_app())

    # Client-side routes fall back to index.html instead of 404.
    for path in ("/", "/login", "/board", "/login?next=%2Fboard"):
        response = spa_client.get(path)
        assert response.status_code == 200, path
        assert "SPA" in response.text, path

    # Real files are still served as-is.
    assert spa_client.get("/asset.js").text == "console.log(1)"

    # API and MCP are not shadowed by the fallback.
    assert spa_client.get("/api/v1/tasks").status_code == 401
    assert spa_client.post("/mcp", json={}).status_code == 401
