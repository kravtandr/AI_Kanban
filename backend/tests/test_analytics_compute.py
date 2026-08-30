"""Read path: analytics.compute() and GET /api/v1/analytics (§7, §10.1).

The journal is written by hand with explicit timestamps: `at` is an argument,
never a moved clock (§13).
"""

from datetime import datetime, timedelta

from sqlalchemy import delete

from app import db as db_module
from app.models import (
    EVENT_STATUS_DELETED,
    EVENT_STATUS_PARKED,
    EstimateBucket,
    Task,
    TaskEvent,
    TaskStatus,
    utcnow,
)
from app.services import analytics as analytics_svc
from app.services import projects as project_svc
from app.services import tasks as task_svc

NOW = datetime(2026, 8, 29, 12, 0, 0)


def _session():
    return db_module.get_session_factory()()


def _journal(
    db,
    task: Task,
    entries: list[tuple[datetime, str, int]],
    source: str = "live",
) -> None:
    """Replace the task's journal with an exact history.

    create_task writes a birth event stamped utcnow(); no test may depend on that
    stamp, so it is dropped and the history is written explicitly.
    """
    db.execute(delete(TaskEvent).where(TaskEvent.task_id == task.id))
    for at, status, project_id in entries:
        db.add(
            TaskEvent(task_id=task.id, at=at, status=status, project_id=project_id, source=source)
        )
    db.flush()


def _corpus_board(db, project_id: int, count: int = 5) -> None:
    """`count` finished tasks: forecast M, exactly 4h of measured work, 100 days ago.

    The estimate is stamped an hour BEFORE the first in_progress event, so
    record_estimate freezes before_work=True: it selects events with
    `TaskEvent.at <= at`, not "whatever is already in the table" (§5.1).
    """
    start = NOW - timedelta(days=100)
    for index in range(count):
        task = task_svc.create_task(db, title=f"Задача {index}")
        _journal(
            db,
            task,
            [
                (start, TaskStatus.in_progress.value, project_id),
                (start + timedelta(hours=4), TaskStatus.done.value, project_id),
            ],
        )
        analytics_svc.record_estimate(db, task.id, EstimateBucket.m, at=start - timedelta(hours=1))
    db.commit()


def test_analytics_requires_auth(client):
    assert client.get("/api/v1/analytics").status_code == 401


def test_window_clips_retro_sums(auth_client):
    with _session() as db:
        project_id = project_svc.create_project(db, "Alpha").id
        _corpus_board(db, project_id)
        narrow = analytics_svc.compute(db, days=7, now=NOW)
        wide = analytics_svc.compute(db, days=365, now=NOW)

    assert narrow.closed_minutes == 0
    assert wide.closed_minutes == 5 * 240
    assert narrow.coverage.window_days == 7


def test_calibration_ignores_window(auth_client):
    with _session() as db:
        project_id = project_svc.create_project(db, "Alpha").id
        _corpus_board(db, project_id)
        narrow = analytics_svc.compute(db, days=7, now=NOW)
        wide = analytics_svc.compute(db, days=365, now=NOW)

    assert [b.model_dump() for b in narrow.buckets] == [b.model_dump() for b in wide.buckets]
    assert narrow.board_factor == wide.board_factor == 2.0
    assert narrow.coverage.corpus_size == wide.coverage.corpus_size == 5
    calibrated = next(b for b in wide.buckets if b.bucket == "M")
    assert (calibrated.minutes, calibrated.samples, calibrated.calibrated) == (240, 5, True)


def test_stuck_only_lists_open_board_statuses(auth_client):
    long_ago = NOW - timedelta(days=400)
    statuses = (
        TaskStatus.backlog.value,
        TaskStatus.todo.value,
        TaskStatus.in_progress.value,
        TaskStatus.done.value,
        EVENT_STATUS_PARKED,
        EVENT_STATUS_DELETED,
    )
    with _session() as db:
        inbox = project_svc.get_inbox(db).id
        ids = {}
        for status in statuses:
            task = task_svc.create_task(db, title=f"Задача {status}")
            _journal(db, task, [(long_ago, status, inbox)])
            ids[status] = task.id
        db.commit()
        out = analytics_svc.compute(db, days=30, now=NOW)

    assert {s.status for s in out.stuck} == {"backlog", "todo", "in_progress"}
    assert {s.task_id for s in out.stuck} == {ids["backlog"], ids["todo"], ids["in_progress"]}
    assert all(s.days > 399 for s in out.stuck)


def test_project_minutes_sum_to_board_minutes(auth_client):
    """Two segments of 90s each: round(1.5) + round(1.5) == 4, not round(180/60) == 3."""
    start = NOW - timedelta(hours=1)
    with _session() as db:
        alpha = project_svc.create_project(db, "Alpha").id
        beta = project_svc.create_project(db, "Beta").id
        first = task_svc.create_task(db, title="A")
        second = task_svc.create_task(db, title="B")
        _journal(
            db,
            first,
            [
                (start, TaskStatus.in_progress.value, alpha),
                (start + timedelta(seconds=90), TaskStatus.done.value, alpha),
            ],
        )
        _journal(
            db,
            second,
            [
                (start, TaskStatus.in_progress.value, beta),
                (start + timedelta(seconds=90), TaskStatus.done.value, beta),
            ],
        )
        db.commit()
        out = analytics_svc.compute(db, days=30, now=NOW)

    assert sorted(p.closed_minutes for p in out.projects) == [2, 2]
    assert out.closed_minutes == 4
    assert out.closed_minutes == sum(p.closed_minutes for p in out.projects)


def test_orphaned_project_snapshot_renders_without_500(auth_client):
    base = utcnow()
    with _session() as db:
        old = project_svc.create_project(db, "Старый").id
        new = project_svc.create_project(db, "Новый").id
        task = task_svc.create_task(db, title="Переехавшая", project_id=old)
        _journal(
            db,
            task,
            [
                (base - timedelta(hours=2), TaskStatus.in_progress.value, old),
                (base - timedelta(hours=1), TaskStatus.todo.value, old),
            ],
        )
        db.commit()
        task_id = task.id

    moved = auth_client.patch(f"/api/v1/tasks/{task_id}", json={"project_id": new})
    assert moved.status_code == 200, moved.text
    assert auth_client.delete(f"/api/v1/projects/{old}").status_code == 204

    response = auth_client.get("/api/v1/analytics?days=30")
    assert response.status_code == 200, response.text
    payload = response.json()
    orphan = next(p for p in payload["projects"] if p["project_id"] == old)
    assert orphan["project"] == "проект удалён"
    assert orphan["color"] == "#6b7280"
    assert orphan["closed_minutes"] == 60
    assert payload["closed_minutes"] == sum(p["closed_minutes"] for p in payload["projects"])


def test_recent_examples_are_corpus_observations_only(auth_client):
    start = NOW - timedelta(days=10)
    with _session() as db:
        project_id = project_svc.create_project(db, "Alpha").id
        live = task_svc.create_task(db, title="Настроить бэкап")
        _journal(
            db,
            live,
            [
                (start, TaskStatus.in_progress.value, project_id),
                (start + timedelta(hours=2), TaskStatus.done.value, project_id),
            ],
        )
        analytics_svc.record_estimate(db, live.id, EstimateBucket.m, at=start - timedelta(hours=1))
        seeded = task_svc.create_task(db, title="Досеянная")
        _journal(
            db,
            seeded,
            [
                (start, TaskStatus.in_progress.value, project_id),
                (start + timedelta(hours=2), TaskStatus.done.value, project_id),
            ],
            source="seed",
        )
        analytics_svc.record_estimate(
            db, seeded.id, EstimateBucket.l, at=start - timedelta(hours=1)
        )
        db.commit()
        examples = analytics_svc.recent_finished_examples(db, limit=6)

    assert examples == [("Настроить бэкап", "Alpha", "M", 120)]
