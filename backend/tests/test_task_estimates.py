"""Estimate on the write path: TaskIn/TaskPatch/TaskOut round trip (§9.1, §13.5)."""

from sqlalchemy import select

from app import db as db_module
from app.models import TaskEstimate


def _create(auth_client, **overrides):
    body = {"title": "Починить бэкап", **overrides}
    response = auth_client.post("/api/v1/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _estimate_rows(task_id: int) -> list[tuple[str, str, bool]]:
    with db_module.get_session_factory()() as db:
        rows = db.scalars(
            select(TaskEstimate).where(TaskEstimate.task_id == task_id).order_by(TaskEstimate.id)
        ).all()
        return [(r.bucket, r.source, r.before_work) for r in rows]


def test_estimate_round_trips_through_post_patch_and_move(auth_client):
    task = _create(auth_client, estimate="M")
    assert task["estimate"] == "M"  # ответ POST несёт оценку, а не null

    listed = auth_client.get("/api/v1/tasks").json()
    assert [t["estimate"] for t in listed if t["id"] == task["id"]] == ["M"]

    patched = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"estimate": "L"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["estimate"] == "L"

    moved = auth_client.post(f"/api/v1/tasks/{task['id']}/move", json={"status": "in_progress"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["estimate"] == "L"


def test_clear_estimate_empties_it(auth_client):
    task = _create(auth_client, estimate="M")

    cleared = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"clear_estimate": True})

    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["estimate"] is None
    assert _estimate_rows(task["id"]) == [("M", "user", True), ("", "user", True)]


def test_clear_estimate_wins_over_a_value_sent_together(auth_client):
    task = _create(auth_client, estimate="M")

    cleared = auth_client.patch(
        f"/api/v1/tasks/{task['id']}", json={"estimate": "L", "clear_estimate": True}
    )

    assert cleared.json()["estimate"] is None


def test_estimate_provenance_comes_from_the_task_source(auth_client):
    from_ai = _create(auth_client, estimate="S", source="ai")
    assert _estimate_rows(from_ai["id"]) == [("S", "ai", True)]

    by_hand = _create(auth_client, estimate="S")
    auth_client.patch(f"/api/v1/tasks/{by_hand['id']}", json={"estimate": "L"})
    assert _estimate_rows(by_hand["id"]) == [("S", "user", True), ("L", "user", True)]


def test_estimate_given_at_birth_of_a_started_task_is_a_forecast(auth_client):
    """POST {"status":"in_progress","estimate":"M"} — one click from the "+" in a
    column. record_estimate runs BEFORE record_state, so before_work stays True."""
    task = _create(auth_client, estimate="M", status="in_progress")

    assert _estimate_rows(task["id"]) == [("M", "user", True)]


def test_unknown_project_still_yields_400(auth_client):
    response = auth_client.post(
        "/api/v1/tasks", json={"title": "Починить бэкап", "project_id": 9999}
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "bad_request"


def test_task_without_estimate_reports_null(auth_client):
    task = _create(auth_client)

    assert task["estimate"] is None
    assert _estimate_rows(task["id"]) == []


def test_get_by_id_reports_the_estimate(auth_client):
    """GET /tasks/{id} must go through the same _out() as every other endpoint
    (§9.1): TaskOut.estimate defaults to None and Task has no such attribute,
    so skipping _out silently reports null even when an estimate was set."""
    task = _create(auth_client, estimate="M")

    fetched = auth_client.get(f"/api/v1/tasks/{task['id']}")

    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["estimate"] == "M"
