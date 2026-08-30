"""Local-day boundaries (§7.3). Time is an argument, never a global clock:
no freezegun, no sleep — the clock is a patched datetime class (§13)."""

from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from app import db as db_module
from app.config import get_settings
from app.services import ai as ai_module
from app.services import tasks as task_svc


class _FrozenClock(datetime):
    """22:30 UTC — the hour at which the Moscow day is already the next one."""

    @classmethod
    def now(cls, tz=None):
        moment = datetime(2026, 8, 29, 22, 30, tzinfo=UTC)
        return moment.astimezone(tz) if tz is not None else moment.replace(tzinfo=None)


@pytest.fixture(autouse=True)
def _settings_cache():
    """TIMEZONE is read through a cached Settings object; clear it on both sides so
    neither this test nor its neighbour inherits the other's timezone."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_local_today_crosses_midnight_in_local_timezone(monkeypatch):
    monkeypatch.setenv("TIMEZONE", "Europe/Moscow")
    monkeypatch.setattr(task_svc, "datetime", _FrozenClock)

    assert task_svc.local_today() == date(2026, 8, 30)


def test_local_today_falls_back_to_utc_on_a_broken_timezone(monkeypatch):
    monkeypatch.setenv("TIMEZONE", "Not/AZone")
    monkeypatch.setattr(task_svc, "datetime", _FrozenClock)

    assert task_svc.local_today() == date(2026, 8, 29)


def test_local_day_bounds_are_naive_utc(monkeypatch):
    monkeypatch.setenv("TIMEZONE", "Europe/Moscow")

    start, end = task_svc.local_day_bounds(date(2026, 8, 30))

    assert start == datetime(2026, 8, 29, 21, 0)
    assert end == datetime(2026, 8, 30, 21, 0)
    assert start.tzinfo is None and end.tzinfo is None


def test_daily_summary_uses_local_day_boundaries(auth_client, monkeypatch):
    """21:30 UTC on Aug 29 is 00:30 on Aug 30 in Moscow — it belongs to Aug 30.

    Green before the refactor and green after it: this is the regression guard that
    proves local_day_bounds reproduces the idiom it replaces, byte for byte.
    """
    monkeypatch.setenv("TIMEZONE", "Europe/Moscow")
    # The client fixture calls init_db(), which caches Settings(timezone="UTC")
    # before this body runs; without the clear, daily_summary would still see UTC.
    get_settings.cache_clear()

    with db_module.get_session_factory()() as db:
        task = task_svc.create_task(db, title="Починить бэкап")
        task.completed_at = datetime(2026, 8, 29, 21, 30)
        db.commit()
        summary = task_svc.daily_summary(db, date(2026, 8, 30))

    assert [row["title"] for row in summary["completed"]] == ["Починить бэкап"]


def test_ai_prompts_do_not_use_the_utc_day():
    source = Path(ai_module.__file__).read_text(encoding="utf-8")

    assert "date.today()" not in source
    assert source.count("local_today()") == 2
