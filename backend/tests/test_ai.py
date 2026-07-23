from datetime import date

from app.schemas import TaskDraft
from app.services import ai as ai_svc


def test_draft_degrades_without_llm(auth_client):
    """FR-5.5: with no API key the draft falls back to the raw text."""
    response = auth_client.post("/api/v1/ai/draft", json={"text": "починить бэкап на NAS"})
    assert response.status_code == 200
    body = response.json()
    assert body["ai_ok"] is False
    assert body["draft"]["title"] == "починить бэкап на NAS"
    inbox = next(p for p in auth_client.get("/api/v1/projects").json() if p["is_inbox"])
    assert body["project_id"] == inbox["id"]


def test_draft_with_mocked_llm(auth_client, monkeypatch):
    auth_client.post("/api/v1/projects", json={"name": "Homelab"})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    def fake_call(system: str, user_message: str):
        assert "Homelab" in user_message  # project list is provided to the model
        draft = TaskDraft(
            title="Починить бэкап на NAS",
            description="- [ ] проверить cron\n- [ ] запустить вручную",
            project="Homelab",
            priority="high",
            tags=["homelab"],
            due_date=date(2026, 7, 24),
        )
        return draft, 100, 50

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)

    body = auth_client.post(
        "/api/v1/ai/draft", json={"text": "починить бэкап на NAS до пятницы"}
    ).json()
    assert body["ai_ok"] is True
    assert body["draft"]["project"] == "Homelab"
    projects = {p["name"]: p["id"] for p in auth_client.get("/api/v1/projects").json()}
    assert body["project_id"] == projects["Homelab"]

    get_settings.cache_clear()


def test_llm_error_degrades(auth_client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    def broken_call(system: str, user_message: str):
        raise RuntimeError("api down")

    monkeypatch.setattr(ai_svc, "_call_model", broken_call)

    body = auth_client.post("/api/v1/ai/draft", json={"text": "buy milk"}).json()
    assert body["ai_ok"] is False
    assert body["draft"]["title"] == "buy milk"

    get_settings.cache_clear()


def test_enhance_not_found(auth_client):
    assert auth_client.post("/api/v1/ai/enhance/9999").status_code == 404
