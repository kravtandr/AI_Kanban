"""OpenAI-compatible provider (self-hosted models): JSON extraction + dispatch."""

import pytest

from app.services import ai as ai_svc

DRAFT_JSON = (
    '{"title": "Починить бэкап", "description": "", "project": "Homelab",'
    ' "priority": "high", "tags": ["infra"], "due_date": null}'
)


def test_extract_json_plain():
    assert ai_svc._extract_json(DRAFT_JSON) == DRAFT_JSON


def test_extract_json_fenced():
    assert ai_svc._extract_json(f"```json\n{DRAFT_JSON}\n```") == DRAFT_JSON


def test_extract_json_with_think_block_and_prose():
    text = f"<think>{{not json}} reasoning...</think>Вот результат:\n{DRAFT_JSON}\nГотово."
    assert ai_svc._extract_json(text) == DRAFT_JSON


def test_extract_json_missing():
    with pytest.raises(ValueError):
        ai_svc._extract_json("<think>hmm</think>no json here")


def _use_openai(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://fake:9443/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_MODEL", "qwen-test")
    from app.config import get_settings

    get_settings.cache_clear()


def test_draft_via_openai_provider(auth_client, monkeypatch):
    auth_client.post("/api/v1/projects", json={"name": "Homelab"})
    _use_openai(monkeypatch)

    def fake_chat(system: str, user_message: str):
        assert "Return ONLY a single JSON object" in system
        assert "Homelab" in user_message
        return f"```json\n{DRAFT_JSON}\n```", 120, 80

    monkeypatch.setattr(ai_svc, "_openai_chat", fake_chat)
    body = auth_client.post("/api/v1/ai/draft", json={"text": "бэкап сломался"}).json()

    from app.config import get_settings

    get_settings.cache_clear()

    assert body["ai_ok"] is True
    assert body["draft"]["title"] == "Починить бэкап"
    assert body["draft"]["priority"] == "high"
    projects = {p["name"]: p["id"] for p in auth_client.get("/api/v1/projects").json()}
    assert body["project_id"] == projects["Homelab"]


def test_openai_provider_without_endpoint_degrades(auth_client, monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    from app.config import get_settings

    get_settings.cache_clear()

    body = auth_client.post("/api/v1/ai/draft", json={"text": "buy milk"}).json()
    get_settings.cache_clear()

    assert body["ai_ok"] is False
    assert body["draft"]["title"] == "buy milk"


def test_openai_invalid_json_degrades(auth_client, monkeypatch):
    _use_openai(monkeypatch)
    monkeypatch.setattr(ai_svc, "_openai_chat", lambda s, u: ("I cannot do that", 10, 5))

    body = auth_client.post("/api/v1/ai/draft", json={"text": "странный запрос"}).json()

    from app.config import get_settings

    get_settings.cache_clear()

    assert body["ai_ok"] is False
    assert body["draft"]["title"] == "странный запрос"
