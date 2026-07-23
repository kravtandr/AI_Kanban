from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Project, Task, TaskPriority, TaskSource, TaskStatus, utcnow
from app.services.projects import get_inbox


class TaskError(Exception):
    pass


DONE_WINDOW_DAYS = 14
PURGE_DELETED_AFTER_DAYS = 30


def list_tasks(
    db: Session,
    *,
    project_ids: list[int] | None = None,
    status: TaskStatus | None = None,
    priority: TaskPriority | None = None,
    tag: str | None = None,
    query: str | None = None,
    all_done: bool = False,
    limit: int = 500,
) -> list[Task]:
    # No SQL LIMIT here: the tag/done-window filters below run in Python, so
    # limiting early would drop matching rows. Single-user scale, acceptable.
    q = (
        select(Task)
        .join(Project)
        .where(Task.deleted_at.is_(None), Project.archived_at.is_(None))
        .order_by(Task.sort_order, Task.created_at.desc())
    )
    if project_ids:
        q = q.where(Task.project_id.in_(project_ids))
    if status is not None:
        q = q.where(Task.status == status)
    if priority is not None:
        q = q.where(Task.priority == priority)
    if query:
        pattern = f"%{query.lower()}%"
        q = q.where(
            or_(func.lower(Task.title).like(pattern), func.lower(Task.description).like(pattern))
        )
    tasks = list(db.scalars(q))
    if tag:
        tasks = [t for t in tasks if tag in (t.tags or [])]
    if not all_done:
        cutoff = utcnow() - timedelta(days=DONE_WINDOW_DAYS)
        tasks = [
            t
            for t in tasks
            if t.status != TaskStatus.done or (t.completed_at and t.completed_at >= cutoff)
        ]
    return tasks[:limit]


def get_task(db: Session, task_id: int) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise TaskError("Task not found")
    return task


def _next_sort_order(db: Session, status: TaskStatus) -> int:
    current = db.scalar(
        select(func.max(Task.sort_order)).where(Task.status == status, Task.deleted_at.is_(None))
    )
    return (current or 0) + 1


def create_task(
    db: Session,
    *,
    title: str,
    description: str = "",
    project_id: int | None = None,
    status: TaskStatus = TaskStatus.todo,
    priority: TaskPriority = TaskPriority.medium,
    tags: list[str] | None = None,
    due_date: date | None = None,
    source: TaskSource = TaskSource.manual,
    ai_meta: dict | None = None,
) -> Task:
    if project_id is None:
        project_id = get_inbox(db).id
    elif db.get(Project, project_id) is None:
        raise TaskError("Project not found")
    task = Task(
        title=title[:200],
        description=description,
        project_id=project_id,
        status=status,
        priority=priority,
        tags=tags or [],
        due_date=due_date,
        source=source,
        ai_meta=ai_meta,
        sort_order=_next_sort_order(db, status),
    )
    if status == TaskStatus.done:
        task.completed_at = utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task(db: Session, task_id: int, **fields) -> Task:
    task = get_task(db, task_id)
    if "project_id" in fields and fields["project_id"] is not None:
        if db.get(Project, fields["project_id"]) is None:
            raise TaskError("Project not found")
        task.project_id = fields["project_id"]
    for name in ("title", "description", "priority", "tags", "due_date"):
        if name in fields and fields[name] is not None:
            value = fields[name]
            if name == "title":  # same normalisation as create_task; DB column is String(200)
                value = value.strip()[:200] or task.title
            setattr(task, name, value)
    if fields.get("clear_due_date"):
        task.due_date = None
    if fields.get("status") is not None:
        _apply_status(db, task, fields["status"])
    db.commit()
    db.refresh(task)
    return task


def _apply_status(
    db: Session, task: Task, status: TaskStatus, sort_order: int | None = None
) -> None:
    if status != task.status:
        task.status = status
        task.completed_at = utcnow() if status == TaskStatus.done else None
        task.sort_order = sort_order if sort_order is not None else _next_sort_order(db, status)
    elif sort_order is not None:
        task.sort_order = sort_order


def move_task(db: Session, task_id: int, status: TaskStatus, sort_order: int | None = None) -> Task:
    task = get_task(db, task_id)
    _apply_status(db, task, status, sort_order)
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, task_id: int) -> None:
    task = get_task(db, task_id)
    task.deleted_at = utcnow()
    db.commit()


def purge_deleted_tasks(db: Session) -> int:
    """Hard-delete tasks soft-deleted more than PURGE_DELETED_AFTER_DAYS ago (NFR-4)."""
    cutoff = utcnow() - timedelta(days=PURGE_DELETED_AFTER_DAYS)
    stale = list(
        db.scalars(select(Task).where(Task.deleted_at.is_not(None), Task.deleted_at < cutoff))
    )
    for task in stale:
        db.delete(task)
    db.commit()
    return len(stale)


def _local_timezone() -> ZoneInfo:
    try:
        return ZoneInfo(get_settings().timezone)
    except Exception:  # invalid IANA name: fall back rather than break summaries
        return ZoneInfo("UTC")


def daily_summary(db: Session, day: date | None = None) -> dict:
    # "Today" is interpreted in the configured timezone; completed_at is stored
    # as naive UTC, so convert the local-day boundaries to naive UTC to compare.
    tz = _local_timezone()
    day = day or datetime.now(tz).date()
    local_start = datetime(day.year, day.month, day.day, tzinfo=tz)
    day_start = local_start.astimezone(UTC).replace(tzinfo=None)
    day_end = (local_start + timedelta(days=1)).astimezone(UTC).replace(tzinfo=None)
    base = (
        select(Task).join(Project).where(Task.deleted_at.is_(None), Project.archived_at.is_(None))
    )

    def rows(q) -> list[dict]:
        return [
            {
                "id": t.id,
                "title": t.title,
                "project": t.project.name,
                "priority": t.priority.value,
                "due_date": t.due_date.isoformat() if t.due_date else None,
            }
            for t in db.scalars(q)
        ]

    return {
        "date": day.isoformat(),
        "completed": rows(base.where(Task.completed_at >= day_start, Task.completed_at < day_end)),
        "in_progress": rows(base.where(Task.status == TaskStatus.in_progress)),
        "overdue": rows(
            base.where(
                Task.status != TaskStatus.done, Task.due_date.is_not(None), Task.due_date < day
            )
        ),
    }
