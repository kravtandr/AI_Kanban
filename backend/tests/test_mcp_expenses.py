from datetime import date

import pytest

from app import mcp_server
from app.services import expenses as svc


@pytest.fixture(autouse=True)
def _today(monkeypatch):
    monkeypatch.setattr(svc, "local_today", lambda: date(2026, 9, 6))


def test_create_marks_mcp_and_converts_rubles(client):
    e = mcp_server.create_expense_impl(
        title="Netflix",
        amount_rub=899.5,
        status="recurring",
        period="month",
        anchor_date="2026-01-15",
    )
    assert e["source"] == "mcp"
    assert e["amount"] == 89950 and e["amount_rub"] == 899.5
    assert e["next_charge"] == "2026-09-15"


def test_list_and_filters(client):
    mcp_server.create_expense_impl(title="Монитор", amount_rub=35000, tags=["техника"])
    mcp_server.create_expense_impl(
        title="Зал", amount_rub=2500, status="recurring", period="month", anchor_date="2026-01-01"
    )
    assert [e["title"] for e in mcp_server.list_expenses_impl(status="wanted")] == ["Монитор"]
    assert [e["title"] for e in mcp_server.list_expenses_impl(tag="техника")] == ["Монитор"]
    assert len(mcp_server.list_expenses_impl(query="зал")) == 1


def test_update_pause_and_bought(client):
    rec = mcp_server.create_expense_impl(
        title="Зал", amount_rub=2500, status="recurring", period="month", anchor_date="2026-01-01"
    )
    paused = mcp_server.update_expense_impl(rec["id"], active=False)
    assert paused["active"] is False and paused["next_charge"] is None
    assert mcp_server.list_expenses_impl() == []
    assert len(mcp_server.list_expenses_impl(include_inactive=True)) == 1

    want = mcp_server.create_expense_impl(title="Монитор", amount_rub=35000)
    bought = mcp_server.update_expense_impl(want["id"], status="bought")
    assert bought["purchased_at"] == "2026-09-06"


def test_update_invalid_raises(client):
    want = mcp_server.create_expense_impl(title="x", amount_rub=1)
    with pytest.raises(svc.ExpenseError):
        mcp_server.update_expense_impl(want["id"], status="recurring")


def test_summary_matches_rest(client, auth_client):
    mcp_server.create_expense_impl(
        title="Зал", amount_rub=3000, status="recurring", period="month", anchor_date="2026-01-01"
    )
    via_mcp = mcp_server.expenses_summary_impl()
    via_rest = auth_client.get("/api/v1/expenses/summary").json()
    assert via_mcp == via_rest
    assert via_mcp["monthly_recurring"] == 300000


# --- Task 5 carry-over (progress.md, review-faf7efc..0270df4.diff): rub_to_kopecks
# itself has no guard against non-finite input. Its only caller before this task
# (the AI expense draft) was protected by ExpenseDraft's allow_inf_nan=False schema
# gate. These MCP tools take amount_rub straight from an external agent with NO
# schema in between, so float('inf')/float('nan') would otherwise raise
# OverflowError/ValueError out of round() deep inside rub_to_kopecks. Must be
# rejected as a clean ExpenseError at the MCP boundary instead.


def test_create_rejects_non_finite_amount(client):
    with pytest.raises(svc.ExpenseError):
        mcp_server.create_expense_impl(title="x", amount_rub=float("inf"))
    with pytest.raises(svc.ExpenseError):
        mcp_server.create_expense_impl(title="x", amount_rub=float("-inf"))
    with pytest.raises(svc.ExpenseError):
        mcp_server.create_expense_impl(title="x", amount_rub=float("nan"))


def test_update_rejects_non_finite_amount(client):
    e = mcp_server.create_expense_impl(title="x", amount_rub=1)
    with pytest.raises(svc.ExpenseError):
        mcp_server.update_expense_impl(e["id"], amount_rub=float("inf"))
