"""3-month rolling-window conversion-rate aggregation (Sub-AC 1.2).

Building on:
  - The TS event-emission layer (`src/funnel/payment-tracking.ts`) — the
    canonical shape of `checkout_started` / `checkout_completed` events.
  - The TS scalar calculator (`src/funnel/conversion-rate.ts`) — the
    canonical `(completed / started) * 100` formula, defined as the
    payment north-star metric.

Why a Python aggregator next to a TS event-emitter:

  The TS module fires events from the client / Glam Up funnel runtime.
  The Python side owns the *server-side* metric pipeline that the
  retention-API router, the magazine-eligibility scheduler, and the
  pivot-alert hook all read from. They all need to ask the same windowed
  conversion question against the same event log — duplicating the
  windowing logic across three Python call-sites is exactly how the 5.5%
  bar would silently drift between dashboards. Centralise it here.

Window contract — trailing N-month window anchored on `now`:

  Given a list of payment events and a window of `window_months` months,
  this module returns the conversion rate observed over the closed-open
  interval `[now - window_months * 30 days, now)`.

  - Anchor at `now` (injectable for tests, defaults to
    `datetime.now(timezone.utc)`). Same input + same `now` → same output:
    the function is pure with respect to its inputs.
  - "1 month" is approximated as 30 days. Phase-0 simplification: the
    dashboard reports a 90-day trailing window, which is what business
    stakeholders call "3 months" colloquially. Switching to calendar-
    month subtraction is a Phase-1 follow-up that does not change the
    function signature.
  - Events on the exact lower bound are INCLUDED (`>= start`); events at
    or after `now` are EXCLUDED (`< now`). This matches how retention
    cohorts handle their window edges (see `src/retention/cohort.py`)
    and prevents a single boundary event from being double-counted by
    two adjacent windows.

Return value:

  A `float` fraction in `[0.0, 1.0]`. NOT percent points. We intentionally
  use the same unit as `src/retention/threshold.py` so the
  threshold-evaluation pipeline (`evaluate_retention_threshold`) and the
  conversion-target test (5.5% → `0.055`) compose naturally without an
  extra `/ 100` step at every call-site.

  - Empty event list                              → 0.0
  - started == 0 AND completed == 0 in window    → 0.0
    (dashboard contract: "0건" / no observations renders as 0%, never
    NaN, never raise)
  - started == 0 AND completed > 0 in window     → clamped to 1.0
    (window-boundary artefact — every completion's matching start lives
    OUTSIDE the window, so the visible "completions without starts"
    reads as 100% conversion)
  - completed > started > 0 in window            → clamped to 1.0
    (same boundary artefact, partial)
  - Standard case (0 < completed ≤ started)      → completed / started

Why clamp instead of raise on `completed >= started` with started == 0:

  Unlike the scalar `calculateConversionRate` in TS, this aggregator
  filters by timestamp. A user who started checkout at day -100 and
  completed at day -50 contributes a completion but no start to a
  90-day window. Raising here would break dashboards whenever a window
  straddles a slow conversion — the metric must stay robust under
  partial data, which is the whole point of having a metric.

Event input shape — duck-typed, dict OR object:

  Accepts both mapping-style events (PostHog-shaped `dict`s) and
  attribute-style events (e.g. a future `PaymentEvent` dataclass). For
  each event the aggregator reads `type` and `timestamp`; everything
  else is ignored.

  Accepted `timestamp` types:
    - `datetime`              — must be tz-aware
    - `int` / `float`         — ms-epoch (matches the TS contract)

  Accepted `type` values:
    - 'checkout_started'
    - 'checkout_completed'
    Other types (e.g. 'checkout_abandoned' if added later, or unrelated
    Glam Up step events) are silently ignored.

Input validation policy:

  - `events` must be a list/tuple/iterable. `None` → `TypeError`.
  - `window_months` must be a positive `int`. `bool` is refused (int
    subclass — mirrors the retention/threshold discipline). Zero or
    negative → `ValueError`.
  - `now`, when provided, must be a tz-aware `datetime`.
  - Malformed individual events (missing fields, naive timestamps,
    non-numeric timestamps) → `ValueError` with a clear message; we
    refuse to silently drop data because that would silently bias the
    metric.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


#: Canonical event types the aggregator counts. Mirrors the
#: PAYMENT_EVENT_TYPES tuple in `src/funnel/payment-tracking.ts`. Anything
#: outside this set is silently ignored so the function is safe to feed a
#: mixed PostHog log (e.g. funnel step events) without pre-filtering.
PAYMENT_EVENT_TYPES: tuple[str, ...] = (
    "checkout_started",
    "checkout_completed",
)

#: Phase-0 simplification: every month in the trailing window is treated as
#: 30 days. Business stakeholders refer to the dashboard's 90-day window as
#: "3 months"; the simplification keeps the metric stable under DST shifts
#: and avoids depending on `python-dateutil` for `relativedelta`.
_DAYS_PER_MONTH: int = 30


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def aggregate_conversion_rate(
    events: list,
    window_months: int = 3,
    *,
    now: datetime | None = None,
) -> float:
    """Conversion rate over a trailing N-month window.

    Counts `checkout_started` and `checkout_completed` events whose
    timestamp lies in `[now - window_months * 30 days, now)` and returns
    the fraction `completed / started`. See the module docstring for the
    full window contract, return-value semantics, and accepted event shape.

    Args:
        events: An iterable of payment events. Each event must expose a
            `type` field (one of `'checkout_started'` /
            `'checkout_completed'`; unknown values are ignored) and a
            `timestamp` field (tz-aware `datetime` or numeric ms-epoch).
            Events are read via mapping access first (`event["type"]`),
            then attribute access (`event.type`) — so both PostHog-shaped
            `dict`s and dataclass-shaped objects work.
        window_months: Trailing window size in 30-day units. Default `3`
            (the Phase-0 dashboard window). Must be a positive `int`;
            `bool` is refused.
        now: Anchor for the window. Defaults to `datetime.now(timezone.utc)`.
            Must be tz-aware. Keyword-only so callers cannot accidentally
            pass an int-epoch into the wrong slot.

    Returns:
        A `float` fraction in `[0.0, 1.0]`. `0.0` for an empty/started=0
        window. Clamped to `1.0` when a boundary artefact causes
        completed > started (see module docstring).

    Raises:
        TypeError: if `events` is not iterable, if `window_months` is not
            an `int` (or is a `bool`), or if `now` is not a `datetime`.
        ValueError: if `window_months <= 0`, if `now` is naive, or if any
            event has an unreadable `type` / `timestamp` field.
    """
    window_size = _validate_window_months(window_months)
    anchor = _resolve_anchor(now)
    window_start = anchor - timedelta(days=window_size * _DAYS_PER_MONTH)

    if events is None or isinstance(events, (str, bytes)):
        # `None` and strings would silently iterate to nothing useful and
        # produce a misleading 0.0; refuse explicitly.
        raise TypeError(
            f"events must be an iterable of payment events, got "
            f"{type(events).__name__}",
        )
    if not isinstance(events, Iterable):
        raise TypeError(
            f"events must be an iterable of payment events, got "
            f"{type(events).__name__}",
        )

    started, completed = 0, 0
    for index, event in enumerate(events):
        event_type = _extract_type(event, index)
        if event_type not in PAYMENT_EVENT_TYPES:
            # Unknown / unrelated events (other funnel steps, future
            # event types) are silently ignored, exactly like the TS
            # `calculateConversionRateFromEvents` aggregator does.
            continue
        event_ts = _extract_timestamp(event, index)
        if not (window_start <= event_ts < anchor):
            continue
        if event_type == "checkout_started":
            started += 1
        else:  # "checkout_completed"
            completed += 1

    if started == 0:
        # Two sub-cases:
        #  (a) completed == 0 — truly no observations; dashboard contract
        #      says 0.0 (render "0건" / 0%, never NaN, never raise).
        #  (b) completed > 0  — window-boundary artefact: every visible
        #      completion's matching start fell outside the window.
        #      Clamp to 1.0 so the dashboard does not break and the raw
        #      counts remain recoverable from the input log.
        return 1.0 if completed > 0 else 0.0
    if completed > started:
        # Same window-boundary artefact, partial form (some starts inside
        # the window, but at least one completion has its matching start
        # outside). Clamp rather than raise so the metric stays robust
        # under partial / straddling windows.
        return 1.0
    return completed / started


# ---------------------------------------------------------------------------
# Internal validators
# ---------------------------------------------------------------------------


def _validate_window_months(value: object) -> int:
    """Coerce/validate `window_months` to a positive `int`."""
    if isinstance(value, bool):
        # `True`/`False` are `int` subclasses; accepting them would let
        # `window_months=True` silently mean "1 month". Mirrors the
        # discipline in `src/retention/threshold.py`.
        raise TypeError(
            f"window_months must be int, got bool ({value!r})",
        )
    if not isinstance(value, int):
        raise TypeError(
            f"window_months must be int, got {type(value).__name__}",
        )
    if value <= 0:
        raise ValueError(
            f"window_months must be positive, got {value}",
        )
    return value


def _resolve_anchor(now: datetime | None) -> datetime:
    """Resolve / validate the `now` anchor."""
    if now is None:
        return datetime.now(timezone.utc)
    if not isinstance(now, datetime):
        raise TypeError(
            f"now must be a datetime, got {type(now).__name__}",
        )
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError(
            "now must be timezone-aware; naive datetimes silently drift "
            "the trailing window across server timezone boundaries",
        )
    return now


def _extract_type(event: Any, index: int) -> str:
    """Return the `type` field of `event`, supporting dict + attribute access."""
    value: Any
    if isinstance(event, Mapping):
        if "type" not in event:
            raise ValueError(
                f"events[{index}] is missing required 'type' field",
            )
        value = event["type"]
    else:
        if not hasattr(event, "type"):
            raise ValueError(
                f"events[{index}] is missing required 'type' attribute",
            )
        value = getattr(event, "type")
    if not isinstance(value, str):
        raise ValueError(
            f"events[{index}].type must be str, got {type(value).__name__}",
        )
    return value


def _extract_timestamp(event: Any, index: int) -> datetime:
    """Return the `timestamp` of `event` normalised to a tz-aware datetime.

    Accepts either a tz-aware `datetime` (used by the Python ActivityEvent
    layer) or a numeric ms-epoch (used by the TS payment-tracking events
    when they cross the language boundary).
    """
    value: Any
    if isinstance(event, Mapping):
        if "timestamp" not in event:
            raise ValueError(
                f"events[{index}] is missing required 'timestamp' field",
            )
        value = event["timestamp"]
    else:
        if not hasattr(event, "timestamp"):
            raise ValueError(
                f"events[{index}] is missing required 'timestamp' attribute",
            )
        value = getattr(event, "timestamp")

    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError(
                f"events[{index}].timestamp is a naive datetime; tz-aware "
                "datetimes are required so the trailing window does not "
                "silently shift under server-timezone drift",
            )
        return value

    # Refuse `bool` before the int/float check — bool is an int subclass.
    if isinstance(value, bool):
        raise ValueError(
            f"events[{index}].timestamp must be datetime or numeric "
            f"ms-epoch, got bool ({value!r})",
        )
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value / 1000.0, tz=timezone.utc)
        except (OverflowError, OSError, ValueError) as exc:
            raise ValueError(
                f"events[{index}].timestamp ({value!r}) is not a valid "
                f"ms-epoch: {exc}",
            ) from exc

    raise ValueError(
        f"events[{index}].timestamp must be a tz-aware datetime or numeric "
        f"ms-epoch, got {type(value).__name__}",
    )
