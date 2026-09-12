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


def test_rub_to_kopecks_direct():
    """Юнит-покрытие чистой функции, отдельно от HTTP/LLM (обзор, находка #2)."""
    cases = [
        (None, 0),
        (899, 89900),
        (2500.5, 250050),
        (-50, 0),
    ]
    for amount_rub, expected in cases:
        assert ai_svc.rub_to_kopecks(amount_rub) == expected


def test_rub_to_kopecks_clamps_to_column_ceiling():
    """Expense.amount — INTEGER (int4), потолок 2147483647 копеек (находка #2)."""
    assert ai_svc.rub_to_kopecks(1e30) == ai_svc.MAX_AMOUNT_KOPECKS


def test_non_finite_amount_degrades_instead_of_500(auth_client, monkeypatch):
    """Находка #1 (FR-5.5): 1e400 в JSON слабой модели -> json.loads даёт inf ->
    без allow_inf_nan=False ExpenseDraft провалидировал бы inf, и
    rub_to_kopecks(inf) уронил бы round() в эндпоинте, вне try draft_expense.
    Здесь мок воспроизводит ровно это: _call_model отдаёт ЧЕРЕЗ реальный
    ExpenseDraft.model_validate({... "amount_rub": inf}) — с фиксом это бросает
    ValidationError и деградирует; без фикса draft вернулся бы с amount_rub=inf
    и уронил бы round(inf) в эндпоинте (500)."""

    def fake(system, user_message, *, schema=TaskDraft):
        return (
            schema.model_validate({"title": "Слишком дорого", "amount_rub": float("inf")}),
            1,
            1,
        )

    monkeypatch.setattr(ai_svc, "_call_model", fake)
    r = auth_client.post("/api/v1/ai/draft-expense", json={"text": "бесконечно дорогая трата"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ai_ok"] is False
    assert body["amount"] == 0
    with db_module.get_session_factory()() as db:
        rows = db.query(LlmUsage).filter_by(operation="draft_expense").all()
    assert [row.ok for row in rows] == [False]
