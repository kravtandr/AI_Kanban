from sqlalchemy import select

from app import db as db_module
from app.models import Project
from app.services import projects as project_svc


def test_inbox_exists(auth_client):
    projects = auth_client.get("/api/v1/projects").json()
    assert any(p["is_inbox"] for p in projects)


def test_create_and_duplicate(auth_client):
    response = auth_client.post("/api/v1/projects", json={"name": "Homelab", "color": "#22c55e"})
    assert response.status_code == 201
    assert auth_client.post("/api/v1/projects", json={"name": "homelab"}).status_code == 409


def test_automatic_project_colors_are_distinct(auth_client):
    first = auth_client.post("/api/v1/projects", json={"name": "First"}).json()
    second = auth_client.post("/api/v1/projects", json={"name": "Second"}).json()

    assert first["color"] != "#6b7280"
    assert second["color"] != "#6b7280"
    assert first["color"] != second["color"]


def test_duplicate_explicit_color_falls_back_to_free_palette_color(auth_client):
    first = auth_client.post("/api/v1/projects", json={"name": "First", "color": "#22c55e"}).json()
    second = auth_client.post(
        "/api/v1/projects", json={"name": "Second", "color": "#22c55e"}
    ).json()

    assert first["color"] == "#22c55e"
    assert second["color"] != first["color"]


def test_legacy_default_and_duplicate_colors_are_reassigned(client):
    with db_module.get_session_factory()() as db:
        db.add_all(
            [
                Project(name="Legacy gray", color="#6b7280"),
                Project(name="First purple", color="#c084fc"),
                Project(name="Second purple", color="#c084fc"),
            ]
        )
        db.commit()

        project_svc.ensure_unique_project_colors(db)
        projects = list(
            db.scalars(select(Project).where(Project.is_inbox.is_(False)).order_by(Project.id))
        )

    colors = [project.color for project in projects]
    assert "#6b7280" not in colors
    assert len(colors) == len(set(colors))
    assert projects[1].color == "#c084fc"


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
