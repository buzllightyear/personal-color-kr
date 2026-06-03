"""Sentry ``before_send`` composition layer (Phase 7.2).

# Why this module exists

The Phase 7.2 Seed mandates a *defense-in-depth* PII-scrubbing layer that runs
on **every** Sentry event before it leaves the process. ``send_default_pii=False``
is the first line of defence; the per-concern helpers in this package
(:mod:`api.observability.scrub_auth_keys`, :mod:`~api.observability.scrub_jwt_strings`,
and siblings) are the second. This module is where those independent, pure
scrubbing rules are **composed** into the single hook the Sentry SDK invokes —
``before_send``.

This sub-layer wires together the two token-oriented rules that together close
the "credential leaks into an event" gap:

    * the **key-scrubber** (:func:`~api.observability.scrub_auth_keys.scrub_auth_keys`)
      — redacts values whose *key name* is auth-shaped (``token``, ``jwt``,
      ``authorization``, ``secret``, ``password`` …), and
    * the **JWT-scrubber** (:func:`~api.observability.scrub_jwt_strings.scrub_jwt_strings`)
      — redacts JWT-shaped substrings embedded inside arbitrary *string values*.

# Contract

:func:`_scrub_event` applies each scrubber in turn over the whole event and
returns the fully scrubbed copy. :func:`before_send` adapts that to the Sentry
SDK's ``before_send(event, hint)`` signature.

Per the Seed's **no-event-dropping** invariant, :func:`before_send` *always*
returns the scrubbed event and **never** returns ``None`` — scrubbing is a
transformation, never a drop. Both functions are pure with respect to their
input (the helpers they compose return new structures) and never raise.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Final

import sentry_sdk

from api.config.env import get_environment, get_release, get_sentry_dsn_api
from api.config.logging import LOGGER_NAME
from api.observability.scrub_auth_keys import scrub_auth_keys
from api.observability.scrub_jwt_strings import scrub_jwt_strings

#: Module logger — the shared ``apps.api`` JSON logger (see
#: :mod:`api.config.logging`). Sentry init lifecycle events
#: (``sentry_init_completed`` / ``sentry_init_skipped``) are emitted through
#: this logger so they cross-reference the same structured log stream as
#: per-request records, enabling incident correlation between Sentry and logs.
_logger: Final[logging.Logger] = logging.getLogger(LOGGER_NAME)

#: One-shot guard for the fail-open ``sentry_init_skipped`` warning (AC-4).
#:
#: When a non-production environment starts without a DSN, Sentry init is a
#: no-op and we emit a *single* warning so the operator knows error reporting
#: is disabled — but we must not re-emit it on every ``init_sentry_for_environment``
#: call (the ``create_app`` factory is re-invoked per test and could be called
#: more than once per process). This module-level flag makes the warning
#: idempotent: it is logged at most once per process. ``_reset_init_skip_warning``
#: clears it for test isolation only.
_init_skip_warned: bool = False


def _reset_init_skip_warning() -> None:
    """Reset the one-shot fail-open warning guard (test isolation only).

    Production code never calls this; it exists so unit tests can assert the
    *first* fail-open ``init_sentry_for_environment`` call warns and a
    *subsequent* call (same process) stays silent, without leaking the flag's
    state across test cases.
    """
    global _init_skip_warned
    _init_skip_warned = False


#: The ordered scrubbing pipeline ``before_send`` composes. Each entry is a pure
#: ``event -> scrubbed_event`` function; they are applied left-to-right so the
#: output of one feeds the next. Ordering is safe because the two rules are
#: orthogonal — the key-scrubber rewrites values by *key name*, the JWT-scrubber
#: rewrites JWT-shaped substrings inside *string values* — but a deterministic
#: order keeps the composition reproducible and easy to extend.
_SCRUBBERS: Final[tuple[Callable[[Any], Any], ...]] = (
    scrub_auth_keys,
    scrub_jwt_strings,
)


def _scrub_event(event: Any) -> Any:
    """Return ``event`` with every scrubbing rule in :data:`_SCRUBBERS` applied.

    Folds the event through the pipeline: ``scrub_jwt_strings(scrub_auth_keys(event))``.
    Each helper is pure and returns a new structure, so the input is never
    mutated. A ``dict`` in yields a ``dict`` out — never ``None`` — honoring the
    Seed's "always return a scrubbed event, never drop" invariant.

    Parameters
    ----------
    event:
        A Sentry event dict (or, in tests, any event-shaped structure).

    Returns
    -------
    Any
        The fully scrubbed event. Same shape as the input.
    """
    scrubbed = event
    for scrubber in _SCRUBBERS:
        scrubbed = scrubber(scrubbed)
    return scrubbed


def before_send(event: Any, hint: Any | None = None) -> Any:
    """Sentry ``before_send`` hook: scrub every event, never drop one.

    Adapts :func:`_scrub_event` to the Sentry SDK's hook signature
    ``before_send(event, hint) -> event | None``. The composed key-scrubber and
    JWT-scrubber are applied to ``event`` and the scrubbed copy is returned.

    The ``hint`` argument (the SDK's per-event metadata — original exception,
    log record, …) is accepted for signature compatibility but unused: this
    layer scrubs unconditionally and is not a sampling/filtering hook.

    Returns
    -------
    Any
        The scrubbed event. **Never ``None``** — per the Seed, ``before_send``
        scrubs but never drops, so no event is ever suppressed here.
    """
    return _scrub_event(event)


# ---------------------------------------------------------------------------
# Phase 7.2 — Sentry SDK initialization (AC-2)
# ---------------------------------------------------------------------------
# ``_init_sentry`` is the single, pure call site for ``sentry_sdk.init``. It is
# deliberately narrow: it receives the already-resolved ``dsn`` / ``environment``
# / ``release`` and wires them — plus the composed :func:`before_send` PII hook
# and the privacy-mandated ``send_default_pii=False`` flag — into the SDK.
#
# What is intentionally OMITTED is as important as what is passed:
#
#   * ``traces_sample_rate`` is **never** supplied. Phase 7.2 is *error capture
#     only* — no transaction/performance tracing. The SDK defaults the rate to
#     ``0`` (tracing disabled) when the kwarg is absent, so leaving it out is the
#     correct, explicit way to keep tracing off. (No ``SentryAsgiMiddleware`` is
#     installed either; that wiring lives outside this module.)
#   * No ``sentry_sdk.set_user`` / user_id correlation (deferred post-launch).
#
# The environment-keyed fail-fast / fail-open decision is delegated entirely to
# :func:`api.config.env.get_sentry_dsn_api`: it raises ``LookupError`` when the
# DSN is missing in ``production`` (fail-fast) and returns ``None`` in
# development / preview / ci (fail-open). ``init_sentry_for_environment`` turns
# that ``None`` into a no-op plus a single warning log — never a crash.


def _init_sentry(*, dsn: str, environment: str, release: str) -> None:
    """Initialize the Sentry SDK for error capture (no tracing).

    Calls ``sentry_sdk.init`` with exactly four behavioral parameters —
    ``dsn``, ``environment``, ``release``, and the composed
    :func:`before_send` PII-scrubbing hook — plus ``send_default_pii=False``
    to keep Sentry's own PII collection off (the ``before_send`` hook is the
    defense-in-depth second layer).

    ``traces_sample_rate`` is intentionally **not** passed: Phase 7.2 is error
    capture only, and the SDK defaults the sample rate to ``0`` (tracing
    disabled) in its absence.

    Parameters
    ----------
    dsn:
        A non-empty Sentry DSN (already validated by the caller).
    environment:
        The runtime environment tag (``development`` / ``preview`` /
        ``production`` / ``ci``).
    release:
        The release identifier (``GIT_SHA`` or ``"unknown"``).
    """
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        before_send=before_send,
        # Privacy: never let the SDK attach request bodies, headers, cookies,
        # or user IP. ``before_send`` is the second, defense-in-depth layer.
        send_default_pii=False,
        # NOTE: traces_sample_rate is deliberately omitted — see module note.
        # Phase 7.2 ships error capture only; the SDK defaults tracing to 0.
    )


def init_sentry_for_environment() -> bool:
    """Initialize Sentry from the ambient environment, or no-op safely.

    Resolves the runtime ``environment`` and ``release`` and the
    environment-keyed DSN, then:

        * **production, missing DSN** — :func:`get_sentry_dsn_api` raises
          ``LookupError`` (fail-fast); this function does not swallow it, so
          startup aborts loudly rather than running prod without error
          reporting.
        * **non-production, missing DSN** — ``get_sentry_dsn_api`` returns
          ``None``; this function logs a single ``sentry_init_skipped`` warning
          and returns ``False`` without touching the SDK (fail-open no-op).
        * **DSN present (any environment)** — calls :func:`_init_sentry` and
          logs ``sentry_init_completed``, returning ``True``.

    Intended to be called as the **first** line inside the ``create_app``
    factory, before the ``FastAPI`` constructor, so the SDK's global error
    hooks are armed before any router/middleware is built.

    Returns
    -------
    bool
        ``True`` if the SDK was initialized, ``False`` on the fail-open no-op.

    Raises
    ------
    LookupError
        Propagated from :func:`get_sentry_dsn_api` when the DSN is missing in
        ``production``.
    ValueError
        Propagated from :func:`get_environment` when ``ENVIRONMENT`` is an
        unknown, non-empty value.
    """
    environment = get_environment()
    release = get_release()

    # May raise LookupError in production (fail-fast) — intentionally not caught.
    dsn = get_sentry_dsn_api()

    if dsn is None:
        # Fail-open (AC-4): non-production (development / preview / ci, or unset
        # → development) with no DSN. Never crash and never initialize the SDK;
        # emit a *one-shot* warning so the operator knows error reporting is
        # disabled, then no-op. The module-level guard keeps the warning
        # idempotent across repeated init calls in the same process.
        global _init_skip_warned
        if not _init_skip_warned:
            _init_skip_warned = True
            _logger.warning(
                "sentry_init_skipped",
                extra={"init_skip_reason": "no_dsn", "environment": environment},
            )
        return False

    _init_sentry(dsn=dsn, environment=environment, release=release)
    _logger.info(
        "sentry_init_completed",
        extra={"environment": environment, "release": release},
    )
    return True


__all__ = ["before_send", "init_sentry_for_environment"]
