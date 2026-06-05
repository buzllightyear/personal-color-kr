"""Unit tests for the Sentry SDK init call parameters (AC-2 + Phase 7.3).

Contract: ``sentry_sdk.init`` is invoked with ``dsn``, ``environment``,
``release``, ``before_send``, ``send_default_pii=False`` and — since Phase 7.3 —
``traces_sample_rate`` plus ``integrations=[FastApiIntegration()]`` with
``auto_enabling_integrations=False`` (FastAPI is the ONLY integration; no
sub-span instrumentation). ``traces_sampler`` / ``profiles_sample_rate`` /
``enable_tracing`` are still **never** passed — the environment-aware
``traces_sample_rate`` float is the single sampling knob.

These tests **never contact Sentry.io**: ``sentry_sdk.init`` is replaced with a
recording stub via ``monkeypatch`` so we assert on the captured kwargs only.
"""

from __future__ import annotations

from typing import Any

import pytest
from sentry_sdk.integrations.fastapi import FastApiIntegration

import api.observability.sentry as sentry_module
from api.observability.sentry import (
    _init_sentry,
    _reset_init_skip_warning,
    before_send,
    init_sentry_for_environment,
)

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _reset_skip_guard() -> Any:
    """Isolate the module-level one-shot fail-open warning guard per test."""
    _reset_init_skip_warning()
    yield
    _reset_init_skip_warning()


class _InitRecorder:
    """Records the kwargs passed to ``sentry_sdk.init`` (never hits the network)."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(self, *args: Any, **kwargs: Any) -> None:
        # Positional args are never used by our init call; capture for safety.
        self.calls.append({"args": args, "kwargs": kwargs})

    @property
    def last_kwargs(self) -> dict[str, Any]:
        assert self.calls, "sentry_sdk.init was never called"
        return self.calls[-1]["kwargs"]


@pytest.fixture()
def recorder(monkeypatch: pytest.MonkeyPatch) -> _InitRecorder:
    """Patch ``sentry_sdk.init`` (as seen by the sentry module) with a recorder."""
    rec = _InitRecorder()
    monkeypatch.setattr(sentry_module.sentry_sdk, "init", rec)
    return rec


# ---------------------------------------------------------------------------
# _init_sentry: the pure SDK call site
# ---------------------------------------------------------------------------


def test_init_passes_dsn_environment_release(recorder: _InitRecorder) -> None:
    _init_sentry(
        dsn="https://public@o0.ingest.sentry.io/1",
        environment="production",
        release="abc123",
        traces_sample_rate=0.1,
    )
    kwargs = recorder.last_kwargs
    assert kwargs["dsn"] == "https://public@o0.ingest.sentry.io/1"
    assert kwargs["environment"] == "production"
    assert kwargs["release"] == "abc123"


def test_init_passes_module_before_send_hook(recorder: _InitRecorder) -> None:
    _init_sentry(dsn="dsn", environment="ci", release="r", traces_sample_rate=0.0)
    # The before_send param must be the module's composed scrubbing hook.
    assert recorder.last_kwargs["before_send"] is before_send


def test_init_enforces_send_default_pii_false(recorder: _InitRecorder) -> None:
    _init_sentry(dsn="dsn", environment="ci", release="r", traces_sample_rate=0.0)
    assert recorder.last_kwargs["send_default_pii"] is False


def test_init_passes_the_given_traces_sample_rate(recorder: _InitRecorder) -> None:
    # Phase 7.3 — the resolved transaction sample rate is forwarded verbatim.
    _init_sentry(
        dsn="dsn", environment="production", release="r", traces_sample_rate=0.1
    )
    assert recorder.last_kwargs["traces_sample_rate"] == 0.1


def test_init_registers_only_fastapi_integration(recorder: _InitRecorder) -> None:
    # Phase 7.3 — FastApiIntegration is the only integration and auto-enabling
    # (SQLAlchemy/HTTPX/asyncio sub-spans) is OFF.
    _init_sentry(
        dsn="dsn", environment="production", release="r", traces_sample_rate=0.1
    )
    integrations = recorder.last_kwargs["integrations"]
    assert len(integrations) == 1
    assert isinstance(integrations[0], FastApiIntegration)
    assert recorder.last_kwargs["auto_enabling_integrations"] is False


def test_init_never_passes_other_tracing_or_profiling_kwargs(
    recorder: _InitRecorder,
) -> None:
    # Defense-in-depth: the single sampling knob is ``traces_sample_rate``; no
    # ``traces_sampler`` / ``profiles_sample_rate`` / ``enable_tracing`` leaks in.
    _init_sentry(
        dsn="dsn", environment="production", release="r", traces_sample_rate=0.1
    )
    forbidden = {
        "traces_sampler",
        "profiles_sample_rate",
        "enable_tracing",
    }
    assert forbidden.isdisjoint(recorder.last_kwargs)


def test_init_passes_exactly_the_expected_kwargs(recorder: _InitRecorder) -> None:
    _init_sentry(dsn="dsn", environment="preview", release="r", traces_sample_rate=0.1)
    assert set(recorder.last_kwargs) == {
        "dsn",
        "environment",
        "release",
        "before_send",
        "send_default_pii",
        "traces_sample_rate",
        "integrations",
        "auto_enabling_integrations",
    }


# ---------------------------------------------------------------------------
# init_sentry_for_environment: orchestration over the env getters
# ---------------------------------------------------------------------------


def test_for_environment_inits_when_dsn_present(
    recorder: _InitRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SENTRY_DSN_API", "https://public@o0.ingest.sentry.io/1")
    monkeypatch.setenv("GIT_SHA", "deadbeef")
    monkeypatch.delenv("SENTRY_TRACES_SAMPLE_RATE", raising=False)

    result = init_sentry_for_environment()

    assert result is True
    kwargs = recorder.last_kwargs
    assert kwargs["dsn"] == "https://public@o0.ingest.sentry.io/1"
    assert kwargs["environment"] == "production"
    assert kwargs["release"] == "deadbeef"
    assert kwargs["before_send"] is before_send
    assert kwargs["send_default_pii"] is False
    # Phase 7.3 — production samples 10% of transactions by default.
    assert kwargs["traces_sample_rate"] == 0.1
    assert isinstance(kwargs["integrations"][0], FastApiIntegration)


def test_for_environment_uses_unknown_release_when_git_sha_unset(
    recorder: _InitRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "ci")
    monkeypatch.setenv("SENTRY_DSN_API", "dsn")
    monkeypatch.delenv("GIT_SHA", raising=False)

    init_sentry_for_environment()

    assert recorder.last_kwargs["release"] == "unknown"


def test_for_environment_noop_when_dsn_missing_in_non_prod(
    recorder: _InitRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("SENTRY_DSN_API", raising=False)

    result = init_sentry_for_environment()

    assert result is False
    assert recorder.calls == []  # SDK never initialized — fail-open no-op


def test_for_environment_logs_completed_with_metadata(
    recorder: _InitRecorder,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "preview")
    monkeypatch.setenv("SENTRY_DSN_API", "dsn")
    monkeypatch.setenv("GIT_SHA", "sha1")
    # The ``apps.api`` logger disables propagation in production config; enable
    # it here so pytest's root-attached caplog handler observes the record.
    monkeypatch.setattr(sentry_module._logger, "propagate", True)

    with caplog.at_level("INFO", logger="apps.api"):
        init_sentry_for_environment()

    records = [r for r in caplog.records if r.getMessage() == "sentry_init_completed"]
    assert len(records) == 1
    assert getattr(records[0], "environment") == "preview"
    assert getattr(records[0], "release") == "sha1"


def test_for_environment_logs_skipped_with_reason(
    recorder: _InitRecorder,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("SENTRY_DSN_API", raising=False)
    monkeypatch.setattr(sentry_module._logger, "propagate", True)

    with caplog.at_level("WARNING", logger="apps.api"):
        init_sentry_for_environment()

    records = [r for r in caplog.records if r.getMessage() == "sentry_init_skipped"]
    assert len(records) == 1
    assert getattr(records[0], "init_skip_reason") == "no_dsn"


def test_for_environment_fail_fast_in_production_without_dsn(
    recorder: _InitRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("SENTRY_DSN_API", raising=False)

    with pytest.raises(LookupError):
        init_sentry_for_environment()
    assert recorder.calls == []  # never reached the init call
