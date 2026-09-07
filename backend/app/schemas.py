from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models import (
    EstimateBucket,
    ExpensePeriod,
    ExpenseStatus,
    TaskPriority,
    TaskSource,
    TaskStatus,
)

_VALID_BUCKETS = {b.value for b in EstimateBucket}


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str

    model_config = {"from_attributes": True}


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str | None = None
    description: str = ""


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = None
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
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    project_id: int | None = None
    status: TaskStatus = TaskStatus.todo
    priority: TaskPriority = TaskPriority.medium
    tags: list[str] = []
    due_date: date | None = None
    source: TaskSource = TaskSource.manual
    ai_meta: dict | None = None
    estimate: EstimateBucket | None = None


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    project_id: int | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    tags: list[str] | None = None
    due_date: date | None = None
    clear_due_date: bool = False
    estimate: EstimateBucket | None = None
    # Отдельный флаг, ровно как clear_due_date: роут вызывает
    # model_dump(exclude_unset=True), поэтому «поле не прислали» и «прислали null»
    # в сервисе неразличимы, и голый {"estimate": null} молча потерялся бы (§9.1).
    clear_estimate: bool = False


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
    # Заполняется в слое API через _out/_out_many, а не с ORM-объекта (§9.1).
    estimate: str | None = None

    model_config = {"from_attributes": True}


class DraftIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class TaskDraft(BaseModel):
    """Structured output schema returned by the LLM."""

    title: str = Field(description="Short imperative task title, max 200 chars")
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
    estimate: EstimateBucket | None = Field(
        default=None,
        description=(
            "Effort bucket for focused work time: XS, S, M, L or XL. "
            "null when the note gives no basis for sizing"
        ),
    )

    @field_validator("estimate", mode="before")
    @classmethod
    def _lenient_bucket(cls, v):
        """Плохая оценка НЕ имеет права уронить черновик целиком.

        На openai-пути ответ выскребается регуляркой из свободного текста
        (ai.py:95-103), и слабая локальная Qwen спокойно отдаёт "medium", "M?",
        "Small" или 3. Строгая валидация означала бы ValidationError на ВЕСЬ
        TaskDraft — пользователь потерял бы и заголовок, и описание, и маршрутизацию
        по проекту (§2.7, FR-5.5).
        """
        if v is None:
            return None
        key = str(v).strip().strip("?.").upper()
        return key if key in _VALID_BUCKETS else None


class DraftOut(BaseModel):
    draft: TaskDraft
    project_id: int
    ai_ok: bool
    ai_error: str | None = None


class TranscriptionOut(BaseModel):
    """Recognised speech. An empty string is a valid result (silence)."""

    text: str


class BucketCalibration(BaseModel):
    """What one estimate bucket is worth on this board right now (§10.1).

    `seed_minutes` is the immovable anchor the prompt always sees (§3.3);
    `minutes` is what is in effect now; `observed_minutes` is the raw median even
    when the sample is still too small to switch over.
    """

    bucket: str
    minutes: int
    seed_minutes: int
    observed_minutes: int | None
    samples: int
    calibrated: bool


class Coverage(BaseModel):
    as_of: datetime  # подпись «данные на такое-то время»; для арифметики не использовать
    window_days: int  # окно ТОЛЬКО ретро-сумм (§7.4)
    seeded_tasks: int  # были событием source == "seed" — существовали до замеров
    untracked_tasks: int  # отсечены правилом допуска R2 (§7.1)
    tracked_tasks: int  # len(by_task) − untracked_tasks, считается ПО ЖУРНАЛУ
    drift_repaired: int  # были событием source == "drift" (§5.4 п.2)
    capped_spells: int  # ЗАКРЫТЫХ заходов обрезано по MAX_SPELL_SECONDS
    clock_anomalies: int
    corpus_size: int  # наблюдений в корпусе, по всей истории


class ProjectStat(BaseModel):
    """closed_minutes/open_minutes — по СНИМКАМ пролётов, factor/samples — по
    НАБЛЮДЕНИЯМ (§8.3). У задачи, работавшейся в двух проектах, эти две группы
    полей законно относятся к разным популяциям."""

    project_id: int
    project: str  # "проект удалён" для осиротевшего снимка (§7.2)
    color: str
    closed_minutes: int
    open_minutes: int  # НИКОГДА не складывается с closed
    factor: float | None
    relative: float | None
    samples: int


class StuckTask(BaseModel):
    task_id: int
    title: str
    status: str  # статус ПОСЛЕДНЕГО события ∈ {backlog, todo, in_progress}
    days: float  # длительность ТЕКУЩЕЙ резиденции, окном не ограничена
    spells: int  # заходов за всю историю задачи


class RunningTask(BaseModel):
    task_id: int
    title: str
    open_seconds: int  # ТОЛЬКО текущий открытый заход, без потолка (R7)
    closed_seconds: int  # закрытые заходы этой же задачи, с потолком
    predicted_minutes: int | None
    over: float | None  # open_seconds / 60 / predicted_minutes


class AnalyticsOut(BaseModel):
    coverage: Coverage
    board_factor: float | None
    closed_minutes: int  # СУММА ProjectStat.closed_minutes (§7.4)
    open_minutes: int
    deleted_minutes: int  # дизъюнктно с closed_minutes и со всеми ProjectStat
    inversions: list[str]  # [] когда лестница монотонна, никогда null
    buckets: list[BucketCalibration]
    projects: list[ProjectStat]
    stuck: list[StuckTask]
    running: list[RunningTask]


class InsightsIn(BaseModel):
    days: int = Field(default=30, ge=1, le=3650)


class InsightsOut(BaseModel):
    """AI-комментарий поверх измеренных чисел.

    `data` заполнен ВСЕГДА — с LLM и без. `facts` — ровно тот текст, который увидела
    модель: выдуманное число видно тем, что его нет в фактах (§11.3).
    """

    data: AnalyticsOut
    facts: str
    text: str = ""
    ai_ok: bool
    ai_error: str | None = None


class UpcomingCharge(BaseModel):
    expense_id: int
    title: str
    amount: int
    date: date


class ExpenseSummaryOut(BaseModel):
    monthly_recurring: int
    upcoming: list[UpcomingCharge]
    upcoming_total: int
    wanted_total: int
    bought_this_month: int
    currency: str


class ExpenseIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    amount: int = Field(ge=0)  # копейки
    status: ExpenseStatus = ExpenseStatus.wanted
    period: ExpensePeriod | None = None
    anchor_date: date | None = None
    # Дата покупки (только status=bought) и пауза (только status=recurring); без
    # них create_expense не может выполнить то же, что и PATCH (обзор, находка #2).
    purchased_at: date | None = None
    active: bool = True
    note: str = ""
    tags: list[str] = Field(default_factory=list)
    source: TaskSource = TaskSource.manual
    ai_meta: dict | None = None


class ExpensePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = None
    amount: int | None = Field(default=None, ge=0)
    status: ExpenseStatus | None = None
    period: ExpensePeriod | None = None
    anchor_date: date | None = None
    active: bool | None = None
    purchased_at: date | None = None
    tags: list[str] | None = None
    sort_order: int | None = None
    # Как clear_due_date/clear_estimate: PATCH идёт через exclude_unset, и
    # «поле не прислали» неотличимо от «прислали null» (§7.2).
    clear_period: bool = False


class ExpenseMoveIn(BaseModel):
    status: ExpenseStatus
    sort_order: int | None = None


class ExpenseOut(BaseModel):
    id: int
    title: str
    note: str
    amount: int
    status: ExpenseStatus
    period: ExpensePeriod | None
    anchor_date: date | None
    active: bool
    purchased_at: date | None
    tags: list[str]
    sort_order: int
    source: TaskSource
    created_at: datetime
    updated_at: datetime
    # Считается сервером (§5), у неактивных и wanted/bought — null.
    next_charge: date | None = None

    model_config = {"from_attributes": True}


class ExpenseDraft(BaseModel):
    """Плоская схема черновика траты для слабой локальной модели (§8.1)."""

    title: str = Field(description="Short expense name, max 200 chars")
    amount_rub: float | None = Field(
        default=None,
        description="Price in rubles, decimals allowed, or null if not stated",
        # json.loads() accepts inf/NaN; must fail validation here, not round() later (FR-5.5)
        allow_inf_nan=False,
    )
    status: Literal["recurring", "wanted"] = Field(
        default="wanted",
        description=(
            "recurring for repeating payments (subscriptions, rent), wanted for one-off purchases"
        ),
    )
    period: ExpensePeriod | None = Field(
        default=None, description="Only for recurring: day|month|quarter|year"
    )
    anchor_date: date | None = Field(
        default=None, description="ISO date of one charge, only for recurring"
    )
    tags: list[str] = Field(default_factory=list, description="0-3 short lowercase tags")

    @field_validator("title")
    @classmethod
    def _trim_title(cls, value: str) -> str:
        return value.strip()[:200] or "Трата"


class ExpenseDraftOut(BaseModel):
    draft: ExpenseDraft
    amount: int  # копейки, round(amount_rub * 100); 0 при null
    ai_ok: bool
    ai_error: str | None = None
