from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Project, Task, TaskStatus, utcnow

DEFAULT_PROJECT_COLOR = "#6b7280"
PROJECT_COLORS = [
    "#f59e0b",
    "#38bdf8",
    "#a78bfa",
    "#34d399",
    "#fb7185",
    "#fbbf24",
    "#2dd4bf",
    "#c084fc",
    "#f97316",
    "#0ea5e9",
    "#8b5cf6",
    "#10b981",
    "#f43f5e",
    "#eab308",
    "#14b8a6",
    "#d946ef",
]


class ProjectError(Exception):
    pass


def get_inbox(db: Session) -> Project:
    inbox = db.scalar(select(Project).where(Project.is_inbox.is_(True)))
    if inbox is None:
        inbox = Project(name="Inbox", color="#64748b", is_inbox=True)
        db.add(inbox)
        try:
            db.commit()
        except IntegrityError:  # lost a create race (projects.name is unique)
            db.rollback()
            inbox = db.scalar(select(Project).where(Project.is_inbox.is_(True)))
            if inbox is None:  # unique clash on the name without an inbox flag
                raise ProjectError("Inbox project is missing") from None
    return inbox


def list_projects(db: Session, include_archived: bool = False) -> list[tuple[Project, int]]:
    q = select(Project).order_by(Project.is_inbox.desc(), Project.name)
    if not include_archived:
        q = q.where(Project.archived_at.is_(None))
    projects = list(db.scalars(q))
    counts: dict[int, int] = {
        project_id: count
        for project_id, count in db.execute(
            select(Task.project_id, func.count(Task.id))
            .where(Task.deleted_at.is_(None), Task.status != TaskStatus.done)
            .group_by(Task.project_id)
        ).all()
    }
    return [(p, counts.get(p.id, 0)) for p in projects]


def _next_project_color(
    db: Session, preferred: str | None = None, *, exclude_project_id: int | None = None
) -> str:
    """Return a distinct project color while the shared palette has capacity."""
    q = select(Project.color)
    if exclude_project_id is not None:
        q = q.where(Project.id != exclude_project_id)
    used = set(db.scalars(q))
    if preferred and preferred != DEFAULT_PROJECT_COLOR and preferred not in used:
        return preferred
    for candidate in PROJECT_COLORS:
        if candidate not in used:
            return candidate
    # More projects than palette entries: preserve an explicit choice, otherwise
    # cycle predictably. At this point a repeated color is unavoidable.
    return preferred or PROJECT_COLORS[len(used) % len(PROJECT_COLORS)]


def ensure_unique_project_colors(db: Session) -> None:
    """Replace legacy gray and duplicate colors, preserving stable unique colors.

    One-time migration: skips once no non-inbox project has the default gray color
    or shares a color with another project, so later restarts don't overwrite
    user-selected colors.
    """
    has_legacy_gray = db.scalar(
        select(Project)
        .where(Project.is_inbox.is_(False), Project.color == DEFAULT_PROJECT_COLOR)
        .limit(1)
    )
    has_duplicate = db.scalar(
        select(Project.color)
        .where(Project.is_inbox.is_(False))
        .group_by(Project.color)
        .having(func.count(Project.id) > 1)
        .limit(1)
    )
    if not has_legacy_gray and not has_duplicate:
        return
    projects = list(db.scalars(select(Project).order_by(Project.id)))
    used: set[str] = set()
    changed = False
    for project in projects:
        color = project.color
        needs_color = not project.is_inbox and (color == DEFAULT_PROJECT_COLOR or color in used)
        if needs_color:
            color = next(
                (candidate for candidate in PROJECT_COLORS if candidate not in used), color
            )
            if color != project.color:
                project.color = color
                changed = True
        used.add(color)
    if changed:
        db.commit()


def create_project(
    db: Session, name: str, color: str | None = None, description: str = ""
) -> Project:
    name = name.strip()
    if not name or len(name) > 100:
        raise ProjectError("Project name must contain 1-100 characters")
    if db.scalar(select(Project).where(func.lower(Project.name) == name.lower())):
        raise ProjectError(f"Project '{name}' already exists")
    project = Project(name=name, color=_next_project_color(db, color), description=description)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def update_project(
    db: Session,
    project_id: int,
    *,
    name: str | None = None,
    color: str | None = None,
    description: str | None = None,
    archived: bool | None = None,
) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise ProjectError("Project not found")
    if project.is_inbox and archived:
        raise ProjectError("Inbox project cannot be archived")
    if name is not None:
        name = name.strip()
        if not name or len(name) > 100:
            raise ProjectError("Project name must contain 1-100 characters")
        if db.scalar(
            select(Project).where(
                func.lower(Project.name) == name.lower(), Project.id != project_id
            )
        ):
            raise ProjectError(f"Project '{name}' already exists")
        project.name = name
    if color is not None:
        project.color = _next_project_color(db, color, exclude_project_id=project.id)
    if description is not None:
        project.description = description
    if archived is not None and not project.is_inbox:
        project.archived_at = utcnow() if archived else None
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: int, force: bool = False) -> None:
    project = db.get(Project, project_id)
    if project is None:
        raise ProjectError("Project not found")
    if project.is_inbox:
        raise ProjectError("Inbox project cannot be deleted")
    task_count = db.scalar(
        select(func.count(Task.id)).where(Task.project_id == project_id, Task.deleted_at.is_(None))
    )
    if task_count and not force:
        raise ProjectError(f"Project has {task_count} tasks; pass force=true to delete them")
    for task in db.scalars(select(Task).where(Task.project_id == project_id)):
        db.delete(task)
    db.delete(project)
    db.commit()


def find_project_by_name(db: Session, name: str) -> Project | None:
    return db.scalar(
        select(Project).where(
            func.lower(Project.name) == name.lower(), Project.archived_at.is_(None)
        )
    )
