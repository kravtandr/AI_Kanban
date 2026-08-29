"""Time tracking: the pure core of the residence algorithm (§7).

One query to the journal plus a pure Python function. On 400-7000 rows this is
cheaper to write, cheaper to test, and behaves identically on PostgreSQL and on
the SQLite of the tests -- unlike DISTINCT ON and window functions.

Values travel through the fold, never ORM objects. R3 clamps `at` forward; on an
ORM object that clamp is a dirty attribute in the same Session, and the first
commit in the same request would turn it into `UPDATE task_events SET at = ...`.
Such a commit exists in the design: POST /ai/insights logs its token spend
through _log_usage, which commits. An append-only journal would be rewritten
after the fact by a report that is only allowed to read it -- and the clamp is
idempotent, so the corruption would erase its own evidence. `frozen=True` makes
that impossible rather than unlikely.
"""

from dataclasses import dataclass, replace
from datetime import datetime

# --- Constants (§8) ----------------------------------------------------------
# The ceiling of a single spell. A card forgotten in In Progress over the weekend
# gives 60 hours and alone outweighs a month of real work. Applies to CLOSED
# spells only (§7.1 R7). The remaining calibration constants of §8 join this
# block in the calibration task.
MAX_SPELL_SECONDS = 24 * 3600


@dataclass(frozen=True, slots=True)
class Ev:
    """One journal row of one task. task_id is the dict key, not a field (§7)."""

    id: int
    at: datetime
    status: str
    project_id: int | None
    source: str


@dataclass(frozen=True)
class Span:
    """A residence: from `start` to `end` the task sat in `status` inside
    `project_id`.

    `factor` carries the R7 ceiling coefficient. The field exists PRECISELY
    because the ceiling has to survive clip(): k is computed from the RAW spell
    length but applied to the ALREADY CLIPPED seconds (§7.4).
    """

    start: datetime
    end: datetime
    status: str
    project_id: int | None
    factor: float = 1.0


@dataclass(frozen=True)
class Spell:
    """A maximal run of consecutive in_progress spans (R6).

    `closed` is R8: the spell is open when its last span is the last span of the
    task, i.e. the task is in progress right now. Closed and open seconds are
    counted SEPARATELY and are never added into one number.
    """

    spans: tuple[Span, ...]
    closed: bool


@dataclass(frozen=True)
class TaskTime:
    """The fold of one task's journal."""

    spans: tuple[Span, ...]
    spells: tuple[Spell, ...]
    tracked: bool
    anomalies: tuple[str, ...]


def _in_progress_runs(spans: list[Span]) -> list[tuple[int, int, bool]]:
    """Index ranges [lo, hi) of maximal consecutive in_progress spans, plus R8's
    `closed` flag.

    Takes ALL spans of one task, not a pre-filtered list. Adjacency is a property
    of positions in the sequence, and `closed` is only knowable from whether
    anything follows the run at all. Filtering first and re-deriving adjacency
    from `a.end == b.start` would glue two spells together whenever the residence
    between them has zero length -- which R3 produces every time two events are
    clamped onto the same `at`.
    """
    runs: list[tuple[int, int, bool]] = []
    lo: int | None = None
    for i, span in enumerate(spans):
        if span.status == "in_progress":
            if lo is None:
                lo = i
            continue
        if lo is not None:
            runs.append((lo, i, True))  # something follows -> the spell is closed
            lo = None
    if lo is not None:
        runs.append((lo, len(spans), False))  # last span of the task -> still open
    return runs


def merge_runs(spans: list[Span]) -> list[Spell]:
    """R6: maximal runs of consecutive in_progress spans.

    A project change cuts a span but does NOT break a spell: four hours in one
    sitting with a move to another project halfway through is one spell.
    """
    return [
        Spell(spans=tuple(spans[lo:hi]), closed=closed)
        for lo, hi, closed in _in_progress_runs(spans)
    ]


def fold(events: list[Ev], now: datetime) -> TaskTime:
    """§7.1 R1-R8. Events of ONE task; `now` is an argument, never the clock.

    The window is NOT applied here: fold() knows nothing about it at all. Cutting
    to a window is a separate pure function, clip() (§7.4).
    """
    # R1: id, not at. One sequence, one uvicorn worker -- id IS the causal order.
    ordered = sorted(events, key=lambda e: e.id)

    # R2: interval admission rule, not "no non-live event ever". A non-live event
    # BEFORE the first in_progress only pinned the starting point and could not
    # hide a single minute of work; from the first in_progress onward it could
    # have invented the START of a spell or hidden a whole spell.
    first_ip = next((e for e in ordered if e.status == "in_progress"), None)
    tracked = first_ip is not None and not any(
        e.source != "live" and e.id >= first_ip.id for e in ordered
    )

    # R3: clamp forward. Builds a NEW list; no input element is ever modified.
    anomalies: list[str] = []
    clamped: list[Ev] = []
    prev: datetime | None = None
    for e in ordered:
        at = e.at
        if prev is not None and at < prev:
            anomalies.append(f"clock_regression:{e.id}")
            at = prev  # NEVER backwards
        if at > now:
            anomalies.append(f"clock_advance:{e.id}")
            at = now  # pulled to now; the walk is NOT aborted, or one broken RTC
            # would erase the whole remaining history
        clamped.append(replace(e, at=at))
        prev = at

    # R4: no synthetic residence from created_at -- that is inventing a duration.
    if not clamped:
        return TaskTime(spans=(), spells=(), tracked=False, anomalies=())

    # R5: a span ends at the `at` of the next event; the last one ends at `now`.
    spans: list[Span] = []
    for i, e in enumerate(clamped):
        end = clamped[i + 1].at if i + 1 < len(clamped) else now
        # max(end, e.at) is redundant after R3 and kept on purpose: the invariant
        # "a duration is never negative" must not depend on R3.
        spans.append(
            Span(
                start=e.at,
                end=max(end, e.at),
                status=e.status,
                project_id=e.project_id,
            )
        )

    # R6 + R7: the ceiling applies to CLOSED spells only, and it is a STAMP on
    # `factor`, never a mutation of start/end -- scaling timestamps would slide a
    # span along the axis and carry it out of its own window. One k for the whole
    # spell keeps the split between projects proportional.
    runs = _in_progress_runs(spans)
    for lo, hi, closed in runs:
        raw = sum((s.end - s.start).total_seconds() for s in spans[lo:hi])
        if not closed or raw <= MAX_SPELL_SECONDS:
            continue  # an OPEN spell is never capped: k stays 1.0
        k = MAX_SPELL_SECONDS / raw
        for i in range(lo, hi):
            spans[i] = replace(spans[i], factor=k)

    # R8: spells are rebuilt AFTER stamping, so a spell's spans carry the same k.
    spells = tuple(Spell(spans=tuple(spans[lo:hi]), closed=closed) for lo, hi, closed in runs)
    return TaskTime(spans=tuple(spans), spells=spells, tracked=tracked, anomalies=tuple(anomalies))


def clip(spans: list[Span], start: datetime, end: datetime) -> list[Span]:
    """§7.4: intersect spans with the request window, cutting on BOTH boundaries.

    status, project_id and `factor` are carried over UNCHANGED: the R7 ceiling
    must survive clipping, because k is computed from the RAW spell length and
    applied to the ALREADY CLIPPED seconds at aggregation. A span whose clipped
    end is not strictly after its clipped start is dropped whole -- a zero-length
    row would add nothing but would still be counted as a residence downstream.
    """
    out: list[Span] = []
    for span in spans:
        lo = max(span.start, start)
        hi = min(span.end, end)
        if hi <= lo:
            continue
        out.append(replace(span, start=lo, end=hi))
    return out
