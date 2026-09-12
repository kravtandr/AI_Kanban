from datetime import UTC, date, datetime
from enum import StrEnum

from sqlalchemy import JSON, Date, DateTime, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TaskStatus(StrEnum):
    backlog = "backlog"
    todo = "todo"
    in_progress = "in_progress"
    done = "done"


class TaskPriority(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"


class TaskSource(StrEnum):
    manual = "manual"
    ai = "ai"
    mcp = "mcp"


class TokenKind(StrEnum):
    mcp = "mcp"
    api = "api"


def utcnow() -> datetime:
    """Naive UTC timestamp (DB columns are timezone-naive)."""
    return datetime.now(UTC).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SessionToken(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship()


class ApiToken(Base):
    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    kind: Mapped[TokenKind] = mapped_column(Enum(TokenKind))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    color: Mapped[str] = mapped_column(String(16), default="#6b7280")
    description: Mapped[str] = mapped_column(Text, default="")
    is_inbox: Mapped[bool] = mapped_column(default=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    tasks: Mapped[list["Task"]] = relationship(back_populates="project")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus), default=TaskStatus.todo, index=True
    )
    priority: Mapped[TaskPriority] = mapped_column(Enum(TaskPriority), default=TaskPriority.medium)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    source: Mapped[TaskSource] = mapped_column(Enum(TaskSource), default=TaskSource.manual)
    ai_meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    project: Mapped[Project] = relationship(back_populates="tasks")


class ExpenseStatus(StrEnum):
    recurring = "recurring"  # колонка «Регулярные»
    wanted = "wanted"  # колонка «Хочу купить»
    bought = "bought"  # колонка «Куплено»


class ExpensePeriod(StrEnum):
    day = "day"
    month = "month"
    quarter = "quarter"
    year = "year"


class Expense(Base):
    """Планировщик трат (ADR-0009). Новая таблица: create_all создаёт её вместе с
    энумами, Alembic не нужен. Ни одной ссылки на tasks — учёт времени трат не видит."""

    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    note: Mapped[str] = mapped_column(Text, default="")
    amount: Mapped[int] = mapped_column(default=0)  # копейки, >= 0
    status: Mapped[ExpenseStatus] = mapped_column(
        Enum(ExpenseStatus), default=ExpenseStatus.wanted, index=True
    )
    period: Mapped[ExpensePeriod | None] = mapped_column(Enum(ExpensePeriod), nullable=True)
    anchor_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(default=True)
    purchased_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    sort_order: Mapped[int] = mapped_column(default=0)
    source: Mapped[TaskSource] = mapped_column(Enum(TaskSource), default=TaskSource.manual)
    ai_meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class LlmUsage(Base):
    __tablename__ = "llm_usage"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    operation: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    input_tokens: Mapped[int] = mapped_column(default=0)
    output_tokens: Mapped[int] = mapped_column(default=0)
    ok: Mapped[bool] = mapped_column(default=True)


class EstimateBucket(StrEnum):
    xs = "XS"
    s = "S"
    m = "M"
    l = "L"  # noqa: E741
    xl = "XL"


# Journal-only pseudo-statuses. They are absent from TaskStatus and must stay absent:
# these are states in which a task sits in no board column at all. That is exactly why
# TaskEvent.status is a String and not Enum(TaskStatus): create_all cannot ALTER TYPE a
# native PG enum (ADR-0008), and the journal vocabulary must be WIDER than the board's.
EVENT_STATUS_DELETED = "deleted"  # the task is soft-deleted
EVENT_STATUS_PARKED = "parked"  # the task's project is archived


class TaskEvent(Base):
    """Append-only journal of task states.

    A row reads: "since `at` the task sits in status `status` inside project
    `project_id`". The interval ends at the next row of the same task, or at `now`
    when there is no next row.

    project_id is stored as a SNAPSHOT and bounds the interval on par with the status:
    moving a task into another project must not retroactively carry already measured
    hours into the new project.

    ondelete="CASCADE" is load-bearing, not hygiene: purge_deleted_tasks calls
    db.delete(task) while _purge_loop swallows exceptions, so a restricting foreign key
    would kill the daily purge silently and forever.
    """

    __tablename__ = "task_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    at: Mapped[datetime] = mapped_column(DateTime)  # naive UTC
    status: Mapped[str] = mapped_column(String(16))  # TaskStatus | deleted | parked
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # A vocabulary of THREE values, not two:
    #   "live"  - observed at the moment of the mutation;
    #   "seed"  - written by the cold start;
    #   "drift" - written by the startup reconciliation when the state had diverged
    #             from the journal.
    # "seed" and "drift" are kept apart on purpose: the read model answers DIFFERENT
    # questions with them (coverage.seeded_tasks and coverage.drift_repaired), and the
    # two cases can only be told apart afterwards by this very label - the difference is
    # stored nowhere else. String(8) fits both.
    source: Mapped[str] = mapped_column(String(8), default="live")

    __table_args__ = (Index("ix_task_events_task_id_id", "task_id", "id"),)


class TaskEstimate(Base):
    """Append-only journal of estimates. The row with the highest id wins.

    A separate table rather than a column in tasks, and rather than a field in ai_meta:
    ai_meta is overwritten by a repeated draft, while we need the history - to tell a
    FORECAST (an estimate made before the work started) from a REVISION (an estimate
    made after the fact, looking at the measured time in the modal). Only forecasts
    enter the calibration corpus; otherwise the loop learns on hindsight and converges
    to "your estimates are perfect".
    """

    __tablename__ = "task_estimates"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    at: Mapped[datetime] = mapped_column(DateTime)
    # An EstimateBucket value OR an empty string - a tombstone meaning "estimate
    # removed". String(2) fits both "XS" and "": the longest bucket value is two
    # characters and the tombstone is shorter. The column stays NOT NULL and the journal
    # stays append-only: clearing an estimate neither deletes nor rewrites a row.
    bucket: Mapped[str] = mapped_column(String(2))
    source: Mapped[str] = mapped_column(String(8), default="user")  # ai | user | mcp
    # True when the task had NO in_progress event yet at the moment of writing.
    # Computed from the journal by record_estimate and frozen there: an after-the-fact
    # re-estimate must not retroactively pretend to be a forecast.
    #
    # A flag, not a comparison of ids across tables: task_events.id and
    # task_estimates.id are two independent sequences and their relative order means
    # nothing. On a real board there are 3-5x more events than estimates, so
    # "estimate.id < event.id" holds almost always, and a rule built on it would
    # degenerate into "an estimate exists" - letting in exactly the revision this table
    # exists to cut off.
    before_work: Mapped[bool] = mapped_column(default=True)

    __table_args__ = (Index("ix_task_estimates_task_id_id", "task_id", "id"),)
