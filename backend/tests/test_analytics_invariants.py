"""Критические инварианты журнала (§13.4): холодный старт, сверка, каскады.

lifespan в тестах НЕ запускается (§13.1), поэтому init_db() вызывается напрямую.
"""

from datetime import timedelta

import pytest
from sqlalchemy import delete, select

from app import db as db_module
from app.bootstrap import init_db
from app.models import EstimateBucket, Task, TaskEstimate, TaskEvent, TaskStatus, utcnow
from app.services import analytics
from app.services import tasks as task_svc


def _events(task_id: int) -> list[TaskEvent]:
    with db_module.get_session_factory()() as db:
        return list(
            db.scalars(select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.id))
        )


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


def _wipe_events(task_id: int | None = None) -> None:
    """Привести БД к предзапусковому состоянию: у задачи нет НИ ОДНОГО события."""
    statement = delete(TaskEvent)
    if task_id is not None:
        statement = statement.where(TaskEvent.task_id == task_id)
    with db_module.get_session_factory()() as db:
        db.execute(statement)
        db.commit()


def test_seed_is_idempotent_and_marks_seeded(auth_client):
    alive = _create(auth_client, title="Живая")
    gone = _create(auth_client, title="Удалённая")
    assert auth_client.delete(f"/api/v1/tasks/{gone['id']}").status_code == 204
    project = auth_client.post("/api/v1/projects", json={"name": "Архив"}).json()
    parked = _create(auth_client, title="В архиве", project_id=project["id"])
    auth_client.patch(f"/api/v1/projects/{project['id']}", json={"archived": True})
    _wipe_events()

    with db_module.get_session_factory()() as db:
        assert analytics.seed_missing_events(db) == 3

    assert [(e.status, e.source) for e in _events(alive["id"])] == [("todo", "seed")]
    assert [(e.status, e.source) for e in _events(gone["id"])] == [("deleted", "seed")]
    assert [(e.status, e.source) for e in _events(parked["id"])] == [("parked", "seed")]

    with db_module.get_session_factory()() as db:
        assert analytics.seed_missing_events(db) == 0
    assert len(_events(alive["id"])) == 1


def test_seed_is_per_task_not_a_global_guard(auth_client):
    """Глобальный сторож отключил бы посев навсегда после первого запуска (§6)."""
    first = _create(auth_client, title="Первая")
    _wipe_events()
    with db_module.get_session_factory()() as db:
        assert analytics.seed_missing_events(db) == 1

    second = _create(auth_client, title="Вторая")
    _wipe_events(second["id"])

    with db_module.get_session_factory()() as db:
        assert analytics.seed_missing_events(db) == 1
    assert [e.source for e in _events(second["id"])] == ["seed"]
    assert [e.source for e in _events(first["id"])] == ["seed"]


def test_reconcile_marks_drift_not_seed(auth_client, untracked_writes_allowed):
    seeded = _create(auth_client, title="Засеянная")
    _wipe_events()
    with db_module.get_session_factory()() as db:
        assert analytics.seed_missing_events(db) == 1

    drifted = _create(auth_client, title="Разошлась")
    with db_module.get_session_factory()() as db:
        task = db.get(Task, drifted["id"])
        assert task is not None
        task.status = TaskStatus.in_progress  # мимо сервиса — сторож снят фикстурой
        db.commit()

    with db_module.get_session_factory()() as db:
        assert analytics.reconcile_all(db) == 1
        assert analytics.reconcile_all(db) == 0

    assert [(e.status, e.source) for e in _events(drifted["id"])] == [
        ("todo", "live"),
        ("in_progress", "drift"),
    ]
    assert [e.source for e in _events(seeded["id"])] == ["seed"]


def test_init_db_seeds_pre_existing_tasks(auth_client):
    """Посев обязан отработать ДО сверки, иначе метка была бы drift, а не seed."""
    task = _create(auth_client, title="До замеров")
    _wipe_events()

    init_db()

    assert [(e.status, e.source) for e in _events(task["id"])] == [("todo", "seed")]


def _set_foreign_keys(enabled: str) -> None:
    """PRAGMA foreign_keys — no-op внутри транзакции, поэтому ставится прямо на
    DBAPI-соединении. StaticPool держит ровно одно соединение на весь тест, так что
    значение действует и в сессиях."""
    raw = db_module.get_engine().raw_connection()
    try:
        raw.driver_connection.execute(f"PRAGMA foreign_keys={enabled}")
        actual = raw.driver_connection.execute("PRAGMA foreign_keys").fetchone()[0]
    finally:
        raw.close()
    assert actual == (1 if enabled == "ON" else 0)


@pytest.mark.parametrize("foreign_keys", ["ON", "OFF"])
def test_purge_cascades_events(auth_client, foreign_keys):
    """Явное удаление обязано работать независимо от каскада БД (§5.3)."""
    task = _create(auth_client, title="Старая")
    auth_client.post(f"/api/v1/tasks/{task['id']}/move", json={"status": "in_progress"})
    with db_module.get_session_factory()() as db:
        analytics.record_estimate(db, task["id"], EstimateBucket.m)
        db.commit()
    assert auth_client.delete(f"/api/v1/tasks/{task['id']}").status_code == 204
    assert len(_events(task["id"])) == 3
    assert len(_estimates(task["id"])) == 1

    _set_foreign_keys(foreign_keys)
    with db_module.get_session_factory()() as db:
        stored = db.get(Task, task["id"])
        assert stored is not None
        stored.deleted_at = utcnow() - timedelta(days=31)
        db.commit()

    with db_module.get_session_factory()() as db:
        assert task_svc.purge_deleted_tasks(db) == 1

    with db_module.get_session_factory()() as db:
        assert db.get(Task, task["id"]) is None
    assert _events(task["id"]) == []
    assert _estimates(task["id"]) == []


@pytest.mark.parametrize("foreign_keys", ["ON", "OFF"])
def test_delete_project_force_destroys_history(auth_client, foreign_keys):
    project = auth_client.post("/api/v1/projects", json={"name": "Homelab"}).json()
    task = _create(auth_client, title="Обновить caddy", project_id=project["id"])
    auth_client.post(f"/api/v1/tasks/{task['id']}/move", json={"status": "in_progress"})
    with db_module.get_session_factory()() as db:
        analytics.record_estimate(db, task["id"], EstimateBucket.l)
        db.commit()
    assert len(_events(task["id"])) == 2

    _set_foreign_keys(foreign_keys)
    response = auth_client.delete(f"/api/v1/projects/{project['id']}?force=true")
    assert response.status_code == 204, response.text

    with db_module.get_session_factory()() as db:
        assert db.get(Task, task["id"]) is None
    assert _events(task["id"]) == []
    assert _estimates(task["id"]) == []
