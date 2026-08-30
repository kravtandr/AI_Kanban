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
