"""AI-инсайты (§11): свободный текст поверх измеренных чисел.

Мокается ai._call_text_model — второй шов, отдельный от _call_model.
"""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app import db as db_module
from app.config import get_settings
from app.models import LlmUsage, TaskEvent, TaskStatus
from app.services import ai as ai_svc
from app.services import tasks as task_svc


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _use_llm(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()


def _backdate(task_id: int, shifts: dict[str, int]) -> None:
    """Раздвинуть журнал задачи по часам: {"todo": 3, "in_progress": 2}.

    Сдвигается ВСЯ цепочка, а не одно событие: R3 зажимает метки вперёд
    (at = max(at, prev_at)), поэтому одиночный сдвиг назад был бы отменён свёрткой.
    Правится только task_events; строки Task не трогаются, поэтому сторож §5.4 п.3
    молчит.
    """
    with db_module.get_session_factory()() as db:
        for event in db.scalars(select(TaskEvent).where(TaskEvent.task_id == task_id)):
            hours = shifts.get(event.status)
            if hours:
                event.at = event.at - timedelta(hours=hours)
        db.commit()


def _two_hours_of_closed_work() -> int:
    """Задача, отработавшая 2 часа и закрытая. Оценки нет: корпус пуст,
    closed_minutes > 0 — ровно то состояние, в котором модель ВЫЗЫВАЕТСЯ."""
    with db_module.get_session_factory()() as db:
        task = task_svc.create_task(db, title="Починить бэкап на NAS")
        task_svc.move_task(db, task.id, TaskStatus.in_progress)
        task_svc.move_task(db, task.id, TaskStatus.done)
        task_id = task.id
    _backdate(task_id, {"todo": 3, "in_progress": 2})
    return task_id


def test_insights_requires_auth(client):
    assert client.post("/api/v1/ai/insights", json={"days": 30}).status_code == 401


def test_insights_without_llm_returns_full_data(auth_client):
    """Деградация полная: data заполнен, это ровно то, что страница и так рисует."""
    response = auth_client.post("/api/v1/ai/insights", json={"days": 30})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ai_ok"] is False
    assert body["ai_error"] == "LLM is not configured"
    assert body["text"] == ""
    assert body["data"]["coverage"]["window_days"] == 30
    assert [b["bucket"] for b in body["data"]["buckets"]] == ["XS", "S", "M", "L", "XL"]
    assert body["facts"].startswith("Period: last 30 days.")


def test_insights_short_circuits_on_an_empty_board(auth_client, monkeypatch):
    """corpus_size == 0 И closed_minutes == 0 — оба конъюнкта (§11.3)."""
    _use_llm(monkeypatch)

    def forbidden(system: str, user_message: str):
        raise AssertionError("the model must not be called on an empty board")

    monkeypatch.setattr(ai_svc, "_call_text_model", forbidden)

    body = auth_client.post("/api/v1/ai/insights", json={"days": 30}).json()

    assert body["ai_ok"] is False
    assert body["ai_error"] == "not enough data yet"
    assert body["data"]["coverage"]["corpus_size"] == 0
    assert body["data"]["closed_minutes"] == 0


def test_insights_calls_the_model_when_time_is_tracked(auth_client, monkeypatch):
    """Второй конъюнкт: корпус пуст, но закрытое время есть — модель вызывается."""
    _use_llm(monkeypatch)
    _two_hours_of_closed_work()
    captured: dict = {}

    def fake_call(system: str, user_message: str):
        captured["system"] = system
        captured["user"] = user_message
        return "Задачи закрываются за 120 минут.", 300, 40

    monkeypatch.setattr(ai_svc, "_call_text_model", fake_call)

    body = auth_client.post("/api/v1/ai/insights", json={"days": 30}).json()

    assert body["ai_ok"] is True
    assert body["ai_error"] is None
    assert body["text"] == "Задачи закрываются за 120 минут."
    assert body["data"]["coverage"]["corpus_size"] == 0
    assert body["data"]["closed_minutes"] > 0
    assert "аналитик ретроспективы" in captured["system"]

    with db_module.get_session_factory()() as db:
        rows = db.scalars(select(LlmUsage).where(LlmUsage.operation == "insights")).all()
    assert [(r.ok, r.input_tokens, r.output_tokens) for r in rows] == [(True, 300, 40)]


def test_facts_are_returned_byte_for_byte(auth_client, monkeypatch):
    """Выдуманное число видно тем, что его нет в фактах — значит факты обязаны
    совпадать с аргументом вызова дословно."""
    _use_llm(monkeypatch)
    _two_hours_of_closed_work()
    captured: dict = {}

    def fake_call(system: str, user_message: str):
        captured["user"] = user_message
        return "ок", 10, 5

    monkeypatch.setattr(ai_svc, "_call_text_model", fake_call)

    body = auth_client.post("/api/v1/ai/insights", json={"days": 7}).json()

    assert body["facts"] == captured["user"]
    assert body["data"]["coverage"]["window_days"] == 7
    assert body["facts"].startswith("Period: last 7 days.")
    # Каждое число витрины обязано быть в фактах дословно, иначе «сверься с фактами»
    # не работает. Закрытая задача не stuck и не running, поэтому её заголовок в
    # блок не идёт вовсе — проверяется именно число, а не название.
    closed = body["data"]["closed_minutes"]
    assert f"Closed work in the period: {closed} min " in body["facts"]


def test_insights_degrades_when_the_model_fails(auth_client, monkeypatch):
    _use_llm(monkeypatch)
    _two_hours_of_closed_work()

    def boom(system: str, user_message: str):
        raise TimeoutError("upstream timed out")

    monkeypatch.setattr(ai_svc, "_call_text_model", boom)

    response = auth_client.post("/api/v1/ai/insights", json={"days": 30})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ai_ok"] is False
    assert "upstream timed out" in body["ai_error"]
    assert body["text"] == ""
    assert body["facts"]

    with db_module.get_session_factory()() as db:
        rows = db.scalars(select(LlmUsage).where(LlmUsage.operation == "insights")).all()
    assert [r.ok for r in rows] == [False]


def test_text_reply_is_cleaned_and_capped():
    cleaned = ai_svc._clean_text_reply(
        "<think>подумаю\nещё</think>```\n  Проекты   идут\nмимо оценок. ```"
    )
    assert cleaned == "Проекты идут мимо оценок."

    assert len(ai_svc._clean_text_reply("я" * 5000)) == ai_svc.MAX_INSIGHTS_CHARS

    with pytest.raises(ValueError):
        ai_svc._clean_text_reply("<think>только рассуждения</think>   ")


def test_call_text_model_uses_the_plain_chat_seam(monkeypatch):
    """Блок формата TaskDraft в этот вызов не подмешивается (§11.1)."""
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://fake:9443/v1")
    monkeypatch.setenv("OPENAI_MODEL", "qwen-test")
    get_settings.cache_clear()
    captured: dict = {}

    def fake_chat(system: str, user_message: str):
        captured["system"] = system
        return "Всё ровно.", 11, 22

    monkeypatch.setattr(ai_svc, "_openai_chat", fake_chat)

    assert ai_svc._call_text_model("система", "факты") == ("Всё ровно.", 11, 22)
    assert captured["system"] == "система"
    assert "JSON" not in captured["system"]
