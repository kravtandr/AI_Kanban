"""Критические инварианты журнала (§13.4): холодный старт, сверка, каскады.

lifespan в тестах НЕ запускается (§13.1), поэтому init_db() вызывается напрямую.
"""

from sqlalchemy import delete, select

from app import db as db_module
from app.bootstrap import init_db
from app.models import Task, TaskEstimate, TaskEvent, TaskStatus
from app.services import analytics


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
