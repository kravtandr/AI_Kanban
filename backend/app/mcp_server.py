"""MCP server (FR-6.x): exposes task-tracker operations to AI agents.

Mounted into the FastAPI app at /mcp (Streamable HTTP transport), protected by
Bearer tokens (env MCP_TOKEN or DB api_tokens with kind=mcp). All tools go
through the same service layer as the REST API. Tool logic lives in plain
functions (`*_impl`) so it can be tested without the MCP transport.
"""

import math
from datetime import UTC, datetime
from datetime import date as date_type

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from app.api.expenses import expense_out
from app.config import get_settings
from app.db import get_session_factory
from app.models import (
    EstimateBucket,
    ExpensePeriod,
    ExpenseStatus,
    TaskPriority,
    TaskSource,
    TaskStatus,
)
from app.services import ai as ai_svc

# MANDATORY alias. @mcp.tool() returns the function itself, so `def analytics`
# below rebinds this module-level name; without the alias analytics.compute()
# would raise AttributeError: 'function' object has no attribute 'compute' on the
# very first tool call. Same trick as ai_svc / expense_svc / project_svc / task_svc.
from app.services import analytics as analytics_svc
from app.services import expenses as expense_svc
from app.services import projects as project_svc
from app.services import tasks as task_svc
from app.services.ai import rub_to_kopecks

mcp = FastMCP(
    "TaskTracker",
    instructions=(
        "Personal kanban task tracker. Use create_task to record new work items, "
        "list_tasks/get_task to inspect the board, move_task/complete_task to update "
        "progress, and daily_summary for a day overview. The board also has a spending "
        "planner: list_expenses/expenses_summary answer budget questions, create_expense "
        "records subscriptions and wishes."
    ),
    stateless_http=True,
    # DNS-rebinding protection rejects LAN hostnames (421 behind the reverse
    # proxy). The endpoint is protected by our own Bearer-token check instead
    # (ADR-0003/0004), so host-header validation is disabled.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


def _task_dict(task, estimate: str | None = None) -> dict:
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
        "estimate": estimate,
    }


def _task_dict_with_estimate(db, task) -> dict:
    """Single-task variant of _task_dict: one batched (n=1) call to
    analytics.latest_estimates, same query as the list path (§9.1). An agent
    that can WRITE an estimate must also be able to READ it back, or it has no
    way to know one was already set and may re-estimate a task the owner
    already sized."""
    return _task_dict(task, analytics_svc.latest_estimates(db, [task.id]).get(task.id))


def _bucket(value: str | None) -> EstimateBucket | None:
    """Agent-supplied effort bucket. An unusable value is silently dropped, never
    raised: a wrong estimate must not fail an otherwise valid create/update — the
    same leniency TaskDraft applies to the LLM (§9.1)."""
    if value is None:
        return None
    try:
        return EstimateBucket(str(value).strip().upper())
    except ValueError:
        return None


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
        # One batched query for the whole page, not one per task (§9.1) --
        # the same shape as api/tasks.py's _out_many.
        estimates = analytics_svc.latest_estimates(db, [t.id for t in tasks])
        return [_task_dict(t, estimates.get(t.id)) for t in tasks]


def get_task_impl(task_id: int) -> dict:
    with get_session_factory()() as db:
        return _task_dict_with_estimate(db, task_svc.get_task(db, task_id))


def create_task_impl(
    title: str,
    description: str = "",
    project: str | None = None,
    priority: str = "medium",
    tags: list[str] | None = None,
    due_date: str | None = None,
    auto_format: bool = False,
    estimate: str | None = None,
) -> dict:
    with get_session_factory()() as db:
        ai_meta = None
        draft = None
        # Whether the agent named a project explicitly; the LLM suggestion is
        # only used (and may auto-create a project) when it did not.
        agent_project = project
        if auto_format or project is None:
            source_text = f"{title}\n{description}".strip()
            result = ai_svc.draft_task(db, source_text)
            if result.ok:
                draft = result.draft
                title = draft.title
                description = draft.description or description
                project = project or draft.project
                priority = draft.priority.value
                tags = tags or draft.tags
                due_date = due_date or (draft.due_date.isoformat() if draft.due_date else None)
                ai_meta = {
                    "source_text": source_text,
                    "auto_format": True,
                    "model": ai_svc.active_model(get_settings()),
                    "timestamp": datetime.now(UTC).isoformat(),
                }
        project_id = None
        if draft is not None and agent_project is None and project:
            # LLM-picked project: auto-create it / backfill its description
            project_id = ai_svc.resolve_project_id(db, project, draft.project_description)
        elif project:
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
            estimate=_bucket(estimate),
            # Hard-wired, not a tool parameter: the agent does not get to choose
            # whose estimate this is.
            estimate_source="mcp",
        )
        return _task_dict_with_estimate(db, task)


def update_task_impl(
    task_id: int,
    title: str | None = None,
    description: str | None = None,
    project: str | None = None,
    priority: str | None = None,
    tags: list[str] | None = None,
    due_date: str | None = None,
    estimate: str | None = None,
    clear_estimate: bool = False,
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
            estimate=_bucket(estimate),
            clear_estimate=clear_estimate,
            estimate_source="mcp",
        )
        return _task_dict_with_estimate(db, task)


def move_task_impl(task_id: int, status: str) -> dict:
    with get_session_factory()() as db:
        return _task_dict_with_estimate(db, task_svc.move_task(db, task_id, TaskStatus(status)))


def complete_task_impl(task_id: int) -> dict:
    with get_session_factory()() as db:
        return _task_dict_with_estimate(db, task_svc.move_task(db, task_id, TaskStatus.done))


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
        "formats the task and picks a project automatically. estimate is the effort "
        "bucket for focused work: XS, S, M, L or XL; call analytics to see what each "
        "bucket costs on this board."
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
    estimate: str | None = None,
) -> dict:
    return create_task_impl(
        title, description, project, priority, tags, due_date, auto_format, estimate
    )


@mcp.tool(
    description=(
        "Update fields of an existing task. Only provided fields are changed. "
        "estimate sets the effort bucket (XS|S|M|L|XL); clear_estimate=true removes it."
    )
)
def update_task(
    task_id: int,
    title: str | None = None,
    description: str | None = None,
    project: str | None = None,
    priority: str | None = None,
    tags: list[str] | None = None,
    due_date: str | None = None,
    estimate: str | None = None,
    clear_estimate: bool = False,
) -> dict:
    return update_task_impl(
        task_id, title, description, project, priority, tags, due_date, estimate, clear_estimate
    )


@mcp.tool(description="Move a task to another kanban column (change its status).")
def move_task(task_id: int, status: str) -> dict:
    return move_task_impl(task_id, status)


@mcp.tool(description="Mark a task as done.")
def complete_task(task_id: int) -> dict:
    return complete_task_impl(task_id)


@mcp.tool(
    description=(
        "Delete a task. Soft delete: the task disappears from the board and is "
        "permanently removed after 30 days; there is no restore API."
    )
)
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


def analytics_impl(days: int = 30) -> dict:
    # MCP has no Query validation, so the window is clamped explicitly (§7.4).
    days = max(1, min(int(days), 3650))
    with get_session_factory()() as db:
        return analytics_svc.compute(db, days=days).model_dump(mode="json")


@mcp.tool(
    description=(
        "Measured effort statistics for this board: what each estimate bucket actually "
        "costs in minutes, which projects run over their estimates, which tasks are stuck "
        "and where the time went. Call this before estimating work, and for retrospectives."
    )
)
def analytics(days: int = 30) -> dict:
    return analytics_impl(days)


def _expense_dict(e) -> dict:
    data = expense_out(e).model_dump(mode="json")
    data["amount_rub"] = e.amount / 100
    return data


def _rub_to_kopecks(amount_rub: float) -> int:
    """Guards rub_to_kopecks against non-finite input from an external agent (Task 5
    carry-over, progress.md faf7efc..0270df4 review). The AI-draft path is protected by
    ExpenseDraft's allow_inf_nan=False schema gate; create_expense/update_expense take
    amount_rub straight off the wire with no schema in between, so float('inf')/
    float('nan') would otherwise raise OverflowError/ValueError out of round() deep
    inside rub_to_kopecks. Reject them here instead, as a clean ExpenseError the agent
    can act on. rub_to_kopecks itself is untouched -- its other caller depends on its
    current behaviour."""
    if not math.isfinite(amount_rub):
        raise expense_svc.ExpenseError(f"amount_rub must be a finite number, got {amount_rub!r}")
    return rub_to_kopecks(amount_rub)


def list_expenses_impl(
    status: str | None = None,
    tag: str | None = None,
    query: str | None = None,
    include_inactive: bool = False,
) -> list[dict]:
    with get_session_factory()() as db:
        rows = expense_svc.list_expenses(
            db,
            status=ExpenseStatus(status) if status else None,
            tag=tag,
            query=query,
            include_inactive=include_inactive,
        )
        return [_expense_dict(e) for e in rows]


def create_expense_impl(
    title: str,
    amount_rub: float,
    status: str = "wanted",
    period: str | None = None,
    anchor_date: str | None = None,
    note: str = "",
    tags: list[str] | None = None,
) -> dict:
    with get_session_factory()() as db:
        e = expense_svc.create_expense(
            db,
            title=title,
            amount=_rub_to_kopecks(amount_rub),
            status=ExpenseStatus(status),
            period=ExpensePeriod(period) if period else None,
            anchor_date=date_type.fromisoformat(anchor_date) if anchor_date else None,
            note=note,
            tags=tags,
            source=TaskSource.mcp,  # провенанс ставит сервер, не агент (§9)
        )
        return _expense_dict(e)


def update_expense_impl(
    expense_id: int,
    title: str | None = None,
    amount_rub: float | None = None,
    status: str | None = None,
    period: str | None = None,
    anchor_date: str | None = None,
    note: str | None = None,
    tags: list[str] | None = None,
    active: bool | None = None,
    purchased_at: str | None = None,
    clear_period: bool = False,
) -> dict:
    fields: dict = {}
    if title is not None:
        fields["title"] = title
    if amount_rub is not None:
        fields["amount"] = _rub_to_kopecks(amount_rub)
    if status is not None:
        fields["status"] = ExpenseStatus(status)
    if period is not None:
        fields["period"] = ExpensePeriod(period)
    if anchor_date is not None:
        fields["anchor_date"] = date_type.fromisoformat(anchor_date)
    if note is not None:
        fields["note"] = note
    if tags is not None:
        fields["tags"] = tags
    if active is not None:
        fields["active"] = active
    if purchased_at is not None:
        fields["purchased_at"] = date_type.fromisoformat(purchased_at)
    if clear_period:
        fields["clear_period"] = True
    with get_session_factory()() as db:
        return _expense_dict(expense_svc.update_expense(db, expense_id, **fields))


def expenses_summary_impl() -> dict:
    with get_session_factory()() as db:
        return expense_svc.summary(db).model_dump(mode="json")


@mcp.tool(
    description=(
        "Spending planner. Call this before answering questions about subscriptions, "
        "recurring costs or the wishlist, and before creating an expense to avoid "
        "duplicates. status: recurring|wanted|bought. Amounts come back both as kopecks "
        "(amount) and rubles (amount_rub)."
    )
)
def list_expenses(
    status: str | None = None,
    tag: str | None = None,
    query: str | None = None,
    include_inactive: bool = False,
) -> list[dict]:
    return list_expenses_impl(status, tag, query, include_inactive)


@mcp.tool(
    description=(
        "Record a recurring payment (status=recurring; requires period day|month|quarter|year "
        "and anchor_date YYYY-MM-DD of one charge) or a wanted one-off purchase "
        "(status=wanted). amount_rub is the price in rubles."
    )
)
def create_expense(
    title: str,
    amount_rub: float,
    status: str = "wanted",
    period: str | None = None,
    anchor_date: str | None = None,
    note: str = "",
    tags: list[str] | None = None,
) -> dict:
    return create_expense_impl(title, amount_rub, status, period, anchor_date, note, tags)


@mcp.tool(
    description=(
        "Edit an expense. active=false pauses a cancelled subscription; status=bought marks "
        "a wish as purchased today; clear_period=true drops period/anchor_date when turning "
        "a recurring expense into a wanted one."
    )
)
def update_expense(
    expense_id: int,
    title: str | None = None,
    amount_rub: float | None = None,
    status: str | None = None,
    period: str | None = None,
    anchor_date: str | None = None,
    note: str | None = None,
    tags: list[str] | None = None,
    active: bool | None = None,
    purchased_at: str | None = None,
    clear_period: bool = False,
) -> dict:
    return update_expense_impl(
        expense_id,
        title,
        amount_rub,
        status,
        period,
        anchor_date,
        note,
        tags,
        active,
        purchased_at,
        clear_period,
    )


@mcp.tool(
    description=(
        "Monthly cost of active recurring expenses, charges due in the next 7 days, wishlist "
        "total and this month's purchases (all in kopecks). Call this for any budget question."
    )
)
def expenses_summary() -> dict:
    return expenses_summary_impl()
