"""End-to-end image-edit pipeline (Sub-AC 9.3).

This module is the single integration point the application layer
calls when a user submits a selfie for editing. It glues together the
two Sub-AC 9 primitives:

  - `vendor_client.edit_image` — retry + timeout discipline against a
    commoditised generative-AI vendor (Nano Banana / Replicate /
    MediaPipe / Face++ per the Seed Contract).
  - `latency_tracker.LatencyTracker` — in-process SLO accumulator that
    the observability layer rolls up into p50 / p95 / p99 readings.

Why a pipeline wrapper rather than calling both at the call site:

  - The Seed Contract pins a hard p95 < 30s SLO on the *end-to-end*
    selfie → edited result path. End-to-end means every wall-clock
    second between "we accepted the bytes" and "we returned the
    bytes" — not just the vendor RPC. Recording the vendor latency
    alone would underestimate the user-perceived tail because it
    omits validation, request construction, and response packaging.
  - Centralising the orchestration means future feature work (the
    fake-loader hint in Sub-AC 8, the content_package dispatch in
    AC 6, the editing_preset selection in Sub-AC 12) extends one
    function instead of N call sites, each of which would otherwise
    have to remember to wire the tracker.
  - It is unit + integration testable. The vendor caller is injected
    so the integration test can drive a deterministic fake that
    simulates realistic vendor latency without burning real RPCs.

Boundary contract:

  `run_edit_pipeline(selfie_bytes, *, vendor_caller, ...) -> PipelineResult`

  - `selfie_bytes` is the raw image payload (PNG / JPEG). Empty input
    is rejected before the tracker is touched — a 0-byte selfie is a
    user-side bug, not a vendor-side latency event, so it should not
    pollute the SLO histogram.
  - `vendor_caller` satisfies the `VendorCaller` protocol from
    `vendor_client`. Production wires the real HTTP adapter; tests
    wire a deterministic stub.
  - `tracker` is the destination accumulator. The same tracker can be
    shared across many pipeline calls (that is the point — its
    snapshot is the SLO reading). A fresh `LatencyTracker()` is
    constructed if the caller passes `None`, which keeps simple
    one-shot uses ergonomic.

p95 < 30s guarantee:

  - The vendor wrapper enforces `DEFAULT_TIMEOUT_SECONDS = 25s` as a
    hard ceiling per call. The pipeline adds only validation and DTO
    construction around that call, which is microseconds. So as long
    as the injected `vendor_caller` honours the `attempt_timeout`
    handed to it, no single pipeline call can exceed ~25.x seconds,
    and p95 across a window stays comfortably under 30s.
  - The integration test in `tests/image_edit/test_pipeline.py`
    asserts this directly against a mocked vendor that simulates
    realistic latency drawn from a long-tail distribution.

Failure semantics:

  - `VendorError` / `VendorTimeoutError`: surfaced as-is to the
    caller. Application layer is expected to catch and surface a
    user-facing "편집을 다시 시도해주세요" message. Importantly the
    latency *is still recorded* before the exception propagates — a
    failed 25s vendor call is still a 25s user-perceived event, and
    hiding it from the histogram would let a vendor whose only
    failure mode is "time out at the deadline" look healthy.
  - `ValueError` / `TypeError`: client-side input errors. Raised
    eagerly before the tracker is touched — these are not latency
    events from the user's perspective; they are 400-class rejections
    that never get to the vendor.

Immutability:

  `PipelineResult` is a frozen dataclass — once returned, it cannot
  be mutated by a logger or a caller. Matches the project-wide
  coding-style rule (~/.claude/rules/common/coding-style.md).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, Final, Mapping

from .latency_tracker import LatencyTracker, measure_latency
from .vendor_client import (
    DEFAULT_BACKOFF_BASE_SECONDS,
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT_SECONDS,
    VendorCaller,
    VendorRequest,
    VendorResponse,
    edit_image,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: The Seed Contract's p95 SLO target for selfie → edited result.
#: Surfaced as a module-level constant so the integration test, the
#: alerting layer, and any future dashboard agree on a single number
#: instead of drifting into "30s here, 29s there".
P95_SLO_SECONDS: Final[float] = 30.0


# ---------------------------------------------------------------------------
# Result DTO
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PipelineResult:
    """End-to-end outcome of a single `run_edit_pipeline` call.

    Distinct from `VendorResponse` because the pipeline measures the
    *user-perceived* wall-clock duration (validation + vendor +
    packaging) rather than the vendor RPC alone. The vendor response
    is preserved verbatim under `vendor_response` for callers that
    need attempt counts or the vendor-only latency.

    Attributes:
        edited_bytes: Encoded edited image (PNG / JPEG).
        vendor: Name of the adapter that produced the result. Mirrors
            `VendorResponse.vendor`.
        pipeline_latency_seconds: End-to-end wall-clock seconds —
            this is the number the p95 SLO is measured against.
        vendor_response: The underlying `VendorResponse` for callers
            that need attempt counts or vendor-only latency.
    """

    edited_bytes: bytes
    vendor: str
    pipeline_latency_seconds: float
    vendor_response: VendorResponse

    def __post_init__(self) -> None:
        if not isinstance(self.edited_bytes, (bytes, bytearray)):
            raise TypeError(
                "edited_bytes must be bytes-like, "
                f"got {type(self.edited_bytes).__name__}"
            )
        if len(self.edited_bytes) == 0:
            raise ValueError("edited_bytes must not be empty")
        if not isinstance(self.vendor, str) or not self.vendor:
            raise ValueError("vendor must be a non-empty string")
        if self.pipeline_latency_seconds < 0:
            raise ValueError("pipeline_latency_seconds must be >= 0")
        if not isinstance(self.vendor_response, VendorResponse):
            raise TypeError(
                "vendor_response must be VendorResponse, "
                f"got {type(self.vendor_response).__name__}"
            )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def run_edit_pipeline(
    selfie_bytes: bytes,
    *,
    vendor_caller: VendorCaller,
    params: Mapping[str, object] | None = None,
    vendor: str = "nano_banana",
    tracker: LatencyTracker | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff_base_seconds: float = DEFAULT_BACKOFF_BASE_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> PipelineResult:
    """Run a selfie through the full edit pipeline.

    The pipeline:

      1. Validates ``selfie_bytes`` eagerly (rejects empty / non-bytes
         input before touching the tracker — these are client-side
         400s, not latency events).
      2. Builds an immutable `VendorRequest` envelope.
      3. Opens a `measure_latency` context against ``tracker`` so the
         end-to-end wall clock is recorded *whether or not* the vendor
         call succeeds.
      4. Delegates to `edit_image` with the configured retry +
         timeout discipline.
      5. Packages the result into a `PipelineResult`.

    Args:
        selfie_bytes: Raw image payload (PNG / JPEG). Must be a non-
            empty bytes-like object.
        vendor_caller: Concrete adapter satisfying `VendorCaller`.
            Injected so production wires the real HTTP client and
            tests wire a deterministic fake.
        params: Vendor-agnostic editing parameters (e.g.
            ``{"preset": "spring_warm", "intensity": 0.7}``). Defaults
            to an empty mapping.
        vendor: Hint echoed back in the response for log attribution.
            Defaults to ``"nano_banana"`` since that is the primary
            vendor in the current build per the Seed Contract.
        tracker: Destination latency accumulator. If ``None`` a fresh
            one is constructed — useful for one-shot calls in tests
            but production code is expected to share a single tracker
            across calls so the SLO snapshot is meaningful.
        timeout_seconds: End-to-end wall-clock budget passed through
            to `edit_image`. Defaults to `DEFAULT_TIMEOUT_SECONDS`
            (25s) which leaves headroom under the 30s p95 SLO.
        max_retries: Additional attempts after the first. Defaults
            to `DEFAULT_MAX_RETRIES`.
        backoff_base_seconds: First retry sleep; doubles each retry.
        sleep: Injectable sleeper for the retry loop. Tests wire a
            no-op stub so the suite runs instantly.
        clock: Injectable monotonic clock. Tests wire a list-walker
            for deterministic time.

    Returns:
        `PipelineResult` carrying the edited bytes plus end-to-end
        latency and the underlying vendor response.

    Raises:
        TypeError: ``selfie_bytes`` is not bytes-like, or any other
            argument violates its declared type. Raised eagerly
            before the tracker is touched.
        ValueError: ``selfie_bytes`` is empty, ``vendor`` is empty,
            or any other argument is out of range.
        VendorError / VendorTimeoutError: surfaced from `edit_image`
            after retries are exhausted. Latency is recorded into
            ``tracker`` before the exception propagates.
        Any other exception raised by ``vendor_caller`` propagates
            unchanged — by contract those are non-retryable.
    """
    # Eager validation — keep these *outside* the latency-measured
    # block so a malformed call does not skew the SLO histogram with
    # microsecond samples that are not user-perceived latency events.
    if not isinstance(selfie_bytes, (bytes, bytearray)):
        raise TypeError(
            "selfie_bytes must be bytes-like, " f"got {type(selfie_bytes).__name__}"
        )
    if len(selfie_bytes) == 0:
        raise ValueError("selfie_bytes must not be empty")
    if not isinstance(vendor, str) or not vendor:
        raise ValueError("vendor must be a non-empty string")
    if tracker is not None and not isinstance(tracker, LatencyTracker):
        raise TypeError(
            "tracker must be a LatencyTracker or None, " f"got {type(tracker).__name__}"
        )

    # `params` defaults to an empty mapping — VendorRequest will copy
    # it into an immutable snapshot, so a caller mutating the original
    # dict cannot affect the in-flight request.
    effective_params: Mapping[str, object] = params if params is not None else {}

    # Fresh tracker for one-shot callers. Production passes a shared
    # tracker; the SLO snapshot is only meaningful across calls.
    effective_tracker: LatencyTracker = (
        tracker if tracker is not None else LatencyTracker()
    )

    request = VendorRequest(
        selfie_bytes=bytes(selfie_bytes),
        params=effective_params,
        vendor=vendor,
    )

    # Capture the pipeline start *inside* the measured block by reading
    # `clock` once before and once after the vendor call. The same
    # `clock` is threaded through `edit_image` so wall-clock + retry
    # budgets agree on a single time source — critical when tests
    # inject a deterministic clock.
    pipeline_start = clock()

    # `measure_latency` records the elapsed time on exit regardless of
    # whether the block raised. That is the intended behaviour: a
    # vendor that times out at 25s is still a 25s user-perceived
    # latency event, and the SLO dashboard must see it.
    with measure_latency(effective_tracker, clock=clock):
        vendor_response = edit_image(
            request,
            vendor_caller=vendor_caller,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            backoff_base_seconds=backoff_base_seconds,
            sleep=sleep,
            clock=clock,
        )

    pipeline_end = clock()
    pipeline_latency = pipeline_end - pipeline_start
    # Guard against a pathologically non-monotonic injected clock in
    # tests: pipeline_latency cannot be negative in the response
    # contract. Mirrors the same guard in `edit_image`.
    if pipeline_latency < 0:
        pipeline_latency = 0.0

    return PipelineResult(
        edited_bytes=vendor_response.edited_bytes,
        vendor=vendor_response.vendor,
        pipeline_latency_seconds=pipeline_latency,
        vendor_response=vendor_response,
    )
