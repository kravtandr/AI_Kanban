from sqlalchemy import text

from app.db import _make_engine


def test_sqlite_unicode_names_and_foreign_keys():
    engine = _make_engine("sqlite://")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT lower('СВАРОГ')")) == "сварог"
        assert connection.scalar(text("PRAGMA foreign_keys")) == 1
    engine.dispose()
