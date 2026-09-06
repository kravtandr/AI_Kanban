"""Планировщик трат (SPEC.md §4.7, ADR-0009)."""

import calendar
from datetime import date

from app.models import ExpensePeriod


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
