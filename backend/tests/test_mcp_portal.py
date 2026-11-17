"""Portal operations share services, invariants and storage with MCP."""

import asyncio
import base64
from datetime import timedelta

import pytest
from pydantic import ValidationError

from app import db as db_module
from app import mcp_server as tools
from app.models import Task, utcnow
from app.schemas import AgentPromptDraft, ExpenseDraft, TaskDraft
from app.services import ai, expenses, projects, stt


def test_projects_crud_archive_and_inbox_guards(client):
    project = tools.create_project_impl("Разработка", "#123456", "Описание")
    assert project["color"] == "#123456"
    task = tools.create_task_impl("Работа", project_id=project["id"], status="in_progress")
    changed = tools.update_project_impl(project["id"], name="Продукт", archived=True)
    assert changed["archived_at"]
    assert project["id"] not in {p["id"] for p in tools.list_projects_impl()}
    assert project["id"] in {p["id"] for p in tools.list_projects_impl(True)}
    tools.update_project_impl(project["id"], archived=False, description="Новое")
    with pytest.raises(projects.ProjectError):
        tools.delete_project_impl(project["id"])
    tools.delete_project_impl(project["id"], force=True)
    assert not any(p["id"] == project["id"] for p in tools.list_projects_impl(True))
    with db_module.get_session_factory()() as db:
        assert db.get(Task, task["id"]) is None
    inbox = next(p for p in tools.list_projects_impl() if p["is_inbox"])
    with pytest.raises(projects.ProjectError):
        tools.update_project_impl(inbox["id"], archived=True)
    with pytest.raises(projects.ProjectError):
        tools.delete_project_impl(inbox["id"], force=True)


def test_task_status_order_multiple_projects_and_full_history(client):
    first = tools.create_project_impl("Первый")
    second = tools.create_project_impl("Второй")
    task = tools.create_task_impl("Готово", project_id=first["id"], status="done")
    with db_module.get_session_factory()() as db:
        db.get(Task, task["id"]).completed_at = utcnow() - timedelta(days=40)
        db.commit()
    assert tools.list_tasks_impl(status="done") == []
    assert tools.list_tasks_impl(all_done=True, project_ids=[first["id"]])[0]["id"] == task["id"]
    moved = tools.update_task_impl(task["id"], project_id=second["id"], status="todo")
    assert moved["project_id"] == second["id"]
    assert moved["status"] == "todo"
    other = tools.create_task_impl("Другая", project_id=second["id"])
    ordered = tools.move_task_impl(task["id"], "todo", sort_order=1)
    assert ordered["sort_order"] == 1
    assert tools.get_task_impl(other["id"])["sort_order"] == 2
    assert (
        tools.list_tasks_impl(project_ids=[first["id"], second["id"]], limit=None)[0]["id"]
        == task["id"]
    )
    tools.update_task_impl(task["id"], due_date="2026-12-01")
    assert tools.update_task_impl(task["id"], due_date="")["due_date"] is None


def test_expense_full_cycle_and_purchase_at_creation(client):
    bought = tools.create_expense_impl(
        "Ноутбук", 100.25, status="bought", purchased_at="2026-11-01"
    )
    assert bought["purchased_at"] == "2026-11-01"
    assert tools.get_expense_impl(bought["id"])["amount"] == 10025
    moved = tools.move_expense_impl(bought["id"], "wanted", sort_order=-5)
    assert moved["sort_order"] == -5
    assert moved["purchased_at"] is None
    assert tools.update_expense_impl(bought["id"], sort_order=17)["sort_order"] == 17
    tools.delete_expense_impl(bought["id"])
    with pytest.raises(expenses.ExpenseError):
        tools.get_expense_impl(bought["id"])
    paused = tools.create_expense_impl(
        "Подписка", 500, "recurring", "month", "2026-01-31", active=False
    )
    assert paused["active"] is False
    with pytest.raises(expenses.ExpenseError):
        tools.move_expense_impl(paused["id"], "wanted")


def test_budget_round_trip_rest_parity_goals_and_retries(auth_client):
    assert tools.get_budget_impl("2026-11")["salary"] == 0
    body = {"salary": 100001, "freelance": [{"title": "Проект", "amount": 10000}]}
    first = tools.save_budget_impl("2026-11", **body)
    assert first == tools.save_budget_impl("2026-11", **body)
    assert first["income"] == 110001
    assert first["goals"] == {
        "savings": 22000,
        "entertainment": 33000,
        "recurring_ceiling": 55001,
        "emergency_fund": 660006,
        "capital": 13200120,
    }
    assert auth_client.get("/api/v1/budget/2026-11").json() == body
    assert (
        auth_client.put("/api/v1/budget/2026-11", json={"salary": 0, "freelance": []}).status_code
        == 200
    )
    assert tools.get_budget_impl("2026-11")["income"] == 0
    assert tools.get_budget_impl("2026-12")["income"] == 0


@pytest.mark.parametrize("month", ["2026-00", "2026-13", "0000-01", "2026-1", "x"])
def test_budget_rejects_invalid_month_without_writing(client, month):
    with pytest.raises(ValueError):
        tools.save_budget_impl(month, 10, [])


@pytest.mark.parametrize(
    "salary,receipts",
    [
        (-1, []),
        (1.5, []),
        (True, []),
        (10_000_000_001, []),
        (0, [{"title": "x", "amount": 0}]),
        (0, [{"amount": 1}] * 101),
    ],
)
def test_budget_reuses_rest_validation(client, salary, receipts):
    with pytest.raises(ValidationError):
        tools.save_budget_impl("2026-11", salary, receipts)


def test_expense_plan_uses_anchor_clamping_and_tag_split(client):
    tools.create_expense_impl(
        "Месяц", 120, "recurring", "month", "2026-01-31", tags=["дом", "работа"]
    )
    tools.create_expense_impl("Год", 1200, "recurring", "year", "2026-01-31")
    tools.create_expense_impl("День", 12, "recurring", "day", "2026-02-27")
    tools.create_expense_impl("Пауза", 99, "recurring", "month", "2026-01-01", active=False)
    plan = tools.expense_plan_impl("2026-02")
    assert [(c["title"], c["date"]) for c in plan["charges"]] == [
        ("День", "2026-02-27"),
        ("Месяц", "2026-02-28"),
        ("День", "2026-02-28"),
    ]
    assert plan["scheduled_total"] == 14400
    assert plan["monthly_recurring"] == 58500  # 120 + 100 + 365 rubles
    assert {row["tag"]: row["amount"] for row in plan["tags"]} == {
        None: 46500,
        "дом": 6000,
        "работа": 6000,
    }


def test_ai_tools_preview_and_degradation(client, monkeypatch):
    assert tools.draft_task_impl("Купить бумагу")["ai_ok"] is False
    monkeypatch.setattr(tools.get_settings(), "anthropic_api_key", "mock-only")

    def call_model(system, user_message, schema=TaskDraft):
        if schema is ExpenseDraft:
            return ExpenseDraft(title="Бумага", amount_rub=123.45), 1, 1
        if schema is AgentPromptDraft:
            return AgentPromptDraft(prompt="Выполни задачу"), 1, 1
        return TaskDraft(title="Черновик", project="Новый", project_description="Из AI"), 1, 1

    monkeypatch.setattr(ai, "_call_model", call_model)
    draft = tools.draft_task_impl("Текст")
    assert draft["ai_ok"] is True
    assert draft["project_id"] in {p["id"] for p in tools.list_projects_impl()}
    expense = tools.draft_expense_impl("Бумага")
    assert expense["amount"] == 12345
    task = tools.create_task_impl("Исходная", project="Inbox")
    preview = tools.enhance_task_impl(task["id"])
    assert preview["draft"]["title"] == "Черновик"
    assert tools.get_task_impl(task["id"])["title"] == "Исходная"
    assert tools.agent_prompt_impl(task["id"])["prompt"] == "Выполни задачу"


def test_insights_exposes_same_analytics_without_llm(client):
    result = tools.insights_impl(7)
    assert result["ai_ok"] is False
    assert result["data"]["coverage"]["window_days"] == 7


def test_transcribe_base64_limits_and_disabled_service(client, monkeypatch):
    with pytest.raises(stt.SttError):
        tools.transcribe_audio_impl("YQ==")
    monkeypatch.setattr(tools.get_settings(), "whisper_base_url", "http://mock-only")
    monkeypatch.setattr(tools.get_settings(), "whisper_max_audio_mb", 0.00001)
    with pytest.raises(ValueError):
        tools.transcribe_audio_impl("???")
    with pytest.raises(ValueError):
        tools.transcribe_audio_impl(base64.b64encode(b"x" * 20).decode())
    monkeypatch.setattr(stt, "transcribe", lambda audio, filename, content_type: "Речь")
    assert tools.transcribe_audio_impl("YQ==") == {"text": "Речь"}


def test_every_business_route_has_an_mcp_counterpart(client):
    # Auth uses the MCP Bearer gate. The catalog is tools/list itself.
    from app.main import create_app

    routes = {
        (method.upper(), path)
        for path, methods in create_app().openapi()["paths"].items()
        for method in methods
        if path.startswith("/api/v1/") and not path.startswith(("/api/v1/auth/", "/api/v1/mcp/"))
    }
    counterparts = {
        ("GET", "/api/v1/projects"): "list_projects",
        ("POST", "/api/v1/projects"): "create_project",
        ("PATCH", "/api/v1/projects/{project_id}"): "update_project",
        ("DELETE", "/api/v1/projects/{project_id}"): "delete_project",
        ("GET", "/api/v1/tasks"): "list_tasks",
        ("POST", "/api/v1/tasks"): "create_task",
        ("GET", "/api/v1/tasks/{task_id}"): "get_task",
        ("PATCH", "/api/v1/tasks/{task_id}"): "update_task",
        ("POST", "/api/v1/tasks/{task_id}/move"): "move_task",
        ("DELETE", "/api/v1/tasks/{task_id}"): "delete_task",
        ("GET", "/api/v1/expenses"): "list_expenses",
        ("POST", "/api/v1/expenses"): "create_expense",
        ("GET", "/api/v1/expenses/{expense_id}"): "get_expense",
        ("PATCH", "/api/v1/expenses/{expense_id}"): "update_expense",
        ("POST", "/api/v1/expenses/{expense_id}/move"): "move_expense",
        ("DELETE", "/api/v1/expenses/{expense_id}"): "delete_expense",
        ("GET", "/api/v1/expenses/summary"): "expenses_summary",
        ("GET", "/api/v1/budget/{month}"): "get_budget",
        ("PUT", "/api/v1/budget/{month}"): "save_budget",
        ("GET", "/api/v1/analytics"): "analytics",
        ("POST", "/api/v1/ai/draft"): "draft_task",
        ("POST", "/api/v1/ai/draft-expense"): "draft_expense",
        ("POST", "/api/v1/ai/enhance/{task_id}"): "enhance_task",
        ("POST", "/api/v1/ai/agent-prompt/{task_id}"): "agent_prompt",
        ("POST", "/api/v1/ai/insights"): "insights",
        ("POST", "/api/v1/ai/transcribe"): "transcribe_audio",
    }
    assert routes == set(counterparts)
    names = {tool.name for tool in asyncio.run(tools.mcp.list_tools())}
    assert set(counterparts.values()) <= names
    assert "expense_plan" in names


@pytest.mark.parametrize("salary", [True, 1.0, "125"])
def test_mcp_transport_rejects_non_integer_salary_without_replacing_budget(client, salary):
    from mcp.server.fastmcp.exceptions import ToolError

    tools.save_budget_impl("2026-11", 50000, [])
    with pytest.raises(ToolError):
        asyncio.run(
            tools.mcp.call_tool(
                "save_budget",
                {
                    "month": "2026-11",
                    "salary": salary,
                    "freelance": [],
                },
            )
        )
    assert tools.get_budget_impl("2026-11")["salary"] == 50000


def test_auto_format_keeps_explicit_project_id(client, monkeypatch):
    monkeypatch.setattr(tools.get_settings(), "anthropic_api_key", "mock-only")
    monkeypatch.setattr(
        ai,
        "_call_model",
        lambda *args: (
            TaskDraft(title="Оформлено", project="Предложение AI"),
            1,
            1,
        ),
    )
    project = tools.create_project_impl("Выбранный проект")
    task = tools.create_task_impl("Текст", project_id=project["id"], auto_format=True)
    assert task["project_id"] == project["id"]
    assert task["title"] == "Оформлено"
    assert "Предложение AI" not in {row["name"] for row in tools.list_projects_impl()}


def test_expense_plan_respects_portal_search_and_tag_filters(client):
    tools.create_expense_impl("Интернет", 500, "recurring", "month", "2026-11-01", tags=["дом"])
    tools.create_expense_impl("Сервер", 1000, "recurring", "month", "2026-11-02", tags=["работа"])
    plan = tools.expense_plan_impl("2026-11", tag="дом", query="интернет")
    assert plan["monthly_recurring"] == 50000
    assert len(plan["charges"]) == 1
    assert tools.expense_plan_impl("2026-11", query="Несуществующий")["charges"] == []
