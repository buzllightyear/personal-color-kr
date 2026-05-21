"""Integration tests for `get_retention_metrics` (Sub-AC 6.3).

Why integration-level, not unit:

    The handler's whole reason for existing is to compose two upstream
    primitives — `calculate_30day_retention` and `evaluate_retention_threshold`
    — into a single response envelope. Stubbing those out would only test
    the envelope-building helpers; the real contract is "given valid inputs,
    the handler returns the *same* numbers the primitives compute, wrapped
    in the ApiResponse shape". So these tests exercise the full composition
    against the real upstream functions, mirroring how an HTTP route would
    invoke the handler in production.

Coverage matrix (per the AC):
  - 200 정상 응답         : test_returns_success_envelope_*
  - 빈 데이터 처리         : test_empty_cohort_*, test_empty_active_*
  - 응답 스키마 검증       : test_response_top_level_schema, test_response_data_schema

Plus the discipline tests that any HTTP-style handler earns:
  - Default threshold matches the Seed Contract 25% bar.
  - Invalid inputs are folded into error envelopes, not raised.
  - The handler is pure (same inputs ⇒ equal outputs, fresh dict per call).
"""

from __future__ import annotations

import math

import pytest

from retention.api import (
    DEFAULT_RETENTION_THRESHOLD,
    get_retention_metrics,
)

# ---------------------------------------------------------------------------
# 200 normal response — happy-path composition
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_returns_success_envelope_for_valid_inputs() -> None:
    # Two of four cohort users come back → retention = 0.50 (above the 25%
    # Seed bar). The handler must compose calculator + threshold and surface
    # both numbers in a `success=True` envelope.
    response = get_retention_metrics(
        cohort_users=["alice", "bob", "carol", "dave"],
        active_users=["alice", "bob"],
    )

    assert response["success"] is True
    assert response["error"] is None
    assert response["data"] is not None

    data = response["data"]
    assert data["cohort_size"] == 4
    assert data["active_size"] == 2
    assert data["retention_rate"] == pytest.approx(0.50)
    assert data["threshold"] == pytest.approx(DEFAULT_RETENTION_THRESHOLD)
    assert data["meets_threshold"] is True
    assert data["gap"] == pytest.approx(0.25)
    assert data["status"] == "above"


@pytest.mark.integration
def test_full_retention_returns_above_status() -> None:
    response = get_retention_metrics(
        cohort_users=["alice", "bob"],
        active_users=["alice", "bob", "carol"],  # extra user — ignored
    )

    assert response["success"] is True
    assert response["data"]["retention_rate"] == pytest.approx(1.0)
    assert response["data"]["status"] == "above"
    assert response["data"]["meets_threshold"] is True


@pytest.mark.integration
def test_zero_retention_returns_below_status() -> None:
    # No overlap between cohort and active → rate = 0.0, below the 25% bar.
    response = get_retention_metrics(
        cohort_users=["alice", "bob", "carol"],
        active_users=["mallory", "trent"],
    )

    assert response["success"] is True
    assert response["data"]["retention_rate"] == pytest.approx(0.0)
    assert response["data"]["status"] == "below"
    assert response["data"]["meets_threshold"] is False
    assert response["data"]["gap"] == pytest.approx(-0.25)


@pytest.mark.integration
def test_rate_exactly_at_threshold_is_inclusive() -> None:
    # 1 of 4 = 0.25 exactly. The inclusive `>=` semantics must propagate
    # from `evaluate_retention_threshold` through the handler unchanged.
    response = get_retention_metrics(
        cohort_users=["alice", "bob", "carol", "dave"],
        active_users=["alice"],
    )

    assert response["success"] is True
    assert response["data"]["retention_rate"] == pytest.approx(0.25)
    assert response["data"]["meets_threshold"] is True
    assert response["data"]["status"] == "at"
    assert response["data"]["gap"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Empty-data handling — empty cohort / empty active are NOT errors
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_empty_cohort_returns_success_with_zero_rate() -> None:
    # Fresh-launch case: no users have joined yet. The dashboard wants to
    # render "0건 / 0%", not an error toast — so the envelope must be
    # success=True with retention_rate=0.0.
    response = get_retention_metrics(
        cohort_users=[],
        active_users=["alice"],
    )

    assert response["success"] is True
    assert response["error"] is None
    assert response["data"]["cohort_size"] == 0
    assert response["data"]["active_size"] == 1
    assert response["data"]["retention_rate"] == 0.0
    # 0.0 vs 0.25 bar → below, but still a successful computation.
    assert response["data"]["status"] == "below"


@pytest.mark.integration
def test_empty_active_returns_success_with_zero_rate() -> None:
    # No one has come back at D+30 yet. Same contract as empty cohort: the
    # handler reports the bare truth (0%) without an error.
    response = get_retention_metrics(
        cohort_users=["alice", "bob"],
        active_users=[],
    )

    assert response["success"] is True
    assert response["error"] is None
    assert response["data"]["cohort_size"] == 2
    assert response["data"]["active_size"] == 0
    assert response["data"]["retention_rate"] == 0.0
    assert response["data"]["status"] == "below"
    assert response["data"]["meets_threshold"] is False


@pytest.mark.integration
def test_both_empty_returns_success_with_zero_rate() -> None:
    # Edge of edges — completely fresh deploy. Must not crash; must report
    # zeros.
    response = get_retention_metrics(
        cohort_users=[],
        active_users=[],
    )

    assert response["success"] is True
    assert response["data"]["cohort_size"] == 0
    assert response["data"]["active_size"] == 0
    assert response["data"]["retention_rate"] == 0.0


# ---------------------------------------------------------------------------
# Response-schema validation — top-level envelope shape
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_response_top_level_schema() -> None:
    response = get_retention_metrics(
        cohort_users=["alice", "bob"],
        active_users=["alice"],
    )

    # ApiResponse envelope: exactly three top-level keys, never more / less.
    # Any drift here breaks every consumer that destructures the response.
    assert set(response.keys()) == {"success", "data", "error"}
    assert isinstance(response["success"], bool)
    assert response["data"] is None or isinstance(response["data"], dict)
    assert response["error"] is None or isinstance(response["error"], str)


@pytest.mark.integration
def test_response_data_schema_on_success() -> None:
    response = get_retention_metrics(
        cohort_users=["alice", "bob", "carol", "dave"],
        active_users=["alice", "bob"],
    )

    # Data payload must carry exactly the seven keys the docstring promises.
    # Locking the set down means dashboards can rely on `data[key]` without
    # `.get(key, default)` defensive code.
    expected_keys = {
        "cohort_size",
        "active_size",
        "retention_rate",
        "threshold",
        "meets_threshold",
        "gap",
        "status",
    }
    assert set(response["data"].keys()) == expected_keys

    # Type discipline — the consumer expects floats for rates, ints for
    # sizes, bool for the verdict, str for status.
    data = response["data"]
    assert isinstance(data["cohort_size"], int)
    assert isinstance(data["active_size"], int)
    assert isinstance(data["retention_rate"], float)
    assert isinstance(data["threshold"], float)
    assert isinstance(data["meets_threshold"], bool)
    assert isinstance(data["gap"], float)
    assert isinstance(data["status"], str)


@pytest.mark.integration
def test_status_is_one_of_three_values() -> None:
    # The verdict status is a closed enum; any value outside this set is a
    # protocol violation the dashboard would silently mis-render.
    for cohort, active in [
        (["a", "b", "c", "d"], ["a"]),  # exactly at the bar
        (["a", "b"], ["a", "b"]),  # above
        (["a", "b", "c", "d"], []),  # below
    ]:
        response = get_retention_metrics(cohort_users=cohort, active_users=active)
        assert response["data"]["status"] in {"below", "at", "above"}


# ---------------------------------------------------------------------------
# Custom threshold — handler must respect the keyword override
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_default_threshold_is_seed_contract_25_percent() -> None:
    # The Seed Contract Phase-1 bar is 0.25. The constant exists exactly so
    # a future amendment lives in one place; pin it down with a test.
    assert DEFAULT_RETENTION_THRESHOLD == pytest.approx(0.25)


@pytest.mark.integration
def test_custom_threshold_overrides_default() -> None:
    # The pivot signal in the Seed Contract is "retention < 10%". Operators
    # comparing against the kill-switch line need the same handler with a
    # different bar — not a second handler.
    response = get_retention_metrics(
        cohort_users=["alice", "bob", "carol", "dave"],
        active_users=["alice"],  # 25%
        threshold=0.10,
    )

    assert response["data"]["threshold"] == pytest.approx(0.10)
    assert response["data"]["meets_threshold"] is True
    assert response["data"]["status"] == "above"


# ---------------------------------------------------------------------------
# Error envelopes — invalid inputs render as success=False, not raise
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_invalid_threshold_returns_error_envelope() -> None:
    # Out-of-range threshold should not crash the handler — the route layer
    # would otherwise 500. Convert it to a structured error envelope.
    response = get_retention_metrics(
        cohort_users=["alice"],
        active_users=["alice"],
        threshold=1.5,
    )

    assert response["success"] is False
    assert response["data"] is None
    assert isinstance(response["error"], str)
    assert "threshold" in response["error"].lower()


@pytest.mark.integration
def test_nan_threshold_returns_error_envelope() -> None:
    response = get_retention_metrics(
        cohort_users=["alice"],
        active_users=["alice"],
        threshold=math.nan,
    )

    assert response["success"] is False
    assert response["data"] is None
    assert "threshold" in response["error"].lower()


@pytest.mark.integration
def test_negative_threshold_returns_error_envelope() -> None:
    response = get_retention_metrics(
        cohort_users=["alice"],
        active_users=["alice"],
        threshold=-0.1,
    )

    assert response["success"] is False
    assert response["data"] is None


@pytest.mark.integration
def test_non_string_cohort_member_returns_error_envelope() -> None:
    # Bare-str-iteration foot-gun: passing "alice" instead of ["alice"]
    # would silently iterate over characters. The calculator already rejects
    # this; the handler must surface the rejection as an error envelope,
    # not as an unhandled exception.
    response = get_retention_metrics(
        cohort_users="alice",  # type: ignore[arg-type]
        active_users=["alice"],
    )

    assert response["success"] is False
    assert response["data"] is None
    assert isinstance(response["error"], str)


@pytest.mark.integration
def test_non_iterable_input_returns_error_envelope() -> None:
    # Some HTTP frameworks may hand us a None when a query param is missing;
    # the handler must not 500 on that — it must return a clear error.
    response = get_retention_metrics(
        cohort_users=None,  # type: ignore[arg-type]
        active_users=["alice"],
    )

    assert response["success"] is False
    assert response["data"] is None


# ---------------------------------------------------------------------------
# Purity / hygiene — defensive against shared-mutable-state regressions
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_handler_is_pure_same_inputs_yield_equal_outputs() -> None:
    first = get_retention_metrics(
        cohort_users=["alice", "bob"],
        active_users=["alice"],
    )
    second = get_retention_metrics(
        cohort_users=["alice", "bob"],
        active_users=["alice"],
    )

    assert first == second


@pytest.mark.integration
def test_handler_returns_fresh_dict_each_call() -> None:
    # Callers routinely augment the response for logging; mutation must not
    # leak back into a shared instance.
    first = get_retention_metrics(
        cohort_users=["alice"],
        active_users=["alice"],
    )
    second = get_retention_metrics(
        cohort_users=["alice"],
        active_users=["alice"],
    )

    assert first is not second
    assert first["data"] is not second["data"]


@pytest.mark.integration
def test_response_mutation_does_not_leak_into_next_call() -> None:
    # Concretely demonstrate the freshness guarantee — mutating one
    # response must not poison a later one.
    first = get_retention_metrics(
        cohort_users=["alice"],
        active_users=["alice"],
    )
    first["data"]["retention_rate"] = 999.0  # caller-side scribble

    second = get_retention_metrics(
        cohort_users=["alice"],
        active_users=["alice"],
    )

    assert second["data"]["retention_rate"] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Deduplication — sizes reported are post-deduplication
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_duplicate_cohort_users_are_deduplicated_in_size() -> None:
    # The calculator deduplicates internally so a double-counted user does
    # not double-count in the denominator. The handler's `cohort_size` must
    # report the dedup'd count to stay consistent with the rate.
    response = get_retention_metrics(
        cohort_users=["alice", "alice", "bob"],
        active_users=["alice"],
    )

    assert response["success"] is True
    assert response["data"]["cohort_size"] == 2
    assert response["data"]["retention_rate"] == pytest.approx(0.5)


@pytest.mark.integration
def test_duplicate_active_users_are_deduplicated_in_size() -> None:
    response = get_retention_metrics(
        cohort_users=["alice", "bob"],
        active_users=["alice", "alice"],
    )

    assert response["data"]["active_size"] == 1
    assert response["data"]["retention_rate"] == pytest.approx(0.5)
