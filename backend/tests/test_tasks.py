def _create(auth_client, **overrides):
    body = {"title": "Fix backup", **overrides}
    response = auth_client.post("/api/v1/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_defaults_to_inbox(auth_client):
    task = _create(auth_client)
    inbox = next(p for p in auth_client.get("/api/v1/projects").json() if p["is_inbox"])
    assert task["project_id"] == inbox["id"]
    assert task["status"] == "todo"


def test_move_sets_completed_at(auth_client):
    task = _create(auth_client)
    moved = auth_client.post(f"/api/v1/tasks/{task['id']}/move", json={"status": "done"}).json()
    assert moved["status"] == "done"
    assert moved["completed_at"] is not None
    reopened = auth_client.post(
        f"/api/v1/tasks/{task['id']}/move", json={"status": "in_progress"}
    ).json()
    assert reopened["completed_at"] is None


def test_filters(auth_client):
    project = auth_client.post("/api/v1/projects", json={"name": "Work"}).json()
    _create(
        auth_client, title="Deploy caddy", project_id=project["id"], priority="high", tags=["infra"]
    )
    _create(auth_client, title="Buy milk")

    by_project = auth_client.get(f"/api/v1/tasks?project_id={project['id']}").json()
    assert [t["title"] for t in by_project] == ["Deploy caddy"]

    by_query = auth_client.get("/api/v1/tasks?q=caddy").json()
    assert len(by_query) == 1

    by_tag = auth_client.get("/api/v1/tasks?tag=infra").json()
    assert len(by_tag) == 1

    by_priority = auth_client.get("/api/v1/tasks?priority=high").json()
    assert len(by_priority) == 1


def test_patch(auth_client):
    task = _create(auth_client)
    patched = auth_client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"title": "Fix NAS backup", "priority": "urgent", "due_date": "2026-08-01"},
    ).json()
    assert patched["title"] == "Fix NAS backup"
    assert patched["priority"] == "urgent"
    assert patched["due_date"] == "2026-08-01"


def test_soft_delete(auth_client):
    task = _create(auth_client)
    assert auth_client.delete(f"/api/v1/tasks/{task['id']}").status_code == 204
    assert auth_client.get(f"/api/v1/tasks/{task['id']}").status_code == 404
    assert all(t["id"] != task["id"] for t in auth_client.get("/api/v1/tasks").json())
