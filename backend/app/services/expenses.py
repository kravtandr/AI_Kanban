"""Планировщик трат (SPEC.md §4.7, ADR-0009)."""

import calendar
from datetime import date, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Expense, ExpensePeriod, ExpenseStatus, TaskSource, utcnow
from app.schemas import ExpenseSummaryOut, UpcomingCharge
from app.services.tasks import local_today


class ExpenseError(Exception):
    pass


_STEP_MONTHS = {ExpensePeriod.month: 1, ExpensePeriod.quarter: 3, ExpensePeriod.year: 12}


def _add_months(anchor: date, months: int) -> date:
    """anchor + months, день прижат к концу короткого месяца. Считается всегда от
    anchor, а не от предыдущего результата: так 31 янв → 28 фев → 31 мар, прижатие
    не «залипает»."""
    index = anchor.year * 12 + (anchor.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    day = min(anchor.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def next_charge(period: ExpensePeriod, anchor: date, today: date) -> date:
    """Наименьшая дата >= today в ряду anchor + k·period (§5)."""
    if period == ExpensePeriod.day:
        return max(anchor, today)
    if anchor >= today:
        return anchor
    step = _STEP_MONTHS[period]
    months_between = (today.year - anchor.year) * 12 + (today.month - anchor.month)
    k = max(0, months_between // step)
    candidate = _add_months(anchor, k * step)
    while candidate < today:
        k += 1
        candidate = _add_months(anchor, k * step)
    return candidate


PURGE_DELETED_AFTER_DAYS = 30

# Expense.amount is Mapped[int] -> PostgreSQL INTEGER (int4); this is its ceiling in
# kopecks. Lives here, not in services/ai.py, because it describes this module's
# column -- ai.py imports it back for rub_to_kopecks's own clamping.
MAX_AMOUNT_KOPECKS = 2_147_483_647


def normalize_tags(tags: list[str] | None) -> list[str]:
    seen: list[str] = []
    for raw in tags or []:
        tag = raw.strip().lower()
        if tag and tag not in seen:
            seen.append(tag)
    return seen


def _check_invariants(e: Expense) -> None:
    """Инвариант §4. Вызывается после применения ЛЮБЫХ изменений, до commit."""
    if e.amount < 0:
        raise ExpenseError("Amount must be >= 0")
    if e.amount > MAX_AMOUNT_KOPECKS:
        raise ExpenseError(f"Amount must be <= {MAX_AMOUNT_KOPECKS} kopecks")
    if not e.title.strip():
        raise ExpenseError("Title is required")
    if e.status == ExpenseStatus.recurring:
        if e.period is None or e.anchor_date is None:
            raise ExpenseError("Recurring expense needs period and anchor_date")
        if e.purchased_at is not None:
            raise ExpenseError("Recurring expense cannot have purchased_at")
        return
    if e.period is not None or e.anchor_date is not None:
        raise ExpenseError("Only recurring expenses have period and anchor_date")
    if not e.active:
        raise ExpenseError("Only recurring expenses can be paused")
    if e.status == ExpenseStatus.bought and e.purchased_at is None:
        raise ExpenseError("Bought expense needs purchased_at")
    if e.status == ExpenseStatus.wanted and e.purchased_at is not None:
        raise ExpenseError("Wanted expense cannot have purchased_at")


def list_expenses(
    db: Session,
    *,
    status: ExpenseStatus | None = None,
    tag: str | None = None,
    query: str | None = None,
    include_inactive: bool = False,
) -> list[Expense]:
    q = (
        select(Expense)
        .where(Expense.deleted_at.is_(None))
        .order_by(Expense.sort_order, Expense.created_at.desc())
    )
    if status is not None:
        q = q.where(Expense.status == status)
    if not include_inactive:
        q = q.where(Expense.active.is_(True))
    if query:
        pattern = f"%{query.lower()}%"
        q = q.where(
            or_(func.lower(Expense.title).like(pattern), func.lower(Expense.note).like(pattern))
        )
    rows = list(db.scalars(q))
    if tag:
        rows = [e for e in rows if tag in (e.tags or [])]
    return rows


def get_expense(db: Session, expense_id: int) -> Expense:
    e = db.get(Expense, expense_id)
    if e is None or e.deleted_at is not None:
        raise ExpenseError("Expense not found")
    return e


def _next_sort_order(db: Session, status: ExpenseStatus) -> int:
    current = db.scalar(
        select(func.max(Expense.sort_order)).where(
            Expense.status == status, Expense.deleted_at.is_(None)
        )
    )
    return (current or 0) + 1


def _first_sort_order(db: Session, status: ExpenseStatus) -> int:
    current = db.scalar(
        select(func.min(Expense.sort_order)).where(
            Expense.status == status, Expense.deleted_at.is_(None)
        )
    )
    return (current or 0) - 1


def create_expense(
    db: Session,
    *,
    title: str,
    amount: int,
    status: ExpenseStatus = ExpenseStatus.wanted,
    period: ExpensePeriod | None = None,
    anchor_date: date | None = None,
    purchased_at: date | None = None,
    active: bool = True,
    note: str = "",
    tags: list[str] | None = None,
    source: TaskSource = TaskSource.manual,
    ai_meta: dict | None = None,
) -> Expense:
    # purchased_at из вызывающего кода (явная дата покупки) побеждает; сегодняшняя
    # дата — только запасной вариант для bought без даты, как раньше (§9).
    if purchased_at is None and status == ExpenseStatus.bought:
        purchased_at = local_today()
    e = Expense(
        title=title.strip()[:200],
        amount=amount,
        status=status,
        period=period,
        anchor_date=anchor_date,
        note=note,
        active=active,
        tags=normalize_tags(tags),
        source=source,
        ai_meta=ai_meta,
        purchased_at=purchased_at,
        sort_order=_next_sort_order(db, status),
    )
    _check_invariants(e)
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


_PATCHABLE = {
    "title",
    "note",
    "amount",
    "status",
    "period",
    "anchor_date",
    "active",
    "purchased_at",
    "tags",
    "sort_order",
}


def update_expense(db: Session, expense_id: int, **fields) -> Expense:
    e = get_expense(db, expense_id)
    if fields.pop("clear_period", False):
        e.period = None
        e.anchor_date = None
    for key, value in fields.items():
        if key not in _PATCHABLE:
            raise ExpenseError(f"Unknown field: {key}")
        if value is None:
            continue  # None = поле не пришло в патче, а не запись (§7.2, clear_period — отдельно)
        if key == "tags":
            value = normalize_tags(value)
        if key == "title":
            value = value.strip()[:200]
        setattr(e, key, value)
    # Смена на bought через PATCH без даты — ставим сегодня, как move (§9).
    if e.status == ExpenseStatus.bought and e.purchased_at is None:
        e.purchased_at = local_today()
    if e.status == ExpenseStatus.wanted:
        e.purchased_at = None
    if e.status == ExpenseStatus.recurring:
        e.purchased_at = None
    try:
        _check_invariants(e)
    except ExpenseError:
        db.rollback()
        raise
    db.commit()
    db.refresh(e)
    return e


def move_expense(
    db: Session, expense_id: int, status: ExpenseStatus, sort_order: int | None = None
) -> Expense:
    e = get_expense(db, expense_id)
    if ExpenseStatus.recurring in (e.status, status) and e.status != status:
        raise ExpenseError("Recurring expenses cannot be moved between columns")
    if status != e.status:
        e.status = status
        if status == ExpenseStatus.bought:
            e.purchased_at = local_today()
            e.sort_order = _first_sort_order(db, status)  # свежая покупка сверху
        else:
            e.purchased_at = None
            e.sort_order = _next_sort_order(db, status)
    if sort_order is not None:
        e.sort_order = sort_order
    _check_invariants(e)
    db.commit()
    db.refresh(e)
    return e


def delete_expense(db: Session, expense_id: int) -> None:
    e = get_expense(db, expense_id)
    e.deleted_at = utcnow()
    db.commit()


def purge_deleted_expenses(db: Session) -> int:
    """Физически удалить мягко удалённые > 30 дней назад (NFR-4). Дочерних таблиц нет."""
    cutoff = utcnow() - timedelta(days=PURGE_DELETED_AFTER_DAYS)
    stale = list(
        db.scalars(
            select(Expense).where(Expense.deleted_at.is_not(None), Expense.deleted_at < cutoff)
        )
    )
    for e in stale:
        db.delete(e)
    db.commit()
    return len(stale)


UPCOMING_DAYS = 7

# Приведение к среднему календарному месяцу (§6). Округление — один раз,
# после суммирования по всем картам.
MONTHLY_FACTOR: dict[ExpensePeriod, float] = {
    ExpensePeriod.day: 365 / 12,
    ExpensePeriod.month: 1.0,
    ExpensePeriod.quarter: 1 / 3,
    ExpensePeriod.year: 1 / 12,
}


def next_charge_for(e: Expense, today: date | None = None) -> date | None:
    """next_charge только для активной регулярной траты; иначе None (§5)."""
    if e.status != ExpenseStatus.recurring or not e.active:
        return None
    assert e.period is not None and e.anchor_date is not None  # инвариант §4
    return next_charge(e.period, e.anchor_date, today or local_today())


def summary(db: Session) -> ExpenseSummaryOut:
    today = local_today()
    active = list(
        db.scalars(
            select(Expense).where(
                Expense.deleted_at.is_(None),
                Expense.status == ExpenseStatus.recurring,
                Expense.active.is_(True),
            )
        )
    )
    monthly = round(sum(e.amount * MONTHLY_FACTOR[e.period] for e in active if e.period))
    horizon = today + timedelta(days=UPCOMING_DAYS)
    upcoming = sorted(
        (
            UpcomingCharge(expense_id=e.id, title=e.title, amount=e.amount, date=charge)
            for e in active
            if (charge := next_charge_for(e, today)) is not None and charge <= horizon
        ),
        key=lambda u: (u.date, u.expense_id),
    )
    wanted_total = db.scalar(
        select(func.coalesce(func.sum(Expense.amount), 0)).where(
            Expense.deleted_at.is_(None), Expense.status == ExpenseStatus.wanted
        )
    )
    month_start = today.replace(day=1)
    bought = db.scalar(
        select(func.coalesce(func.sum(Expense.amount), 0)).where(
            Expense.deleted_at.is_(None),
            Expense.status == ExpenseStatus.bought,
            Expense.purchased_at >= month_start,
            Expense.purchased_at <= today,
        )
    )
    return ExpenseSummaryOut(
        monthly_recurring=int(monthly),
        upcoming=upcoming,
        upcoming_total=sum(u.amount for u in upcoming),
        wanted_total=int(wanted_total or 0),
        bought_this_month=int(bought or 0),
        currency=get_settings().expense_currency,
    )
