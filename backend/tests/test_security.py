"""NFR-3/NFR-4 hardening: security headers, CSRF origin check, token kinds,
session expiry and JSON 404 for unknown API paths."""

from datetime import timedelta

from fastapi.testclient import TestClient
from starlette.responses import PlainTextResponse

from app import db as db_module
from app.config import get_settings
from app.main import McpTokenAuth
from app.models import SessionToken, TokenKind, utcnow
from app.services.auth import create_api_token


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _gate_client() -> TestClient:
    """The MCP token gate wrapped around a trivial 200-OK app: a request that
    passes the gate succeeds, one that fails it gets the 401."""

    async def inner(scope, receive, send):
        await PlainTextResponse("ok")(scope, receive, send)

    return TestClient(McpTokenAuth(inner))


def test_security_headers_present(client):
    response = client.get("/healthz")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "same-origin"
    assert "default-src 'self'" in response.headers["Content-Security-Policy"]
    # HTTP deployment: no HSTS unless COOKIE_SECURE is on.
    assert "Strict-Transport-Security" not in response.headers


def test_csrf_foreign_origin_rejected(auth_client):
    response = auth_client.post(
        "/api/v1/tasks", json={"title": "x"}, headers={"Origin": "http://evil.example"}
    )
    assert response.status_code == 403


def test_csrf_same_origin_and_no_origin_allowed(auth_client):
    ok = auth_client.post(
        "/api/v1/tasks", json={"title": "same origin"}, headers={"Origin": "http://testserver"}
    )
    assert ok.status_code == 201
    no_origin = auth_client.post("/api/v1/tasks", json={"title": "curl style"})
    assert no_origin.status_code == 201


def test_unknown_api_path_is_json_404(client, tmp_path, monkeypatch):
    """With the SPA mounted, unknown /api/* paths must not get index.html/200."""
    (tmp_path / "index.html").write_text("<html><body>SPA</body></html>")

    from app import main as main_module

    monkeypatch.setattr(main_module, "STATIC_DIR", tmp_path)
    spa_client = TestClient(main_module.create_app())

    response = spa_client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert "SPA" not in response.text


def test_api_bearer_token_works_on_rest(client):
    with db_module.get_session_factory()() as db:
        api_token = create_api_token(db, "cli", TokenKind.api)
    assert client.get("/api/v1/tasks", headers=_bearer(api_token)).status_code == 200


def test_mcp_static_token_accepted(client, monkeypatch):
    monkeypatch.setenv("MCP_TOKEN", "static-secret")
    get_settings.cache_clear()

    gate = _gate_client()
    assert gate.get("/", headers=_bearer("static-secret")).status_code == 200
    assert gate.get("/", headers=_bearer("wrong-token")).status_code == 401
    assert gate.get("/").status_code == 401

    get_settings.cache_clear()


def test_mcp_db_token_accepted_and_kinds_are_separated(client):
    with db_module.get_session_factory()() as db:
        mcp_token = create_api_token(db, "agent", TokenKind.mcp)
        api_token = create_api_token(db, "cli", TokenKind.api)

    gate = _gate_client()
    # kind=mcp opens the MCP gate; kind=api does not.
    assert gate.get("/", headers=_bearer(mcp_token)).status_code == 200
    assert gate.get("/", headers=_bearer(api_token)).status_code == 401
    # And the other way around for REST.
    assert client.get("/api/v1/tasks", headers=_bearer(api_token)).status_code == 200
    assert client.get("/api/v1/tasks", headers=_bearer(mcp_token)).status_code == 401


def test_expired_session_rejected(auth_client):
    assert auth_client.get("/api/v1/auth/me").status_code == 200
    with db_module.get_session_factory()() as db:
        for session in db.query(SessionToken).all():
            session.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert auth_client.get("/api/v1/auth/me").status_code == 401
