"""MCP tools are thin wrappers over *_impl functions; test the impls directly
plus the transport-level token gate."""

from app import db as db_module
from app import mcp_server
from app.models import Task
from app.schemas import TaskDraft
from app.services import ai as ai_svc


def test_mcp_endpoint_requires_token(client):
    # Both with and without the trailing slash: no 307 bounce, straight to 401.
    assert client.post("/mcp", json={}).status_code == 401
    assert client.post("/mcp/", json={}).status_code == 401


def test_create_and_list(client):
    task = mcp_server.create_task_impl(title="Refactor auth", priority="high")
    assert task["source"] == "mcp"
    assert task["priority"] == "high"

    tasks = mcp_server.list_tasks_impl(query="refactor")
    assert [t["id"] for t in tasks] == [task["id"]]


def test_move_and_complete(client):
    task = mcp_server.create_task_impl(title="Ship it")
    moved = mcp_server.move_task_impl(task["id"], "in_progress")
    assert moved["status"] == "in_progress"
    done = mcp_server.complete_task_impl(task["id"])
    assert done["status"] == "done"
    assert done["completed_at"] is not None


def test_project_routing(client, auth_client):
    auth_client.post("/api/v1/projects", json={"name": "Homelab"})
    task = mcp_server.create_task_impl(title="Update caddy", project="Homelab")
    projects = {p["name"]: p["id"] for p in mcp_server.list_projects_impl()}
    assert task["project_id"] == projects["Homelab"]

    unknown = mcp_server.create_task_impl(title="Mystery", project="Nope")
    assert unknown["project_id"] == projects["Inbox"]


def test_daily_summary(client):
    task = mcp_server.create_task_impl(title="Morning task")
    mcp_server.complete_task_impl(task["id"])
    summary = mcp_server.daily_summary_impl()
    assert any(row["id"] == task["id"] for row in summary["completed"])


def test_delete(client):
    task = mcp_server.create_task_impl(title="Temp")
    assert mcp_server.delete_task_impl(task["id"])["ok"] is True
    assert mcp_server.list_tasks_impl(query="Temp") == []


def test_update_truncates_long_title(client):
    task = mcp_server.create_task_impl(title="Short")
    updated = mcp_server.update_task_impl(task["id"], title="  " + "x" * 300)
    assert updated["title"] == "x" * 200


def test_tag_filter_sees_past_the_sql_limit(client):
    """Python-side filters must apply before the limit, not after a SQL LIMIT."""
    limit = 50
    for i in range(limit + 5):
        mcp_server.create_task_impl(title=f"Filler {i}")
    tagged = mcp_server.create_task_impl(title="Needle", tags=["needle"])
    tasks = mcp_server.list_tasks_impl(tag="needle", limit=limit)
    assert [t["id"] for t in tasks] == [tagged["id"]]


def test_auto_format_keeps_original_source_text(client, monkeypatch):
    """FR-3.1: ai_meta stores the agent's original text, model and timestamp."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    def fake_call(system: str, user_message: str):
        return TaskDraft(title="Rewritten title"), 10, 5

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)

    task = mcp_server.create_task_impl(title="сырой текст заметки", auto_format=True)
    assert task["title"] == "Rewritten title"
    with db_module.get_session_factory()() as db:
        stored = db.get(Task, task["id"])
        assert stored is not None and stored.ai_meta is not None
        assert stored.ai_meta["source_text"] == "сырой текст заметки"
        assert stored.ai_meta["model"] == "claude-opus-4-8"
        assert stored.ai_meta["timestamp"]

    get_settings.cache_clear()


def test_explicit_agent_project_is_never_auto_created(client, monkeypatch):
    """An explicitly passed unknown project must not be auto-created, even if
    the LLM echoes the same name; the task falls back to Inbox."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    def fake_call(system: str, user_message: str):
        return TaskDraft(title="Fix it", project="Ghost", project_description="spooky"), 10, 5

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)

    task = mcp_server.create_task_impl(title="fix it", project="Ghost", auto_format=True)
    projects = {p["name"]: p["id"] for p in mcp_server.list_projects_impl()}
    assert "Ghost" not in projects
    assert task["project_id"] == projects["Inbox"]

    get_settings.cache_clear()
