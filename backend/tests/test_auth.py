from tests.conftest import PASSWORD, USERNAME


def test_api_requires_auth(client):
    assert client.get("/api/v1/tasks").status_code == 401
    assert client.get("/api/v1/auth/me").status_code == 401


def test_login_logout_flow(client):
    response = client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert response.status_code == 200
    assert response.json()["username"] == USERNAME
    assert "tt_session" in response.cookies

    assert client.get("/api/v1/auth/me").status_code == 200

    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_wrong_password_rejected(client):
    response = client.post(
        "/api/v1/auth/login", json={"username": USERNAME, "password": "nope-nope"}
    )
    assert response.status_code == 401


def test_login_rate_limited(client):
    for _ in range(5):
        client.post("/api/v1/auth/login", json={"username": USERNAME, "password": "wrong-wrong"})
    response = client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert response.status_code == 429


def test_healthz_is_public(client):
    assert client.get("/healthz").status_code == 200


def test_login_limit_reserves_inflight_attempt(client, monkeypatch):
    from app import db as db_module
    from app.config import get_settings
    from app.services import auth

    monkeypatch.setattr(get_settings(), "login_rate_limit_attempts", 1)
    nested_results = []
    with db_module.get_session_factory()() as db:

        def password_check(*args):
            try:
                auth.login(db, "missing-user", "bad", "same-ip")
            except auth.RateLimited:
                nested_results.append("limited")
            except auth.AuthError:
                nested_results.append("not-limited")
            return False

        monkeypatch.setattr(auth, "verify_password", password_check)
        try:
            auth.login(db, USERNAME, "bad", "same-ip")
        except auth.AuthError:
            pass
    assert nested_results == ["limited"]
