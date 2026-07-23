import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

# Make sure a developer's real keys/endpoints never leak into tests.
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["LLM_PROVIDER"] = "anthropic"
os.environ["OPENAI_BASE_URL"] = ""
os.environ["OPENAI_API_KEY"] = ""
os.environ["OPENAI_MODEL"] = ""
os.environ["MCP_TOKEN"] = ""
os.environ["ADMIN_USERNAME"] = ""
os.environ["ADMIN_PASSWORD"] = ""

from app import db as db_module  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.models import Base  # noqa: E402
from app.services.auth import create_user, reset_rate_limiter  # noqa: E402
from app.services.projects import get_inbox  # noqa: E402

USERNAME = "andrew"
PASSWORD = "correct-horse-battery"


@pytest.fixture()
def client() -> TestClient:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    db_module.set_engine_for_tests(engine)
    get_settings.cache_clear()
    reset_rate_limiter()

    with db_module.get_session_factory()() as db:
        create_user(db, USERNAME, PASSWORD)
        get_inbox(db)

    from app.main import create_app

    return TestClient(create_app())


@pytest.fixture()
def auth_client(client: TestClient) -> TestClient:
    response = client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return client
