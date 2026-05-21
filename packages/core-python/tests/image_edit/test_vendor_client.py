"""Unit tests for `edit_image` and its dataclasses (Sub-AC 9.1).

These tests stay unit-level by injecting a deterministic vendor stub
plus a stub `clock` + `sleep` — no real network, no real wall-clock.
That keeps the suite fast (< 1s) and isolates the wrapper's retry +
timeout discipline from vendor flakiness.

Coverage matrix:

  Happy path
    - test_edit_image_returns_response_on_first_try

  Validation (eager)
    - test_request_rejects_non_bytes_image
    - test_request_rejects_empty_image
    - test_request_rejects_non_mapping_params
    - test_request_rejects_empty_vendor
    - test_request_params_are_immutable_snapshot
    - test_edit_image_rejects_negative_timeout
    - test_edit_image_rejects_negative_max_retries
    - test_edit_image_rejects_non_callable_vendor

  Retry discipline
    - test_retries_on_transient_error_then_succeeds
    - test_exhausts_retries_and_raises_last_vendor_error
    - test_non_vendor_error_is_not_retried
    - test_backoff_schedule_is_exponential
    - test_attempt_count_in_response_reflects_retries

  Timeout discipline
    - test_timeout_before_first_call_raises_timeout
    - test_skips_backoff_when_sleep_would_exceed_budget
    - test_attempt_timeout_passed_to_vendor_caller
    - test_timeout_error_is_subclass_of_vendor_error

  Response shape
    - test_response_is_immutable
    - test_response_carries_vendor_metadata
"""

from __future__ import annotations

from typing import Iterator

import pytest

from image_edit.vendor_client import (
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT_SECONDS,
    VendorError,
    VendorRequest,
    VendorResponse,
    VendorTimeoutError,
    edit_image,
)

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _make_request(**overrides: object) -> VendorRequest:
    """Build a minimal valid `VendorRequest` for tests."""
    defaults: dict[str, object] = {
        "selfie_bytes": b"\x89PNG\r\n\x1a\nfake-payload",
        "params": {"preset": "spring_warm", "intensity": 0.7},
        "vendor": "nano_banana",
    }
    defaults.update(overrides)
    return VendorRequest(**defaults)  # type: ignore[arg-type]


class _FakeClock:
    """Deterministic monotonic clock walking a pre-seeded list."""

    def __init__(self, ticks: list[float]) -> None:
        # Defensive copy so tests can keep referring to the original
        # list without affecting the iterator.
        self._ticks: Iterator[float] = iter(list(ticks))
        self._last: float = 0.0

    def __call__(self) -> float:
        try:
            self._last = next(self._ticks)
        except StopIteration:
            # Once exhausted, keep returning the final timestamp so a
            # test that under-counts ticks gets a clear "deadline
            # exceeded" rather than an obscure StopIteration.
            pass
        return self._last


class _RecordingSleep:
    """Sleep stub that records the requested delays without waiting."""

    def __init__(self) -> None:
        self.calls: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


def _vendor_always_ok(payload: bytes = b"edited-bytes"):
    """Build a vendor stub that always returns `payload`."""

    def _caller(request: VendorRequest, attempt_timeout: float) -> bytes:
        return payload

    return _caller


def _vendor_fails_then_succeeds(
    *,
    failures: int,
    payload: bytes = b"edited-bytes",
    exc_factory=lambda i: VendorError(f"transient #{i}"),
):
    """Vendor stub that raises `failures` times then returns `payload`."""
    state: dict[str, int] = {"calls": 0}

    def _caller(request: VendorRequest, attempt_timeout: float) -> bytes:
        state["calls"] += 1
        if state["calls"] <= failures:
            raise exc_factory(state["calls"])
        return payload

    return _caller, state


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_edit_image_returns_response_on_first_try() -> None:
    request = _make_request()
    clock = _FakeClock([0.0, 0.0, 1.5])  # start, attempt-start probe, success
    sleep = _RecordingSleep()

    response = edit_image(
        request,
        vendor_caller=_vendor_always_ok(b"banana-edit"),
        clock=clock,
        sleep=sleep,
    )

    assert isinstance(response, VendorResponse)
    assert response.edited_bytes == b"banana-edit"
    assert response.vendor == "nano_banana"
    assert response.attempt == 1
    assert response.latency_seconds == pytest.approx(1.5)
    # No retry → no sleep call.
    assert sleep.calls == []


# ---------------------------------------------------------------------------
# Validation (eager)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_request_rejects_non_bytes_image() -> None:
    with pytest.raises(TypeError, match="selfie_bytes"):
        VendorRequest(selfie_bytes="not-bytes", vendor="nano_banana")  # type: ignore[arg-type]


@pytest.mark.unit
def test_request_rejects_empty_image() -> None:
    with pytest.raises(ValueError, match="empty"):
        VendorRequest(selfie_bytes=b"", vendor="nano_banana")


@pytest.mark.unit
def test_request_rejects_non_mapping_params() -> None:
    with pytest.raises(TypeError, match="params"):
        VendorRequest(
            selfie_bytes=b"data",
            params=["not", "a", "mapping"],  # type: ignore[arg-type]
            vendor="nano_banana",
        )


@pytest.mark.unit
def test_request_rejects_empty_vendor() -> None:
    with pytest.raises(ValueError, match="vendor"):
        VendorRequest(selfie_bytes=b"data", vendor="")


@pytest.mark.unit
def test_request_params_are_immutable_snapshot() -> None:
    # Caller mutates the original dict after construction; the request
    # must already hold an isolated copy.
    original = {"preset": "spring_warm"}
    request = _make_request(params=original)
    original["preset"] = "winter_cool"

    assert request.params == {"preset": "spring_warm"}

    # The frozen dataclass itself must refuse field reassignment.
    with pytest.raises(Exception):  # FrozenInstanceError is dataclasses-specific
        request.vendor = "other"  # type: ignore[misc]


@pytest.mark.unit
def test_edit_image_rejects_negative_timeout() -> None:
    request = _make_request()
    with pytest.raises(ValueError, match="timeout_seconds"):
        edit_image(
            request,
            vendor_caller=_vendor_always_ok(),
            timeout_seconds=-1.0,
        )


@pytest.mark.unit
def test_edit_image_rejects_negative_max_retries() -> None:
    request = _make_request()
    with pytest.raises(ValueError, match="max_retries"):
        edit_image(
            request,
            vendor_caller=_vendor_always_ok(),
            max_retries=-1,
        )


@pytest.mark.unit
def test_edit_image_rejects_non_callable_vendor() -> None:
    request = _make_request()
    with pytest.raises(TypeError, match="callable"):
        edit_image(request, vendor_caller="not-callable")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Retry discipline
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_retries_on_transient_error_then_succeeds() -> None:
    request = _make_request()
    caller, state = _vendor_fails_then_succeeds(failures=1)
    # Ticks: start(0) → attempt1 probe(0) → backoff probe(0.1) →
    # attempt2 probe(0.6) → success-end(1.0). Five reads.
    clock = _FakeClock([0.0, 0.0, 0.1, 0.6, 1.0])
    sleep = _RecordingSleep()

    response = edit_image(
        request,
        vendor_caller=caller,
        clock=clock,
        sleep=sleep,
        backoff_base_seconds=0.5,
        max_retries=2,
    )

    assert state["calls"] == 2
    assert response.attempt == 2
    assert response.edited_bytes == b"edited-bytes"
    # First retry sleeps `base * 2**0 = 0.5s`.
    assert sleep.calls == [0.5]


@pytest.mark.unit
def test_exhausts_retries_and_raises_last_vendor_error() -> None:
    request = _make_request()

    def _always_fails(request: VendorRequest, attempt_timeout: float) -> bytes:
        raise VendorError("persistent 5xx")

    # Enough ticks for 3 attempts + 2 backoff probes.
    clock = _FakeClock([0.0, 0.0, 0.1, 0.6, 0.7, 1.6])
    sleep = _RecordingSleep()

    with pytest.raises(VendorError, match="persistent 5xx"):
        edit_image(
            request,
            vendor_caller=_always_fails,
            clock=clock,
            sleep=sleep,
            backoff_base_seconds=0.5,
            max_retries=2,
            timeout_seconds=60.0,
        )

    # 3 total attempts ⇒ 2 sleeps (between attempts 1↔2 and 2↔3).
    # Backoff doubles: 0.5s, 1.0s.
    assert sleep.calls == [0.5, 1.0]


@pytest.mark.unit
def test_non_vendor_error_is_not_retried() -> None:
    """ValueError from the adapter means "bad input" — retrying is futile."""
    request = _make_request()
    state = {"calls": 0}

    def _bad_input(request: VendorRequest, attempt_timeout: float) -> bytes:
        state["calls"] += 1
        raise ValueError("schema mismatch")

    sleep = _RecordingSleep()

    with pytest.raises(ValueError, match="schema mismatch"):
        edit_image(
            request,
            vendor_caller=_bad_input,
            sleep=sleep,
            max_retries=3,
        )

    # Exactly one call — no retry path entered.
    assert state["calls"] == 1
    assert sleep.calls == []


@pytest.mark.unit
def test_backoff_schedule_is_exponential() -> None:
    request = _make_request()

    def _always_fails(request: VendorRequest, attempt_timeout: float) -> bytes:
        raise VendorError("flake")

    clock = _FakeClock([0.0] * 12)  # plenty of ticks, ample budget
    sleep = _RecordingSleep()

    with pytest.raises(VendorError):
        edit_image(
            request,
            vendor_caller=_always_fails,
            clock=clock,
            sleep=sleep,
            backoff_base_seconds=0.25,
            max_retries=3,
            timeout_seconds=60.0,
        )

    # 4 attempts ⇒ 3 sleeps. Schedule: 0.25, 0.5, 1.0.
    assert sleep.calls == [0.25, 0.5, 1.0]


@pytest.mark.unit
def test_attempt_count_in_response_reflects_retries() -> None:
    request = _make_request()
    caller, _ = _vendor_fails_then_succeeds(failures=2)
    # 3 attempts ⇒ enough ticks for: start, a1-probe, after-a1, a2-probe,
    # after-a2, a3-probe, success-end.
    clock = _FakeClock([0.0, 0.0, 0.1, 0.6, 0.7, 1.7, 2.0])
    sleep = _RecordingSleep()

    response = edit_image(
        request,
        vendor_caller=caller,
        clock=clock,
        sleep=sleep,
        backoff_base_seconds=0.5,
        max_retries=3,
    )

    assert response.attempt == 3


# ---------------------------------------------------------------------------
# Timeout discipline
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_timeout_before_first_call_raises_timeout() -> None:
    """If the first probe shows the deadline already passed, fail fast."""
    request = _make_request()
    state = {"calls": 0}

    def _vendor(request: VendorRequest, attempt_timeout: float) -> bytes:
        state["calls"] += 1
        return b"never-runs"

    # start=0, deadline = 0 + 1.0 = 1.0, first probe = 5.0 ⇒ exhausted.
    clock = _FakeClock([0.0, 5.0])
    sleep = _RecordingSleep()

    with pytest.raises(VendorTimeoutError, match="budget"):
        edit_image(
            request,
            vendor_caller=_vendor,
            clock=clock,
            sleep=sleep,
            timeout_seconds=1.0,
        )

    assert state["calls"] == 0  # never called the vendor
    assert sleep.calls == []


@pytest.mark.unit
def test_skips_backoff_when_sleep_would_exceed_budget() -> None:
    """If sleeping would push us past the deadline, raise instead of waiting."""
    request = _make_request()

    def _always_fails(request: VendorRequest, attempt_timeout: float) -> bytes:
        raise VendorError("rate limited")

    # start=0, deadline=10.0. First attempt at t=0; after failure t=9.9;
    # backoff would push us to 10.4 ⇒ over the budget ⇒ timeout.
    clock = _FakeClock([0.0, 0.0, 9.9])
    sleep = _RecordingSleep()

    with pytest.raises(VendorTimeoutError) as exc_info:
        edit_image(
            request,
            vendor_caller=_always_fails,
            clock=clock,
            sleep=sleep,
            backoff_base_seconds=0.5,
            max_retries=3,
            timeout_seconds=10.0,
        )

    # Cause chained so logs can surface the underlying VendorError.
    assert isinstance(exc_info.value.__cause__, VendorError)
    # Sleep must not have been called.
    assert sleep.calls == []


@pytest.mark.unit
def test_attempt_timeout_passed_to_vendor_caller() -> None:
    """Adapters need to know how much budget is left."""
    request = _make_request()
    observed: list[float] = []

    def _vendor(request: VendorRequest, attempt_timeout: float) -> bytes:
        observed.append(attempt_timeout)
        return b"ok"

    # start=0, attempt-probe=2.0, latency-end=2.1
    clock = _FakeClock([0.0, 2.0, 2.1])
    sleep = _RecordingSleep()

    edit_image(
        request,
        vendor_caller=_vendor,
        clock=clock,
        sleep=sleep,
        timeout_seconds=10.0,
    )

    # deadline = 0 + 10 = 10; remaining at t=2.0 is 8.0.
    assert observed == [pytest.approx(8.0)]


@pytest.mark.unit
def test_timeout_error_is_subclass_of_vendor_error() -> None:
    """Callers that catch VendorError must also catch timeouts."""
    assert issubclass(VendorTimeoutError, VendorError)


# ---------------------------------------------------------------------------
# Response shape
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_response_is_immutable() -> None:
    response = VendorResponse(
        edited_bytes=b"x",
        vendor="nano_banana",
        latency_seconds=0.1,
        attempt=1,
    )
    with pytest.raises(Exception):  # FrozenInstanceError
        response.vendor = "other"  # type: ignore[misc]


@pytest.mark.unit
def test_response_carries_vendor_metadata() -> None:
    request = _make_request(vendor="replicate")
    clock = _FakeClock([0.0, 1.0, 2.5])  # latency = 2.5 - 1.0 = 1.5
    sleep = _RecordingSleep()

    response = edit_image(
        request,
        vendor_caller=_vendor_always_ok(b"out"),
        clock=clock,
        sleep=sleep,
    )

    assert response.vendor == "replicate"
    assert response.latency_seconds == pytest.approx(1.5)
    assert response.attempt == 1


# ---------------------------------------------------------------------------
# Constants — sanity bounds
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_default_timeout_respects_p95_30s_budget() -> None:
    """Wrapper budget must leave headroom for pre/post processing under 30s."""
    assert 0 < DEFAULT_TIMEOUT_SECONDS < 30.0


@pytest.mark.unit
def test_default_retry_count_is_nonzero_but_bounded() -> None:
    # At least one retry (transient failures must be absorbed), but
    # not so many that a 30s p95 SLO is at risk.
    assert 1 <= DEFAULT_MAX_RETRIES <= 3
