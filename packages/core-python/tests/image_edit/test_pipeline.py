"""Integration tests for `run_edit_pipeline` (Sub-AC 9.3).

These tests exercise the *integration* of `vendor_client.edit_image`
with `latency_tracker.LatencyTracker` rather than re-testing either in
isolation (that is what `test_vendor_client.py` and
`test_latency_tracker.py` already cover). The point of this suite is
to prove three things:

  1. The pipeline plumbs selfie bytes → vendor → result correctly,
     preserving the immutability guarantees of `VendorRequest` and
     producing an immutable `PipelineResult`.
  2. End-to-end latency is recorded into the injected tracker on
     *every* call — success, retry, and terminal failure — so the
     SLO dashboard cannot be gamed by burying failed calls.
  3. The Seed Contract's hard SLO (`p95 < 30s` for selfie → edited
     result) holds under a realistic mocked-vendor distribution.

The vendor is mocked throughout. Two flavours of mock are used:

  - `_deterministic_vendor`: fixed-latency stub for the precise
    plumbing tests. Pairs with `_FakeClock` so the suite never
    sleeps.
  - `_realistic_vendor`: a draws-from-distribution stub that
    simulates vendor latency with a long tail (most calls 3–8s, one-
    in-twenty calls 15–24s). Pairs with a *virtual* clock that
    advances by the vendor's simulated latency so the integration
    test verifies the p95 SLO without burning real seconds.

Coverage matrix:

  Plumbing
    - test_pipeline_returns_edited_bytes_from_vendor
    - test_pipeline_preserves_vendor_response_metadata
    - test_pipeline_passes_params_to_vendor_request
    - test_pipeline_uses_default_vendor_when_not_specified
    - test_pipeline_constructs_fresh_tracker_when_none

  Validation (eager — before tracker is touched)
    - test_pipeline_rejects_non_bytes_selfie
    - test_pipeline_rejects_empty_selfie
    - test_pipeline_rejects_empty_vendor
    - test_pipeline_rejects_non_tracker
    - test_validation_failure_does_not_record_latency

  Latency recording
    - test_pipeline_records_latency_on_success
    - test_pipeline_records_latency_on_vendor_failure
    - test_pipeline_records_one_sample_per_call
    - test_pipeline_uses_caller_supplied_tracker

  Failure propagation
    - test_pipeline_propagates_vendor_error
    - test_pipeline_propagates_vendor_timeout_error
    - test_pipeline_propagates_non_retryable_value_error

  Result shape
    - test_pipeline_result_is_immutable
    - test_pipeline_result_rejects_empty_bytes

  SLO (the headline integration assertion)
    - test_pipeline_p95_under_30s_with_realistic_vendor
"""

from __future__ import annotations

import random
from typing import Iterator

import pytest

from image_edit.latency_tracker import LatencyTracker
from image_edit.pipeline import (
    P95_SLO_SECONDS,
    PipelineResult,
    run_edit_pipeline,
)
from image_edit.vendor_client import (
    VendorError,
    VendorRequest,
    VendorResponse,
    VendorTimeoutError,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_SAMPLE_SELFIE: bytes = b"\x89PNG\r\n\x1a\n" + b"fake-selfie-payload" * 4


class _FakeClock:
    """Deterministic monotonic clock walking a pre-seeded list.

    Once the seed is exhausted the final value is returned forever —
    this matches the same behaviour as the helper in
    `test_vendor_client.py` and means an undercount of ticks fails
    with a clear deadline-exceeded rather than `StopIteration`.
    """

    def __init__(self, ticks: list[float]) -> None:
        self._ticks: Iterator[float] = iter(list(ticks))
        self._last: float = 0.0

    def __call__(self) -> float:
        try:
            self._last = next(self._ticks)
        except StopIteration:
            pass
        return self._last


class _VirtualClock:
    """Monotonic clock the test can advance by `advance(seconds)`.

    Used by the SLO integration test: the mocked vendor advances this
    clock by its simulated latency, so the tracker sees realistic
    per-call durations without the suite ever sleeping.
    """

    def __init__(self) -> None:
        self._now: float = 0.0

    def __call__(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        if seconds < 0:
            raise ValueError("cannot advance virtual clock backward")
        self._now += seconds


class _RecordingSleep:
    """Sleep stub that records requested delays without waiting."""

    def __init__(self) -> None:
        self.calls: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


def _deterministic_vendor(payload: bytes = b"edited-bytes"):
    """Vendor stub that always returns `payload` on the first try."""

    def _caller(request: VendorRequest, attempt_timeout: float) -> bytes:
        return payload

    return _caller


def _failing_vendor(exc_factory=lambda: VendorError("persistent 5xx")):
    """Vendor stub that always raises `exc_factory()`."""

    def _caller(request: VendorRequest, attempt_timeout: float) -> bytes:
        raise exc_factory()

    return _caller


def _value_error_vendor():
    """Vendor stub that raises a non-retryable ValueError (bad input)."""

    def _caller(request: VendorRequest, attempt_timeout: float) -> bytes:
        raise ValueError("schema mismatch")

    return _caller


# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_pipeline_returns_edited_bytes_from_vendor() -> None:
    """The vendor's bytes must arrive verbatim on the result."""
    tracker = LatencyTracker()
    clock = _FakeClock(
        [0.0, 0.0, 0.0, 1.2, 1.2]
    )  # pipeline-start, measure-start, attempt-probe, success-end, measure-end
    sleep = _RecordingSleep()

    result = run_edit_pipeline(
        _SAMPLE_SELFIE,
        vendor_caller=_deterministic_vendor(b"banana-edit-payload"),
        tracker=tracker,
        clock=clock,
        sleep=sleep,
    )

    assert isinstance(result, PipelineResult)
    assert result.edited_bytes == b"banana-edit-payload"


@pytest.mark.integration
def test_pipeline_preserves_vendor_response_metadata() -> None:
    """`vendor_response` on the result mirrors the underlying call."""
    tracker = LatencyTracker()
    # Clock reads in order:
    #   1. pipeline_start (run_edit_pipeline)
    #   2. measure_latency start
    #   3. edit_image: outer start
    #   4. edit_image: attempt-1 probe (sets attempt_start)
    #   5. edit_image: latency end (after vendor success) → 2.5 - 0.0 = 2.5
    #   6. measure_latency end
    #   7. pipeline_end (run_edit_pipeline)
    clock = _FakeClock([0.0, 0.0, 0.0, 0.0, 2.5, 2.5, 2.5])
    sleep = _RecordingSleep()

    result = run_edit_pipeline(
        _SAMPLE_SELFIE,
        vendor_caller=_deterministic_vendor(b"out"),
        vendor="replicate",
        tracker=tracker,
        clock=clock,
        sleep=sleep,
    )

    assert result.vendor == "replicate"
    assert isinstance(result.vendor_response, VendorResponse)
    assert result.vendor_response.vendor == "replicate"
    assert result.vendor_response.attempt == 1
    assert result.vendor_response.latency_seconds == pytest.approx(2.5)


@pytest.mark.integration
def test_pipeline_passes_params_to_vendor_request() -> None:
    """The caller's params must reach the vendor caller intact."""
    tracker = LatencyTracker()
    clock = _FakeClock([0.0, 0.0, 0.0, 0.1, 0.1])
    sleep = _RecordingSleep()
    observed: list[VendorRequest] = []

    def _capturing_vendor(request: VendorRequest, attempt_timeout: float) -> bytes:
        observed.append(request)
        return b"ok"

    run_edit_pipeline(
        _SAMPLE_SELFIE,
        vendor_caller=_capturing_vendor,
        params={"preset": "winter_cool", "intensity": 0.42},
        tracker=tracker,
        clock=clock,
        sleep=sleep,
    )

    assert len(observed) == 1
    assert observed[0].params == {"preset": "winter_cool", "intensity": 0.42}


@pytest.mark.integration
def test_pipeline_uses_default_vendor_when_not_specified() -> None:
    """Default vendor is the Seed Contract's primary adapter."""
    tracker = LatencyTracker()
    clock = _FakeClock([0.0, 0.0, 0.0, 0.5, 0.5])
    sleep = _RecordingSleep()
    observed: list[VendorRequest] = []

    def _capturing_vendor(request: VendorRequest, attempt_timeout: float) -> bytes:
        observed.append(request)
        return b"ok"

    result = run_edit_pipeline(
        _SAMPLE_SELFIE,
        vendor_caller=_capturing_vendor,
        tracker=tracker,
        clock=clock,
        sleep=sleep,
    )

    assert observed[0].vendor == "nano_banana"
    assert result.vendor == "nano_banana"


@pytest.mark.integration
def test_pipeline_constructs_fresh_tracker_when_none() -> None:
    """`tracker=None` is a convenience for one-shot callers."""
    clock = _FakeClock([0.0, 0.0, 0.0, 1.0, 1.0])
    sleep = _RecordingSleep()

    result = run_edit_pipeline(
        _SAMPLE_SELFIE,
        vendor_caller=_deterministic_vendor(),
        clock=clock,
        sleep=sleep,
    )

    # Just check the pipeline ran successfully — the fresh tracker
    # is internal so the test cannot inspect it. The point is that
    # no exception was raised by passing `tracker=None`.
    assert isinstance(result, PipelineResult)
    assert result.edited_bytes == b"edited-bytes"


# ---------------------------------------------------------------------------
# Validation (eager — must happen before tracker is touched)
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_pipeline_rejects_non_bytes_selfie() -> None:
    tracker = LatencyTracker()
    with pytest.raises(TypeError, match="selfie_bytes"):
        run_edit_pipeline(
            "not-bytes",  # type: ignore[arg-type]
            vendor_caller=_deterministic_vendor(),
            tracker=tracker,
        )


@pytest.mark.integration
def test_pipeline_rejects_empty_selfie() -> None:
    tracker = LatencyTracker()
    with pytest.raises(ValueError, match="empty"):
        run_edit_pipeline(
            b"",
            vendor_caller=_deterministic_vendor(),
            tracker=tracker,
        )


@pytest.mark.integration
def test_pipeline_rejects_empty_vendor() -> None:
    tracker = LatencyTracker()
    with pytest.raises(ValueError, match="vendor"):
        run_edit_pipeline(
            _SAMPLE_SELFIE,
            vendor_caller=_deterministic_vendor(),
            vendor="",
            tracker=tracker,
        )


@pytest.mark.integration
def test_pipeline_rejects_non_tracker() -> None:
    with pytest.raises(TypeError, match="tracker"):
        run_edit_pipeline(
            _SAMPLE_SELFIE,
            vendor_caller=_deterministic_vendor(),
            tracker="not a tracker",  # type: ignore[arg-type]
        )


@pytest.mark.integration
def test_validation_failure_does_not_record_latency() -> None:
    """Client-side 400s must not pollute the SLO histogram."""
    tracker = LatencyTracker()
    with pytest.raises(ValueError):
        run_edit_pipeline(
            b"",
            vendor_caller=_deterministic_vendor(),
            tracker=tracker,
        )
    assert len(tracker) == 0


# ---------------------------------------------------------------------------
# Latency recording
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_pipeline_records_latency_on_success() -> None:
    """Successful calls must land a sample in the tracker."""
    tracker = LatencyTracker()
    # Clock reads in order:
    #   pipeline_start (run_edit_pipeline)
    #   measure_latency start
    #   edit_image: outer start
    #   edit_image: attempt-1 probe
    #   edit_image: latency end (after success)
    #   measure_latency end
    #   pipeline_end (run_edit_pipeline)
    clock = _FakeClock([0.0, 0.0, 0.0, 0.0, 3.0, 3.0, 3.0])
    sleep = _RecordingSleep()

    result = run_edit_pipeline(
        _SAMPLE_SELFIE,
        vendor_caller=_deterministic_vendor(),
        tracker=tracker,
        clock=clock,
        sleep=sleep,
    )

    snapshot = tracker.snapshot()
    assert snapshot.count == 1
    # measure_latency observed [0.0, 3.0] ⇒ 3.0s elapsed.
    assert snapshot.max_seconds == pytest.approx(3.0)
    # Pipeline-level latency is also ~3.0s (same clock).
    assert result.pipeline_latency_seconds == pytest.approx(3.0)


@pytest.mark.integration
def test_pipeline_records_latency_on_vendor_failure() -> None:
    """Failed calls *must* still record latency — SLO honesty."""
    tracker = LatencyTracker()
    # Feed enough ticks for vendor failure path:
    #   pipeline_start, measure_start, edit_image start,
    #   attempt1 probe, attempt2 probe, attempt3 probe, measure_end
    clock = _FakeClock([0.0] * 30)
    sleep = _RecordingSleep()

    with pytest.raises(VendorError, match="persistent 5xx"):
        run_edit_pipeline(
            _SAMPLE_SELFIE,
            vendor_caller=_failing_vendor(),
            tracker=tracker,
            clock=clock,
            sleep=sleep,
            max_retries=2,
        )

    # Even on terminal failure, the latency event must be recorded.
    snapshot = tracker.snapshot()
    assert snapshot.count == 1


@pytest.mark.integration
def test_pipeline_records_one_sample_per_call() -> None:
    """Even with retries, *one* sample per pipeline call lands."""
    tracker = LatencyTracker()
    state: dict[str, int] = {"calls": 0}

    def _flaky(request: VendorRequest, attempt_timeout: float) -> bytes:
        state["calls"] += 1
        if state["calls"] <= 1:
            raise VendorError("flake")
        return b"ok"

    clock = _FakeClock([0.0] * 30)
    sleep = _RecordingSleep()

    run_edit_pipeline(
        _SAMPLE_SELFIE,
        vendor_caller=_flaky,
        tracker=tracker,
        clock=clock,
        sleep=sleep,
    )

    # 2 vendor invocations, but only 1 user-perceived latency event.
    assert state["calls"] == 2
    assert tracker.snapshot().count == 1


@pytest.mark.integration
def test_pipeline_uses_caller_supplied_tracker() -> None:
    """Multiple calls against the same tracker accumulate samples."""
    tracker = LatencyTracker()
    sleep = _RecordingSleep()

    for _ in range(5):
        clock = _FakeClock([0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0])
        run_edit_pipeline(
            _SAMPLE_SELFIE,
            vendor_caller=_deterministic_vendor(),
            tracker=tracker,
            clock=clock,
            sleep=sleep,
        )

    assert tracker.snapshot().count == 5


# ---------------------------------------------------------------------------
# Failure propagation
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_pipeline_propagates_vendor_error() -> None:
    """`VendorError` from `edit_image` surfaces unchanged."""
    tracker = LatencyTracker()
    clock = _FakeClock([0.0] * 30)
    sleep = _RecordingSleep()

    with pytest.raises(VendorError, match="persistent 5xx"):
        run_edit_pipeline(
            _SAMPLE_SELFIE,
            vendor_caller=_failing_vendor(),
            tracker=tracker,
            clock=clock,
            sleep=sleep,
            max_retries=0,
        )


@pytest.mark.integration
def test_pipeline_propagates_vendor_timeout_error() -> None:
    """A budget-exhausted call surfaces as `VendorTimeoutError`."""
    tracker = LatencyTracker()
    # start=0, deadline = 0 + 1.0; first probe = 5.0 ⇒ exhausted.
    # measure_latency consumes the first two ticks (its own start +
    # edit_image's outer-start probe). edit_image then reads its
    # attempt-1 probe (5.0) and raises VendorTimeoutError.
    clock = _FakeClock([0.0, 0.0, 0.0, 5.0, 5.0, 5.0])
    sleep = _RecordingSleep()

    with pytest.raises(VendorTimeoutError, match="budget"):
        run_edit_pipeline(
            _SAMPLE_SELFIE,
            vendor_caller=_deterministic_vendor(),
            tracker=tracker,
            clock=clock,
            sleep=sleep,
            timeout_seconds=1.0,
        )


@pytest.mark.integration
def test_pipeline_propagates_non_retryable_value_error() -> None:
    """`ValueError` from the vendor is non-retryable — propagate as-is."""
    tracker = LatencyTracker()
    clock = _FakeClock([0.0] * 10)
    sleep = _RecordingSleep()

    with pytest.raises(ValueError, match="schema mismatch"):
        run_edit_pipeline(
            _SAMPLE_SELFIE,
            vendor_caller=_value_error_vendor(),
            tracker=tracker,
            clock=clock,
            sleep=sleep,
        )

    # Latency still recorded — the user did wait for that call.
    assert tracker.snapshot().count == 1


# ---------------------------------------------------------------------------
# Result shape
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_pipeline_result_is_immutable() -> None:
    """Frozen dataclass — no caller can tamper with the result."""
    tracker = LatencyTracker()
    clock = _FakeClock([0.0, 0.0, 0.0, 0.5, 0.5])
    sleep = _RecordingSleep()

    result = run_edit_pipeline(
        _SAMPLE_SELFIE,
        vendor_caller=_deterministic_vendor(),
        tracker=tracker,
        clock=clock,
        sleep=sleep,
    )

    with pytest.raises(Exception):  # FrozenInstanceError
        result.vendor = "tampered"  # type: ignore[misc]


@pytest.mark.integration
def test_pipeline_result_rejects_empty_bytes() -> None:
    """The DTO refuses to wrap a zero-byte payload."""
    valid_response = VendorResponse(
        edited_bytes=b"non-empty",
        vendor="nano_banana",
        latency_seconds=0.1,
        attempt=1,
    )
    with pytest.raises(ValueError, match="empty"):
        PipelineResult(
            edited_bytes=b"",
            vendor="nano_banana",
            pipeline_latency_seconds=0.1,
            vendor_response=valid_response,
        )


@pytest.mark.integration
def test_pipeline_result_rejects_non_bytes() -> None:
    """The DTO's defensive guard rejects non-bytes payloads."""
    valid_response = VendorResponse(
        edited_bytes=b"non-empty",
        vendor="nano_banana",
        latency_seconds=0.1,
        attempt=1,
    )
    with pytest.raises(TypeError, match="edited_bytes"):
        PipelineResult(
            edited_bytes="not-bytes",  # type: ignore[arg-type]
            vendor="nano_banana",
            pipeline_latency_seconds=0.1,
            vendor_response=valid_response,
        )


@pytest.mark.integration
def test_pipeline_result_rejects_empty_vendor() -> None:
    """The DTO's defensive guard rejects empty vendor names."""
    valid_response = VendorResponse(
        edited_bytes=b"non-empty",
        vendor="nano_banana",
        latency_seconds=0.1,
        attempt=1,
    )
    with pytest.raises(ValueError, match="vendor"):
        PipelineResult(
            edited_bytes=b"x",
            vendor="",
            pipeline_latency_seconds=0.1,
            vendor_response=valid_response,
        )


@pytest.mark.integration
def test_pipeline_result_rejects_negative_latency() -> None:
    """The DTO's defensive guard rejects negative pipeline latency."""
    valid_response = VendorResponse(
        edited_bytes=b"non-empty",
        vendor="nano_banana",
        latency_seconds=0.1,
        attempt=1,
    )
    with pytest.raises(ValueError, match="pipeline_latency_seconds"):
        PipelineResult(
            edited_bytes=b"x",
            vendor="nano_banana",
            pipeline_latency_seconds=-0.001,
            vendor_response=valid_response,
        )


@pytest.mark.integration
def test_pipeline_result_rejects_non_vendor_response() -> None:
    """The DTO's defensive guard rejects a non-VendorResponse."""
    with pytest.raises(TypeError, match="vendor_response"):
        PipelineResult(
            edited_bytes=b"x",
            vendor="nano_banana",
            pipeline_latency_seconds=0.1,
            vendor_response="not a response",  # type: ignore[arg-type]
        )


@pytest.mark.integration
def test_pipeline_clamps_non_monotonic_clock() -> None:
    """A backward-jumping clock must not produce a negative latency."""
    tracker = LatencyTracker()
    # pipeline_start = 10.0, then all subsequent reads are 5.0
    # measure_start = 5.0, edit_image start = 5.0, attempt-probe = 5.0,
    # latency-end = 5.0, measure-end = 5.0, pipeline_end = 5.0
    # Pipeline latency = 5.0 - 10.0 = -5.0 ⇒ clamped to 0.0.
    clock = _FakeClock([10.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0])
    sleep = _RecordingSleep()

    result = run_edit_pipeline(
        _SAMPLE_SELFIE,
        vendor_caller=_deterministic_vendor(),
        tracker=tracker,
        clock=clock,
        sleep=sleep,
    )

    assert result.pipeline_latency_seconds == 0.0


# ---------------------------------------------------------------------------
# SLO — headline integration assertion
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_pipeline_p95_under_30s_with_realistic_vendor() -> None:
    """200 mocked-vendor calls keep p95 comfortably under 30s.

    Vendor latency distribution (seed-pinned for determinism):
      - 95% of calls: 3.0–8.0s (typical Nano Banana / Replicate latency)
      - 5% of calls: 12.0–24.0s (long-tail — slow GPU, queueing)

    The mocked vendor advances a *virtual* clock by the drawn latency
    so the tracker sees realistic per-call durations and the suite
    never sleeps. With this distribution the p95 sample lands inside
    the long tail but still well under the wrapper's 25s per-call cap
    and the contract's 30s end-to-end SLO.

    This is the headline integration assertion for Sub-AC 9.3: it
    proves that — with a representative vendor distribution and the
    full pipeline wiring (vendor_client + latency_tracker) — the
    p95 < 30s SLO holds.
    """
    rng = random.Random(20260516)  # pinned seed = stable CI
    tracker = LatencyTracker()
    clock = _VirtualClock()
    sleep = _RecordingSleep()

    def _realistic_vendor(request: VendorRequest, attempt_timeout: float) -> bytes:
        # 95% in the typical band, 5% in the long tail.
        if rng.random() < 0.95:
            latency = rng.uniform(3.0, 8.0)
        else:
            latency = rng.uniform(12.0, 24.0)
        clock.advance(latency)
        return b"edited-selfie-payload"

    n_calls = 200
    for _ in range(n_calls):
        result = run_edit_pipeline(
            _SAMPLE_SELFIE,
            vendor_caller=_realistic_vendor,
            tracker=tracker,
            clock=clock,
            sleep=sleep,
            # Wrapper's per-call cap is 25s; the long tail tops out
            # at 24s so no individual call should hit the timeout.
            timeout_seconds=25.0,
        )
        # Every individual call must be under the per-call cap.
        assert result.pipeline_latency_seconds < 25.0

    snapshot = tracker.snapshot()
    assert snapshot.count == n_calls
    # The headline assertion: p95 stays under the contract SLO.
    assert snapshot.p95 < P95_SLO_SECONDS, (
        f"p95 of {snapshot.p95:.3f}s exceeds the {P95_SLO_SECONDS}s "
        f"SLO from the Seed Contract"
    )
    # Sanity: max also under the per-call cap.
    assert snapshot.max_seconds < 25.0
    # Sanity: typical (p50) sits well inside the common-case band.
    assert 3.0 <= snapshot.p50 <= 8.0


@pytest.mark.integration
def test_p95_slo_constant_matches_contract() -> None:
    """Guard against a drive-by edit that loosens the SLO target."""
    assert P95_SLO_SECONDS == 30.0
