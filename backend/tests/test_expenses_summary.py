from datetime import date

import pytest

from app import db as db_module
from app.models import ExpensePeriod, ExpenseStatus
from app.services import expenses as svc


@pytest.fixture()
def db(client, monkeypatch):
    monkeypatch.setattr(svc, "local_today", lambda: date(2026, 9, 6))
    with db_module.get_session_factory()() as session:
        yield session


def _rec(db, title, amount, period, anchor, **kw):
    return svc.create_expense(
        db,
        title=title,
        amount=amount,
        status=ExpenseStatus.recurring,
        period=period,
        anchor_date=anchor,
        **kw,
    )


def test_monthly_factors_rounded_once(db):
    _rec(db, "d", 10000, ExpensePeriod.day, date(2026, 1, 1))
    _rec(db, "q", 10000, ExpensePeriod.quarter, date(2026, 1, 1))
    _rec(db, "y", 10000, ExpensePeriod.year, date(2026, 1, 1))
    s = svc.summary(db)
    assert s.monthly_recurring == 308333  # 304166.67 + 3333.33 + 833.33
    assert s.currency == "RUB"


def test_upcoming_window_and_daily_once(db):
    _rec(db, "daily", 100, ExpensePeriod.day, date(2026, 1, 1))
    _rec(db, "soon", 200, ExpensePeriod.month, date(2026, 1, 10))  # 10 сен: в окне
    _rec(db, "edge", 300, ExpensePeriod.month, date(2026, 1, 13))  # 13 сен: today+7, в окне
    _rec(db, "late", 400, ExpensePeriod.month, date(2026, 1, 14))  # 14 сен: вне
    s = svc.summary(db)
    assert [(u.title, u.date) for u in s.upcoming] == [
        ("daily", date(2026, 9, 6)),
        ("soon", date(2026, 9, 10)),
        ("edge", date(2026, 9, 13)),
    ]
    assert s.upcoming_total == 600


def test_inactive_excluded(db):
    e = _rec(db, "paused", 5000, ExpensePeriod.month, date(2026, 1, 6))
    svc.update_expense(db, e.id, active=False)
    s = svc.summary(db)
    assert s.monthly_recurring == 0 and s.upcoming == []


def test_wanted_and_bought_totals(db):
    svc.create_expense(db, title="w1", amount=100)
    svc.create_expense(db, title="w2", amount=250)
    b = svc.create_expense(db, title="b", amount=999)
    svc.move_expense(db, b.id, ExpenseStatus.bought)
    old = svc.create_expense(db, title="old", amount=1)
    svc.move_expense(db, old.id, ExpenseStatus.bought)
    svc.update_expense(db, old.id, purchased_at=date(2026, 8, 31))
    s = svc.summary(db)
    assert s.wanted_total == 350
    assert s.bought_this_month == 999
