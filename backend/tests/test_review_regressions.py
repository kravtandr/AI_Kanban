from app import db as db_module
from app import mcp_server
from app.models import Task
from app.schemas import TaskDraft
from app.services import ai


def test_project_case_only_rename(auth_client):
    project = auth_client.post("/api/v1/projects", json={"name": "MixedCase"}).json()
    response = auth_client.patch(f"/api/v1/projects/{project['id']}", json={"name": "mixedcase"})
    assert response.status_code == 200


def test_archived_project_rejects_new_tasks(auth_client):
    project = auth_client.post("/api/v1/projects", json={"name": "Archived"}).json()
    auth_client.patch(f"/api/v1/projects/{project['id']}", json={"archived": True})
    response = auth_client.post(
        "/api/v1/tasks", json={"title": "Hidden", "project_id": project["id"]}
    )
    assert response.status_code == 400
    task = auth_client.post("/api/v1/tasks", json={"title": "Visible"}).json()
    response = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"project_id": project["id"]})
    assert response.status_code == 400


def test_blank_names_rejected(auth_client):
    assert auth_client.post("/api/v1/tasks", json={"title": "   "}).status_code == 422
    assert auth_client.post("/api/v1/projects", json={"name": "   "}).status_code == 422


def test_mcp_explicit_priority_preserved(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(
        ai, "_call_model", lambda *args: (TaskDraft(title="AI", priority="low"), 1, 1)
    )
    assert mcp_server.create_task_impl("Important", priority="urgent")["priority"] == "urgent"


def test_ai_draft_title_can_be_saved(auth_client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(ai, "_call_model", lambda *args: (TaskDraft(title="X" * 201), 1, 1))
    result = auth_client.post("/api/v1/ai/draft", json={"text": "Original note"}).json()
    response = auth_client.post("/api/v1/tasks", json={"title": result["draft"]["title"]})
    assert response.status_code == 201


def test_rest_board_does_not_silently_truncate(auth_client):
    with db_module.get_session_factory()() as db:
        db.add_all([Task(title=str(i), project_id=1, sort_order=i) for i in range(501)])
        db.commit()
    assert len(auth_client.get("/api/v1/tasks").json()) == 501


def test_search_matches_literal_text_and_tags(auth_client):
    wanted = auth_client.post(
        "/api/v1/tasks", json={"title": "100% complete", "tags": ["needle"]}
    ).json()
    auth_client.post("/api/v1/tasks", json={"title": "Unrelated"})
    assert [t["id"] for t in auth_client.get("/api/v1/tasks", params={"q": "%"}).json()] == [
        wanted["id"]
    ]
    assert [t["id"] for t in auth_client.get("/api/v1/tasks", params={"q": "needle"}).json()] == [
        wanted["id"]
    ]


def test_ai_relative_dates_use_configured_timezone(auth_client, monkeypatch):
    from datetime import datetime

    from app.config import get_settings

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("TIMEZONE", "Pacific/Kiritimati")
    get_settings.cache_clear()

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            assert str(tz) == "Pacific/Kiritimati"
            return cls(2030, 1, 2, 1, 0, tzinfo=tz)

    monkeypatch.setattr(ai, "datetime", FrozenDatetime, raising=False)

    def fake_call(system, message):
        assert "Today is 2030-01-02." in message
        return TaskDraft(title="Tomorrow"), 1, 1

    monkeypatch.setattr(ai, "_call_model", fake_call)
    result = auth_client.post("/api/v1/ai/draft", json={"text": "Tomorrow"}).json()
    assert result["ai_ok"] is True


def test_ai_failure_does_not_expose_upstream_secrets(auth_client, monkeypatch, caplog):
    from app.config import get_settings

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()

    def fail(*args):
        raise RuntimeError("Authorization failed token=secret-upstream-value")

    monkeypatch.setattr(ai, "_call_model", fail)
    result = auth_client.post("/api/v1/ai/draft", json={"text": "Original"}).json()
    assert result["ai_ok"] is False
    assert "secret-upstream-value" not in str(result)
    assert "secret-upstream-value" not in caplog.text


def test_move_inserts_without_duplicate_positions(auth_client):
    tasks = [auth_client.post("/api/v1/tasks", json={"title": str(i)}).json() for i in range(3)]
    response = auth_client.post(
        f"/api/v1/tasks/{tasks[2]['id']}/move", json={"status": "todo", "sort_order": 1}
    )
    assert response.status_code == 200
    board = auth_client.get("/api/v1/tasks").json()
    assert [t["id"] for t in board] == [tasks[2]["id"], tasks[0]["id"], tasks[1]["id"]]
    assert [t["sort_order"] for t in board] == [1, 2, 3]
    response = auth_client.post(
        f"/api/v1/tasks/{tasks[2]['id']}/move", json={"status": "todo", "sort_order": 3}
    )
    assert response.status_code == 200
    assert [t["id"] for t in auth_client.get("/api/v1/tasks").json()] == [t["id"] for t in tasks]


def test_project_color_is_validated(auth_client):
    assert (
        auth_client.post(
            "/api/v1/projects", json={"name": "Bad color", "color": "x" * 100}
        ).status_code
        == 422
    )


def test_stt_logs_do_not_expose_credentials(client, monkeypatch, caplog):
    import httpx
    import pytest

    from app.config import get_settings
    from app.services import stt

    monkeypatch.setenv("WHISPER_BASE_URL", "https://example.test")
    get_settings.cache_clear()

    def fail(*args, **kwargs):
        raise httpx.ConnectError("https://user:secret-upstream-value@example.test")

    monkeypatch.setattr(httpx, "post", fail)
    with pytest.raises(stt.SttError):
        stt.transcribe(b"audio", "audio.webm", "audio/webm")
    assert "secret-upstream-value" not in caplog.text


def test_mcp_can_clear_due_date(client):
    task = mcp_server.create_task_impl("Dated", due_date="2030-01-01")
    assert mcp_server.update_task_impl(task["id"], due_date="")["due_date"] is None
