"""List-based 30-day retention calculator (Sub-AC 6.2).

A deliberately small, dependency-free helper that answers one question:

    Given a cohort of users (`cohort_users`) and a set of users observed as
    active at or after D+30 (`active_users`), what fraction of the cohort
    came back?

Why this exists alongside `retention_rate.calculate_retention_rate`:

  - `calculate_retention_rate` reads an `ActivityStore` and computes the
    cohort/active-set intersection *internally* from raw event logs. That
    is the right surface for the in-process retention pipeline.
  - This module is the surface for callers who *already* have two
    pre-computed lists in hand:
        * an analytics dump from PostHog / Mixpanel,
        * a daily batch job materialising "today's actives" to S3,
        * a unit test that wants to assert the math without standing up an
          `ActivityStore`.
    For those callers the `ActivityStore` round-trip is pure ceremony.

Definition (rolling retention, 30-day window):

  A user U in `cohort_users` is **retained** iff U also appears in
  `active_users`. The caller is responsible for building `active_users`
  with a "active at or after first_activity + 30 days" rule — this
  function does not look at timestamps, only at set membership. Keeping
  the time semantics in the caller lets the same primitive serve D+30,
  D+60, D+90, etc. without parameter sprawl.

Empty-cohort policy:

  Returns `0.0`, never `NaN`, never raises. Mirrors the contract in
  `retention_rate.py` so dashboards comparing against the 25% Seed bar
  do not have to special-case division by zero.

Duplicate policy:

  Both inputs are deduplicated via `set()` before the intersection. A
  user listed twice in `cohort_users` (e.g. the analytics export double-
  counted them) must not double-count in the denominator, and a user
  listed twice in `active_users` must not double-count in the numerator.
"""

from __future__ import annotations

from typing import Iterable


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def calculate_30day_retention(
    cohort_users: list,
    active_users: list,
) -> float:
    """Return the fraction of `cohort_users` that appears in `active_users`.

    Args:
        cohort_users: User identifiers who joined in the cohort window
            (the denominator). Duplicates are deduplicated — a user listed
            twice does not double-count. An empty list returns `0.0`.
        active_users: User identifiers observed as active at or after
            D+30 (the numerator candidates). The caller is responsible for
            applying the 30-day timestamp rule when assembling this list;
            this function only checks set membership.

    Returns:
        A `float` in `[0.0, 1.0]`:
          - `|cohort ∩ active| / |cohort|` for non-empty cohorts.
          - `0.0` for an empty cohort. Contract-defined so dashboards do
            not have to special-case division by zero.

    Raises:
        TypeError: if either argument is not an iterable (or is a bare
            `str` / `bytes`, which would silently iterate over characters
            — almost never what the caller meant); or if any user
            identifier is not a `str`.
        ValueError: if any user identifier is an empty / whitespace-only
            string.
    """
    cohort_set = _coerce_user_list(cohort_users, "cohort_users")
    active_set = _coerce_user_list(active_users, "active_users")

    if not cohort_set:
        # Contract: empty cohort → 0.0. See module docstring.
        return 0.0

    retained = cohort_set & active_set
    return len(retained) / len(cohort_set)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _coerce_user_list(value: Iterable, name: str) -> frozenset[str]:
    """Normalise `value` to a deduplicated, validated `frozenset[str]`.

    Mirrors `retention_rate._coerce_cohort`'s guardrails so the two entry
    points reject the same bad inputs the same way. Rejecting bare
    `str` / `bytes` early kills the "iterable of characters" foot-gun:
    `calculate_30day_retention("alice", ["alice"])` would otherwise
    silently treat the cohort as `{"a", "l", "i", "c", "e"}`.
    """
    if isinstance(value, (str, bytes, bytearray)):
        raise TypeError(
            f"{name} must be a list of user_id strings, "
            f"got bare {type(value).__name__}; did you mean [{value!r}]?",
        )
    try:
        members = list(value)
    except TypeError as exc:
        raise TypeError(
            f"{name} must be iterable, got {type(value).__name__}",
        ) from exc

    for member in members:
        if not isinstance(member, str):
            raise TypeError(
                f"{name} members must be str user_ids, got "
                f"{type(member).__name__} ({member!r})",
            )
        if not member.strip():
            raise ValueError(
                f"{name} contains an empty / whitespace-only user_id",
            )
    return frozenset(members)
