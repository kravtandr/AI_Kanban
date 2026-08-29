"""Pure fold of the state journal (§7.1 R1-R8) and the request window (§7.4).

No DB, no clock, no freezegun: `now` and the events are arguments (§13 p.1).
"""

from datetime import datetime, timedelta

import pytest

from app.services.analytics import (
    MAX_SPELL_SECONDS,
    Ev,
    Span,
    Spell,
    clip,
    fold,
    merge_runs,
)

T0 = datetime(2026, 8, 1, 9, 0, 0)


def at(hours: float) -> datetime:
    return T0 + timedelta(hours=hours)


def ev(
    event_id: int,
    hours: float,
    status: str,
    project_id: int | None = 1,
    source: str = "live",
) -> Ev:
    return Ev(id=event_id, at=at(hours), status=status, project_id=project_id, source=source)


def _seconds(spell: Spell) -> float:
    return sum((s.end - s.start).total_seconds() for s in spell.spans)


def test_empty_journal_yields_nothing():
    """R4: no synthetic residence from created_at -- that would invent a duration."""
    result = fold([], at(10))
    assert result.spans == ()
    assert result.spells == ()
    assert result.tracked is False
    assert result.anomalies == ()


def test_single_event_opens_an_interval():
    """R5: the last span ends at `now`; R8: that spell is OPEN."""
    result = fold([ev(1, 0, "in_progress")], at(2))
    assert len(result.spans) == 1
    assert result.spans[0].start == at(0)
    assert result.spans[0].end == at(2)
    assert [s.closed for s in result.spells] == [False]


def test_closed_cycle_counts_only_in_progress():
    """Time in backlog/todo is recorded but is not "time on the task" (decision 2)."""
    events = [ev(1, 0, "todo"), ev(2, 1, "in_progress"), ev(3, 3, "done")]
    result = fold(events, at(5))
    assert [s.status for s in result.spans] == ["todo", "in_progress", "done"]
    assert len(result.spells) == 1
    assert result.spells[0].closed is True
    assert _seconds(result.spells[0]) == 2 * 3600


def test_reopen_after_done_gives_two_spells():
    """§7.2: done -> in_progress is just one more event. Durations never read
    completed_at, so zeroing it in _apply_status does not touch the journal."""
    events = [
        ev(1, 0, "in_progress"),
        ev(2, 1, "done"),
        ev(3, 4, "in_progress"),
        ev(4, 6, "done"),
    ]
    result = fold(events, at(8))
    assert [s.closed for s in result.spells] == [True, True]
    assert [_seconds(s) for s in result.spells] == [3600, 2 * 3600]


def test_clock_regression_clamps_forward_without_inflating():
    """R3: at = max(at, prev). An NTP step back can neither lengthen an interval
    nor produce negative time -- the span collapses, it never swells."""
    events = [ev(1, 2, "in_progress"), ev(2, 1, "done")]
    result = fold(events, at(5))
    assert result.anomalies == ("clock_regression:2",)
    assert result.spans[0].start == at(2)
    assert result.spans[0].end == at(2)
    assert _seconds(result.spells[0]) == 0
    assert all(s.end >= s.start for s in result.spans)


def test_future_event_is_pulled_to_now_and_the_walk_continues():
    """R3: one broken RTC must not erase the rest of the history."""
    events = [ev(1, 0, "in_progress"), ev(2, 100, "todo"), ev(3, 2, "in_progress")]
    result = fold(events, at(3))
    assert result.anomalies == ("clock_advance:2", "clock_regression:3")
    assert len(result.spans) == 3  # the walk was NOT aborted
    assert result.spans[2].status == "in_progress"
    assert all(s.end <= at(3) for s in result.spans)


def test_fold_does_not_mutate_the_input_list():
    """§7: R3 builds a NEW list. A dirty `at` on a journal row would be flushed
    back as an UPDATE by the first commit in the same request."""
    events = [ev(1, 5, "in_progress"), ev(2, 1, "done")]
    snapshot = [(e.id, e.at, e.status, e.project_id, e.source) for e in events]
    fold(events, at(9))
    assert [(e.id, e.at, e.status, e.project_id, e.source) for e in events] == snapshot


def test_equal_at_is_ordered_by_id():
    """§7.2: two events with the same `at` are ordered deterministically by id."""
    events = [ev(2, 0, "done"), ev(1, 0, "in_progress")]
    result = fold(events, at(4))
    assert [s.status for s in result.spans] == ["in_progress", "done"]
    assert result.spans[0].start == result.spans[0].end
    assert result.spans[1].end == at(4)


def test_project_change_cuts_a_span_but_not_a_spell():
    """R6: four hours in one sitting with a move to another project halfway
    through is ONE spell, split into two spans."""
    events = [
        ev(1, 0, "in_progress", project_id=1),
        ev(2, 1, "in_progress", project_id=2),
        ev(3, 4, "done", project_id=2),
    ]
    result = fold(events, at(5))
    assert [s.project_id for s in result.spans] == [1, 2, 2]
    assert len(result.spells) == 1
    assert len(result.spells[0].spans) == 2
    assert _seconds(result.spells[0]) == 4 * 3600


def test_closed_spell_over_the_cap_is_stamped_with_k():
    """R7: k is a STAMP on every span of the spell; start/end never move, so the
    proportion between projects survives untouched."""
    events = [
        ev(1, 0, "in_progress", project_id=1),
        ev(2, 45, "in_progress", project_id=2),
        ev(3, 60, "done", project_id=2),
    ]
    result = fold(events, at(61))
    spell = result.spells[0]
    assert spell.closed is True
    assert [s.factor for s in spell.spans] == [pytest.approx(0.4), pytest.approx(0.4)]
    assert spell.spans[0].start == at(0)
    assert spell.spans[0].end == at(45)
    assert spell.spans[1].start == at(45)
    assert spell.spans[1].end == at(60)
    weighted = [(s.end - s.start).total_seconds() * s.factor for s in spell.spans]
    assert weighted == [pytest.approx(18 * 3600), pytest.approx(6 * 3600)]
    assert sum(weighted) == pytest.approx(MAX_SPELL_SECONDS)


def test_open_spell_is_never_capped():
    """R7: capping an open spell would make the live timer jump BACKWARDS on every
    refetch (§12.1) -- a clock running in reverse."""
    result = fold([ev(1, 0, "in_progress")], at(60))
    spell = result.spells[0]
    assert spell.closed is False
    assert [s.factor for s in spell.spans] == [1.0]
    assert _seconds(spell) == 60 * 3600
    assert _seconds(spell) > MAX_SPELL_SECONDS


@pytest.mark.parametrize("terminal", ["deleted", "parked"])
def test_terminal_status_closes_the_interval(terminal):
    """§7.2: `deleted` and `parked` close the interval and accumulate nothing."""
    events = [ev(1, 0, "in_progress"), ev(2, 2, terminal)]
    result = fold(events, at(100))
    assert [s.closed for s in result.spells] == [True]
    assert _seconds(result.spells[0]) == 2 * 3600
    assert result.spans[1].status == terminal


def test_open_and_closed_spells_never_mix():
    """R8: closed and open seconds are two numbers, never one."""
    events = [ev(1, 0, "in_progress"), ev(2, 1, "todo"), ev(3, 2, "in_progress")]
    result = fold(events, at(5))
    assert [_seconds(s) for s in result.spells if s.closed] == [3600]
    assert [_seconds(s) for s in result.spells if not s.closed] == [3 * 3600]


def test_merge_runs_glues_consecutive_in_progress_spans_only():
    """R6 over a raw span list: adjacency is a property of POSITION, not of
    timestamps -- a zero-length residence in between still breaks the spell."""
    spans = [
        Span(start=at(0), end=at(1), status="in_progress", project_id=1),
        Span(start=at(1), end=at(1), status="todo", project_id=1),
        Span(start=at(1), end=at(3), status="in_progress", project_id=1),
    ]
    spells = merge_runs(spans)
    assert [len(s.spans) for s in spells] == [1, 1]
    assert [s.closed for s in spells] == [True, False]


def test_seed_before_the_first_in_progress_keeps_the_task_tracked():
    """R2 is INTERVAL-based: a non-live event that only pinned the starting point
    could not hide a single minute of work."""
    events = [ev(1, 0, "todo", source="seed"), ev(2, 1, "in_progress"), ev(3, 3, "done")]
    assert fold(events, at(5)).tracked is True


def test_seed_exactly_at_the_first_in_progress_untracks_the_task():
    """R2 uses a NON-STRICT boundary: such a seed invented the START of a spell."""
    events = [ev(1, 0, "in_progress", source="seed"), ev(2, 3, "done")]
    assert fold(events, at(5)).tracked is False


def test_drift_after_the_first_in_progress_untracks_the_task():
    """A non-live event later than the first in_progress could have hidden a whole
    spell -- we do not know WHEN the state changed."""
    events = [ev(1, 0, "todo"), ev(2, 1, "in_progress"), ev(3, 3, "done", source="drift")]
    assert fold(events, at(5)).tracked is False


def test_task_without_any_in_progress_is_not_tracked():
    """Nothing to measure, so the corpus does not take it (R2)."""
    assert fold([ev(1, 0, "todo"), ev(2, 1, "done")], at(5)).tracked is False


def test_clip_cuts_on_both_boundaries_and_carries_factor():
    """§7.4: status, project_id and factor are carried over UNCHANGED."""
    span = Span(start=at(0), end=at(10), status="in_progress", project_id=7, factor=0.4)
    (clipped,) = clip([span], at(2), at(6))
    assert clipped.start == at(2)
    assert clipped.end == at(6)
    assert clipped.status == "in_progress"
    assert clipped.project_id == 7
    assert clipped.factor == pytest.approx(0.4)


def test_clip_drops_a_span_entirely_outside_the_window():
    span = Span(start=at(0), end=at(1), status="in_progress", project_id=1)
    assert clip([span], at(5), at(9)) == []


def test_clip_drops_a_span_that_ends_exactly_at_the_window_start():
    """A zero-length row must not reach the list at all."""
    span = Span(start=at(0), end=at(5), status="in_progress", project_id=1)
    assert clip([span], at(5), at(9)) == []


def test_window_example_60h_spell_20h_inside_contributes_8h():
    """§7.4 worked example: k = 24/60 = 0.4 is computed from the RAW spell length
    (step 3) and applied to the CLIPPED 20 h at aggregation (step 5) -- 8 h, not 20.
    The reverse order would make one spell's contribution depend on `days`."""
    events = [ev(1, 0, "in_progress"), ev(2, 60, "done")]
    result = fold(events, at(61))
    assert result.spells[0].closed is True
    assert result.spells[0].spans[0].factor == pytest.approx(0.4)

    clipped = clip(list(result.spans), at(30), at(50))
    contribution = sum((s.end - s.start).total_seconds() * s.factor for s in clipped)
    assert contribution == pytest.approx(8 * 3600)
