"""MCP tools are thin wrappers over *_impl functions; test the impls directly
plus the transport-level token gate."""

from app import mcp_server


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
