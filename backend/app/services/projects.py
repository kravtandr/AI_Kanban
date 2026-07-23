from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Project, Task, TaskStatus, utcnow


class ProjectError(Exception):
    pass


def get_inbox(db: Session) -> Project:
    inbox = db.scalar(select(Project).where(Project.is_inbox.is_(True)))
    if inbox is None:
        inbox = Project(name="Inbox", color="#64748b", is_inbox=True)
        db.add(inbox)
        db.commit()
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


def create_project(
    db: Session, name: str, color: str = "#6b7280", description: str = ""
) -> Project:
    if db.scalar(select(Project).where(func.lower(Project.name) == name.lower())):
        raise ProjectError(f"Project '{name}' already exists")
    project = Project(name=name, color=color, description=description)
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
    if name is not None and name != project.name:
        if db.scalar(select(Project).where(func.lower(Project.name) == name.lower())):
            raise ProjectError(f"Project '{name}' already exists")
        project.name = name
    if color is not None:
        project.color = color
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
