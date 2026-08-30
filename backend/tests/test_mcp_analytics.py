"""MCP: инструмент analytics и оценка у create_task/update_task (§10.2).

Инструменты — тонкие обёртки над *_impl; тестируются impl-функции, как в test_mcp.py.
"""

import inspect

from sqlalchemy import select

from app import db as db_module
from app import mcp_server
from app.models import TaskEstimate


def test_tool_name_does_not_shadow_the_service_module(client):
    """Без алиаса analytics_svc декоратор перезаписал бы имя модуля, и первый же
    вызов инструмента упал бы с AttributeError на .compute."""
    assert not inspect.ismodule(mcp_server.analytics), "имя analytics занято инструментом"
    assert inspect.ismodule(mcp_server.analytics_svc), "сервис обязан быть под алиасом"
    assert mcp_server.analytics_impl()["coverage"]["window_days"] == 30


def test_analytics_returns_measured_stats(client):
    result = mcp_server.analytics_impl(days=7)

    assert result["coverage"]["window_days"] == 7
    assert [b["bucket"] for b in result["buckets"]] == ["XS", "S", "M", "L", "XL"]
    assert result["stuck"] == []
    assert result["running"] == []
    # mode="json": ответ инструмента обязан быть сериализуемым без pydantic-типов
    assert isinstance(result["coverage"]["as_of"], str)


def test_analytics_clamps_days(client):
    """У MCP нет валидации Query — зажим явный (§7.4)."""
    assert mcp_server.analytics_impl(days=0)["coverage"]["window_days"] == 1
    assert mcp_server.analytics_impl(days=-5)["coverage"]["window_days"] == 1
    assert mcp_server.analytics_impl(days=99999)["coverage"]["window_days"] == 3650


def _estimates(task_id: int) -> list[tuple[str, str, bool]]:
    with db_module.get_session_factory()() as db:
        rows = db.scalars(
            select(TaskEstimate).where(TaskEstimate.task_id == task_id).order_by(TaskEstimate.id)
        ).all()
        return [(r.bucket, r.source, r.before_work) for r in rows]


def test_create_task_records_the_estimate_as_mcp(client):
    task = mcp_server.create_task_impl(title="Обновить caddy", project="Inbox", estimate="S")
    assert _estimates(task["id"]) == [("S", "mcp", True)]


def test_create_task_ignores_an_invalid_estimate(client):
    task = mcp_server.create_task_impl(title="Обновить caddy", project="Inbox", estimate="huge")
    assert task["title"] == "Обновить caddy"
    assert _estimates(task["id"]) == []


def test_update_task_sets_and_clears_the_estimate(client):
    task = mcp_server.create_task_impl(title="Починить бэкап", project="Inbox")
    mcp_server.update_task_impl(task["id"], estimate="l")
    assert _estimates(task["id"]) == [("L", "mcp", True)]

    mcp_server.update_task_impl(task["id"], clear_estimate=True)
    # Надгробие, а не удаление строки: журнал append-only (§9.1).
    assert _estimates(task["id"]) == [("L", "mcp", True), ("", "mcp", True)]


def test_update_task_without_estimate_writes_nothing(client):
    task = mcp_server.create_task_impl(title="Починить бэкап", project="Inbox")
    mcp_server.update_task_impl(task["id"], title="Починить бэкап на NAS")
    assert _estimates(task["id"]) == []


def test_agent_cannot_forge_the_estimate_provenance(client):
    """estimate_source не параметр инструмента: агент не выбирает, чьей оценка записана."""
    assert "estimate_source" not in inspect.signature(mcp_server.create_task_impl).parameters
    assert "estimate_source" not in inspect.signature(mcp_server.update_task_impl).parameters


# --- Finding #5: the MCP agent can WRITE an estimate but every _task_dict-shaped
# return value used to omit it entirely, so the agent had no way to know one was
# already set -- and re-estimating after work started writes a before_work=False
# revision, not a duplicate forecast.


def test_create_task_response_carries_the_estimate(client):
    task = mcp_server.create_task_impl(title="Обновить caddy", project="Inbox", estimate="S")
    assert task["estimate"] == "S"


def test_create_task_response_reports_null_without_an_estimate(client):
    task = mcp_server.create_task_impl(title="Обновить caddy", project="Inbox")
    assert task["estimate"] is None


def test_get_task_response_carries_the_estimate(client):
    task = mcp_server.create_task_impl(title="Обновить caddy", project="Inbox", estimate="M")
    fetched = mcp_server.get_task_impl(task["id"])
    assert fetched["estimate"] == "M"


def test_update_task_response_carries_the_estimate(client):
    task = mcp_server.create_task_impl(title="Починить бэкап", project="Inbox")
    updated = mcp_server.update_task_impl(task["id"], estimate="l")
    assert updated["estimate"] == "L"


def test_move_and_complete_response_carry_the_estimate(client):
    task = mcp_server.create_task_impl(title="Починить бэкап", project="Inbox", estimate="XS")
    moved = mcp_server.move_task_impl(task["id"], "in_progress")
    assert moved["estimate"] == "XS"
    done = mcp_server.complete_task_impl(task["id"])
    assert done["estimate"] == "XS"


def test_list_tasks_response_carries_the_estimate_without_an_n_plus_one(client, monkeypatch):
    """analytics.latest_estimates(db, ids) must be called ONCE, batched over all
    listed tasks -- not once per task."""
    from app.services import analytics as analytics_svc

    mcp_server.create_task_impl(title="Задача А", project="Inbox", estimate="S")
    mcp_server.create_task_impl(title="Задача Б", project="Inbox", estimate="L")

    calls: list[list[int]] = []
    original = analytics_svc.latest_estimates

    def counting(db, task_ids):
        calls.append(list(task_ids))
        return original(db, task_ids)

    monkeypatch.setattr(mcp_server.analytics_svc, "latest_estimates", counting)

    tasks = mcp_server.list_tasks_impl(query="Задача")

    assert {t["title"]: t["estimate"] for t in tasks} == {"Задача А": "S", "Задача Б": "L"}
    assert len(calls) == 1
    assert set(calls[0]) == {t["id"] for t in tasks}
