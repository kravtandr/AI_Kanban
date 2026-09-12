"""Эмиссия событий состояния (§5.1, §5.2).

Проверяется факт строки, её `status` и `project_id`, но НИКОГДА значение метки
времени: метка — аргумент эмиттера, а не показание часов (§13 п.4).
"""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app import db as db_module
from app import mcp_server
from app.models import EstimateBucket, Task, TaskEstimate, TaskEvent, TaskStatus
from app.services import analytics


def _events(task_id: int) -> list[TaskEvent]:
    with db_module.get_session_factory()() as db:
        return list(
            db.scalars(select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.id))
        )


def _statuses(task_id: int) -> list[str]:
    return [event.status for event in _events(task_id)]


def _estimates(task_id: int) -> list[TaskEstimate]:
    with db_module.get_session_factory()() as db:
        return list(
            db.scalars(
                select(TaskEstimate)
                .where(TaskEstimate.task_id == task_id)
                .order_by(TaskEstimate.id)
            )
        )


def _create(auth_client, **overrides) -> dict:
    body = {"title": "Fix backup", **overrides}
    response = auth_client.post("/api/v1/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()


# Три пути смены статуса из шести точек входа §2.4. Оставшиеся три —
# рождение (POST /tasks, create_task_impl) и complete_task_impl — ниже
# отдельными тестами: у них нет параметра «в какую колонку».
MOVE_PATHS = {
    "rest_move": lambda ac, task_id, status: ac.post(
        f"/api/v1/tasks/{task_id}/move", json={"status": status}
    ),
    "rest_patch": lambda ac, task_id, status: ac.patch(
        f"/api/v1/tasks/{task_id}", json={"status": status}
    ),
    "mcp_move": lambda ac, task_id, status: mcp_server.move_task_impl(task_id, status),
}


@pytest.mark.parametrize("status", ["backlog", "todo", "in_progress", "done"])
def test_birth_is_recorded_for_every_status(auth_client, status):
    task = _create(auth_client, status=status)
    events = _events(task["id"])
    assert [event.status for event in events] == [status]
    assert events[0].source == "live"
    assert events[0].project_id == task["project_id"]


@pytest.mark.parametrize("path", sorted(MOVE_PATHS))
def test_status_change_is_recorded_on_every_path(auth_client, path):
    task = _create(auth_client)
    MOVE_PATHS[path](auth_client, task["id"], "in_progress")
    MOVE_PATHS[path](auth_client, task["id"], "done")
    assert _statuses(task["id"]) == ["todo", "in_progress", "done"]


def test_mcp_create_records_birth(client):
    task = mcp_server.create_task_impl(title="Refactor auth")
    assert _statuses(task["id"]) == ["todo"]


def test_mcp_complete_records_done(client):
    task = mcp_server.create_task_impl(title="Ship it")
    mcp_server.complete_task_impl(task["id"])
    assert _statuses(task["id"]) == ["todo", "done"]


def test_mcp_update_without_status_writes_no_event(client):
    task = mcp_server.create_task_impl(title="Ship it")
    mcp_server.update_task_impl(task["id"], title="Ship it now")
    assert _statuses(task["id"]) == ["todo"]


def test_patch_without_status_writes_no_event(auth_client):
    task = _create(auth_client)
    auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"title": "Fix NAS backup"})
    assert _statuses(task["id"]) == ["todo"]


def test_repeated_move_to_the_same_column_writes_one_event(auth_client):
    task = _create(auth_client)
    for _ in range(3):
        auth_client.post(f"/api/v1/tasks/{task['id']}/move", json={"status": "in_progress"})
    assert _statuses(task["id"]) == ["todo", "in_progress"]


def test_project_change_writes_a_snapshot_event(auth_client):
    project = auth_client.post("/api/v1/projects", json={"name": "Homelab"}).json()
    task = _create(auth_client)
    auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"project_id": project["id"]})
    events = _events(task["id"])
    assert [event.status for event in events] == ["todo", "todo"]
    assert [event.project_id for event in events] == [task["project_id"], project["id"]]


def test_soft_delete_closes_the_interval(auth_client):
    task = _create(auth_client)
    auth_client.post(f"/api/v1/tasks/{task['id']}/move", json={"status": "in_progress"})
    assert auth_client.delete(f"/api/v1/tasks/{task['id']}").status_code == 204
    assert _statuses(task["id"]) == ["todo", "in_progress", "deleted"]


def test_archiving_a_project_parks_its_tasks(auth_client):
    project = auth_client.post("/api/v1/projects", json={"name": "Homelab"}).json()
    task = _create(auth_client, project_id=project["id"])
    auth_client.post(f"/api/v1/tasks/{task['id']}/move", json={"status": "in_progress"})

    auth_client.patch(f"/api/v1/projects/{project['id']}", json={"archived": True})
    assert _statuses(task["id"]) == ["todo", "in_progress", "parked"]

    auth_client.patch(f"/api/v1/projects/{project['id']}", json={"archived": False})
    assert _statuses(task["id"]) == ["todo", "in_progress", "parked", "in_progress"]


def test_record_state_is_idempotent(auth_client):
    task = _create(auth_client)
    with db_module.get_session_factory()() as db:
        stored = db.get(Task, task["id"])
        assert stored is not None
        assert analytics.record_state(db, stored) is False
        db.commit()
    assert _statuses(task["id"]) == ["todo"]


def test_record_estimate_bounds_before_work_by_the_supplied_at(auth_client):
    """Отбор событий ограничен `at`, а не «что вообще лежит в журнале» (§5.1).

    Оценка, записанная задним числом ДО первого in_progress, обязана остаться
    прогнозом; записанная после — ревизией.
    """
    task = _create(auth_client)
    auth_client.post(f"/api/v1/tasks/{task['id']}/move", json={"status": "in_progress"})
    started = _events(task["id"])[-1].at

    with db_module.get_session_factory()() as db:
        analytics.record_estimate(db, task["id"], EstimateBucket.m, at=started - timedelta(hours=1))
        analytics.record_estimate(db, task["id"], EstimateBucket.l, at=started + timedelta(hours=1))
        db.commit()

    rows = _estimates(task["id"])
    assert [(row.bucket, row.before_work) for row in rows] == [("M", True), ("L", False)]
    assert [row.source for row in rows] == ["user", "user"]


def test_record_estimate_writes_a_tombstone(auth_client):
    task = _create(auth_client)
    with db_module.get_session_factory()() as db:
        analytics.record_estimate(db, task["id"], EstimateBucket.s, source="ai")
        analytics.record_estimate(db, task["id"], None)
        db.commit()
    rows = _estimates(task["id"])
    assert [(row.bucket, row.source) for row in rows] == [("S", "ai"), ("", "user")]


def test_state_guard_holds_after_commit(auth_client):
    """Сторож §5.4 п.3 не роняет ни одну врезку §5.2, но ловит обход сервиса."""
    task = _create(auth_client)
    auth_client.post(f"/api/v1/tasks/{task['id']}/move", json={"status": "in_progress"})
    auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"title": "Fix NAS backup"})

    with pytest.raises(AssertionError, match="untracked write"):
        with db_module.get_session_factory()() as db:
            stored = db.get(Task, task["id"])
            assert stored is not None
            stored.status = TaskStatus.done  # мимо сервиса: события не будет
            db.commit()


def test_missed_emitter_call_heals_on_the_next_mutation(auth_client, untracked_writes_allowed):
    """§3.1: забытый вызов эмиттера не теряет переход, а лишь сдвигает метку."""
    task = _create(auth_client)
    with db_module.get_session_factory()() as db:
        stored = db.get(Task, task["id"])
        assert stored is not None
        stored.status = TaskStatus.in_progress  # обход сервиса — сторож снят фикстурой
        db.commit()
    assert _statuses(task["id"]) == ["todo"]

    auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"title": "Fix NAS backup"})
    assert _statuses(task["id"]) == ["todo", "in_progress"]
