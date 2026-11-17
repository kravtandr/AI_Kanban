"""Calendar and monthly shares from the same schedules displayed in the portal."""

import calendar
from collections.abc import Iterable
from datetime import date
from fractions import Fraction

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ExpensePeriod, ExpenseStatus
from app.services import budget, expenses

MONTH_WEIGHTS = {
    ExpensePeriod.day: 365,
    ExpensePeriod.month: 12,
    ExpensePeriod.quarter: 4,
    ExpensePeriod.year: 1,
}


def compute(db: Session, month: str, tag: str | None = None, query: str | None = None) -> dict:
    budget.validate_month(month)
    year, number = map(int, month.split("-"))
    start = date(year, number, 1)
    last_day = calendar.monthrange(year, number)[1]
    rows = expenses.list_expenses(db, status=ExpenseStatus.recurring, tag=tag, query=query)
    items = []
    charges: list[dict] = []
    tags: dict[str | None, Fraction] = {}
    total = Fraction(0)
    for row in rows:
        assert row.period is not None and row.anchor_date is not None
        monthly = Fraction(row.amount * MONTH_WEIGHTS[row.period], 12)
        total += monthly
        if row.amount > 0:
            items.append({"expense_id": row.id, "title": row.title, "amount": float(monthly)})
            for tag in row.tags or [None]:
                tags[tag] = tags.get(tag, Fraction(0)) + monthly / max(1, len(row.tags))
        # The original anchor always determines clamping, e.g. Jan 31 -> Feb 28.
        days: Iterable[int]
        if row.period == ExpensePeriod.day:
            days = range(
                max(1, row.anchor_date.day if row.anchor_date >= start else 1), last_day + 1
            )
            if row.anchor_date > date(year, number, last_day):
                days = range(0)
        else:
            distance = (year - row.anchor_date.year) * 12 + number - row.anchor_date.month
            step = {ExpensePeriod.month: 1, ExpensePeriod.quarter: 3, ExpensePeriod.year: 12}[
                row.period
            ]
            days = (
                [min(row.anchor_date.day, last_day)]
                if distance >= 0 and distance % step == 0
                else []
            )
        charges.extend(
            {
                "expense_id": row.id,
                "title": row.title,
                "amount": row.amount,
                "date": date(year, number, day).isoformat(),
            }
            for day in days
        )
    return {
        "month": month,
        "currency": get_settings().expense_currency,
        "units": "kopecks",
        "monthly_recurring": round(total),
        "items": sorted(items, key=lambda item: (-item["amount"], item["expense_id"])),
        "tags": [
            {"tag": tag, "amount": float(amount)}
            for tag, amount in sorted(tags.items(), key=lambda pair: (-pair[1], pair[0] or ""))
        ],
        "charges": sorted(charges, key=lambda item: (item["date"], item["expense_id"])),
        "scheduled_total": sum(charge["amount"] for charge in charges),
    }
