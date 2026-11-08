import pytest
from fastapi.testclient import TestClient

NOVEMBER = "/api/v1/budget/2026-11"
OCTOBER = "/api/v1/budget/2026-10"
EMPTY = {"salary": 0, "freelance": []}


def test_budget_requires_authentication(client: TestClient):
    assert client.get(NOVEMBER).status_code == 401
    assert client.put(NOVEMBER, json=EMPTY).status_code == 401


def test_budget_persists_salary_and_orders_by_month(auth_client: TestClient):
    assert auth_client.get(NOVEMBER).json() == EMPTY
    november = {
        "salary": 10_000_000,
        "freelance": [
            {"title": "Лендинг", "amount": 2_000_025},
            {"title": "Правки", "amount": 500_000},
        ],
    }
    for _ in range(2):
        response = auth_client.put(NOVEMBER, json=november)
        assert response.status_code == 200
        assert response.json() == november
    assert auth_client.get(NOVEMBER).json() == november
    assert auth_client.get(OCTOBER).json() == EMPTY

    updated = {"salary": 11_000_000, "freelance": november["freelance"][:1]}
    assert auth_client.put(NOVEMBER, json=updated).status_code == 200
    assert auth_client.put(OCTOBER, json={"salary": 1, "freelance": []}).status_code == 200
    assert auth_client.get(NOVEMBER).json() == updated


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/v1/budget/2026-13", EMPTY),
        (NOVEMBER, {"salary": -1, "freelance": []}),
        (NOVEMBER, {"salary": 0.5, "freelance": []}),
        (NOVEMBER, {"salary": 0, "freelance": [{"title": "Заказ", "amount": 0}]}),
        (NOVEMBER, {"salary": 0, "freelance": [{"title": "", "amount": 1}] * 101}),
    ],
)
def test_budget_rejects_invalid_input(auth_client: TestClient, path: str, body: dict):
    assert auth_client.put(path, json=body).status_code == 422
    assert auth_client.get(NOVEMBER).json() == EMPTY
