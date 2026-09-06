from datetime import date, timedelta

import pytest

from app import db as db_module
from app.models import Expense, ExpensePeriod, ExpenseStatus, utcnow
from app.services import expenses as svc


@pytest.fixture()
def db(client):
    with db_module.get_session_factory()() as session:
        yield session


def _recurring(db, **kw):
    fields = dict(
        title="Netflix",
        amount=89900,
        status=ExpenseStatus.recurring,
        period=ExpensePeriod.month,
        anchor_date=date(2026, 1, 15),
    )
    fields.update(kw)
    return svc.create_expense(db, **fields)


def test_recurring_requires_period_and_anchor(db):
    with pytest.raises(svc.ExpenseError):
        svc.create_expense(db, title="x", amount=1, status=ExpenseStatus.recurring)
    with pytest.raises(svc.ExpenseError):
        svc.create_expense(
            db, title="x", amount=1, status=ExpenseStatus.recurring, period=ExpensePeriod.month
        )


def test_wanted_rejects_period(db):
    with pytest.raises(svc.ExpenseError):
        svc.create_expense(db, title="x", amount=1, period=ExpensePeriod.day)


def test_negative_amount_rejected(db):
    with pytest.raises(svc.ExpenseError):
        svc.create_expense(db, title="x", amount=-1)


def test_tags_normalized(db):
    e = svc.create_expense(db, title="x", amount=1, tags=["Подписки", " подписки ", "TV"])
    assert e.tags == ["подписки", "tv"]


def test_move_wanted_to_bought_sets_purchased_at_and_back(db, monkeypatch):
    monkeypatch.setattr(svc, "local_today", lambda: date(2026, 9, 6))
    e = svc.create_expense(db, title="Монитор", amount=3500000)
    moved = svc.move_expense(db, e.id, ExpenseStatus.bought)
    assert moved.status == ExpenseStatus.bought
    assert moved.purchased_at == date(2026, 9, 6)
    back = svc.move_expense(db, e.id, ExpenseStatus.wanted)
    assert back.purchased_at is None


def test_move_recurring_forbidden(db):
    e = _recurring(db)
    with pytest.raises(svc.ExpenseError):
        svc.move_expense(db, e.id, ExpenseStatus.wanted)
    w = svc.create_expense(db, title="x", amount=1)
    with pytest.raises(svc.ExpenseError):
        svc.move_expense(db, w.id, ExpenseStatus.recurring)


def test_bought_goes_to_top_of_column(db):
    first = svc.create_expense(db, title="a", amount=1)
    second = svc.create_expense(db, title="b", amount=1)
    svc.move_expense(db, first.id, ExpenseStatus.bought)
    svc.move_expense(db, second.id, ExpenseStatus.bought)
    bought = svc.list_expenses(db, status=ExpenseStatus.bought)
    assert [e.title for e in bought] == ["b", "a"]


def test_update_to_recurring_via_patch(db):
    e = svc.create_expense(db, title="x", amount=1)
    with pytest.raises(svc.ExpenseError):
        svc.update_expense(db, e.id, status=ExpenseStatus.recurring)
    upd = svc.update_expense(
        db,
        e.id,
        status=ExpenseStatus.recurring,
        period=ExpensePeriod.year,
        anchor_date=date(2026, 3, 1),
    )
    assert upd.period == ExpensePeriod.year


def test_clear_period_turns_recurring_into_wanted_only_with_status(db):
    e = _recurring(db)
    with pytest.raises(svc.ExpenseError):  # recurring без периода невозможна
        svc.update_expense(db, e.id, clear_period=True)
    upd = svc.update_expense(db, e.id, status=ExpenseStatus.wanted, clear_period=True)
    assert upd.period is None and upd.anchor_date is None


def test_inactive_hidden_by_default(db):
    e = _recurring(db)
    svc.update_expense(db, e.id, active=False)
    assert svc.list_expenses(db) == []
    assert [x.id for x in svc.list_expenses(db, include_inactive=True)] == [e.id]


def test_wanted_cannot_be_inactive(db):
    e = svc.create_expense(db, title="x", amount=1)
    with pytest.raises(svc.ExpenseError):
        svc.update_expense(db, e.id, active=False)


def test_filters(db):
    _recurring(db, title="Netflix", tags=["tv"])
    svc.create_expense(db, title="Монитор", amount=1, note="27 дюймов")
    assert [e.title for e in svc.list_expenses(db, tag="tv")] == ["Netflix"]
    assert [e.title for e in svc.list_expenses(db, query="дюйм")] == ["Монитор"]
    assert [e.title for e in svc.list_expenses(db, status=ExpenseStatus.wanted)] == ["Монитор"]


def test_soft_delete_and_purge(db):
    e = svc.create_expense(db, title="x", amount=1)
    svc.delete_expense(db, e.id)
    with pytest.raises(svc.ExpenseError):
        svc.get_expense(db, e.id)
    assert svc.purge_deleted_expenses(db) == 0
    row = db.get(Expense, e.id)
    row.deleted_at = utcnow() - timedelta(days=31)
    db.commit()
    assert svc.purge_deleted_expenses(db) == 1
    assert db.get(Expense, e.id) is None
