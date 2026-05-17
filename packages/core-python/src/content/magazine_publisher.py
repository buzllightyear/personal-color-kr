"""Monthly magazine publisher (Sub-AC 6.1 / 11.4 scheduler layer).

The magazine catalogue in :mod:`content.magazines` is the *data plane*
— a frozen tuple of pre-authored issues keyed by ``YYYY-MM``. This
module is the *scheduler plane* that sits on top: it answers two
questions on every wake-up tick the app schedules:

  1. *Which issue is "this month"?* → :func:`get_current_issue`.
  2. *Should we trigger the publish side-effect right now?* →
     :func:`evaluate_publish` returning a :class:`PublishDecision`.

Design notes:

  - **Why a `date` input and not "now()" inside the module.** The
    publisher is the only layer that needs a calendar, but the
    `datetime` clock is non-deterministic and timezone-sensitive. We
    accept ``today: date`` from the caller so tests are pure (no
    monkeypatching) and the production scheduler picks the timezone
    explicitly upstream.

  - **Why `should_publish` is a separate dataclass.** The caller has
    to do two things on a positive decision: render the issue to the
    magazine screen *and* fire the retention push notification. They
    must agree on which issue won — bundling the resolved
    ``Magazine`` into the decision avoids the "render one issue, push
    another" race that splits the decision and the lookup into two
    calls.

  - **Why idempotency is delegated, not stateful.** Per the Seed
    constraint set the module stays I/O-free — we do *not* persist a
    ``published_at`` flag. Instead callers pass the set of months
    they have already pushed (loaded from their DB or analytics
    store), and we treat that as the idempotency key. This keeps the
    publisher trivially testable and lets the caller own the source
    of truth.

  - **Why "1st of the month" is the only publish day.** "발행 주기"
    in the Seed goal is *monthly* — one drop per calendar month, on
    day-1, so the retention cohort buckets line up cleanly with the
    issue rotation.

  - **Why no `datetime` clock anywhere.** Same rationale as
    :mod:`content.magazines` — the surface stays deterministic and
    timezone-free. The :class:`datetime.date` parameter carries the
    calendar semantics the scheduler needs without dragging in
    ``datetime.utcnow()``.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

from content.magazines import (
    Magazine,
    available_months,
    get_magazine_by_month,
)

# ---------------------------------------------------------------------------
# Reason codes — kept as module-level constants so the caller can branch on
# them without re-typing the string literal at every analytics call site.
# ---------------------------------------------------------------------------

REASON_READY: str = "ready"
REASON_NOT_PUBLISH_DAY: str = "not_publish_day"
REASON_NO_ISSUE: str = "no_issue_for_month"
REASON_ALREADY_PUBLISHED: str = "already_published"

PUBLISH_DAY_OF_MONTH: int = 1


# ---------------------------------------------------------------------------
# Decision value object.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PublishDecision:
    """Outcome of evaluating whether to publish on a given calendar date.

    Attributes:
        should_publish: ``True`` iff the caller should fire the
            publish side-effect (push notification, magazine unlock,
            analytics event). The other fields stay populated either
            way so the caller can render the current issue even on
            ``False``.
        month: The ``YYYY-MM`` key for ``today``. Always populated
            — the scheduler needs it for cohort bucketing regardless
            of the publish outcome.
        issue: The seeded :class:`~content.magazines.Magazine` for
            that month, or ``None`` if the catalogue does not ship
            one (rare — the seed catalogue keeps the next 3 months
            covered).
        reason: Stable machine-readable reason code — one of
            :data:`REASON_READY`, :data:`REASON_NOT_PUBLISH_DAY`,
            :data:`REASON_NO_ISSUE`, :data:`REASON_ALREADY_PUBLISHED`.
            Drives analytics ("publish_skipped" buckets) and lets the
            caller decide whether to retry or wait.
    """

    should_publish: bool
    month: str
    issue: Magazine | None
    reason: str


# ---------------------------------------------------------------------------
# Public scheduler API.
# ---------------------------------------------------------------------------


def current_month_key(today: date) -> str:
    """Format ``today`` as the catalogue's ``YYYY-MM`` lookup key.

    Args:
        today: The calendar date the caller is evaluating. We do not
            read the system clock — see the module docstring for why
            the date is an explicit parameter.

    Returns:
        Zero-padded ``YYYY-MM`` string (e.g. ``"2026-05"``).

    Raises:
        TypeError: if ``today`` is not a :class:`datetime.date`.
    """
    if not isinstance(today, date):
        raise TypeError(
            f"today must be a datetime.date, got {type(today).__name__}",
        )
    return f"{today.year:04d}-{today.month:02d}"


def get_current_issue(today: date) -> Magazine | None:
    """Return the seeded issue for ``today``'s calendar month.

    Args:
        today: The calendar date the caller is evaluating.

    Returns:
        The matching :class:`Magazine`, or ``None`` if the seed
        catalogue does not cover that month. Returning ``None``
        instead of raising lets the UI render an "이달 매거진 준비 중"
        empty state without a try/except wrapping every call site.
    """
    month = current_month_key(today)
    if month not in available_months():
        return None
    return get_magazine_by_month(month)


def is_publish_day(today: date) -> bool:
    """Return ``True`` iff ``today`` is the issue-drop day.

    The publisher fires once per calendar month, on day-1. Any other
    day of the month is a no-op so the retention cohort buckets and
    push notifications stay aligned across users.
    """
    if not isinstance(today, date):
        raise TypeError(
            f"today must be a datetime.date, got {type(today).__name__}",
        )
    return today.day == PUBLISH_DAY_OF_MONTH


def evaluate_publish(
    today: date,
    *,
    already_published: Iterable[str] = (),
) -> PublishDecision:
    """Decide whether the publisher should fire today.

    Decision order (first match wins):

      1. Day-of-month must equal :data:`PUBLISH_DAY_OF_MONTH`,
         otherwise :data:`REASON_NOT_PUBLISH_DAY`.
      2. The seed catalogue must ship an issue for the current
         month, otherwise :data:`REASON_NO_ISSUE`.
      3. The current month must not appear in ``already_published``,
         otherwise :data:`REASON_ALREADY_PUBLISHED` — this is the
         idempotency guard.
      4. Otherwise :data:`REASON_READY` and the resolved
         :class:`Magazine` is bundled into the decision.

    Args:
        today: The calendar date the scheduler woke up on.
        already_published: ``YYYY-MM`` keys the caller has already
            pushed in a previous tick. Accepts any iterable (set,
            tuple, list, generator). The caller owns the source of
            truth — typically loaded from a retention database or
            analytics warehouse, not held in this module's state.

    Returns:
        A :class:`PublishDecision` carrying the resolution + reason
        code. ``should_publish`` is ``False`` on every miss; the
        ``month`` and ``issue`` fields stay populated when known so
        the caller can still render the current issue.
    """
    month = current_month_key(today)
    available = available_months()
    issue: Magazine | None = (
        get_magazine_by_month(month) if month in available else None
    )

    if not is_publish_day(today):
        return PublishDecision(
            should_publish=False,
            month=month,
            issue=issue,
            reason=REASON_NOT_PUBLISH_DAY,
        )

    if issue is None:
        return PublishDecision(
            should_publish=False,
            month=month,
            issue=None,
            reason=REASON_NO_ISSUE,
        )

    # Snapshot the caller's idempotency set — accept any iterable
    # without consuming a generator more than once.
    published_keys = frozenset(already_published)
    if month in published_keys:
        return PublishDecision(
            should_publish=False,
            month=month,
            issue=issue,
            reason=REASON_ALREADY_PUBLISHED,
        )

    return PublishDecision(
        should_publish=True,
        month=month,
        issue=issue,
        reason=REASON_READY,
    )
