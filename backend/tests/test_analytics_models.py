"""Measurement journals: the tables exist and their cascades actually fire (§4, §13.1)."""

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError

from app import db as db_module
from app.models import EstimateBucket, Task, TaskEstimate, TaskEvent, TaskStatus, utcnow
from app.services.projects import get_inbox

# Этот модуль проверяет СЛОЙ МОДЕЛЕЙ и DDL: он создаёт Task напрямую, минуя
# сервисы, и именно в этом его смысл. Сторож §5.4 п.3 справедливо считает такую
# запись непрослеженной, поэтому он снимается на весь модуль. Прогонять _task
# через create_task нельзя: сервис эмиссии не существовал, когда писались эти
# тесты, и каскады/умолчания колонок надо щупать без него.
pytestmark = pytest.mark.usefixtures("untracked_writes_allowed")


def _task(db) -> Task:
    task = Task(project_id=get_inbox(db).id, title="Fix backup", status=TaskStatus.todo)
    db.add(task)
    db.commit()
    return task


def test_create_all_makes_journal_tables(client):
    """`create_all` is the whole migration mechanism: a new table must appear by itself."""
    names = set(inspect(db_module.get_engine()).get_table_names())
    assert {"task_events", "task_estimates"} <= names


def test_journal_columns_and_indexes(client):
    inspector = inspect(db_module.get_engine())

    assert {c["name"] for c in inspector.get_columns("task_events")} == {
        "id",
        "task_id",
        "at",
        "status",
        "project_id",
        "source",
    }
    assert {c["name"] for c in inspector.get_columns("task_estimates")} == {
        "id",
        "task_id",
        "at",
        "bucket",
        "source",
        "before_work",
    }

    assert "ix_task_events_task_id_id" in {i["name"] for i in inspector.get_indexes("task_events")}
    assert "ix_task_estimates_task_id_id" in {
        i["name"] for i in inspector.get_indexes("task_estimates")
    }


def test_foreign_key_checking_is_enabled(client):
    """Guard for the guard: without PRAGMA foreign_keys=ON the cascade test below is
    vacuously green, because SQLite would simply keep the orphaned rows."""
    with db_module.get_session_factory()() as db:
        assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_hard_delete_of_task_cascades_to_both_journals(client):
    """purge_deleted_tasks calls db.delete(task) and _purge_loop swallows exceptions,
    so a restricting FK would kill the daily purge silently and forever (§2.5)."""
    with db_module.get_session_factory()() as db:
        task = _task(db)
        db.add(
            TaskEvent(
                task_id=task.id,
                at=utcnow(),
                status=TaskStatus.in_progress.value,
                project_id=task.project_id,
            )
        )
        db.add(TaskEstimate(task_id=task.id, at=utcnow(), bucket=EstimateBucket.m.value))
        db.commit()

        assert db.scalars(select(TaskEvent).where(TaskEvent.task_id == task.id)).all()
        assert db.scalars(select(TaskEstimate).where(TaskEstimate.task_id == task.id)).all()

        db.delete(task)
        db.commit()

        assert db.scalars(select(TaskEvent).where(TaskEvent.task_id == task.id)).all() == []
        assert db.scalars(select(TaskEstimate).where(TaskEstimate.task_id == task.id)).all() == []


def test_journal_row_without_a_parent_task_is_rejected(client):
    with db_module.get_session_factory()() as db:
        db.add(TaskEvent(task_id=999_999, at=utcnow(), status="todo", project_id=None))
        with pytest.raises(IntegrityError):
            db.commit()


def test_journal_defaults(client):
    """`source` and `before_work` carry their defaults from the column, not the caller."""
    with db_module.get_session_factory()() as db:
        task = _task(db)
        event = TaskEvent(task_id=task.id, at=utcnow(), status="todo", project_id=task.project_id)
        estimate = TaskEstimate(task_id=task.id, at=utcnow(), bucket="")
        db.add_all([event, estimate])
        db.commit()

        assert event.source == "live"
        assert estimate.source == "user"
        assert estimate.before_work is True
