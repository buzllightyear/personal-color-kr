"""Unit tests for `aggregate_conversion_rate` (Sub-AC 1.2).

The contract under test:

    aggregate_conversion_rate(events, window_months=3, *, now=None) -> float

    Counts `checkout_started` / `checkout_completed` events whose timestamp
    lies in `[now - window_months * 30 days, now)` and returns the fraction
    `completed / started` in `[0.0, 1.0]`.

Why this function exists:

    The TS event-emission layer (`src/funnel/payment-tracking.ts`) and the
    TS scalar calculator (`src/funnel/conversion-rate.ts`) own client-side
    capture and per-call math. The server-side metric pipeline — the
    retention-API router, the dashboard query, the pivot-alert hook —
    needs to ask the same windowed conversion question against the same
    event log. Centralising the windowing here prevents the 5.5% north-
    star bar from silently drifting between dashboards.

Coverage matrix (the AC-required edge cases):

  1. Window inclusion semantics
     a. Event exactly on `window_start`        → INCLUDED
     b. Event at `now`                          → EXCLUDED (half-open)
     c. Event just inside `now`                 → INCLUDED
     d. Event before `window_start`             → EXCLUDED
  2. Boundary cases — "0건" and "분모 0"
     a. Empty event list                        → 0.0
     b. No started events in window             → 0.0
     c. started > 0, completed = 0              → 0.0
     d. started = 0, completed > 0 (straddle)   → clamped to 1.0
  3. Standard ratios at the 5.5% north-star
     a. 55 completed / 1000 started             → 0.055
     b. 1 completed / 1 started                 → 1.0
  4. Event shape flexibility
     a. Dict events with ms-epoch timestamps
     b. Object events with datetime timestamps
     c. Unknown event types are silently ignored
  5. Window-size override
     a. 1-month window                          → 30-day cut-off
     b. 6-month window                          → 180-day cut-off
  6. Purity
     a. Same input + same `now` → same output
     b. Input list is not mutated
  7. Input validation
     a. `events=None`                           → TypeError
     b. `events="string"`                       → TypeError
     c. Non-positive window_months              → ValueError
     d. bool window_months                      → TypeError
     e. Naive `now`                             → ValueError
     f. Non-datetime `now`                      → TypeError
     g. Event missing `type`                    → ValueError
     h. Event with non-string `type`            → ValueError
     i. Event missing `timestamp`               → ValueError
     j. Event with naive-datetime timestamp     → ValueError
     k. Event with bool timestamp               → ValueError
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest

from funnel.window_aggregator import (
    PAYMENT_EVENT_TYPES,
    aggregate_conversion_rate,
)


# ---------------------------------------------------------------------------
# Test fixtures — anchor `now` and tiny event helpers
# ---------------------------------------------------------------------------


# A fixed UTC anchor so every test is deterministic. Picking a date well
# inside the unix epoch range avoids fromtimestamp edge cases on 32-bit
# systems while staying in a recognisable year.
NOW = datetime(2026, 5, 16, 12, 0, 0, tzinfo=timezone.utc)


def _ts_at(now: datetime, *, days_ago: float) -> datetime:
    """Helper: tz-aware datetime `days_ago` before `now`."""
    return now - timedelta(days=days_ago)


def _ms_epoch_at(now: datetime, *, days_ago: float) -> int:
    """Helper: integer ms-epoch `days_ago` before `now`."""
    return int(_ts_at(now, days_ago=days_ago).timestamp() * 1000)


def _started(ts: datetime | int) -> dict:
    return {"type": "checkout_started", "timestamp": ts}


def _completed(ts: datetime | int) -> dict:
    return {"type": "checkout_completed", "timestamp": ts}


@dataclass(frozen=True)
class _AttrEvent:
    """Attribute-style event used to cover the non-dict input path."""

    type: str
    timestamp: datetime


# ---------------------------------------------------------------------------
# Window inclusion semantics — the AC-required boundary cases
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_event_exactly_on_window_start_is_included() -> None:
    # Lower bound is INCLUSIVE so a cohort that just crosses the boundary
    # is not silently lost. Mirrors the cohort-window edge in
    # src/retention/cohort.py.
    window_days = 3 * 30
    on_boundary = NOW - timedelta(days=window_days)
    just_inside = NOW - timedelta(seconds=1)
    events = [_started(on_boundary), _completed(just_inside)]

    rate = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert rate == pytest.approx(1.0)


@pytest.mark.unit
def test_event_at_now_is_excluded() -> None:
    # Upper bound is EXCLUSIVE so the same event cannot land in two
    # adjacent windows when the dashboard ticks over.
    events = [_started(NOW), _completed(NOW)]

    rate = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert rate == 0.0


@pytest.mark.unit
def test_event_just_inside_now_is_included() -> None:
    just_inside = NOW - timedelta(microseconds=1)
    events = [_started(just_inside), _completed(just_inside)]

    rate = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert rate == pytest.approx(1.0)


@pytest.mark.unit
def test_event_before_window_start_is_excluded() -> None:
    outside = NOW - timedelta(days=3 * 30 + 1)  # 1 day older than window
    events = [_started(outside), _completed(outside)]

    rate = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert rate == 0.0


# ---------------------------------------------------------------------------
# Boundary cases — "0건" / 분모 0
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_empty_events_returns_zero() -> None:
    # Dashboard contract: render 0% on no observations, never NaN, never
    # raise. Same behaviour as the TS calculator.
    assert aggregate_conversion_rate([], window_months=3, now=NOW) == 0.0


@pytest.mark.unit
def test_no_started_in_window_returns_zero() -> None:
    outside = _ts_at(NOW, days_ago=200)
    events = [_started(outside), _completed(outside)]

    assert aggregate_conversion_rate(events, window_months=3, now=NOW) == 0.0


@pytest.mark.unit
def test_started_only_no_completed_returns_zero() -> None:
    inside = _ts_at(NOW, days_ago=10)
    events = [_started(inside), _started(inside), _started(inside)]

    assert aggregate_conversion_rate(events, window_months=3, now=NOW) == 0.0


@pytest.mark.unit
def test_straddle_completed_without_started_is_clamped_to_one() -> None:
    # Window-boundary artefact: a user started outside the window and
    # completed inside it. Raising would break the dashboard; we clamp
    # the rate at 1.0 and let raw counts diagnose the artefact if needed.
    inside = _ts_at(NOW, days_ago=10)
    events = [_completed(inside)]

    rate = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert rate == 1.0


# ---------------------------------------------------------------------------
# Standard ratios — the 5.5% north-star anchor
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_north_star_anchor_55_per_1000_is_5_5_percent() -> None:
    # The Phase-0 conversion target is 5.5%. The aggregator returns a
    # fraction (0.055), not percent points — same units as
    # `src/retention/threshold.py` so the threshold pipeline composes
    # cleanly downstream.
    inside_ts = _ts_at(NOW, days_ago=10)
    events = [_started(inside_ts) for _ in range(1000)]
    events.extend(_completed(inside_ts) for _ in range(55))

    rate = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert rate == pytest.approx(0.055)


@pytest.mark.unit
def test_full_conversion_one_for_one() -> None:
    inside_ts = _ts_at(NOW, days_ago=10)
    events = [_started(inside_ts), _completed(inside_ts)]

    rate = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert rate == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Event-shape flexibility
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_ms_epoch_timestamp_dict_event() -> None:
    # PostHog / TS sends timestamps as ms-epoch ints across the boundary;
    # the aggregator must accept that shape without explicit conversion.
    inside_ms = _ms_epoch_at(NOW, days_ago=10)
    events = [
        {"type": "checkout_started", "timestamp": inside_ms},
        {"type": "checkout_completed", "timestamp": inside_ms},
    ]

    rate = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert rate == pytest.approx(1.0)


@pytest.mark.unit
def test_attribute_style_event_objects() -> None:
    # Python callers might pass dataclasses (e.g. an internal PaymentEvent
    # dataclass); attribute access must work, not only dict access.
    inside = _ts_at(NOW, days_ago=10)
    events = [
        _AttrEvent(type="checkout_started", timestamp=inside),
        _AttrEvent(type="checkout_completed", timestamp=inside),
    ]

    rate = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert rate == pytest.approx(1.0)


@pytest.mark.unit
def test_unknown_event_types_silently_ignored() -> None:
    # Mixed PostHog logs include funnel-step events (`step_view`,
    # `step_drop`, etc.) that have nothing to do with payment conversion.
    # The aggregator must safely ignore them, exactly like the TS
    # `calculateConversionRateFromEvents`.
    inside = _ts_at(NOW, days_ago=10)
    events = [
        {"type": "step_view", "timestamp": inside},
        {"type": "step_drop", "timestamp": inside},
        _started(inside),
        _completed(inside),
        {"type": "diagnosis_completed", "timestamp": inside},
    ]

    rate = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert rate == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Window size overrides
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_one_month_window_cuts_off_at_30_days() -> None:
    inside_30 = _ts_at(NOW, days_ago=29)
    outside_30 = _ts_at(NOW, days_ago=31)
    events = [
        _started(inside_30),
        _completed(inside_30),
        _started(outside_30),  # outside the 30-day window
    ]

    rate = aggregate_conversion_rate(events, window_months=1, now=NOW)

    assert rate == pytest.approx(1.0)


@pytest.mark.unit
def test_six_month_window_cuts_off_at_180_days() -> None:
    inside_180 = _ts_at(NOW, days_ago=170)
    outside_180 = _ts_at(NOW, days_ago=190)
    events = [
        _started(inside_180),
        _completed(inside_180),
        _started(outside_180),
        _completed(outside_180),
    ]

    rate = aggregate_conversion_rate(events, window_months=6, now=NOW)

    assert rate == pytest.approx(1.0)


@pytest.mark.unit
def test_default_window_is_three_months() -> None:
    # Default kwarg is "3" — the dashboard's canonical window.
    inside_90 = _ts_at(NOW, days_ago=89)
    outside_90 = _ts_at(NOW, days_ago=91)
    events = [
        _started(inside_90),
        _completed(inside_90),
        _started(outside_90),
        _completed(outside_90),
    ]

    rate = aggregate_conversion_rate(events, now=NOW)

    assert rate == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Purity
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_repeated_calls_with_same_input_yield_same_result() -> None:
    inside = _ts_at(NOW, days_ago=10)
    events = [_started(inside), _started(inside), _completed(inside)]

    first = aggregate_conversion_rate(events, window_months=3, now=NOW)
    second = aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert first == second


@pytest.mark.unit
def test_input_list_is_not_mutated() -> None:
    # Aggregation must never reorder, remove, or annotate the caller's
    # event list — that is a class of bug that has bitten the funnel
    # analytics layer before.
    inside = _ts_at(NOW, days_ago=10)
    events: list = [_started(inside), _completed(inside)]
    snapshot = list(events)

    aggregate_conversion_rate(events, window_months=3, now=NOW)

    assert events == snapshot


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_events_none_raises_typeerror() -> None:
    with pytest.raises(TypeError, match="events"):
        aggregate_conversion_rate(None, window_months=3, now=NOW)  # type: ignore[arg-type]


@pytest.mark.unit
def test_events_string_raises_typeerror() -> None:
    # A bare string is technically iterable but iterates to characters,
    # which would silently produce 0.0 — refuse explicitly.
    with pytest.raises(TypeError, match="events"):
        aggregate_conversion_rate("not a list", window_months=3, now=NOW)  # type: ignore[arg-type]


@pytest.mark.unit
def test_zero_window_months_raises_valueerror() -> None:
    with pytest.raises(ValueError, match="window_months"):
        aggregate_conversion_rate([], window_months=0, now=NOW)


@pytest.mark.unit
def test_negative_window_months_raises_valueerror() -> None:
    with pytest.raises(ValueError, match="window_months"):
        aggregate_conversion_rate([], window_months=-1, now=NOW)


@pytest.mark.unit
def test_bool_window_months_raises_typeerror() -> None:
    # bool is an int subclass — accepting True would silently mean
    # window_months=1, exactly the class of bug retention/threshold.py
    # rejects.
    with pytest.raises(TypeError, match="window_months"):
        aggregate_conversion_rate([], window_months=True, now=NOW)  # type: ignore[arg-type]


@pytest.mark.unit
def test_non_int_window_months_raises_typeerror() -> None:
    with pytest.raises(TypeError, match="window_months"):
        aggregate_conversion_rate([], window_months=3.0, now=NOW)  # type: ignore[arg-type]


@pytest.mark.unit
def test_naive_now_raises_valueerror() -> None:
    naive = datetime(2026, 5, 16, 12, 0, 0)
    with pytest.raises(ValueError, match="timezone-aware"):
        aggregate_conversion_rate([], window_months=3, now=naive)


@pytest.mark.unit
def test_non_datetime_now_raises_typeerror() -> None:
    with pytest.raises(TypeError, match="now"):
        aggregate_conversion_rate([], window_months=3, now="2026-05-16")  # type: ignore[arg-type]


@pytest.mark.unit
def test_event_missing_type_raises_valueerror() -> None:
    inside = _ts_at(NOW, days_ago=10)
    bad = [{"timestamp": inside}]
    with pytest.raises(ValueError, match="type"):
        aggregate_conversion_rate(bad, window_months=3, now=NOW)


@pytest.mark.unit
def test_event_non_string_type_raises_valueerror() -> None:
    inside = _ts_at(NOW, days_ago=10)
    bad = [{"type": 42, "timestamp": inside}]
    with pytest.raises(ValueError, match="type"):
        aggregate_conversion_rate(bad, window_months=3, now=NOW)


@pytest.mark.unit
def test_event_missing_timestamp_raises_valueerror() -> None:
    bad = [{"type": "checkout_started"}]
    with pytest.raises(ValueError, match="timestamp"):
        aggregate_conversion_rate(bad, window_months=3, now=NOW)


@pytest.mark.unit
def test_event_naive_datetime_timestamp_raises_valueerror() -> None:
    bad = [
        {"type": "checkout_started", "timestamp": datetime(2026, 5, 10, 12, 0, 0)},
    ]
    with pytest.raises(ValueError, match="naive datetime"):
        aggregate_conversion_rate(bad, window_months=3, now=NOW)


@pytest.mark.unit
def test_event_bool_timestamp_raises_valueerror() -> None:
    bad = [{"type": "checkout_started", "timestamp": True}]
    with pytest.raises(ValueError, match="bool"):
        aggregate_conversion_rate(bad, window_months=3, now=NOW)


@pytest.mark.unit
def test_event_unsupported_timestamp_type_raises_valueerror() -> None:
    bad = [{"type": "checkout_started", "timestamp": object()}]
    with pytest.raises(ValueError, match="timestamp"):
        aggregate_conversion_rate(bad, window_months=3, now=NOW)


# ---------------------------------------------------------------------------
# Constants — guard against silent drift
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_payment_event_types_match_ts_contract() -> None:
    # Mirrors `PAYMENT_EVENT_TYPES` in src/funnel/payment-tracking.ts —
    # an extra/missing event type here would silently double-count or
    # ignore a payment milestone.
    assert PAYMENT_EVENT_TYPES == ("checkout_started", "checkout_completed")
