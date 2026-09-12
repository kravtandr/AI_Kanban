from datetime import date

import pytest

from app.models import ExpensePeriod
from app.services.expenses import next_charge

P = ExpensePeriod


@pytest.mark.parametrize(
    ("period", "anchor", "today", "expected"),
    [
        (P.day, date(2026, 1, 1), date(2026, 9, 6), date(2026, 9, 6)),
        (P.month, date(2026, 1, 15), date(2026, 9, 6), date(2026, 9, 15)),
        (P.month, date(2026, 1, 15), date(2026, 9, 15), date(2026, 9, 15)),  # сегодня
        (P.month, date(2026, 1, 15), date(2026, 9, 16), date(2026, 10, 15)),
        (P.month, date(2026, 1, 31), date(2026, 2, 1), date(2026, 2, 28)),  # прижатие
        (P.month, date(2026, 1, 31), date(2026, 3, 1), date(2026, 3, 31)),  # не залипает
        (P.month, date(2024, 1, 31), date(2024, 2, 1), date(2024, 2, 29)),  # високосный
        (P.quarter, date(2025, 11, 30), date(2026, 1, 1), date(2026, 2, 28)),
        (P.quarter, date(2025, 11, 30), date(2026, 3, 1), date(2026, 5, 30)),
        (P.year, date(2024, 2, 29), date(2025, 1, 1), date(2025, 2, 28)),
        (P.year, date(2024, 2, 29), date(2028, 1, 1), date(2028, 2, 29)),
        (P.month, date(2026, 12, 1), date(2026, 9, 6), date(2026, 12, 1)),  # anchor в будущем
        (P.year, date(2020, 9, 6), date(2026, 9, 6), date(2026, 9, 6)),
    ],
)
def test_next_charge(period, anchor, today, expected):
    assert next_charge(period, anchor, today) == expected
