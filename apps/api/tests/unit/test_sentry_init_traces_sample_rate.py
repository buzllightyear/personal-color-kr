"""Init-time wiring of ``traces_sample_rate`` per environment (Phase 7.3).

Verifies that ``init_sentry_for_environment`` resolves the environment-aware
transaction sample rate and forwards it to ``sentry_sdk.init``:

    development → 0.0   ci → 0.0   preview → 0.1   production → 0.1

…with a valid ``SENTRY_TRACES_SAMPLE_RATE`` override taking precedence. The
``sentry_init_completed`` structured log must also carry the resolved rate.

``sentry_sdk.init`` is monkeypatched to a recorder — these tests never touch the
network.
"""

from __future__ import annotations

from typing import Any

import pytest

import api.observability.sentry as sentry_module
from api.observability.sentry import (
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


@pytest.fixture(autouse=True)
def _clear_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SENTRY_TRACES_SAMPLE_RATE", raising=False)


class _InitRecorder:
    """Records kwargs passed to ``sentry_sdk.init`` (never hits the network)."""

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


@pytest.mark.parametrize(
    ("environment", "expected_rate"),
    [
        ("development", 0.0),
        ("ci", 0.0),
        ("preview", 0.1),
        ("production", 0.1),
    ],
)
def test_init_forwards_per_environment_rate(
    recorder: _InitRecorder,
    monkeypatch: pytest.MonkeyPatch,
    environment: str,
    expected_rate: float,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", environment)
    monkeypatch.setenv("SENTRY_DSN_API", _FAKE_DSN)
    monkeypatch.setenv("GIT_SHA", "sha")

    assert init_sentry_for_environment() is True
    assert recorder.last["traces_sample_rate"] == expected_rate


def test_valid_override_is_forwarded_to_init(
    recorder: _InitRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "preview")
    monkeypatch.setenv("SENTRY_DSN_API", _FAKE_DSN)
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "1.0")

    init_sentry_for_environment()
    assert recorder.last["traces_sample_rate"] == pytest.approx(1.0)


def test_production_malformed_override_aborts_init(
    recorder: _InitRecorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Fail-fast: a bad prod sampling config raises before ``init`` is reached.
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SENTRY_DSN_API", _FAKE_DSN)
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "way-too-much")

    with pytest.raises(ValueError):
        init_sentry_for_environment()
    assert recorder.calls == []  # never reached the SDK init


def test_completed_log_carries_resolved_rate(
    recorder: _InitRecorder,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "preview")
    monkeypatch.setenv("SENTRY_DSN_API", _FAKE_DSN)
    monkeypatch.setenv("GIT_SHA", "sha")
    monkeypatch.setattr(sentry_module._logger, "propagate", True)

    with caplog.at_level("INFO", logger="apps.api"):
        init_sentry_for_environment()

    records = [r for r in caplog.records if r.getMessage() == "sentry_init_completed"]
    assert len(records) == 1
    assert getattr(records[0], "traces_sample_rate") == 0.1
