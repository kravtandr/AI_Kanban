from datetime import date

import pytest

from app import db as db_module
from app.models import LlmUsage
from app.schemas import ExpenseDraft, TaskDraft
from app.services import ai as ai_svc
from app.services import expenses as expense_svc


@pytest.fixture(autouse=True)
def _llm_on(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(expense_svc, "local_today", lambda: date(2026, 9, 6))
    monkeypatch.setattr(ai_svc, "local_today", lambda: date(2026, 9, 6))
    yield
    get_settings.cache_clear()


def test_schema_reaches_call_model(client, monkeypatch):
    seen = {}

    def fake(system, user_message, *, schema=TaskDraft):
        seen["schema"] = schema
        return (
            schema(
                title="Netflix",
                amount_rub=899,
                status="recurring",
                period="month",
                anchor_date=date(2026, 9, 15),
            ),
            1,
            1,
        )

    monkeypatch.setattr(ai_svc, "_call_model", fake)
    with db_module.get_session_factory()() as db:
        result = ai_svc.draft_expense(db, "нетфликс 899 15 числа")
    assert seen["schema"] is ExpenseDraft
    assert result.ok and result.draft.period == "month"


def test_recurring_defaults_fill_in(client, monkeypatch):
    monkeypatch.setattr(
        ai_svc,
        "_call_model",
        lambda s, u, *, schema=TaskDraft: (
            schema(title="Спортзал", amount_rub=2500.5, status="recurring"),
            1,
            1,
        ),
    )
    with db_module.get_session_factory()() as db:
        d = ai_svc.draft_expense(db, "зал 2500.50").draft
    assert d.period == "month" and d.anchor_date == date(2026, 9, 6)


def test_wanted_drops_period(client, monkeypatch):
    monkeypatch.setattr(
        ai_svc,
        "_call_model",
        lambda s, u, *, schema=TaskDraft: (
            schema(
                title="Монитор",
                amount_rub=35000,
                status="wanted",
                period="year",
                anchor_date=date(2026, 1, 1),
            ),
            1,
            1,
        ),
    )
    with db_module.get_session_factory()() as db:
        d = ai_svc.draft_expense(db, "монитор 35к").draft
    assert d.period is None and d.anchor_date is None


def test_degrades_on_exception(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(ai_svc, "_call_model", boom)
    with db_module.get_session_factory()() as db:
        result = ai_svc.draft_expense(db, "что-то 100")
        assert not result.ok
        assert result.draft.title == "что-то 100" and result.draft.status == "wanted"
        rows = db.query(LlmUsage).filter_by(operation="draft_expense").all()
        assert [r.ok for r in rows] == [False]


def test_task_draft_still_calls_without_schema(client, monkeypatch):
    """Регрессия: старые моки без параметра schema продолжают работать."""
    monkeypatch.setattr(ai_svc, "_call_model", lambda s, u: (TaskDraft(title="ok"), 1, 1))
    with db_module.get_session_factory()() as db:
        assert ai_svc.draft_task(db, "x").ok


def test_endpoint(auth_client, monkeypatch):
    monkeypatch.setattr(
        ai_svc,
        "_call_model",
        lambda s, u, *, schema=TaskDraft: (
            schema(title="Netflix", amount_rub=899, status="recurring"),
            1,
            1,
        ),
    )
    r = auth_client.post("/api/v1/ai/draft-expense", json={"text": "нетфликс 899"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ai_ok"] is True
    assert body["amount"] == 89900
    assert body["draft"]["period"] == "month"
