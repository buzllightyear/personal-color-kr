"""Unit tests for `evaluate_retention_threshold` (Sub-AC 6.1).

The contract under test:

    evaluate_retention_threshold(retention_rate, threshold) returns a dict
    describing whether `retention_rate` meets `threshold` (the comparison is
    inclusive: rate >= threshold passes).

Why this function exists:

    The Seed Contract names a Phase-1 retention bar of 0.25 (25%) and a pivot
    signal at 0.10 (10%). Once `calculate_retention_rate` (Sub-AC 7.3) has
    produced a number, every downstream consumer — dashboards, the
    retention_api router, the pivot-alert hook — needs to ask the same
    question against the same threshold with the same boundary semantics.
    Centralising the comparison here prevents the inevitable drift where one
    site uses `>` and another uses `>=` and a rate of exactly 0.25 silently
    passes in one place and fails in another.

Boundary semantics (AC-required edge cases — "임계값 미만/동일/초과"):
  - rate <  threshold  → meets_threshold=False, status='below'
  - rate == threshold  → meets_threshold=True,  status='at'
  - rate >  threshold  → meets_threshold=True,  status='above'

Input validation (AC-required — "잘못된 입력 (음수, 1.0 초과)"):
  - Negative rate / threshold        → ValueError
  - Rate / threshold > 1.0           → ValueError
  - NaN rate / threshold             → ValueError
  - Non-numeric type                 → TypeError
  - bool (int subclass)              → TypeError
"""

from __future__ import annotations

import math

import pytest

from retention.threshold import evaluate_retention_threshold

# ---------------------------------------------------------------------------
# Boundary value tests — rate vs threshold
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_rate_below_threshold_does_not_meet() -> None:
    result = evaluate_retention_threshold(0.20, 0.25)

    assert result["meets_threshold"] is False
    assert result["status"] == "below"
    assert result["retention_rate"] == pytest.approx(0.20)
    assert result["threshold"] == pytest.approx(0.25)


@pytest.mark.unit
def test_rate_equal_to_threshold_meets_threshold() -> None:
    # Inclusive comparison: equality must pass. Drifting to strict `>` later
    # would silently fail every cohort that hits the bar exactly.
    result = evaluate_retention_threshold(0.25, 0.25)

    assert result["meets_threshold"] is True
    assert result["status"] == "at"


@pytest.mark.unit
def test_rate_above_threshold_meets_threshold() -> None:
    result = evaluate_retention_threshold(0.40, 0.25)

    assert result["meets_threshold"] is True
    assert result["status"] == "above"


@pytest.mark.unit
def test_gap_is_signed_difference() -> None:
    above = evaluate_retention_threshold(0.40, 0.25)
    below = evaluate_retention_threshold(0.10, 0.25)
    at = evaluate_retention_threshold(0.25, 0.25)

    assert above["gap"] == pytest.approx(0.15)
    assert below["gap"] == pytest.approx(-0.15)
    assert at["gap"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Allowed range — 0.0 and 1.0 are valid (closed interval)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_zero_rate_zero_threshold_is_at_threshold() -> None:
    # An empty cohort returns 0.0 from calculate_retention_rate; comparing
    # against a 0.0 threshold should not crash and should report 'at'.
    result = evaluate_retention_threshold(0.0, 0.0)

    assert result["meets_threshold"] is True
    assert result["status"] == "at"


@pytest.mark.unit
def test_one_rate_one_threshold_is_at_threshold() -> None:
    result = evaluate_retention_threshold(1.0, 1.0)

    assert result["meets_threshold"] is True
    assert result["status"] == "at"


@pytest.mark.unit
def test_perfect_rate_meets_any_threshold() -> None:
    result = evaluate_retention_threshold(1.0, 0.25)

    assert result["meets_threshold"] is True
    assert result["status"] == "above"


@pytest.mark.unit
def test_zero_rate_fails_positive_threshold() -> None:
    result = evaluate_retention_threshold(0.0, 0.25)

    assert result["meets_threshold"] is False
    assert result["status"] == "below"


# ---------------------------------------------------------------------------
# Output shape & purity
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_result_contains_expected_keys() -> None:
    result = evaluate_retention_threshold(0.30, 0.25)

    assert set(result.keys()) == {
        "retention_rate",
        "threshold",
        "meets_threshold",
        "gap",
        "status",
    }


@pytest.mark.unit
def test_function_is_pure() -> None:
    # Same inputs must always yield equal outputs; no hidden state.
    first = evaluate_retention_threshold(0.30, 0.25)
    second = evaluate_retention_threshold(0.30, 0.25)

    assert first == second


@pytest.mark.unit
def test_returns_new_dict_each_call() -> None:
    # Defensive against accidental shared-mutable-state regressions: callers
    # routinely augment the result for logging; mutation must not leak back.
    first = evaluate_retention_threshold(0.30, 0.25)
    second = evaluate_retention_threshold(0.30, 0.25)

    assert first is not second


# ---------------------------------------------------------------------------
# Input validation — out-of-range values
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_negative_rate_raises() -> None:
    with pytest.raises(ValueError, match="retention_rate"):
        evaluate_retention_threshold(-0.01, 0.25)


@pytest.mark.unit
def test_rate_above_one_raises() -> None:
    with pytest.raises(ValueError, match="retention_rate"):
        evaluate_retention_threshold(1.01, 0.25)


@pytest.mark.unit
def test_negative_threshold_raises() -> None:
    with pytest.raises(ValueError, match="threshold"):
        evaluate_retention_threshold(0.30, -0.5)


@pytest.mark.unit
def test_threshold_above_one_raises() -> None:
    with pytest.raises(ValueError, match="threshold"):
        evaluate_retention_threshold(0.30, 1.5)


@pytest.mark.unit
def test_nan_rate_raises() -> None:
    with pytest.raises(ValueError, match="retention_rate"):
        evaluate_retention_threshold(math.nan, 0.25)


@pytest.mark.unit
def test_nan_threshold_raises() -> None:
    with pytest.raises(ValueError, match="threshold"):
        evaluate_retention_threshold(0.30, math.nan)


# ---------------------------------------------------------------------------
# Input validation — wrong types
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_string_rate_raises_typeerror() -> None:
    with pytest.raises(TypeError, match="retention_rate"):
        evaluate_retention_threshold("0.30", 0.25)  # type: ignore[arg-type]


@pytest.mark.unit
def test_none_rate_raises_typeerror() -> None:
    with pytest.raises(TypeError, match="retention_rate"):
        evaluate_retention_threshold(None, 0.25)  # type: ignore[arg-type]


@pytest.mark.unit
def test_string_threshold_raises_typeerror() -> None:
    with pytest.raises(TypeError, match="threshold"):
        evaluate_retention_threshold(0.30, "0.25")  # type: ignore[arg-type]


@pytest.mark.unit
def test_bool_rate_raises_typeerror() -> None:
    # bool is an int subclass; accepting it would silently treat True as 1.0
    # and False as 0.0 — a class of bug the activity_tracker module also
    # rejects at its boundary, so we mirror that discipline here.
    with pytest.raises(TypeError, match="retention_rate"):
        evaluate_retention_threshold(True, 0.25)  # type: ignore[arg-type]


@pytest.mark.unit
def test_bool_threshold_raises_typeerror() -> None:
    with pytest.raises(TypeError, match="threshold"):
        evaluate_retention_threshold(0.30, False)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Numeric flexibility — accept int 0/1 without surprise
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_int_zero_rate_is_accepted_as_float() -> None:
    # `0` and `1` are valid retention rates; pyhton callers will sometimes
    # pass `0` literal. Accept ints in the closed interval and coerce
    # internally, but the result should always report floats.
    result = evaluate_retention_threshold(0, 0.0)

    assert isinstance(result["retention_rate"], float)
    assert result["retention_rate"] == 0.0


@pytest.mark.unit
def test_int_one_threshold_is_accepted_as_float() -> None:
    result = evaluate_retention_threshold(1.0, 1)

    assert isinstance(result["threshold"], float)
    assert result["threshold"] == 1.0


# ---------------------------------------------------------------------------
# Seed-Contract anchors — 25% target and 10% pivot signal
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_seed_contract_target_passes_at_25_percent() -> None:
    # The Phase-1 retention bar is 25%; a cohort that hits exactly that bar
    # must pass — drifting to strict `>` would silently regress the metric.
    result = evaluate_retention_threshold(0.25, 0.25)

    assert result["meets_threshold"] is True


@pytest.mark.unit
def test_seed_contract_pivot_signal_fails_below_10_percent() -> None:
    # 0.09 against the 0.10 pivot threshold is the exit-condition trigger.
    result = evaluate_retention_threshold(0.09, 0.10)

    assert result["meets_threshold"] is False
    assert result["status"] == "below"
