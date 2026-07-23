"""LLM pipeline: turn raw text into a structured task draft (FR-5.x).

Uses the Anthropic SDK with structured outputs. All failures degrade gracefully:
the caller always gets a usable draft (raw text as title, Inbox as project).
"""

import logging
from datetime import date

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import LlmUsage, Task
from app.schemas import TaskDraft
from app.services.projects import find_project_by_name, get_inbox, list_projects

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the task-formatting engine of a personal kanban task tracker.
Turn the user's raw note into a well-formed task.

Rules:
- Title: short, imperative, in the same language as the input.
- Description: helpful Markdown; add a '- [ ]' checklist when the note implies several steps;
  keep it empty for trivial tasks. Do not invent requirements that are not implied.
- Project: pick the best match from the provided project list ONLY. If none clearly fits,
  return null. Never invent new project names.
- Priority: urgent only for explicit urgency, high for deadlines soon / blocking work,
  low for someday-ideas, otherwise medium.
- Tags: 0-4 short lowercase tags; prefer tags from the provided vocabulary when they fit.
- due_date: resolve explicit or relative dates ("до пятницы", "tomorrow") against today's
  date given in the message; null if no date is implied."""


class DraftResult:
    def __init__(self, draft: TaskDraft, ok: bool, error: str | None = None):
        self.draft = draft
        self.ok = ok
        self.error = error


def _fallback_draft(text: str) -> TaskDraft:
    return TaskDraft(title=text.strip()[:200] or "Untitled task")


def _call_model(system: str, user_message: str) -> tuple[TaskDraft, int, int]:
    """Isolated for tests. Returns (draft, input_tokens, output_tokens)."""
    import anthropic

    settings = get_settings()
    client = anthropic.Anthropic(
        api_key=settings.anthropic_api_key,
        timeout=settings.llm_timeout_seconds,
        max_retries=1,
    )
    response = client.messages.parse(
        model=settings.anthropic_model,
        max_tokens=2048,
        system=system,
        messages=[{"role": "user", "content": user_message}],
        output_format=TaskDraft,
    )
    draft = response.parsed_output
    if draft is None:
        raise ValueError("LLM returned no parseable output")
    usage = response.usage
    return draft, usage.input_tokens, usage.output_tokens


def _log_usage(
    db: Session, operation: str, ok: bool, input_tokens: int = 0, output_tokens: int = 0
) -> None:
    db.add(
        LlmUsage(
            operation=operation,
            model=get_settings().anthropic_model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            ok=ok,
        )
    )
    db.commit()


def _project_context(db: Session) -> str:
    lines = []
    tag_vocab: set[str] = set()
    for project, _count in list_projects(db):
        desc = f" — {project.description}" if project.description else ""
        lines.append(f"- {project.name}{desc}")
    for task in db.query(Task).filter(Task.deleted_at.is_(None)).limit(500):
        tag_vocab.update(task.tags or [])
    tags = ", ".join(sorted(tag_vocab)) or "(none yet)"
    return "Projects:\n" + "\n".join(lines) + f"\n\nExisting tags: {tags}"


def draft_task(db: Session, text: str) -> DraftResult:
    settings = get_settings()
    if not settings.anthropic_api_key:
        return DraftResult(_fallback_draft(text), ok=False, error="LLM is not configured")
    user_message = (
        f"Today is {date.today().isoformat()}.\n\n{_project_context(db)}\n\nRaw note:\n{text}"
    )
    try:
        draft, tin, tout = _call_model(SYSTEM_PROMPT, user_message)
        _log_usage(db, "draft", True, tin, tout)
        return DraftResult(draft, ok=True)
    except Exception as exc:  # degrade, never block task creation (FR-5.5)
        log.warning("LLM draft failed: %s", exc)
        _log_usage(db, "draft", False)
        return DraftResult(_fallback_draft(text), ok=False, error=str(exc))


def enhance_task(db: Session, task: Task) -> DraftResult:
    settings = get_settings()
    if not settings.anthropic_api_key:
        return DraftResult(_fallback_draft(task.title), ok=False, error="LLM is not configured")
    user_message = (
        f"Today is {date.today().isoformat()}.\n\n{_project_context(db)}\n\n"
        "Improve the following existing task. Keep its meaning, rewrite title/description "
        "for clarity, suggest tags and priority.\n"
        f"Title: {task.title}\nDescription:\n{task.description or '(empty)'}\n"
        f"Current project: {task.project.name}\nCurrent priority: {task.priority.value}"
    )
    try:
        draft, tin, tout = _call_model(SYSTEM_PROMPT, user_message)
        _log_usage(db, "enhance", True, tin, tout)
        return DraftResult(draft, ok=True)
    except Exception as exc:
        log.warning("LLM enhance failed: %s", exc)
        _log_usage(db, "enhance", False)
        return DraftResult(_fallback_draft(task.title), ok=False, error=str(exc))


def resolve_project_id(db: Session, project_name: str | None) -> int:
    """Map the LLM-suggested project name to an id, falling back to Inbox (FR-5.4)."""
    if project_name:
        project = find_project_by_name(db, project_name)
        if project is not None:
            return project.id
    return get_inbox(db).id
