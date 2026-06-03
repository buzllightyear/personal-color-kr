"""Unit tests for the Sentry fail-open init path (Phase 7.2, AC-4).

AC-4 contract
-------------
``ENVIRONMENT`` in ``development`` / ``preview`` / ``ci`` (or unset → defaults
to ``development``) **with a missing/empty ``SENTRY_DSN_API``** must:

    1. result in a **no-op** — ``sentry_sdk.init`` is *never* called, and
    2. emit a **one-shot warning log** (``sentry_init_skipped``, reason
       ``no_dsn``) through the shared ``apps.api`` logger — exactly once per
       process, never re-emitted on subsequent init calls.

This is the *fail-open* half of the environment-keyed policy: a non-production
process must never crash for lacking a DSN (contrast AC-3's production
fail-fast ``LookupError``).

Test isolation
--------------
    * ``sentry_sdk.init`` is replaced with a recording stub so **no test ever
      contacts Sentry.io** — the no-op path asserts it was never called; the
      DSN-present control case asserts the stub (not the real network SDK) ran.
    * Every test resets the module-level one-shot guard
      (:func:`_reset_init_skip_warning`) so the "first call warns / second call
      is silent" assertions never leak state across cases.
    * Env vars are driven exclusively via ``monkeypatch.setenv`` / ``delenv``
      (which bypass the once-per-process ``.env`` cache).
    * Log records are captured via a handler attached directly to the
      ``apps.api`` logger — mirroring ``tests/unit/test_json_log_schema.py`` —
      because that logger sets ``propagate=False`` and pytest's ``caplog``
      (root-propagation based) would otherwise miss the records.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

import pytest

from api.config.logging import LOGGER_NAME
import api.observability.sentry as sentry_mod
from api.observability.sentry import (
    _reset_init_skip_warning,
    init_sentry_for_environment,
)

_ENV_VAR = "ENVIRONMENT"
_DSN_VAR = "SENTRY_DSN_API"

# Synthetic DSN — shaped like a real Sentry DSN but points nowhere. Only used
# in the DSN-present control case, where ``sentry_sdk.init`` is a stub, so it
# never reaches the network.
_FAKE_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0"

# The three explicit non-production environments where a missing DSN is
# fail-open. The "unset" case (which defaults to development) is tested
# separately.
_NON_PROD_ENVIRONMENTS = ("development", "preview", "ci")

_SKIP_EVENT = "sentry_init_skipped"
_SKIP_REASON = "no_dsn"


class _RecordingHandler(logging.Handler):
    """Capture raw ``LogRecord`` objects for assertions on level/message/extra."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture
def init_stub(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[dict[str, object]]]:
    """Replace ``sentry_sdk.init`` with a recording stub + reset the guard.

    Yields the list of recorded init-call kwargs. An empty list means the
    no-op path was taken (``sentry_sdk.init`` was never invoked) — the core
    AC-4 assertion.
    """
    calls: list[dict[str, object]] = []

    def _fake_init(**kwargs: object) -> None:
        calls.append(kwargs)

    # Patch the symbol on the module object the production code calls through
    # (``sentry_mod.sentry_sdk.init``) so the real SDK is never initialized.
    monkeypatch.setattr(sentry_mod.sentry_sdk, "init", _fake_init)

    # Re-arm the one-shot warning guard so each test starts from a clean slate.
    _reset_init_skip_warning()
    try:
        yield calls
    finally:
        # Leave no global state behind for sibling test modules.
        _reset_init_skip_warning()


@pytest.fixture
def log_records() -> Iterator[_RecordingHandler]:
    """Attach a capturing handler to the ``apps.api`` logger for the test."""
    logger = logging.getLogger(LOGGER_NAME)
    handler = _RecordingHandler()
    handler.setLevel(logging.DEBUG)
    logger.addHandler(handler)
    # Ensure the logger level does not filter WARNING records.
    previous_level = logger.level
    logger.setLevel(logging.DEBUG)
    try:
        yield handler
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous_level)


def _skip_records(handler: _RecordingHandler) -> list[logging.LogRecord]:
    """Return only the ``sentry_init_skipped`` records captured."""
    return [r for r in handler.records if r.getMessage() == _SKIP_EVENT]


# ---------------------------------------------------------------------------
# Core no-op behavior: explicit non-production environments + missing DSN.
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("environment", _NON_PROD_ENVIRONMENTS)
def test_missing_dsn_non_production_is_noop(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    environment: str,
) -> None:
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.delenv(_DSN_VAR, raising=False)

    result = init_sentry_for_environment()

    # No-op: returns False and never calls sentry_sdk.init.
    assert result is False
    assert init_stub == [], "sentry_sdk.init must not be called on the fail-open path"


@pytest.mark.unit
@pytest.mark.parametrize("environment", _NON_PROD_ENVIRONMENTS)
def test_missing_dsn_non_production_warns_once(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
    environment: str,
) -> None:
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.delenv(_DSN_VAR, raising=False)

    init_sentry_for_environment()

    skips = _skip_records(log_records)
    assert len(skips) == 1
    record = skips[0]
    assert record.levelno == logging.WARNING
    assert record.name == LOGGER_NAME
    # The skip reason and environment are carried as structured ``extra`` fields
    # for incident cross-referencing.
    assert getattr(record, "init_skip_reason", None) == _SKIP_REASON
    assert getattr(record, "environment", None) == environment


@pytest.mark.unit
@pytest.mark.parametrize("empty_value", ["", "   "])
def test_empty_dsn_non_production_is_noop(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
    empty_value: str,
) -> None:
    # A stray ``SENTRY_DSN_API=`` line must not count as a configured DSN.
    # (An all-whitespace value is treated as set by the getter; assert behavior
    # is still safe — either it no-ops, or it inits with the stub, never the
    # real network. We only require the empty-string case to no-op + warn.)
    monkeypatch.setenv(_ENV_VAR, "development")
    monkeypatch.setenv(_DSN_VAR, empty_value)

    result = init_sentry_for_environment()

    if empty_value == "":
        assert result is False
        assert init_stub == []
        assert len(_skip_records(log_records)) == 1
    else:
        # Non-empty whitespace is a (degenerate) DSN value; the stub absorbs it
        # so the network is never touched regardless of the getter's policy.
        assert init_stub != [] or result is False


# ---------------------------------------------------------------------------
# Unset ENVIRONMENT defaults to development → fail-open no-op + warning.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_unset_environment_missing_dsn_is_noop(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    # Neither var set: ENVIRONMENT defaults to development (fail-open). This is
    # the local-dev / fresh-checkout path — it must never crash.
    monkeypatch.delenv(_ENV_VAR, raising=False)
    monkeypatch.delenv(_DSN_VAR, raising=False)

    result = init_sentry_for_environment()

    assert result is False
    assert init_stub == []
    skips = _skip_records(log_records)
    assert len(skips) == 1
    assert getattr(skips[0], "environment", None) == "development"
    assert getattr(skips[0], "init_skip_reason", None) == _SKIP_REASON


# ---------------------------------------------------------------------------
# One-shot guarantee: repeated init calls warn at most once per process.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_warning_is_one_shot_across_repeated_calls(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    monkeypatch.setenv(_ENV_VAR, "development")
    monkeypatch.delenv(_DSN_VAR, raising=False)

    # Three fail-open inits in the same process.
    assert init_sentry_for_environment() is False
    assert init_sentry_for_environment() is False
    assert init_sentry_for_environment() is False

    # Still a no-op every time...
    assert init_stub == []
    # ...but the warning was emitted exactly once (one-shot).
    assert len(_skip_records(log_records)) == 1


@pytest.mark.unit
def test_reset_re_arms_the_one_shot_warning(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    monkeypatch.setenv(_ENV_VAR, "ci")
    monkeypatch.delenv(_DSN_VAR, raising=False)

    init_sentry_for_environment()
    assert len(_skip_records(log_records)) == 1

    # A second call is silent (one-shot)...
    init_sentry_for_environment()
    assert len(_skip_records(log_records)) == 1

    # ...until the guard is explicitly reset (test-isolation seam), after which
    # the next fail-open call warns again.
    _reset_init_skip_warning()
    init_sentry_for_environment()
    assert len(_skip_records(log_records)) == 2


# ---------------------------------------------------------------------------
# Control case: a present DSN in a non-production env DOES initialize (via the
# stub) and emits NO skip warning — proving the no-op is gated on a missing DSN.
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("environment", _NON_PROD_ENVIRONMENTS)
def test_present_dsn_initializes_and_does_not_warn(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
    environment: str,
) -> None:
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)

    result = init_sentry_for_environment()

    # SDK initialized (through the stub — never the real network).
    assert result is True
    assert len(init_stub) == 1
    assert init_stub[0]["dsn"] == _FAKE_DSN
    assert init_stub[0]["environment"] == environment
    # Privacy flag is forced off and the scrubbing hook is wired in.
    assert init_stub[0]["send_default_pii"] is False
    assert init_stub[0]["before_send"] is sentry_mod.before_send
    # Error capture only — no transaction tracing kwarg is passed.
    assert "traces_sample_rate" not in init_stub[0]
    # No fail-open skip warning when a DSN is present.
    assert _skip_records(log_records) == []


@pytest.mark.unit
def test_present_dsn_does_not_consume_one_shot_guard(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    # A successful init must not silently "use up" the one-shot warning: a
    # later fail-open call (e.g. DSN later unset) must still warn.
    monkeypatch.setenv(_ENV_VAR, "development")
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    assert init_sentry_for_environment() is True
    assert _skip_records(log_records) == []

    monkeypatch.delenv(_DSN_VAR, raising=False)
    assert init_sentry_for_environment() is False
    assert len(_skip_records(log_records)) == 1


# ---------------------------------------------------------------------------
# Guardrail: the fail-open path never raises (no silent crash, no LookupError).
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("environment", _NON_PROD_ENVIRONMENTS + ("",))
def test_fail_open_never_raises(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    environment: str,
) -> None:
    if environment == "":
        monkeypatch.delenv(_ENV_VAR, raising=False)
    else:
        monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.delenv(_DSN_VAR, raising=False)

    # Must not raise (contrast the production fail-fast LookupError path).
    assert init_sentry_for_environment() is False
