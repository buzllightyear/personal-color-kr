"""AC20: Pipeline timing instrumentation — stage latency logging.

Acceptance criteria verified
-----------------------------
AC20: 파이프라인 타이밍 계측 — 각 stage(raw생성, enhancer, reject_filter,
      user_pick_presentation) 소요 시간 로깅.
      전체 소요 시간 집계 함수 존재.
      p95 < 30초 목표 추적 기반 확보.

Tests use an injected clock to avoid real wall-clock dependency.
All tests are independent — no shared state.
"""

from __future__ import annotations

import pytest

from api.generation.pipeline_timing import (
    ALL_STAGES,
    STAGE_ENHANCER,
    STAGE_RAW_GENERATION,
    STAGE_REJECT_FILTER,
    STAGE_USER_PICK_PRESENTATION,
    create_pipeline_timing,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _counter_clock(start: float = 0.0, step: float = 1.0):
    """Return a callable that advances by `step` each call."""
    state = {"t": start}

    def tick() -> float:
        current = state["t"]
        state["t"] += step
        return current

    return tick


# ---------------------------------------------------------------------------
# AC20: Stage timing — individual stage start/end
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_start_end_raw_generation_records_duration() -> None:
    """start_stage/end_stage for raw_generation produces a non-None duration."""
    clock = _counter_clock(0.0, 5.0)
    timing = create_pipeline_timing(time_fn=clock)

    timing.start_stage(STAGE_RAW_GENERATION)
    timing.end_stage(STAGE_RAW_GENERATION)

    duration = timing.get_stage_duration(STAGE_RAW_GENERATION)
    assert duration is not None
    assert duration == pytest.approx(5.0)


@pytest.mark.unit
@pytest.mark.parametrize(
    "stage",
    [
        STAGE_RAW_GENERATION,
        STAGE_ENHANCER,
        STAGE_REJECT_FILTER,
        STAGE_USER_PICK_PRESENTATION,
    ],
)
def test_each_stage_can_be_timed(stage: str) -> None:
    """All 4 standard stages can each be independently started and ended."""
    clock = _counter_clock(0.0, 2.0)
    timing = create_pipeline_timing(time_fn=clock)

    timing.start_stage(stage)
    timing.end_stage(stage)

    duration = timing.get_stage_duration(stage)
    assert duration is not None
    assert duration > 0


@pytest.mark.unit
def test_stage_duration_reflects_clock_difference() -> None:
    """Duration = end_time - start_time from the injected clock."""
    clock = _counter_clock(100.0, 7.0)
    timing = create_pipeline_timing(time_fn=clock)

    timing.start_stage(STAGE_ENHANCER)  # clock returns 100.0
    timing.end_stage(STAGE_ENHANCER)  # clock returns 107.0

    assert timing.get_stage_duration(STAGE_ENHANCER) == pytest.approx(7.0)


# ---------------------------------------------------------------------------
# AC20: Total elapsed aggregation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_total_elapsed_is_sum_of_all_stages() -> None:
    """total_elapsed_seconds() = sum of each completed stage duration."""
    clock = _counter_clock(0.0, 5.0)
    timing = create_pipeline_timing(time_fn=clock)

    for stage in ALL_STAGES:
        timing.start_stage(stage)
        timing.end_stage(stage)

    # Each stage: start returns N, end returns N+5 → duration 5.0 each
    # 4 stages × 5.0 = 20.0
    total = timing.total_elapsed_seconds()
    assert total == pytest.approx(20.0)


@pytest.mark.unit
def test_total_elapsed_zero_when_no_stages_complete() -> None:
    """total_elapsed_seconds() is 0.0 when no stages have completed."""
    timing = create_pipeline_timing()
    assert timing.total_elapsed_seconds() == pytest.approx(0.0)


@pytest.mark.unit
def test_total_elapsed_partial_stages() -> None:
    """total_elapsed_seconds() only sums completed stages."""
    clock = _counter_clock(0.0, 3.0)
    timing = create_pipeline_timing(time_fn=clock)

    # Only complete 2 of 4 stages
    timing.start_stage(STAGE_RAW_GENERATION)
    timing.end_stage(STAGE_RAW_GENERATION)
    timing.start_stage(STAGE_ENHANCER)
    timing.end_stage(STAGE_ENHANCER)
    # Start reject_filter but don't end it
    timing.start_stage(STAGE_REJECT_FILTER)

    total = timing.total_elapsed_seconds()
    # 2 completed stages × 3.0 = 6.0
    assert total == pytest.approx(6.0)


# ---------------------------------------------------------------------------
# AC20: p95 < 30s tracking infrastructure
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_total_below_30s_threshold() -> None:
    """A full 4-stage run with realistic durations stays below 30s threshold."""
    # Representative durations (raw=10s, enhancer=5s, filter=1s, pick=0.1s)
    times = iter(
        [
            0.0,
            10.0,  # raw_generation: 10s
            10.0,
            15.0,  # enhancer: 5s
            15.0,
            16.0,  # reject_filter: 1s
            16.0,
            16.1,  # user_pick_presentation: 0.1s
        ]
    )

    def seq_clock() -> float:
        return next(times)

    timing = create_pipeline_timing(time_fn=seq_clock)
    timing.start_stage(STAGE_RAW_GENERATION)
    timing.end_stage(STAGE_RAW_GENERATION)
    timing.start_stage(STAGE_ENHANCER)
    timing.end_stage(STAGE_ENHANCER)
    timing.start_stage(STAGE_REJECT_FILTER)
    timing.end_stage(STAGE_REJECT_FILTER)
    timing.start_stage(STAGE_USER_PICK_PRESENTATION)
    timing.end_stage(STAGE_USER_PICK_PRESENTATION)

    total = timing.total_elapsed_seconds()
    P95_BUDGET_SECONDS = 30.0
    assert (
        total < P95_BUDGET_SECONDS
    ), f"Pipeline total {total:.2f}s exceeds p95 budget {P95_BUDGET_SECONDS}s"


@pytest.mark.unit
def test_all_stages_logged_after_complete_run() -> None:
    """all_stages_logged() returns True only after all 4 stages complete."""
    clock = _counter_clock(0.0, 1.0)
    timing = create_pipeline_timing(time_fn=clock)

    assert timing.all_stages_logged() is False

    for stage in ALL_STAGES:
        timing.start_stage(stage)
        timing.end_stage(stage)

    assert timing.all_stages_logged() is True


@pytest.mark.unit
def test_all_stages_logged_false_if_one_missing() -> None:
    """all_stages_logged() returns False if any stage is missing."""
    clock = _counter_clock(0.0, 1.0)
    timing = create_pipeline_timing(time_fn=clock)

    # Complete only 3 of 4 stages
    for stage in ALL_STAGES[:3]:
        timing.start_stage(stage)
        timing.end_stage(stage)

    assert timing.all_stages_logged() is False


# ---------------------------------------------------------------------------
# AC20: as_dict export for logging
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_as_dict_returns_per_stage_durations() -> None:
    """as_dict() contains per-stage duration entries."""
    clock = _counter_clock(0.0, 2.0)
    timing = create_pipeline_timing(time_fn=clock)

    for stage in ALL_STAGES:
        timing.start_stage(stage)
        timing.end_stage(stage)

    result = timing.as_dict()
    assert isinstance(result, dict)
    for stage in ALL_STAGES:
        assert stage in result
        assert result[stage] == pytest.approx(2.0)


# ---------------------------------------------------------------------------
# AC20: Error handling — end without start
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_end_stage_without_start_raises_value_error() -> None:
    """Calling end_stage without start_stage raises ValueError."""
    timing = create_pipeline_timing()
    with pytest.raises(ValueError, match="was not started or was already ended"):
        timing.end_stage(STAGE_RAW_GENERATION)


@pytest.mark.unit
def test_all_stages_constant_contains_4_entries() -> None:
    """ALL_STAGES contains exactly 4 stages."""
    assert len(ALL_STAGES) == 4
    assert STAGE_RAW_GENERATION in ALL_STAGES
    assert STAGE_ENHANCER in ALL_STAGES
    assert STAGE_REJECT_FILTER in ALL_STAGES
    assert STAGE_USER_PICK_PRESENTATION in ALL_STAGES
