from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.models import TaskPriority, TaskSource, TaskStatus


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str

    model_config = {"from_attributes": True}


class ProjectIn(BaseModel):
    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    name: str = Field(min_length=1, max_length=100)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    description: str = ""


class ProjectPatch(BaseModel):
    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    description: str | None = None
    archived: bool | None = None


class ProjectOut(BaseModel):
    id: int
    name: str
    color: str
    description: str
    is_inbox: bool
    archived_at: datetime | None
    active_tasks: int = 0

    model_config = {"from_attributes": True}


class TaskIn(BaseModel):
    @field_validator("title", mode="before")
    @classmethod
    def strip_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    project_id: int | None = None
    status: TaskStatus = TaskStatus.todo
    priority: TaskPriority = TaskPriority.medium
    tags: list[str] = []
    due_date: date | None = None
    source: TaskSource = TaskSource.manual
    ai_meta: dict | None = None


class TaskPatch(BaseModel):
    @field_validator("title", mode="before")
    @classmethod
    def strip_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    project_id: int | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    tags: list[str] | None = None
    due_date: date | None = None
    clear_due_date: bool = False


class MoveIn(BaseModel):
    status: TaskStatus
    sort_order: int | None = None


class TaskOut(BaseModel):
    id: int
    project_id: int
    title: str
    description: str
    status: TaskStatus
    priority: TaskPriority
    tags: list[str]
    due_date: date | None
    sort_order: int
    source: TaskSource
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class DraftIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class TaskDraft(BaseModel):
    """Structured output schema returned by the LLM."""

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value):
        return value.strip()[:200] if isinstance(value, str) else value

    title: str = Field(
        min_length=1, max_length=200, description="Short imperative task title, max 200 chars"
    )
    description: str = Field(
        default="",
        description="Markdown description; use a '- [ ]' checklist for subtasks when useful",
    )
    project: str | None = Field(
        default=None,
        description=(
            "Exact name of an existing project, or a short new project name when none "
            "fits, or null for one-off tasks"
        ),
    )
    project_description: str | None = Field(
        default=None,
        description=(
            "One short sentence describing the project's scope; required when proposing "
            "a new project, also given when the chosen project lacks a description"
        ),
    )
    priority: TaskPriority = TaskPriority.medium
    tags: list[str] = Field(default_factory=list, description="0-4 short lowercase tags")
    due_date: date | None = Field(
        default=None, description="ISO date resolved from the text, or null"
    )


class DraftOut(BaseModel):
    draft: TaskDraft
    project_id: int
    ai_ok: bool
    ai_error: str | None = None


class TranscriptionOut(BaseModel):
    """Recognised speech. An empty string is a valid result (silence)."""

    text: str
