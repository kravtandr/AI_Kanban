import json

import pytest

from app import db as db_module
from app.config import get_settings
from app.models import LlmUsage
from app.schemas import AgentPromptDraft
from app.services import ai as ai_svc


@pytest.mark.parametrize("wrapped", [False, True])
def test_prompt_json_preserves_markdown_and_literal_think_tags(wrapped):
    prompt = 'Пример:\n```python\nprint("{hello}")\n```\nСохрани <think>literal</think>.'
    payload = json.dumps({"prompt": prompt}, ensure_ascii=False)
    if wrapped:
        payload = f"<think>{{reasoning}}</think>\n```json\n{payload}\n```"
    result = AgentPromptDraft.model_validate_json(ai_svc._extract_json(payload))
    assert result.prompt == prompt


def create_task(client, description="Добавить фильтр по имени, покрыть тестами."):
    project = client.get("/api/v1/projects").json()[0]
    response = client.post(
        "/api/v1/tasks",
        json={"title": "Поиск задач", "description": description, "project_id": project["id"]},
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.parametrize("description", ["Добавить фильтр по имени, покрыть тестами.", ""])
def test_prompt_uses_saved_text_without_changing_task(auth_client, monkeypatch, description):
    task = create_task(auth_client, description)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()

    def fake(system, user_message, *, schema):
        data = json.loads(user_message)
        assert data == {"title": task["title"], "description": description}
        return schema(prompt="  Изучи репозиторий и реализуй поиск задач.  "), 12, 34

    monkeypatch.setattr(ai_svc, "_call_model", fake)
    response = auth_client.post(f"/api/v1/ai/agent-prompt/{task['id']}")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "prompt": "Изучи репозиторий и реализуй поиск задач.",
        "ai_ok": True,
        "ai_error": None,
    }
    assert auth_client.get(f"/api/v1/tasks/{task['id']}").json() == task
    with db_module.get_session_factory()() as db:
        usage = db.query(LlmUsage).filter_by(operation="agent_prompt").one()
        assert (usage.ok, usage.input_tokens, usage.output_tokens) == (True, 12, 34)


def test_prompt_without_llm_is_explicit_failure(auth_client):
    task = create_task(auth_client)
    response = auth_client.post(f"/api/v1/ai/agent-prompt/{task['id']}")
    assert response.status_code == 200
    assert response.json() == {"prompt": None, "ai_ok": False, "ai_error": "LLM is not configured"}


@pytest.mark.parametrize(
    "reply", [None, " \n\t", "x" * 20001], ids=["upstream", "empty", "oversized"]
)
def test_prompt_failure_hides_upstream_details(auth_client, monkeypatch, caplog, reply):
    task = create_task(auth_client)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()

    def fake(system, user_message, *, schema):
        if reply is None:
            raise RuntimeError("private upstream token")
        return schema(prompt=reply), 1, 1

    monkeypatch.setattr(ai_svc, "_call_model", fake)
    response = auth_client.post(f"/api/v1/ai/agent-prompt/{task['id']}")
    assert response.status_code == 200
    assert response.json() == {
        "prompt": None,
        "ai_ok": False,
        "ai_error": "LLM service unavailable",
    }
    assert "private upstream token" not in caplog.text
    with db_module.get_session_factory()() as db:
        assert db.query(LlmUsage).filter_by(operation="agent_prompt").one().ok is False


def test_prompt_requires_authentication(client):
    assert client.post("/api/v1/ai/agent-prompt/1").status_code == 401


def test_prompt_missing_task_does_not_call_llm(auth_client, monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("Missing tasks must not spend tokens")

    monkeypatch.setattr(ai_svc, "_call_model", unexpected)
    assert auth_client.post("/api/v1/ai/agent-prompt/99999").status_code == 404
