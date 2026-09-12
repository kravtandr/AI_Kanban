"""Оценка усилий в черновике: мягкая схема (§9.1) и контекст промпта (§9.2, §9.3).

Сеть не используется: мокается ai._call_model, как в test_ai.py.
"""

from datetime import date

import pytest

from app.config import get_settings
from app.models import TaskPriority
from app.schemas import TaskDraft
from app.services import ai as ai_svc
from app.services import analytics as analytics_svc


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    """get_settings кэширован lru_cache; monkeypatch откатывает env, но не кэш."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _use_llm(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()


def test_bad_estimate_never_takes_the_draft_down():
    """Самый важный тест набора: чистая схема, без LLM.

    "medium" — не бакет, но заголовок, описание и маршрутизация обязаны уцелеть:
    ValidationError на весь TaskDraft стоил бы пользователю всего черновика.
    """
    draft = TaskDraft.model_validate(
        {
            "title": "Починить бэкап на NAS",
            "description": "- [ ] проверить cron",
            "project": "Homelab",
            "project_description": "Домашний сервер и всё вокруг него",
            "priority": "high",
            "tags": ["homelab"],
            "due_date": "2026-09-01",
            "estimate": "medium",
        }
    )
    assert draft.estimate is None
    assert draft.title == "Починить бэкап на NAS"
    assert draft.description == "- [ ] проверить cron"
    assert draft.project == "Homelab"
    assert draft.project_description == "Домашний сервер и всё вокруг него"
    assert draft.priority is TaskPriority.high
    assert draft.tags == ["homelab"]
    assert draft.due_date == date(2026, 9, 1)


@pytest.mark.parametrize("value", [3, "", "XXL", "Small", "medium", "  ", None])
def test_unusable_estimate_becomes_none(value):
    assert TaskDraft.model_validate({"title": "x", "estimate": value}).estimate is None


@pytest.mark.parametrize(("value", "expected"), [("M", "M"), (" m? ", "M"), ("xs.", "XS")])
def test_recognisable_estimate_survives_model_sloppiness(value, expected):
    assert TaskDraft.model_validate({"title": "x", "estimate": value}).estimate == expected


def test_draft_surfaces_the_estimate(auth_client, monkeypatch):
    _use_llm(monkeypatch)

    def fake_call(system: str, user_message: str):
        return TaskDraft(title="Починить бэкап на NAS", estimate="M"), 100, 50

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)

    body = auth_client.post("/api/v1/ai/draft", json={"text": "бэкап сломался"}).json()
    assert body["ai_ok"] is True
    assert body["draft"]["estimate"] == "M"


def test_draft_survives_a_broken_estimate_context(auth_client, monkeypatch):
    """_safe_estimate_context глотает отказ: черновик доезжает целиком (§9.3)."""
    _use_llm(monkeypatch)
    captured: dict = {}

    def boom(db):
        raise ZeroDivisionError("empty sample")

    def fake_call(system: str, user_message: str):
        captured["user"] = user_message
        return TaskDraft(title="Починить бэкап"), 10, 5

    monkeypatch.setattr(ai_svc, "_estimate_context", boom)
    monkeypatch.setattr(ai_svc, "_call_model", fake_call)

    response = auth_client.post("/api/v1/ai/draft", json={"text": "бэкап сломался"})
    assert response.status_code == 200, response.text
    assert response.json()["draft"]["title"] == "Починить бэкап"
    assert "Effort buckets" not in captured["user"]


def test_draft_survives_a_broken_message_assembly(auth_client, monkeypatch):
    """Вторая мера §9.3: сборка user_message стоит ВНУТРИ try.

    Отказ на самой сборке обязан деградировать в fallback-черновик и 200,
    а не в 500, который убил бы весь путь создания задачи через AI.
    """
    _use_llm(monkeypatch)

    def boom(db):
        raise RuntimeError("context exploded")

    monkeypatch.setattr(ai_svc, "_safe_estimate_context", boom)

    response = auth_client.post("/api/v1/ai/draft", json={"text": "бэкап сломался"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ai_ok"] is False
    assert body["draft"]["title"] == "бэкап сломался"


def test_prompt_carries_the_seed_ladder_and_never_the_recalibrated_one(auth_client, monkeypatch):
    """§3.3: оценщик и калибратор не имеют права делить одну переменную."""
    _use_llm(monkeypatch)
    captured: dict = {}

    def forbidden(*args, **kwargs):
        raise AssertionError("recalibrated ladder must never reach the estimate prompt")

    monkeypatch.setattr(analytics_svc, "calibrate", forbidden)
    monkeypatch.setattr(analytics_svc, "compute", forbidden)

    def fake_call(system: str, user_message: str):
        captured["system"] = system
        captured["user"] = user_message
        return TaskDraft(title="Починить бэкап"), 10, 5

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)
    auth_client.post("/api/v1/ai/draft", json={"text": "бэкап сломался"})

    assert "- XS = 15 min of focused work" in captured["user"]
    assert "- XL = 720 min of focused work" in captured["user"]
    # Пустой корпус: блок примеров отсутствует целиком, шкала на месте.
    assert "Recently finished on this board" not in captured["user"]
    assert "measured effort data" in captured["system"]


def test_example_titles_are_collapsed_and_truncated(auth_client, monkeypatch):
    """Заголовки задач впервые едут в промпт и до сих пор не санировались нигде."""
    _use_llm(monkeypatch)
    long_title = "почин\nить\tбэкап " + "я" * 200
    monkeypatch.setattr(
        analytics_svc,
        "recent_finished_examples",
        lambda db, limit=6: [(long_title, "Homelab", "M", 90)],
    )
    captured: dict = {}

    def fake_call(system: str, user_message: str):
        captured["user"] = user_message
        return TaskDraft(title="ок"), 10, 5

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)
    auth_client.post("/api/v1/ai/draft", json={"text": "бэкап сломался"})

    line = next(ln for ln in captured["user"].splitlines() if "[Homelab]" in ln)
    assert "\t" not in line
    # "почин ить бэкап " — 16 символов, MAX_PROMPT_TITLE_LEN=80, значит ровно 64 "я".
    expected_title = "почин ить бэкап " + "я" * 64
    assert line == f'- "{expected_title}" [Homelab] estimated M, actually 90 min'


def test_sanitize_title_collapses_and_caps():
    assert ai_svc._sanitize_title("  a\n\nb\tc  ") == "a b c"
    assert len(ai_svc._sanitize_title("x" * 300)) == ai_svc.MAX_PROMPT_TITLE_LEN
    assert ai_svc._sanitize_title(None) == ""


def test_enhance_also_gets_the_scale(auth_client, monkeypatch):
    _use_llm(monkeypatch)
    task = auth_client.post("/api/v1/tasks", json={"title": "Починить бэкап"}).json()
    captured: dict = {}

    def fake_call(system: str, user_message: str):
        captured["user"] = user_message
        return TaskDraft(title="Починить бэкап на NAS", estimate="L"), 10, 5

    monkeypatch.setattr(ai_svc, "_call_model", fake_call)

    body = auth_client.post(f"/api/v1/ai/enhance/{task['id']}").json()
    assert body["draft"]["estimate"] == "L"
    assert "Effort buckets (fixed reference scale):" in captured["user"]
