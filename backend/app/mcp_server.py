"""MCP server (FR-6.x): exposes task-tracker operations to AI agents.

Mounted into the FastAPI app at /mcp (Streamable HTTP transport), protected by
Bearer tokens (env MCP_TOKEN or DB api_tokens with kind=mcp). All tools go
through the same service layer as the REST API. Tool logic lives in plain
functions (`*_impl`) so it can be tested without the MCP transport.
"""

from datetime import date as date_type

from mcp.server.fastmcp import FastMCP

from app.db import get_session_factory
from app.models import TaskPriority, TaskSource, TaskStatus
from app.services import ai as ai_svc
from app.services import projects as project_svc
from app.services import tasks as task_svc

mcp = FastMCP(
    "TaskTracker",
    instructions=(
        "Personal kanban task tracker. Use create_task to record new work items, "
        "list_tasks/get_task to inspect the board, move_task/complete_task to update "
        "progress, and daily_summary for a day overview."
    ),
    stateless_http=True,
)


def _task_dict(task) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "project_id": task.project_id,
        "status": task.status.value,
        "priority": task.priority.value,
        "tags": task.tags or [],
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "source": task.source.value,
        "created_at": task.created_at.isoformat(),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }


def list_projects_impl() -> list[dict]:
    with get_session_factory()() as db:
        return [
            {"id": p.id, "name": p.name, "description": p.description, "active_tasks": count}
            for p, count in project_svc.list_projects(db)
        ]


def list_tasks_impl(
    project: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    tag: str | None = None,
    query: str | None = None,
    limit: int = 50,
) -> list[dict]:
    with get_session_factory()() as db:
        project_ids = None
        if project:
            found = project_svc.find_project_by_name(db, project)
            if found is None:
                return []
            project_ids = [found.id]
        tasks = task_svc.list_tasks(
            db,
            project_ids=project_ids,
            status=TaskStatus(status) if status else None,
            priority=TaskPriority(priority) if priority else None,
            tag=tag,
            query=query,
            limit=limit,
        )
        return [_task_dict(t) for t in tasks]


def get_task_impl(task_id: int) -> dict:
    with get_session_factory()() as db:
        return _task_dict(task_svc.get_task(db, task_id))


def create_task_impl(
    title: str,
    description: str = "",
    project: str | None = None,
    priority: str = "medium",
    tags: list[str] | None = None,
    due_date: str | None = None,
    auto_format: bool = False,
) -> dict:
    with get_session_factory()() as db:
        ai_meta = None
        if auto_format or project is None:
            result = ai_svc.draft_task(db, f"{title}\n{description}".strip())
            if result.ok:
                draft = result.draft
                title = draft.title
                description = draft.description or description
                project = project or draft.project
                priority = draft.priority.value
                tags = tags or draft.tags
                due_date = due_date or (draft.due_date.isoformat() if draft.due_date else None)
                ai_meta = {"source_text": title, "auto_format": True}
        project_id = None
        if project:
            found = project_svc.find_project_by_name(db, project)
            project_id = found.id if found else None
        task = task_svc.create_task(
            db,
            title=title,
            description=description,
            project_id=project_id,
            priority=TaskPriority(priority),
            tags=tags or [],
            due_date=date_type.fromisoformat(due_date) if due_date else None,
            source=TaskSource.mcp,
            ai_meta=ai_meta,
        )
        return _task_dict(task)


def update_task_impl(
    task_id: int,
    title: str | None = None,
    description: str | None = None,
    project: str | None = None,
    priority: str | None = None,
    tags: list[str] | None = None,
    due_date: str | None = None,
) -> dict:
    with get_session_factory()() as db:
        project_id = None
        if project:
            found = project_svc.find_project_by_name(db, project)
            if found is None:
                raise ValueError(f"Project '{project}' not found")
            project_id = found.id
        task = task_svc.update_task(
            db,
            task_id,
            title=title,
            description=description,
            project_id=project_id,
            priority=TaskPriority(priority) if priority else None,
            tags=tags,
            due_date=date_type.fromisoformat(due_date) if due_date else None,
        )
        return _task_dict(task)


def move_task_impl(task_id: int, status: str) -> dict:
    with get_session_factory()() as db:
        return _task_dict(task_svc.move_task(db, task_id, TaskStatus(status)))


def complete_task_impl(task_id: int) -> dict:
    with get_session_factory()() as db:
        return _task_dict(task_svc.move_task(db, task_id, TaskStatus.done))


def delete_task_impl(task_id: int) -> dict:
    with get_session_factory()() as db:
        task_svc.delete_task(db, task_id)
        return {"ok": True, "task_id": task_id}


def daily_summary_impl(date: str | None = None) -> dict:
    with get_session_factory()() as db:
        return task_svc.daily_summary(db, date_type.fromisoformat(date) if date else None)


@mcp.tool(description="List all projects with their active task counts.")
def list_projects() -> list[dict]:
    return list_projects_impl()


@mcp.tool(
    description=(
        "Search and filter tasks. Call this before creating a task to avoid duplicates, "
        "and to inspect the board. status: backlog|todo|in_progress|done; "
        "priority: low|medium|high|urgent."
    )
)
def list_tasks(
    project: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    tag: str | None = None,
    query: str | None = None,
    limit: int = 50,
) -> list[dict]:
    return list_tasks_impl(project, status, priority, tag, query, limit)


@mcp.tool(description="Get the full details of one task by id.")
def get_task(task_id: int) -> dict:
    return get_task_impl(task_id)


@mcp.tool(
    description=(
        "Create a task. Call this whenever the user or your work produces a follow-up "
        "action item. If project is omitted or auto_format=true, the tracker's LLM "
        "formats the task and picks a project automatically."
    )
)
def create_task(
    title: str,
    description: str = "",
    project: str | None = None,
    priority: str = "medium",
    tags: list[str] | None = None,
    due_date: str | None = None,
    auto_format: bool = False,
) -> dict:
    return create_task_impl(title, description, project, priority, tags, due_date, auto_format)


@mcp.tool(description="Update fields of an existing task. Only provided fields are changed.")
def update_task(
    task_id: int,
    title: str | None = None,
    description: str | None = None,
    project: str | None = None,
    priority: str | None = None,
    tags: list[str] | None = None,
    due_date: str | None = None,
) -> dict:
    return update_task_impl(task_id, title, description, project, priority, tags, due_date)


@mcp.tool(description="Move a task to another kanban column (change its status).")
def move_task(task_id: int, status: str) -> dict:
    return move_task_impl(task_id, status)


@mcp.tool(description="Mark a task as done.")
def complete_task(task_id: int) -> dict:
    return complete_task_impl(task_id)


@mcp.tool(description="Delete a task (soft delete, recoverable for 30 days).")
def delete_task(task_id: int) -> dict:
    return delete_task_impl(task_id)


@mcp.tool(
    description=(
        "Daily overview: tasks completed on the given date (default today), tasks in "
        "progress, and overdue tasks."
    )
)
def daily_summary(date: str | None = None) -> dict:
    return daily_summary_impl(date)
