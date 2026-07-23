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
