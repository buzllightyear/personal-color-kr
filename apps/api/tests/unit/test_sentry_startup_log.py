"""Unit tests for the Sentry structured startup log (Phase 7.2, AC-13).

AC-13 contract
--------------
``init_sentry_for_environment`` must emit a **structured startup log** through
the shared ``apps.api`` logger (:data:`api.config.logging.LOGGER_NAME`) that
records the outcome of Sentry initialization so an operator can cross-reference
Sentry events with the JSON log stream:

    * **success path** — a single ``sentry_init_completed`` record at ``INFO``
      carrying the ``environment`` and ``release`` as structured ``extra``
      fields.
    * **fail-open no-op path** — a single ``sentry_init_skipped`` record at
      ``WARNING`` carrying ``init_skip_reason="no_dsn"`` (and the
      ``environment``) as structured ``extra`` fields.

The two outcomes are mutually exclusive: a successful init never emits a
``sentry_init_skipped`` record, and a no-op never emits ``sentry_init_completed``.

Why this module exists alongside the init tests
-----------------------------------------------
``test_sentry_init_params`` / ``test_sentry_init_fail_open`` assert the init
*behavior* (kwargs, no-op, one-shot warning). This module is the focused
*observability* contract for AC-13: it pins the **log event name, level,
logger identity, and structured metadata** on both branches, and adds the
integration check that those records survive the production ``JsonFormatter``
(8-key schema, Phase 4.1) — i.e. the startup log never breaks the JSON log
stream and the event name lands in the ``message`` field.

Test isolation
--------------
    * ``sentry_sdk.init`` is replaced with a recording stub so **no test ever
      contacts Sentry.io**.
    * The module-level one-shot warning guard is reset around every test via
      :func:`_reset_init_skip_warning` so the "skipped warns once" semantics
      never leak across cases.
    * Env vars are driven exclusively via ``monkeypatch.setenv`` / ``delenv``
      (which bypass the once-per-process ``.env`` cache).
    * Records are captured via a handler attached directly to the ``apps.api``
      logger because that logger sets ``propagate=False`` in production config,
      so pytest's root-propagation ``caplog`` would otherwise miss them.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from typing import Any

import pytest

from api.config.logging import JSON_LOG_KEYS, JsonFormatter, LOGGER_NAME
import api.observability.sentry as sentry_mod
from api.observability.sentry import (
    _reset_init_skip_warning,
    init_sentry_for_environment,
)

pytestmark = pytest.mark.unit

_ENV_VAR = "ENVIRONMENT"
_DSN_VAR = "SENTRY_DSN_API"
_GIT_SHA_VAR = "GIT_SHA"

#: Synthetic DSN — shaped like a real Sentry DSN but points nowhere. Only used
#: where ``sentry_sdk.init`` is stubbed, so it never reaches the network.
_FAKE_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0"

_COMPLETED_EVENT = "sentry_init_completed"
_SKIPPED_EVENT = "sentry_init_skipped"
_SKIP_REASON = "no_dsn"

#: The three non-production environments where a missing DSN is fail-open.
_NON_PROD_ENVIRONMENTS = ("development", "preview", "ci")


class _RecordingHandler(logging.Handler):
    """Capture raw ``LogRecord`` objects for assertions on level/message/extra."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture
def init_stub(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[dict[str, object]]]:
    """Stub ``sentry_sdk.init`` (never hits the network) and reset the guard.

    Yields the list of recorded init-call kwargs; an empty list means the
    no-op path was taken.
    """
    calls: list[dict[str, object]] = []

    def _fake_init(**kwargs: object) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(sentry_mod.sentry_sdk, "init", _fake_init)
    _reset_init_skip_warning()
    try:
        yield calls
    finally:
        _reset_init_skip_warning()


@pytest.fixture
def log_records() -> Iterator[_RecordingHandler]:
    """Attach a capturing handler to the ``apps.api`` logger for the test."""
    logger = logging.getLogger(LOGGER_NAME)
    handler = _RecordingHandler()
    handler.setLevel(logging.DEBUG)
    logger.addHandler(handler)
    previous_level = logger.level
    logger.setLevel(logging.DEBUG)
    try:
        yield handler
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous_level)


def _records_named(handler: _RecordingHandler, event: str) -> list[logging.LogRecord]:
    return [r for r in handler.records if r.getMessage() == event]


# ---------------------------------------------------------------------------
# Success path → sentry_init_completed with environment + release.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("environment", ("production", "preview", "ci", "development"))
def test_completed_log_emitted_on_success(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
    environment: str,
) -> None:
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    monkeypatch.setenv(_GIT_SHA_VAR, "abc123")

    assert init_sentry_for_environment() is True

    completed = _records_named(log_records, _COMPLETED_EVENT)
    assert len(completed) == 1, "exactly one sentry_init_completed record expected"
    record = completed[0]
    # Emitted through the shared apps.api logger.
    assert record.name == LOGGER_NAME
    # Success is an INFO-level lifecycle event.
    assert record.levelno == logging.INFO
    # Structured metadata for incident cross-referencing.
    assert getattr(record, "environment", None) == environment
    assert getattr(record, "release", None) == "abc123"


def test_completed_log_release_reflects_git_sha(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    monkeypatch.setenv(_GIT_SHA_VAR, "deadbeefcafe")

    init_sentry_for_environment()

    record = _records_named(log_records, _COMPLETED_EVENT)[0]
    assert getattr(record, "release", None) == "deadbeefcafe"


def test_completed_log_release_falls_back_to_unknown(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    monkeypatch.setenv(_ENV_VAR, "ci")
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    monkeypatch.delenv(_GIT_SHA_VAR, raising=False)

    init_sentry_for_environment()

    record = _records_named(log_records, _COMPLETED_EVENT)[0]
    # GIT_SHA unset → release tag is the human-legible "unknown" fallback.
    assert getattr(record, "release", None) == "unknown"


def test_success_path_emits_no_skipped_record(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    monkeypatch.setenv(_ENV_VAR, "preview")
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)

    init_sentry_for_environment()

    # The two outcomes are mutually exclusive.
    assert _records_named(log_records, _SKIPPED_EVENT) == []


# ---------------------------------------------------------------------------
# Fail-open no-op path → sentry_init_skipped with reason.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("environment", _NON_PROD_ENVIRONMENTS)
def test_skipped_log_emitted_on_noop(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
    environment: str,
) -> None:
    monkeypatch.setenv(_ENV_VAR, environment)
    monkeypatch.delenv(_DSN_VAR, raising=False)

    assert init_sentry_for_environment() is False

    skipped = _records_named(log_records, _SKIPPED_EVENT)
    assert len(skipped) == 1, "exactly one sentry_init_skipped record expected"
    record = skipped[0]
    # Emitted through the shared apps.api logger.
    assert record.name == LOGGER_NAME
    # A disabled error pipeline is operationally noteworthy → WARNING.
    assert record.levelno == logging.WARNING
    # Structured reason + environment for incident cross-referencing.
    assert getattr(record, "init_skip_reason", None) == _SKIP_REASON
    assert getattr(record, "environment", None) == environment


def test_skipped_log_for_unset_environment_defaults_to_development(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    monkeypatch.delenv(_ENV_VAR, raising=False)
    monkeypatch.delenv(_DSN_VAR, raising=False)

    init_sentry_for_environment()

    record = _records_named(log_records, _SKIPPED_EVENT)[0]
    assert getattr(record, "environment", None) == "development"
    assert getattr(record, "init_skip_reason", None) == _SKIP_REASON


def test_noop_path_emits_no_completed_record(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    monkeypatch.setenv(_ENV_VAR, "development")
    monkeypatch.delenv(_DSN_VAR, raising=False)

    init_sentry_for_environment()

    # The two outcomes are mutually exclusive.
    assert _records_named(log_records, _COMPLETED_EVENT) == []


# ---------------------------------------------------------------------------
# Integration: startup records survive the production JsonFormatter unbroken.
# ---------------------------------------------------------------------------
# The ``apps.api`` JsonFormatter is locked to the documented 8-key schema
# (Phase 4.1). The startup log must remain *compatible* with it: the event name
# lands in ``message`` and the record still serializes to valid JSON with the
# exact schema — the structured ``extra`` fields ride on the LogRecord for
# programmatic consumers without expanding (or breaking) the JSON contract.


def _format_json(record: logging.LogRecord) -> dict[str, Any]:
    return json.loads(JsonFormatter().format(record))


def test_completed_record_serializes_through_json_formatter(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.setenv(_DSN_VAR, _FAKE_DSN)
    monkeypatch.setenv(_GIT_SHA_VAR, "sha-xyz")

    init_sentry_for_environment()

    payload = _format_json(_records_named(log_records, _COMPLETED_EVENT)[0])
    # The event name is the structured log message.
    assert payload["message"] == _COMPLETED_EVENT
    assert payload["level"] == "INFO"
    # JsonFormatter keeps the documented 8-key schema — startup log does not
    # leak extra keys into nor drop keys from the JSON stream.
    assert set(payload.keys()) == JSON_LOG_KEYS


def test_skipped_record_serializes_through_json_formatter(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    monkeypatch.setenv(_ENV_VAR, "development")
    monkeypatch.delenv(_DSN_VAR, raising=False)

    init_sentry_for_environment()

    payload = _format_json(_records_named(log_records, _SKIPPED_EVENT)[0])
    assert payload["message"] == _SKIPPED_EVENT
    assert payload["level"] == "WARNING"
    assert set(payload.keys()) == JSON_LOG_KEYS


# ---------------------------------------------------------------------------
# Production fail-fast emits NEITHER startup record (it raises before logging).
# ---------------------------------------------------------------------------


def test_production_fail_fast_emits_no_startup_record(
    monkeypatch: pytest.MonkeyPatch,
    init_stub: list[dict[str, object]],
    log_records: _RecordingHandler,
) -> None:
    monkeypatch.setenv(_ENV_VAR, "production")
    monkeypatch.delenv(_DSN_VAR, raising=False)

    with pytest.raises(LookupError):
        init_sentry_for_environment()

    # Fail-fast raises at DSN resolution, before either lifecycle log is emitted.
    assert _records_named(log_records, _COMPLETED_EVENT) == []
    assert _records_named(log_records, _SKIPPED_EVENT) == []
    assert init_stub == []
