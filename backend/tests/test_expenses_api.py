from datetime import date

import pytest

from app.services import expenses as svc


@pytest.fixture(autouse=True)
def _today(monkeypatch):
    monkeypatch.setattr(svc, "local_today", lambda: date(2026, 9, 6))


def _create(auth_client, **overrides):
    body = {"title": "Монитор", "amount": 3500000, **overrides}
    r = auth_client.post("/api/v1/expenses", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_requires_auth(client):
    assert client.get("/api/v1/expenses").status_code == 401


def test_create_wanted_defaults(auth_client):
    e = _create(auth_client)
    assert e["status"] == "wanted"
    assert e["next_charge"] is None
    assert e["source"] == "manual"


def test_create_recurring_returns_next_charge(auth_client):
    e = _create(
        auth_client,
        title="Netflix",
        amount=89900,
        status="recurring",
        period="month",
        anchor_date="2026-01-15",
    )
    assert e["next_charge"] == "2026-09-15"


def test_invariant_violation_is_400(auth_client):
    r = auth_client.post(
        "/api/v1/expenses", json={"title": "x", "amount": 1, "status": "recurring"}
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "bad_request"


def test_amount_above_ceiling_is_400_not_500(auth_client):
    """Обзор, находка #3: schemas.ExpenseIn ограничивал amount только ge=0.
    Expense.amount — PostgreSQL INTEGER (тест здесь на SQLite не поймал бы
    NumericValueOutOfRange, поэтому потолок проверяется явно в _check_invariants,
    до commit, и REST должен вернуть чистые 400, а не 500 глобального хендлера."""
    r = auth_client.post(
        "/api/v1/expenses",
        json={"title": "Квартира", "amount": 2_147_483_648},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "bad_request"


def test_create_bought_with_explicit_past_date_via_rest(auth_client):
    """Обзор, находка #2: POST /expenses отбрасывал и purchased_at, и active —
    «Дата покупки»/«Активна» в форме создания были декоративными. _today фикстура
    выше держит local_today() на 2026-09-06, поэтому совпадение с датой запроса
    исключено — если бы дата не сохранялась, сервер подставил бы 2026-09-06."""
    e = _create(auth_client, status="bought", purchased_at="2026-08-01")
    assert e["status"] == "bought"
    assert e["purchased_at"] == "2026-08-01"


def test_create_paused_recurring_via_rest(auth_client):
    e = _create(
        auth_client,
        status="recurring",
        period="month",
        anchor_date="2026-01-15",
        active=False,
    )
    assert e["active"] is False
    assert e["next_charge"] is None


def test_week_period_rejected_by_schema(auth_client):
    r = auth_client.post(
        "/api/v1/expenses",
        json={
            "title": "x",
            "amount": 1,
            "status": "recurring",
            "period": "week",
            "anchor_date": "2026-01-01",
        },
    )
    assert r.status_code == 422


def test_move_and_back(auth_client):
    e = _create(auth_client)
    moved = auth_client.post(f"/api/v1/expenses/{e['id']}/move", json={"status": "bought"}).json()
    assert moved["purchased_at"] == "2026-09-06"
    back = auth_client.post(f"/api/v1/expenses/{e['id']}/move", json={"status": "wanted"}).json()
    assert back["purchased_at"] is None


def test_move_recurring_is_400(auth_client):
    e = _create(auth_client, status="recurring", period="day", anchor_date="2026-01-01")
    r = auth_client.post(f"/api/v1/expenses/{e['id']}/move", json={"status": "wanted"})
    assert r.status_code == 400


def test_patch_clear_period(auth_client):
    e = _create(auth_client, status="recurring", period="day", anchor_date="2026-01-01")
    r = auth_client.patch(
        f"/api/v1/expenses/{e['id']}", json={"status": "wanted", "clear_period": True}
    )
    assert r.status_code == 200
    assert r.json()["period"] is None


def test_patch_pause_hides_from_list(auth_client):
    e = _create(auth_client, status="recurring", period="day", anchor_date="2026-01-01")
    auth_client.patch(f"/api/v1/expenses/{e['id']}", json={"active": False})
    assert auth_client.get("/api/v1/expenses").json() == []
    shown = auth_client.get("/api/v1/expenses?include_inactive=true").json()
    assert shown[0]["active"] is False and shown[0]["next_charge"] is None


def test_filters(auth_client):
    _create(
        auth_client,
        title="Netflix",
        tags=["tv"],
        status="recurring",
        period="month",
        anchor_date="2026-01-01",
    )
    _create(auth_client, title="Монитор", note="27 дюймов")
    assert [e["title"] for e in auth_client.get("/api/v1/expenses?tag=tv").json()] == ["Netflix"]
    assert len(auth_client.get("/api/v1/expenses?q=дюйм").json()) == 1
    assert len(auth_client.get("/api/v1/expenses?status=wanted").json()) == 1


def test_summary_route_before_id(auth_client):
    _create(auth_client)
    s = auth_client.get("/api/v1/expenses/summary").json()
    assert s["wanted_total"] == 3500000 and s["currency"] == "RUB"


def test_delete_then_404(auth_client):
    e = _create(auth_client)
    assert auth_client.delete(f"/api/v1/expenses/{e['id']}").status_code == 204
    assert auth_client.get(f"/api/v1/expenses/{e['id']}").status_code == 404
