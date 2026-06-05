"""Init registers FastApiIntegration ONLY (Phase 7.3, scope discipline).

Phase 7.3 enables top-level HTTP transaction tracing via FastApiIntegration and
deliberately keeps every sub-span integration (SQLAlchemy / HTTPX / asyncio) off
by disabling Sentry's auto-enabling integrations. These tests assert exactly that
boundary on the ``sentry_sdk.init`` call.

``sentry_sdk.init`` is monkeypatched to a recorder — no network, no real SDK
global state.
"""

from __future__ import annotations

from typing import Any

import pytest
from sentry_sdk.integrations.fastapi import FastApiIntegration

import api.observability.sentry as sentry_module
from api.observability.sentry import (
    _init_sentry,
    _reset_init_skip_warning,
    init_sentry_for_environment,
)

pytestmark = pytest.mark.unit

_FAKE_DSN = "https://public@o0.ingest.sentry.io/1"


@pytest.fixture(autouse=True)
def _reset_skip_guard() -> Any:
    _reset_init_skip_warning()
    yield
    _reset_init_skip_warning()


class _InitRecorder:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(self, *args: Any, **kwargs: Any) -> None:
        self.calls.append(kwargs)

    @property
    def last(self) -> dict[str, Any]:
        assert self.calls, "sentry_sdk.init was never called"
        return self.calls[-1]


@pytest.fixture()
def recorder(monkeypatch: pytest.MonkeyPatch) -> _InitRecorder:
    rec = _InitRecorder()
    monkeypatch.setattr(sentry_module.sentry_sdk, "init", rec)
    return rec


def test_init_registers_exactly_one_integration(recorder: _InitRecorder) -> None:
    _init_sentry(
        dsn="dsn", environment="production", release="r", traces_sample_rate=0.1
    )
    integrations = recorder.last["integrations"]
    assert len(integrations) == 1


def test_the_only_integration_is_fastapi(recorder: _InitRecorder) -> None:
    _init_sentry(
        dsn="dsn", environment="production", release="r", traces_sample_rate=0.1
    )
    assert isinstance(recorder.last["integrations"][0], FastApiIntegration)


def test_auto_enabling_integrations_disabled(recorder: _InitRecorder) -> None:
    # Keeps SQLAlchemy/HTTPX/asyncio sub-span integrations OFF (HTTP-only scope).
    _init_sentry(
        dsn="dsn", environment="production", release="r", traces_sample_rate=0.1
    )
    assert recorder.last["auto_enabling_integrations"] is False


def test_for_environment_registers_fastapi_integration(
    recorder: _InitRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SENTRY_DSN_API", _FAKE_DSN)
    monkeypatch.setenv("GIT_SHA", "sha")
    monkeypatch.delenv("SENTRY_TRACES_SAMPLE_RATE", raising=False)

    init_sentry_for_environment()

    integrations = recorder.last["integrations"]
    assert len(integrations) == 1
    assert isinstance(integrations[0], FastApiIntegration)
    assert recorder.last["auto_enabling_integrations"] is False
