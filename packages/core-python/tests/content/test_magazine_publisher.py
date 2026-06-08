"""Unit tests for the monthly magazine publisher (Sub-AC 6.1).

The publisher sits on top of the seeded magazine catalogue in
:mod:`content.magazines` and answers two scheduler questions:

  - *Which issue is "this month"?* → ``get_current_issue``.
  - *Should we publish right now?* → ``evaluate_publish`` returning a
    ``PublishDecision``.

These tests cover the AC headline guarantees:

  - **발행 주기 판정** — ``is_publish_day`` and ``evaluate_publish``
    only fire on day-1 of the calendar month, every other day is a
    no-op with a stable ``not_publish_day`` reason code.
  - **이달치 조회 결과 검증** — ``current_month_key`` and
    ``get_current_issue`` resolve every seeded month, return ``None``
    for unseeded months instead of raising, and bundle the correct
    :class:`Magazine` into the decision.
  - **Idempotency** — months listed in ``already_published`` short-
    circuit to ``REASON_ALREADY_PUBLISHED`` even on day-1.
  - **Immutability** — ``PublishDecision`` is a frozen dataclass.

Marker: every test is ``@pytest.mark.unit`` — pure data + a `date`,
no I/O.
"""

from __future__ import annotations

import dataclasses
from datetime import date

import pytest

from content.magazine_publisher import (
    PUBLISH_DAY_OF_MONTH,
    REASON_ALREADY_PUBLISHED,
    REASON_NO_ISSUE,
    REASON_NOT_PUBLISH_DAY,
    REASON_READY,
    current_month_key,
    evaluate_publish,
    get_current_issue,
    is_publish_day,
)
from content.magazines import (
    Magazine,
    available_months,
    get_magazine_by_month,
)

# ---------------------------------------------------------------------------
# current_month_key — YYYY-MM derivation from a date
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_current_month_key_formats_yyyy_mm() -> None:
    assert current_month_key(date(2026, 5, 17)) == "2026-05"


@pytest.mark.unit
def test_current_month_key_zero_pads_single_digit_month() -> None:
    assert current_month_key(date(2027, 1, 1)) == "2027-01"
    assert current_month_key(date(2027, 9, 30)) == "2027-09"


@pytest.mark.unit
def test_current_month_key_handles_double_digit_month() -> None:
    assert current_month_key(date(2026, 12, 31)) == "2026-12"


@pytest.mark.unit
def test_current_month_key_ignores_day_within_month() -> None:
    """Day-of-month must not leak into the YYYY-MM key."""
    assert current_month_key(date(2026, 6, 1)) == "2026-06"
    assert current_month_key(date(2026, 6, 15)) == "2026-06"
    assert current_month_key(date(2026, 6, 30)) == "2026-06"


@pytest.mark.unit
def test_current_month_key_rejects_non_date() -> None:
    with pytest.raises(TypeError, match="must be a datetime.date"):
        current_month_key("2026-05-17")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# get_current_issue — resolves a date to a seeded magazine
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_current_issue_returns_seeded_magazine_for_seeded_month() -> None:
    """Every seeded month round-trips back to a real Magazine."""
    for month in available_months():
        year_part, month_part = month.split("-")
        today = date(int(year_part), int(month_part), 15)
        issue = get_current_issue(today)
        assert isinstance(
            issue, Magazine
        ), f"get_current_issue returned non-Magazine for {month}"
        assert issue.month == month, f"requested {month!r}, got {issue.month!r}"


@pytest.mark.unit
def test_get_current_issue_returns_correct_issue_payload() -> None:
    """The Magazine surface must match what `get_magazine_by_month` ships."""
    for month in available_months():
        year_part, month_part = month.split("-")
        today = date(int(year_part), int(month_part), 1)
        expected = get_magazine_by_month(month)
        assert get_current_issue(today) == expected


@pytest.mark.unit
def test_get_current_issue_returns_none_when_no_issue_for_month() -> None:
    """Unseeded month must NOT raise — UI needs a render-empty fallback."""
    # 1999 is far enough in the past to never collide with the seed
    # catalogue, even as new issues are added each month.
    assert get_current_issue(date(1999, 1, 15)) is None
    assert get_current_issue(date(2099, 12, 1)) is None


@pytest.mark.unit
def test_get_current_issue_rejects_non_date() -> None:
    with pytest.raises(TypeError, match="must be a datetime.date"):
        get_current_issue("today")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# is_publish_day — only day-1 of a calendar month
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_is_publish_day_returns_true_on_first_of_month() -> None:
    assert is_publish_day(date(2026, 5, 1)) is True
    assert is_publish_day(date(2026, 6, 1)) is True
    assert is_publish_day(date(2027, 1, 1)) is True


@pytest.mark.unit
@pytest.mark.parametrize("day", [2, 5, 15, 17, 28, 30, 31])
def test_is_publish_day_returns_false_on_other_days(day: int) -> None:
    # May has 31 days, January has 31, so these are all valid.
    assert is_publish_day(date(2026, 5, day)) is False


@pytest.mark.unit
def test_publish_day_constant_is_one() -> None:
    """The monthly drop cadence is documented as day-1."""
    assert PUBLISH_DAY_OF_MONTH == 1


@pytest.mark.unit
def test_is_publish_day_rejects_non_date() -> None:
    with pytest.raises(TypeError, match="must be a datetime.date"):
        is_publish_day(20260501)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# evaluate_publish — the publish-cycle decision
# ---------------------------------------------------------------------------


def _first_seeded_month_as_date() -> date:
    month = available_months()[0]
    year_part, month_part = month.split("-")
    return date(int(year_part), int(month_part), 1)


@pytest.mark.unit
def test_evaluate_publish_returns_ready_on_publish_day_with_seeded_issue() -> None:
    today = _first_seeded_month_as_date()
    decision = evaluate_publish(today)
    assert decision.should_publish is True
    assert decision.reason == REASON_READY
    assert decision.month == current_month_key(today)
    assert isinstance(decision.issue, Magazine)
    assert decision.issue.month == decision.month


@pytest.mark.unit
def test_evaluate_publish_blocks_on_non_first_of_month() -> None:
    """발행 주기 판정 — every day except day-1 must short-circuit."""
    seeded_month = available_months()[0]
    year_part, month_part = seeded_month.split("-")
    # Day-2 in a seeded month so only the day check can flip the
    # decision (the issue lookup would otherwise succeed).
    today = date(int(year_part), int(month_part), 2)
    decision = evaluate_publish(today)
    assert decision.should_publish is False
    assert decision.reason == REASON_NOT_PUBLISH_DAY
    # The issue still resolves so the UI can render today's magazine.
    assert isinstance(decision.issue, Magazine)
    assert decision.issue.month == seeded_month


@pytest.mark.unit
def test_evaluate_publish_blocks_when_month_unseeded_even_on_first() -> None:
    """No issue → no publish, regardless of calendar day."""
    decision = evaluate_publish(date(1999, 1, 1))
    assert decision.should_publish is False
    assert decision.reason == REASON_NO_ISSUE
    assert decision.month == "1999-01"
    assert decision.issue is None


@pytest.mark.unit
def test_evaluate_publish_blocks_when_already_published() -> None:
    """Idempotency — repeat ticks within the same month must be no-ops."""
    today = _first_seeded_month_as_date()
    month = current_month_key(today)
    decision = evaluate_publish(today, already_published={month})
    assert decision.should_publish is False
    assert decision.reason == REASON_ALREADY_PUBLISHED
    # The issue is still surfaced so the UI keeps rendering it.
    assert isinstance(decision.issue, Magazine)
    assert decision.issue.month == month


@pytest.mark.unit
def test_evaluate_publish_accepts_iterable_already_published() -> None:
    """`already_published` accepts any iterable of YYYY-MM keys."""
    today = _first_seeded_month_as_date()
    month = current_month_key(today)

    # Tuple
    assert evaluate_publish(today, already_published=(month,)).reason == (
        REASON_ALREADY_PUBLISHED
    )
    # List
    assert evaluate_publish(today, already_published=[month]).reason == (
        REASON_ALREADY_PUBLISHED
    )
    # Generator — must not be exhausted by the time the check happens
    assert (
        evaluate_publish(today, already_published=(m for m in (month,))).reason
        == REASON_ALREADY_PUBLISHED
    )


@pytest.mark.unit
def test_evaluate_publish_unrelated_already_published_does_not_block() -> None:
    """Idempotency keyed on month only — other months must not interfere."""
    today = _first_seeded_month_as_date()
    decision = evaluate_publish(
        today,
        already_published={"1999-01", "2099-12"},
    )
    assert decision.should_publish is True
    assert decision.reason == REASON_READY


@pytest.mark.unit
def test_evaluate_publish_not_publish_day_takes_priority_over_idempotency() -> None:
    """Day-check fires first — keeps the reason code stable for analytics."""
    seeded_month = available_months()[0]
    year_part, month_part = seeded_month.split("-")
    today = date(int(year_part), int(month_part), 2)
    decision = evaluate_publish(today, already_published={seeded_month})
    assert decision.should_publish is False
    assert decision.reason == REASON_NOT_PUBLISH_DAY


@pytest.mark.unit
def test_evaluate_publish_no_issue_takes_priority_over_idempotency() -> None:
    """Missing-issue is checked before idempotency — clearer signal upstream."""
    decision = evaluate_publish(
        date(1999, 1, 1),
        already_published={"1999-01"},
    )
    assert decision.should_publish is False
    assert decision.reason == REASON_NO_ISSUE


# ---------------------------------------------------------------------------
# PublishDecision — immutability + hashability
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_publish_decision_is_frozen() -> None:
    decision = evaluate_publish(_first_seeded_month_as_date())
    with pytest.raises(dataclasses.FrozenInstanceError):
        decision.should_publish = False  # type: ignore[misc]


@pytest.mark.unit
def test_publish_decision_equality_is_structural() -> None:
    today = _first_seeded_month_as_date()
    assert evaluate_publish(today) == evaluate_publish(today)


@pytest.mark.unit
def test_reason_codes_are_distinct() -> None:
    """Reason codes must not collide — analytics keys depend on it."""
    reasons = {
        REASON_READY,
        REASON_NOT_PUBLISH_DAY,
        REASON_NO_ISSUE,
        REASON_ALREADY_PUBLISHED,
    }
    assert len(reasons) == 4
