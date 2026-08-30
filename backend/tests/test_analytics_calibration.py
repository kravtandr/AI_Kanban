"""Calibration and the bias arithmetic (§8.2, §8.3). Pure: no DB, no clock."""

import pytest

from app.schemas import BucketCalibration
from app.services.analytics import (
    BUCKET_ORDER,
    MIN_SEGMENT_SAMPLES,
    SEED_BUCKET_MINUTES,
    Observation,
    board_factor,
    calibrate,
    find_inversions,
    project_factor,
    relative_factor,
)


def obs(task_id: int, bucket: str, seconds: int, project_id: int | None = 1) -> Observation:
    return Observation(task_id=task_id, bucket=bucket, seconds=seconds, project_id=project_id)


def ladder(**minutes: int) -> list[BucketCalibration]:
    """A ready ladder for find_inversions: only `minutes` matters here."""
    return [
        BucketCalibration(
            bucket=bucket,
            minutes=minutes[bucket],
            seed_minutes=SEED_BUCKET_MINUTES[bucket],
            observed_minutes=None,
            samples=0,
            calibrated=False,
        )
        for bucket in BUCKET_ORDER
    ]


def by_bucket(buckets: list[BucketCalibration]) -> dict[str, BucketCalibration]:
    return {b.bucket: b for b in buckets}


def test_empty_corpus_falls_back_to_the_seed_ladder():
    """n == 0 and n < MIN_SAMPLES are ONE branch: the seed value, calibrated
    false, and no StatisticsError anywhere (§8.2)."""
    buckets = calibrate([])
    assert [b.bucket for b in buckets] == list(BUCKET_ORDER)
    assert [b.minutes for b in buckets] == [SEED_BUCKET_MINUTES[b] for b in BUCKET_ORDER]
    assert all(b.calibrated is False for b in buckets)
    assert all(b.samples == 0 for b in buckets)
    assert all(b.observed_minutes is None for b in buckets)


def test_four_samples_report_the_observation_but_stay_uncalibrated():
    """samples and observed_minutes are still handed out, so the owner can watch
    the sample fill up."""
    corpus = [obs(i, "M", s) for i, s in enumerate([1800, 3600, 5400, 7200])]
    m = by_bucket(calibrate(corpus))["M"]
    assert m.calibrated is False
    assert m.minutes == SEED_BUCKET_MINUTES["M"] == 120
    assert m.samples == 4
    assert m.observed_minutes == 60


def test_five_samples_switch_to_median_low():
    corpus = [obs(i, "M", s) for i, s in enumerate([1800, 3600, 5400, 7200, 9000])]
    m = by_bucket(calibrate(corpus))["M"]
    assert m.calibrated is True
    assert m.minutes == 90
    assert m.observed_minutes == 90
    assert m.seed_minutes == 120
    assert m.samples == 5


def test_even_sample_returns_a_duration_that_was_actually_observed():
    """median_low, not median: on an even n interpolation reports a duration NO
    task ever had."""
    seconds = [1800, 3600, 5400, 7200, 9000, 10800]
    m = by_bucket(calibrate([obs(i, "M", s) for i, s in enumerate(seconds)]))["M"]
    assert m.minutes == 90  # 5400 s, the low middle
    assert m.minutes * 60 in seconds
    assert m.minutes != 105  # (5400 + 7200) / 2 / 60 -- never observed


def test_rounding_is_bankers_and_the_floor_lifts_only_the_effective_value():
    """Python rounds half to even: round(2.5) == 2, not 3. MIN_BUCKET_MINUTES
    lifts `minutes`, but observed_minutes shows the observation as it is."""
    xs = by_bucket(calibrate([obs(i, "XS", 150) for i in range(5)]))["XS"]
    assert xs.calibrated is True
    assert xs.observed_minutes == 2
    assert xs.minutes == 5


def test_min_bucket_minutes_keeps_a_one_minute_median_off_the_ladder():
    """§8.2: the floor protects from ONE, not from zero. A burst of agent moves
    legitimately yields 60 s observations, a median of 1, "XS = 1 min" in the
    prompt and "about 240 tasks fit in four hours" in the plan for the day."""
    xs = by_bucket(calibrate([obs(i, "XS", 60) for i in range(5)]))["XS"]
    assert xs.observed_minutes == 1
    assert xs.minutes == 5


def test_monotonic_ladder_has_no_inversions():
    """Empty list, never None (§8.2)."""
    assert find_inversions(ladder(XS=15, S=45, M=120, L=300, XL=720)) == []


def test_inversion_names_the_bucket_that_broke_the_order():
    """M > L gives ["L"], not ["M"]: the order was broken by L (§8.2 p. 1)."""
    assert find_inversions(ladder(XS=15, S=45, M=400, L=300, XL=720)) == ["L"]


def test_only_adjacent_pairs_are_compared():
    """§8.2 p. 2: one split middle must not paint everything above it as an
    inversion."""
    assert find_inversions(ladder(XS=15, S=400, M=120, L=300, XL=720)) == ["M"]


def test_equality_is_an_inversion_too():
    """M == L means the ladder stopped telling two neighbouring sizes apart."""
    assert find_inversions(ladder(XS=15, S=45, M=300, L=300, XL=720)) == ["L"]


def test_an_uncalibrated_bucket_is_never_pulled_up():
    """§8.2: pulling it up would invent a number that then works as a denominator
    of the factors and as the overheat threshold of a card."""
    buckets = calibrate([obs(i, "M", 24000) for i in range(5)])
    table = by_bucket(buckets)
    assert table["M"].minutes == 400
    assert table["M"].calibrated is True
    assert table["L"].minutes == SEED_BUCKET_MINUTES["L"] == 300
    assert table["L"].calibrated is False
    assert find_inversions(buckets) == ["L"]


def test_board_factor_is_measured_against_the_seed_ladder():
    """§3.3: the denominator is the IMMOVABLE seed scale. Dividing the facts by
    the median of the facts collapses the factor to exactly 1.0 by construction."""
    corpus = [obs(i, "M", 14400) for i in range(5)]  # 240 min against a seed of 120
    assert board_factor(corpus) == pytest.approx(2.0)


def test_board_factor_is_none_below_min_samples():
    assert board_factor([obs(i, "M", 14400) for i in range(4)]) is None


def test_project_factor_needs_min_segment_samples():
    """On a board of ~30 tasks and 9 projects an empty project factor is the norm,
    not an edge case."""
    corpus = [obs(i, "M", 14400, project_id=1) for i in range(5)]
    corpus += [obs(100 + i, "M", 7200, project_id=2) for i in range(4)]
    assert MIN_SEGMENT_SAMPLES == 5
    assert project_factor(corpus, 1) == pytest.approx(2.0)
    assert project_factor(corpus, 2) is None
    assert board_factor(corpus) is not None


def test_relative_guards_both_operands():
    """CRITICAL (§8.3): the project check comes FIRST and is mandatory. A guard on
    board_factor alone evaluates None / 1.6 -> TypeError and returns 500 from
    GET /api/v1/analytics, and with it from POST /ai/insights."""
    assert relative_factor(None, 1.6) is None
    assert relative_factor(None, None) is None
    assert relative_factor(2.8, None) is None
    assert relative_factor(2.8, 0.0) is None


def test_relative_divides_the_project_factor_by_the_board_factor():
    assert relative_factor(2.8, 1.6) == pytest.approx(1.75)
