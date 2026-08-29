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

import itertools
import statistics
from dataclasses import dataclass, replace
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    EVENT_STATUS_DELETED,
    EVENT_STATUS_PARKED,
    EstimateBucket,
    Project,
    Task,
    TaskEstimate,
    TaskEvent,
    TaskStatus,
    utcnow,
)
from app.schemas import BucketCalibration

# --- Constants (§8) ----------------------------------------------------------
SEED_BUCKET_MINUTES: dict[str, int] = {"XS": 15, "S": 45, "M": 120, "L": 300, "XL": 720}
# An explicit constant, not derived from the literal order of SEED_BUCKET_MINUTES:
# it also fixes the row order of buckets[] and the order of the monotonicity walk.
BUCKET_ORDER: tuple[str, ...] = ("XS", "S", "M", "L", "XL")
MIN_SAMPLES = 5  # per bucket, so the median stops being a single number
MIN_SEGMENT_SAMPLES = 5  # per project, for the bias factor
MIN_SAMPLE_SECONDS = 60  # under a minute is not an observation but an agent click
# The ceiling of a single spell. A card forgotten in In Progress over the weekend
# gives 60 hours and alone outweighs a month of real work. 24 h and not 8 h for
# coherence: the seed value of XL is 720 min (12 h), so an 8 h ceiling would make
# XL uncalibratable BY CONSTRUCTION. Applies to CLOSED spells only (§7.1 R7).
MAX_SPELL_SECONDS = 24 * 3600
MIN_BUCKET_MINUTES = 5  # floor of the reported value: nothing may divide by zero
STUCK_DAYS = 7


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


@dataclass(frozen=True)
class Observation:
    """One unit of the calibration corpus (§8.1). A task yields exactly one."""

    task_id: int
    bucket: str  # the FORECAST estimate, rule 3
    seconds: int  # calibration_seconds, rule 4
    project_id: int | None  # project of the MAJORITY of those seconds (§8.3)


def calibrate(corpus: list[Observation]) -> list[BucketCalibration]:
    """bucket -> how many minutes it is worth on this board right now (§8.2).

    Pure and windowless: the request window `days` is not applied to calibration
    at all (§7.4), and inversions are found separately, by find_inversions() over
    the finished result.
    """
    out: list[BucketCalibration] = []
    for bucket in BUCKET_ORDER:
        seed = SEED_BUCKET_MINUTES[bucket]
        sample = sorted(o.seconds for o in corpus if o.bucket == bucket)
        n = len(sample)
        calibrated = n >= MIN_SAMPLES
        if calibrated:
            # median_low, not median: on an even n the ordinary median
            # interpolates and reports a duration NO task ever had. The floor
            # guards against ONE, not against zero -- MIN_SAMPLE_SECONDS already
            # keeps sub-minute observations out of the corpus.
            minutes = max(MIN_BUCKET_MINUTES, round(statistics.median_low(sample) / 60))
        else:
            # n == 0 and n < MIN_SAMPLES are one branch: the seed value. samples
            # and observed_minutes are reported anyway, so the owner can watch the
            # sample fill up.
            minutes = seed
        out.append(
            BucketCalibration(
                bucket=bucket,
                minutes=minutes,
                seed_minutes=seed,
                samples=n,
                calibrated=calibrated,
                observed_minutes=(round(statistics.median_low(sample) / 60) if n else None),
            )
        )
    return out


def find_inversions(buckets: list[BucketCalibration]) -> list[str]:
    """Buckets whose effective minutes failed to grow against the previous step.

    Monotonicity is NEVER repaired silently: "M > L" is the honest "not enough
    data" signal (§8.2). The walk goes over the fixed BUCKET_ORDER, only ADJACENT
    pairs are compared, and the bucket that broke the order is added under its OWN
    name -- M > L gives ["L"], not ["M"]. Equality counts too: M == L means the
    ladder stopped telling two neighbouring sizes apart. Seed values take part in
    the comparison as well; the seed scale is strictly increasing by construction,
    so any inversion found means at least one value was measured. The list is []
    when the ladder is monotonic, never None.
    """
    minutes = {b.bucket: b.minutes for b in buckets}
    return [hi for lo, hi in itertools.pairwise(BUCKET_ORDER) if minutes[hi] <= minutes[lo]]


def bias_ratio(observation: Observation) -> float:
    """r_i = actual minutes / SEED minutes of its bucket (§8.3).

    The denominator is the immovable seed scale, never the recalibrated ladder.
    Dividing the facts by the median of the facts collapses the coefficient to
    exactly 1.0 by construction -- "Homelab x2.8" would become unreachable
    precisely when the bias is largest and most stable (§3.3).
    """
    return observation.seconds / 60 / SEED_BUCKET_MINUTES[observation.bucket]


def _ratios(corpus: list[Observation]) -> list[float]:
    # A bucket outside the seed ladder has no denominator at all; calibrate()
    # skips such an observation the same way, by matching against BUCKET_ORDER.
    return [bias_ratio(o) for o in corpus if o.bucket in SEED_BUCKET_MINUTES]


def board_factor(corpus: list[Observation]) -> float | None:
    """Median r_i over the whole board; None while the sample is too small."""
    ratios = _ratios(corpus)
    if len(ratios) < MIN_SAMPLES:
        return None
    return statistics.median_low(ratios)


def project_factor(corpus: list[Observation], project_id: int | None) -> float | None:
    """Median r_i inside one project (§8.3); None below MIN_SEGMENT_SAMPLES.

    Each observation belongs to exactly one project, by the majority-of-hours
    rule, so sum(n_p) == corpus_size and no observation is counted twice.
    """
    ratios = _ratios([o for o in corpus if o.project_id == project_id])
    if len(ratios) < MIN_SEGMENT_SAMPLES:
        return None
    return statistics.median_low(ratios)


def relative_factor(project: float | None, board: float | None) -> float | None:
    """project_factor / board_factor (§8.3).

    BOTH operands are guarded and the project check comes FIRST. project_factor
    becomes None whenever n_p < MIN_SEGMENT_SAMPLES, which on a board of ~30 tasks
    and 9 projects is the norm, not an edge case: a guard on `board` alone would
    evaluate None / 1.6 -> TypeError and return 500 from GET /api/v1/analytics,
    and with it from POST /ai/insights, where `data` is filled ALWAYS. An empty
    board factor (None or 0.0) still yields None.

    The coefficient is REPORTED, not applied automatically: at n = 5 multiplying
    forecasts by it only amplifies noise.
    """
    return project / board if project is not None and board else None


# --- Emission (§5.1) --------------------------------------------------------


def logical_status(db: Session, task: Task) -> str:
    """The task's state in journal terms: a board column or a pseudo-status."""
    if task.deleted_at is not None:
        return EVENT_STATUS_DELETED
    project = db.get(Project, task.project_id)
    if project is not None and project.archived_at is not None:
        return EVENT_STATUS_PARKED
    return task.status.value


def last_event(db: Session, task_id: int) -> TaskEvent | None:
    return db.scalars(
        select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.id.desc()).limit(1)
    ).first()


def state_matches(db: Session, task: Task) -> bool:
    """Reading half of record_state: does the journal already agree with the state?

    Adds nothing and mutates nothing - SELECTs only. It exists as a separate name
    so that production (record_state) and the test tripwire (§5.4 p.3) check ONE
    predicate rather than two similar ones.
    """
    prev = last_event(db, task.id)
    return (
        prev is not None
        and prev.status == logical_status(db, task)
        and prev.project_id == task.project_id
    )


def record_state(
    db: Session, task: Task, *, at: datetime | None = None, source: str = "live"
) -> bool:
    """Append a state snapshot IF it differs from the last journal row.

    Idempotent by construction. Two consequences it exists for:
      * a repeated call (a drag inside the same column) creates no zero-length spans;
      * a MISSED call loses no transition: the next mutation of this task sees the
        mismatch and appends the row. The bug degrades into a shifted timestamp,
        never into a lost measurement (§3.1).

    Does NOT commit: the transaction belongs to the caller, so the status and its
    event land together or not at all.
    """
    if state_matches(db, task):
        return False
    db.add(
        TaskEvent(
            task_id=task.id,
            at=at or utcnow(),
            status=logical_status(db, task),
            project_id=task.project_id,
            source=source,
        )
    )
    return True


def record_estimate(
    db: Session,
    task_id: int,
    bucket: EstimateBucket | None,
    *,
    at: datetime | None = None,
    source: str = "user",
) -> None:
    """Append an estimate. bucket=None writes a TOMBSTONE (bucket=""): estimate cleared.

    `before_work` is computed HERE, from the journal, and frozen into the row. That
    is exactly why the call order in create_task/update_task (§5.2) is mandatory:
    the estimate is written BEFORE record_state, i.e. before the in_progress event
    exists.

    The event lookup is bounded by `at`, not by "whatever is in the journal": the
    timestamp is an argument (§13 p.3), and a test building history in an arbitrary
    CALL order must still get a chronologically correct flag. Without
    `TaskEvent.at <= at`, record_estimate(at=T-1h) after record_state(in_progress,
    at=T) would silently mark a forecast as a revision - and the flag is frozen, so
    the damage would be undetectable afterwards.
    """
    at = at or utcnow()
    started = (
        db.scalar(
            select(TaskEvent.id)
            .where(
                TaskEvent.task_id == task_id,
                TaskEvent.status == TaskStatus.in_progress.value,
                TaskEvent.at <= at,
            )
            .limit(1)
        )
        is not None
    )
    db.add(
        TaskEstimate(
            task_id=task_id,
            at=at,
            bucket=bucket.value if bucket is not None else "",
            source=source,
            before_work=not started,
        )
    )


# --- Cold start (§6, §5.4 p.2) ----------------------------------------------


def seed_missing_events(db: Session, *, at: datetime | None = None) -> int:
    """Cold start: one "as of now the task is in state X" row per task that has NOT A
    SINGLE event in the journal.

    The check is PER TASK, not "does the table hold any event at all": a global
    guard would disable seeding forever after the first run, and any task created
    during a rollback window to an older image would stay eventless and silently
    report in_progress = 0m.

    The timestamp is utcnow(), NOT created_at. Otherwise two tasks currently sitting
    in In Progress would report "working since June": an eight-week invented session
    straight into the median. Nothing about a residence in in_progress is recoverable
    and none of it is invented (§6).

    Soft-deleted tasks are seeded too, with a `deleted` row, so that a pre-launch
    deleted task stuck in in_progress does not accumulate time until the purge.

    Entities are selected, not identifiers: db.get(Task, task_id) would return
    Task | None and mypy with check_untyped_defs would fail the mandatory gate, plus
    it is an extra SELECT per task on top of a query that already fetched everything.
    """
    at = at or utcnow()
    tasks = db.scalars(
        select(Task).where(~select(TaskEvent.id).where(TaskEvent.task_id == Task.id).exists())
    ).all()
    for task in tasks:
        db.add(
            TaskEvent(
                task_id=task.id,
                at=at,
                status=logical_status(db, task),
                project_id=task.project_id,
                source="seed",
            )
        )
    if tasks:
        db.commit()
    return len(tasks)


def reconcile_all(db: Session, *, at: datetime | None = None) -> int:
    """Startup drift repair (§5.4 p.2): append a `drift` event for every task whose
    current state disagrees with its last journal row.

    Such a task is excluded from the calibration corpus over the stretch where the
    divergence could have hidden work (§8.1) - we do not know WHEN it changed.

    Runs AFTER seed_missing_events: a task with an empty journal disagrees with it by
    definition, so the reverse order would label every pre-existing task `drift`
    instead of `seed` - and the two labels answer different questions in the coverage
    banner (§10.1).

    The return value goes into the startup log ONLY. The dashboard recomputes the
    number from the journal by the `drift` label at request time; there is nowhere to
    store it (§2.1) and the next deploy would zero it while the events live on.
    """
    at = at or utcnow()
    repaired = 0
    for task in db.scalars(select(Task)).all():
        if record_state(db, task, at=at, source="drift"):
            repaired += 1
    if repaired:
        db.commit()
    return repaired
