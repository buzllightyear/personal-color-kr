"""Unit tests for `calculate_30day_retention` (Sub-AC 6.2).

The acceptance criterion names three cases that must pass:

  1. Empty cohort                  →  0.0
  2. 100% retention                →  1.0
  3. 0% retention                  →  0.0

These are tested first because they pin the contract corners that the
Seed-level retention threshold (`>= 0.25`) and pivot signal (`< 0.10`)
both lean on. Additional tests cover the boundary discipline the public
docstring promises: deduplication, type / value validation, and the
"extra active users" case where the active set is a superset of the
cohort.
"""

from __future__ import annotations

import pytest

from retention.calculator import calculate_30day_retention

# ---------------------------------------------------------------------------
# Required AC cases
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_empty_cohort_returns_zero() -> None:
    """An empty cohort must return 0.0, not raise ZeroDivisionError.

    The module docstring promises 0.0 explicitly so dashboards that
    compare against the Seed Contract's 25% bar do not have to
    special-case division by zero. Returning NaN here would silently
    fail every threshold comparison downstream (NaN >= 0.25 is False).
    """
    assert calculate_30day_retention([], ["alice", "bob"]) == 0.0


@pytest.mark.unit
def test_100_percent_retention() -> None:
    """Every cohort user appearing in `active_users` → rate 1.0."""
    cohort = ["alice", "bob", "carol"]
    active = ["alice", "bob", "carol"]
    assert calculate_30day_retention(cohort, active) == 1.0


@pytest.mark.unit
def test_0_percent_retention() -> None:
    """No cohort user in `active_users` → rate 0.0.

    Distinguished from the empty-cohort case: here the denominator is
    non-zero, so the contract is `0 / 3 == 0.0` rather than the
    contract-defined `0.0` short-circuit.
    """
    cohort = ["alice", "bob", "carol"]
    active = ["dave", "erin"]
    assert calculate_30day_retention(cohort, active) == 0.0


# ---------------------------------------------------------------------------
# Boundary / contract tests beyond the required three
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_partial_retention_two_thirds() -> None:
    """Mixed retention computes as |cohort ∩ active| / |cohort|."""
    cohort = ["alice", "bob", "carol"]
    active = ["alice", "bob", "dave"]  # 'dave' not in cohort, ignored
    assert calculate_30day_retention(cohort, active) == pytest.approx(2 / 3)


@pytest.mark.unit
def test_duplicates_in_cohort_do_not_double_count() -> None:
    """A user listed twice in the cohort must count once in the denominator.

    Analytics dumps occasionally double-emit a user. The docstring
    promises dedup; this test pins the promise. With raw `len(list)` the
    answer would be 1/2 = 0.5; with dedup it is 1/1 = 1.0.
    """
    cohort = ["alice", "alice"]
    active = ["alice"]
    assert calculate_30day_retention(cohort, active) == 1.0


@pytest.mark.unit
def test_duplicates_in_active_do_not_double_count() -> None:
    """A user listed twice in the active set still only retains themselves.

    Without dedup the numerator could exceed the denominator (e.g.
    `|{alice, alice}| > |{alice}|`) and a rate > 1.0 would slip
    through, breaking the [0.0, 1.0] invariant the threshold module
    depends on.
    """
    cohort = ["alice"]
    active = ["alice", "alice"]
    assert calculate_30day_retention(cohort, active) == 1.0


@pytest.mark.unit
def test_active_users_superset_of_cohort_still_caps_at_one() -> None:
    """Extra active users outside the cohort do not lift the rate above 1."""
    cohort = ["alice", "bob"]
    active = ["alice", "bob", "carol", "dave", "erin"]
    assert calculate_30day_retention(cohort, active) == 1.0


@pytest.mark.unit
def test_both_empty_returns_zero() -> None:
    """Both inputs empty → 0.0 (empty-cohort branch wins)."""
    assert calculate_30day_retention([], []) == 0.0


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad_cohort",
    ["alice", b"alice", bytearray(b"alice")],
    ids=["str", "bytes", "bytearray"],
)
def test_bare_string_like_cohort_rejected(bad_cohort: object) -> None:
    """Passing a bare str/bytes must raise, not silently iterate chars."""
    with pytest.raises(TypeError, match="cohort_users"):
        calculate_30day_retention(bad_cohort, ["alice"])  # type: ignore[arg-type]


@pytest.mark.unit
def test_bare_string_active_rejected() -> None:
    """Same guardrail applied to the active_users argument."""
    with pytest.raises(TypeError, match="active_users"):
        calculate_30day_retention(["alice"], "alice")  # type: ignore[arg-type]


@pytest.mark.unit
def test_non_string_member_rejected() -> None:
    """Numeric user_ids are refused — the module contracts str ids only."""
    with pytest.raises(TypeError, match="cohort_users members"):
        calculate_30day_retention(["alice", 42], ["alice"])  # type: ignore[list-item]


@pytest.mark.unit
def test_empty_string_member_rejected() -> None:
    """An empty / whitespace user_id is a data-quality bug, not retention."""
    with pytest.raises(ValueError, match="empty"):
        calculate_30day_retention(["alice", "   "], ["alice"])


@pytest.mark.unit
def test_accepts_iterables_other_than_list() -> None:
    """Tuples / sets / generators are valid — the type hint says list but
    the docstring promises any iterable, and the broader contract should
    win. This pins the looser contract so future tightening is a
    deliberate decision rather than an accident.
    """
    cohort = ("alice", "bob")
    active = {"alice"}
    assert calculate_30day_retention(cohort, active) == 0.5  # type: ignore[arg-type]
