"""MCP server (FR-6.x): exposes task-tracker operations to AI agents.

Mounted into the FastAPI app at /mcp (Streamable HTTP transport), protected by
Bearer tokens (env MCP_TOKEN or DB api_tokens with kind=mcp). All tools go
through the same service layer as the REST API. Tool logic lives in plain
functions (`*_impl`) so it can be tested without the MCP transport.
"""

import base64
import binascii
import math
from datetime import UTC, datetime
from datetime import date as date_type
from typing import Annotated

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field
from sqlalchemy import select

from app.api import ai as ai_api
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
    User,
)
from app.schemas import (
    BudgetIn,
    DraftIn,
    FreelanceReceipt,
    InsightsIn,
    ProjectIn,
    ProjectOut,
    ProjectPatch,
)
from app.services import ai as ai_svc

# MANDATORY alias. @mcp.tool() returns the function itself, so `def analytics`
# below rebinds this module-level name; without the alias analytics.compute()
# would raise AttributeError: 'function' object has no attribute 'compute' on the
# very first tool call. Same trick as ai_svc / expense_svc / project_svc / task_svc.
from app.services import analytics as analytics_svc
from app.services import budget as budget_svc
from app.services import expense_plan as expense_plan_svc
from app.services import expenses as expense_svc
from app.services import projects as project_svc
from app.services import stt as stt_svc
from app.services import tasks as task_svc
from app.services.ai import rub_to_kopecks

mcp = FastMCP(
    "TaskTracker",
    instructions=(
        "Personal kanban task tracker. Use create_task to record new work items, "
        "list_tasks/get_task to inspect the board, move_task/complete_task to update "
        "progress, and daily_summary for a day overview. The board also has a spending "
        "planner: list_expenses/expenses_summary inspect spending, expense_plan shows a monthly "
        "calendar and tag breakdown. get_budget/save_budget read and replace monthly income "
        "in integer kopecks, with computed goals. Projects support CRUD and archiving. "
        "AI preview tools and transcribe_audio are available on explicit request."
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
        "sort_order": task.sort_order,
        "updated_at": task.updated_at.isoformat(),
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


def list_projects_impl(include_archived: bool = False) -> list[dict]:
    with get_session_factory()() as db:
        return [
            ProjectOut.model_validate(p)
            .model_copy(update={"active_tasks": count})
            .model_dump(mode="json")
            for p, count in project_svc.list_projects(db, include_archived)
        ]


def list_tasks_impl(
    project: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    tag: str | None = None,
    query: str | None = None,
    limit: int | None = 50,
    all_done: bool = False,
    project_ids: list[int] | None = None,
) -> list[dict]:
    with get_session_factory()() as db:
        if project:
            found = project_svc.find_project_by_name(db, project)
            if found is None:
                return []
            project_ids = (
                [found.id]
                if project_ids is None
                else [pid for pid in project_ids if pid == found.id]
            )
            if not project_ids:
                return []
        tasks = task_svc.list_tasks(
            db,
            project_ids=project_ids,
            status=TaskStatus(status) if status else None,
            priority=TaskPriority(priority) if priority else None,
            tag=tag,
            query=query,
            limit=limit,
            all_done=all_done,
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
    priority: str | None = None,
    tags: list[str] | None = None,
    due_date: str | None = None,
    auto_format: bool = False,
    estimate: str | None = None,
    project_id: int | None = None,
    status: str = "todo",
) -> dict:
    with get_session_factory()() as db:
        ai_meta = None
        draft = None
        # Whether the agent named a project explicitly; the LLM suggestion is
        # only used (and may auto-create a project) when it did not.
        agent_project = project
        if auto_format or (project is None and project_id is None):
            source_text = f"{title}\n{description}".strip()
            result = ai_svc.draft_task(db, source_text)
            if result.ok:
                draft = result.draft
                title = draft.title
                description = draft.description or description
                project = project or (draft.project if project_id is None else None)
                priority = priority if priority is not None else draft.priority.value
                tags = tags if tags is not None else draft.tags
                due_date = due_date or (draft.due_date.isoformat() if draft.due_date else None)
                ai_meta = {
                    "source_text": source_text,
                    "auto_format": True,
                    "model": ai_svc.active_model(get_settings()),
                    "timestamp": datetime.now(UTC).isoformat(),
                }
        if project_id is not None and project is not None:
            raise ValueError("Use project or project_id, not both")
        if project_id is None and draft is not None and agent_project is None and project:
            # LLM-picked project: auto-create it / backfill its description
            project_id = ai_svc.resolve_project_id(db, project, draft.project_description)
        elif project_id is None and project:
            found = project_svc.find_project_by_name(db, project)
            project_id = found.id if found else None
        task = task_svc.create_task(
            db,
            title=title,
            description=description,
            project_id=project_id,
            priority=TaskPriority(priority or "medium"),
            status=TaskStatus(status),
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
    project_id: int | None = None,
    status: str | None = None,
) -> dict:
    with get_session_factory()() as db:
        if project_id is not None and project is not None:
            raise ValueError("Use project or project_id, not both")
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
            status=TaskStatus(status) if status else None,
            tags=tags,
            due_date=date_type.fromisoformat(due_date) if due_date else None,
            clear_due_date=due_date == "",
            estimate=_bucket(estimate),
            clear_estimate=clear_estimate,
            estimate_source="mcp",
        )
        return _task_dict_with_estimate(db, task)


def move_task_impl(task_id: int, status: str, sort_order: int | None = None) -> dict:
    with get_session_factory()() as db:
        return _task_dict_with_estimate(
            db, task_svc.move_task(db, task_id, TaskStatus(status), sort_order)
        )


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
def list_projects(include_archived: bool = False) -> list[dict]:
    return list_projects_impl(include_archived)


@mcp.tool(
    description=(
        "Search and filter tasks. Call this before creating a task to avoid duplicates, "
        "and to inspect the board. status: backlog|todo|in_progress|done; "
        "priority: low|medium|high|urgent. all_done=true includes older completed tasks; "
        "limit=null returns all matches. project_ids filters multiple projects."
    )
)
def list_tasks(
    project: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    tag: str | None = None,
    query: str | None = None,
    limit: int | None = 50,
    all_done: bool = False,
    project_ids: list[int] | None = None,
) -> list[dict]:
    return list_tasks_impl(project, status, priority, tag, query, limit, all_done, project_ids)


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
    priority: str | None = None,
    tags: list[str] | None = None,
    due_date: str | None = None,
    auto_format: bool = False,
    estimate: str | None = None,
    project_id: int | None = None,
    status: str = "todo",
) -> dict:
    return create_task_impl(
        title,
        description,
        project,
        priority,
        tags,
        due_date,
        auto_format,
        estimate,
        project_id,
        status,
    )


@mcp.tool(
    description=(
        "Update fields of an existing task. Only provided fields are changed. "
        "Pass due_date as an empty string to remove a deadline. "
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
    project_id: int | None = None,
    status: str | None = None,
) -> dict:
    return update_task_impl(
        task_id,
        title,
        description,
        project,
        priority,
        tags,
        due_date,
        estimate,
        clear_estimate,
        project_id,
        status,
    )


@mcp.tool(description="Move a task to another kanban column (change its status).")
def move_task(task_id: int, status: str, sort_order: int | None = None) -> dict:
    return move_task_impl(task_id, status, sort_order)


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
    purchased_at: str | None = None,
    active: bool = True,
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
            purchased_at=date_type.fromisoformat(purchased_at) if purchased_at else None,
            active=active,
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
    sort_order: int | None = None,
) -> dict:
    fields: dict = {}
    if sort_order is not None:
        fields["sort_order"] = sort_order
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
        "(status=wanted), or a purchase (status=bought, purchased_at YYYY-MM-DD optional). "
        "active=false creates a paused subscription. amount_rub is the price in rubles."
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
    purchased_at: str | None = None,
    active: bool = True,
) -> dict:
    return create_expense_impl(
        title, amount_rub, status, period, anchor_date, note, tags, purchased_at, active
    )


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
    sort_order: int | None = None,
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
        sort_order,
    )


@mcp.tool(
    description=(
        "Monthly cost of active recurring expenses, charges due in the next 7 days, wishlist "
        "total and this month's purchases (all in kopecks). Use get_budget for income and goals."
    )
)
def expenses_summary() -> dict:
    return expenses_summary_impl()


def create_project_impl(name: str, color: str | None = None, description: str = "") -> dict:
    body = ProjectIn(name=name, color=color, description=description)
    with get_session_factory()() as db:
        project = project_svc.create_project(db, **body.model_dump())
        return ProjectOut.model_validate(project).model_dump(mode="json")


def update_project_impl(
    project_id: int,
    name: str | None = None,
    color: str | None = None,
    description: str | None = None,
    archived: bool | None = None,
) -> dict:
    body = ProjectPatch(name=name, color=color, description=description, archived=archived)
    with get_session_factory()() as db:
        project = project_svc.update_project(db, project_id, **body.model_dump())
        counts = {p.id: count for p, count in project_svc.list_projects(db, True)}
        return (
            ProjectOut.model_validate(project)
            .model_copy(update={"active_tasks": counts.get(project.id, 0)})
            .model_dump(mode="json")
        )


def delete_project_impl(project_id: int, force: bool = False) -> dict:
    with get_session_factory()() as db:
        project_svc.delete_project(db, project_id, force)
        return {"ok": True, "project_id": project_id}


def get_expense_impl(expense_id: int) -> dict:
    with get_session_factory()() as db:
        return _expense_dict(expense_svc.get_expense(db, expense_id))


def move_expense_impl(expense_id: int, status: str, sort_order: int | None = None) -> dict:
    with get_session_factory()() as db:
        return _expense_dict(
            expense_svc.move_expense(db, expense_id, ExpenseStatus(status), sort_order)
        )


def delete_expense_impl(expense_id: int) -> dict:
    with get_session_factory()() as db:
        expense_svc.delete_expense(db, expense_id)
        return {"ok": True, "expense_id": expense_id}


def _budget_dict(month: str, body: BudgetIn) -> dict:
    income = body.salary + sum(receipt.amount for receipt in body.freelance)
    return {
        "month": month,
        **body.model_dump(mode="json"),
        "units": "kopecks",
        "income": income,
        # Integer half-up rounding matches Math.round in BudgetGoals for positive sums.
        "goals": {
            "savings": (income * 2 + 5) // 10,
            "entertainment": (income * 3 + 5) // 10,
            "recurring_ceiling": (income * 5 + 5) // 10,
            "emergency_fund": income * 6,
            "capital": income * 120,
        },
    }


def _owner_id(db) -> int:
    owner_id = db.scalar(select(User.id).order_by(User.id).limit(1))
    if owner_id is None:
        raise ValueError("Tracker owner is not configured")
    return owner_id


def get_budget_impl(month: str) -> dict:
    with get_session_factory()() as db:
        return _budget_dict(month, budget_svc.get_budget(db, _owner_id(db), month))


def save_budget_impl(month: str, salary: int, freelance: list[dict]) -> dict:
    body = BudgetIn.model_validate({"salary": salary, "freelance": freelance})
    with get_session_factory()() as db:
        return _budget_dict(month, budget_svc.save_budget(db, _owner_id(db), month, body))


def expense_plan_impl(month: str, tag: str | None = None, query: str | None = None) -> dict:
    with get_session_factory()() as db:
        return expense_plan_svc.compute(db, month, tag, query)


def draft_task_impl(text: str) -> dict:
    with get_session_factory()() as db:
        return ai_api.draft(DraftIn(text=text), db).model_dump(mode="json")


def draft_expense_impl(text: str) -> dict:
    with get_session_factory()() as db:
        return ai_api.draft_expense(DraftIn(text=text), db).model_dump(mode="json")


def enhance_task_impl(task_id: int) -> dict:
    with get_session_factory()() as db:
        return ai_api.enhance(task_id, db).model_dump(mode="json")


def agent_prompt_impl(task_id: int) -> dict:
    with get_session_factory()() as db:
        return ai_api.agent_prompt(task_id, db).model_dump(mode="json")


def insights_impl(days: int = 30) -> dict:
    with get_session_factory()() as db:
        return ai_api.insights(InsightsIn(days=days), db).model_dump(mode="json")


def transcribe_audio_impl(
    audio_base64: str, filename: str = "audio.webm", content_type: str = "audio/webm"
) -> dict:
    settings = get_settings()
    if not stt_svc.stt_configured(settings):
        raise stt_svc.SttError("speech recognition is not configured")
    limit = int(settings.whisper_max_audio_mb * 1024 * 1024)
    if len(audio_base64) > 4 * ((limit + 2) // 3):
        raise ValueError("Audio exceeds the configured size limit")
    try:
        audio = base64.b64decode(audio_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("audio_base64 must be valid base64") from exc
    if len(audio) > limit:
        raise ValueError("Audio exceeds the configured size limit")
    return {"text": stt_svc.transcribe(audio, filename, content_type)}


@mcp.tool(description="Create a project with name, description and optional #RRGGBB color.")
def create_project(name: str, color: str | None = None, description: str = "") -> dict:
    return create_project_impl(name, color, description)


@mcp.tool(
    description=(
        "Edit a project or set archived=true/false. Archiving preserves tasks and their "
        "history. Inbox cannot be archived. "
    )
)
def update_project(
    project_id: int,
    name: str | None = None,
    color: str | None = None,
    description: str | None = None,
    archived: bool | None = None,
) -> dict:
    return update_project_impl(project_id, name, color, description, archived)


@mcp.tool(
    description=(
        "Permanently delete a project. If it contains tasks, force=true is required and "
        "deletes those tasks and measurement history too. Inbox cannot be deleted. "
    )
)
def delete_project(project_id: int, force: bool = False) -> dict:
    return delete_project_impl(project_id, force)


@mcp.tool(description="Get all fields of an expense, including next charge and purchase date.")
def get_expense(expense_id: int) -> dict:
    return get_expense_impl(expense_id)


@mcp.tool(
    description=(
        "Move wanted/bought expenses between columns or reorder within a column using "
        "sort_order. Recurring expenses can only be reordered in place. "
    )
)
def move_expense(expense_id: int, status: str, sort_order: int | None = None) -> dict:
    return move_expense_impl(expense_id, status, sort_order)


@mcp.tool(
    description=(
        "Soft-delete an expense. It is removed from lists and summaries, and purged after 30 days."
    )
)
def delete_expense(expense_id: int) -> dict:
    return delete_expense_impl(expense_id)


@mcp.tool(
    description=(
        "Read a monthly budget (month YYYY-MM), salary and freelance income, total income "
        "and five goals. All amounts are integer kopecks. An unsaved month returns zeros. "
    )
)
def get_budget(month: str) -> dict:
    return get_budget_impl(month)


@mcp.tool(
    description=(
        "Replace the owner's budget for month YYYY-MM atomically. salary and each "
        "freelance[].amount are integer kopecks, not rubles. Salary is 0..10000000000; up "
        "to 100 receipts, each amount 1..10000000000, title up to 200 chars. Repeating "
        "this call is idempotent; omitted previous receipts are removed. Returns updated "
        "income and goals. "
    )
)
def save_budget(
    month: Annotated[str, Field(pattern=r"^[1-9][0-9]{3}-(0[1-9]|1[0-2])$")],
    salary: Annotated[
        int, Field(strict=True, ge=0, le=10_000_000_000, description="Salary in integer kopecks")
    ],
    freelance: Annotated[list[FreelanceReceipt], Field(max_length=100)],
) -> dict:
    return save_budget_impl(month, salary, [receipt.model_dump() for receipt in freelance])


@mcp.tool(
    description=(
        "Monthly expense plan for YYYY-MM: calendar of scheduled payments, monthly- "
        "normalized shares by expense and tag. Multi-tag amounts split evenly. Amounts in "
        "kopecks; fractional kopecks can occur in shares. This projects current "
        "schedules, not actual payment history. "
    )
)
def expense_plan(month: str, tag: str | None = None, query: str | None = None) -> dict:
    return expense_plan_impl(month, tag, query)


@mcp.tool(
    description=(
        "Use the tracker's AI to preview a task from text (1..4000 chars). The task is "
        "not saved. As in the portal, the suggested project can be created or its empty "
        "description filled. Returns ai_ok and fallback on AI failure. "
    )
)
def draft_task(text: str) -> dict:
    return draft_task_impl(text)


@mcp.tool(
    description=(
        "Use the tracker's AI to preview a recurring expense or wish from text (1..4000 "
        "chars). Does not save the expense. Returns draft, amount in kopecks and ai_ok. "
    )
)
def draft_expense(text: str) -> dict:
    return draft_expense_impl(text)


@mcp.tool(
    description=(
        "Use the tracker's AI to improve a task as a preview. Does not update the task or "
        "create projects. Apply the returned draft with update_task if wanted. "
    )
)
def enhance_task(task_id: int) -> dict:
    return enhance_task_impl(task_id)


@mcp.tool(
    description=(
        "Generate an execution prompt for a task using the tracker's AI. Returns prompt "
        "and ai_ok; does not change the task. "
    )
)
def agent_prompt(task_id: int) -> dict:
    return agent_prompt_impl(task_id)


@mcp.tool(
    description=(
        "Request AI commentary on measured analytics, days 1..3650. Explicit AI call; "
        "returns the same facts, data and fallback as portal statistics. "
    )
)
def insights(days: int = 30) -> dict:
    return insights_impl(days)


@mcp.tool(
    description=(
        "Transcribe base64-encoded audio with the configured Whisper service, as portal "
        "dictation does. filename and content_type must match the recording. Enforces "
        "WHISPER_MAX_AUDIO_MB, keeps audio in memory and returns text. Requires "
        "configured STT. "
    )
)
def transcribe_audio(
    audio_base64: str, filename: str = "audio.webm", content_type: str = "audio/webm"
) -> dict:
    return transcribe_audio_impl(audio_base64, filename, content_type)
