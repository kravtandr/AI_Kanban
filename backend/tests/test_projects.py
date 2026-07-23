def test_inbox_exists(auth_client):
    projects = auth_client.get("/api/v1/projects").json()
    assert any(p["is_inbox"] for p in projects)


def test_create_and_duplicate(auth_client):
    response = auth_client.post("/api/v1/projects", json={"name": "Homelab", "color": "#22c55e"})
    assert response.status_code == 201
    assert auth_client.post("/api/v1/projects", json={"name": "homelab"}).status_code == 409


def test_archive_and_unarchive(auth_client):
    project = auth_client.post("/api/v1/projects", json={"name": "Old"}).json()
    response = auth_client.patch(f"/api/v1/projects/{project['id']}", json={"archived": True})
    assert response.json()["archived_at"] is not None
    assert all(p["id"] != project["id"] for p in auth_client.get("/api/v1/projects").json())


def test_inbox_protected(auth_client):
    inbox = next(p for p in auth_client.get("/api/v1/projects").json() if p["is_inbox"])
    assert (
        auth_client.patch(f"/api/v1/projects/{inbox['id']}", json={"archived": True}).status_code
        == 400
    )
    assert auth_client.delete(f"/api/v1/projects/{inbox['id']}").status_code == 400


def test_delete_with_tasks_requires_force(auth_client):
    project = auth_client.post("/api/v1/projects", json={"name": "Temp"}).json()
    auth_client.post("/api/v1/tasks", json={"title": "t", "project_id": project["id"]})
    assert auth_client.delete(f"/api/v1/projects/{project['id']}").status_code == 400
    assert auth_client.delete(f"/api/v1/projects/{project['id']}?force=true").status_code == 204
