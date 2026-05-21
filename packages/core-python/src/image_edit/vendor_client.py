"""Vendor wrapper for external image-editing APIs (Sub-AC 9.1).

The Seed Contract constrains the backend to *commoditised generative-AI
wrapping* — Nano Banana, Replicate, MediaPipe, Face++ — and forbids us
from training our own models. So every selfie-edit path eventually
funnels through one of those HTTP-style vendors. This module is the
single in-process boundary that funnel runs through.

Why a wrapper rather than calling the vendor SDK at the call site:

  - Vendors come and go (Nano Banana today, Replicate tomorrow). Pinning
    the *shape* of the call here — request dataclass in, response
    dataclass out — means swapping vendors is a one-file edit to the
    concrete `VendorCaller`, not a sweep through every feature module.
  - Vendors fail. Network blips, rate limits, transient 5xx — every one
    of these has to be retried with backoff so a single hiccup does not
    surface as a "편집 실패" toast to the user. Centralising retry +
    timeout discipline here lets every caller inherit the same SLA
    without re-implementing it.
  - The p95 latency budget in the Seed Contract is *< 30 seconds end to
    end* for selfie → edited result. The wrapper enforces a per-call
    timeout budget that respects that ceiling regardless of how many
    retries fire underneath.

Boundary contract:

  `edit_image(request, *, vendor_caller, ...) -> VendorResponse`

  - `request` is a fully-validated `VendorRequest` (image bytes + params).
  - `vendor_caller` is any callable that satisfies the `VendorCaller`
    protocol. Production wires this to a real HTTP client; tests wire it
    to a deterministic mock. Dependency injection (rather than module-
    level state) keeps the wrapper trivially testable without monkey-
    patching.
  - Returns a `VendorResponse` carrying the edited bytes plus minimal
    metadata (vendor name, latency, attempt count). Callers downstream
    of this layer never see an HTTP response object.

Retry + timeout discipline:

  - The wrapper retries on `VendorError` only — a permanent error class
    raised by the concrete adapter when the vendor signals a transient
    fault (HTTP 5xx, network reset, rate-limit-with-retry-after). Non-
    retryable failures (e.g. malformed input rejected with HTTP 4xx)
    must be raised as a different exception (`ValueError`) which
    propagates immediately — retrying a bad request is pointless.
  - Between retries the wrapper sleeps with exponential backoff
    (`base * 2**attempt`). Sleep is injected so tests run instantly.
  - The total elapsed budget is bounded by `timeout_seconds`. If the
    next sleep would push us past the budget, `VendorTimeoutError` is
    raised immediately — no point sleeping just to retry once after the
    deadline has passed.
  - Per-attempt deadline: each `vendor_caller` invocation is told how
    much budget remains (`attempt_timeout`). Vendors that honour
    deadlines can hard-cancel; vendors that ignore them at least see the
    cap and can self-limit.

Immutability:

  `VendorRequest` and `VendorResponse` are frozen dataclasses — once
  constructed, a request cannot be mutated mid-retry by a poorly-written
  caller, and a returned response cannot be tampered with by a logger.
  This matches the project-wide coding-style rule (~/.claude/rules/
  common/coding-style.md) that forbids mutation of shared values.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Final, Mapping, Protocol

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Default end-to-end budget. The Seed Contract sets p95 < 30s for the
#: full selfie → edited result pipeline. The wrapper alone reserves 25s
#: so that pre-processing (face landmarks, cropping) and post-processing
#: (writing to storage) can fit inside the same 30s p95 bound.
DEFAULT_TIMEOUT_SECONDS: Final[float] = 25.0

#: Default retry count. 2 retries (3 total attempts) trades off "absorb
#: one transient HTTP 502" against "do not blow the latency budget on a
#: vendor that is genuinely down".
DEFAULT_MAX_RETRIES: Final[int] = 2

#: Backoff schedule base in seconds. `base * 2**attempt` ⇒ 0.5s, 1.0s.
#: With a 25s budget and a typical 5–8s vendor latency this leaves head-
#: room for two attempts plus their sleeps.
DEFAULT_BACKOFF_BASE_SECONDS: Final[float] = 0.5


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class VendorError(Exception):
    """Transient failure surfaced by a concrete vendor adapter.

    The wrapper treats `VendorError` as the *only* retryable exception
    class. Concrete adapters must translate HTTP 5xx, connection reset,
    and rate-limit responses into `VendorError`. Everything else (bad
    image bytes, missing API key, schema mismatch) must raise a non-
    retryable exception so the wrapper does not waste the budget
    retrying a request that can never succeed.
    """


class VendorTimeoutError(VendorError):
    """The end-to-end timeout budget was exhausted before success.

    Subclasses `VendorError` so callers that already handle vendor
    failures will catch a timeout too, but callers that want to
    distinguish "vendor returned an error" from "we ran out of time"
    can catch `VendorTimeoutError` specifically.
    """


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class VendorRequest:
    """Validated input to a vendor edit call.

    Attributes:
        selfie_bytes: Raw image bytes (PNG / JPEG). Empty bytes are
            rejected at construction — every downstream vendor will fail
            on an empty payload, so failing fast saves a network round-
            trip.
        params: Vendor-agnostic editing parameters (`{"preset": "warm",
            "intensity": 0.7, ...}`). Concrete adapters are responsible
            for translating this generic dict into the vendor's native
            schema. Stored as an immutable copy so a caller mutating
            their original dict cannot affect an in-flight request.
        vendor: Hint for the concrete adapter; the wrapper itself does
            not branch on this value, but it is echoed back on the
            response so logs can attribute latency by vendor.
    """

    selfie_bytes: bytes
    params: Mapping[str, object] = field(default_factory=dict)
    vendor: str = "unknown"

    def __post_init__(self) -> None:
        # Boundary validation: every constraint that the wrapper relies
        # on is asserted here so the retry loop can assume well-formed
        # input.
        if not isinstance(self.selfie_bytes, (bytes, bytearray)):
            raise TypeError(
                "selfie_bytes must be bytes-like, "
                f"got {type(self.selfie_bytes).__name__}"
            )
        if len(self.selfie_bytes) == 0:
            raise ValueError("selfie_bytes must not be empty")
        if not isinstance(self.params, Mapping):
            raise TypeError(
                f"params must be a Mapping, got {type(self.params).__name__}"
            )
        if not isinstance(self.vendor, str) or not self.vendor:
            raise ValueError("vendor must be a non-empty string")

        # Freeze the params as an immutable dict-snapshot so post-
        # construction mutation by the caller cannot leak into retries.
        # `object.__setattr__` is the documented escape hatch for
        # frozen dataclasses; it is intentional and contained here.
        object.__setattr__(self, "params", dict(self.params))


@dataclass(frozen=True)
class VendorResponse:
    """Vendor edit result surfaced to the application layer.

    Attributes:
        edited_bytes: Encoded edited image (same format family as input).
        vendor: Name of the adapter that produced the result. Mirrors
            `VendorRequest.vendor` unless an adapter falls back to a
            different vendor internally — in which case the actual
            vendor is recorded here, not the requested one.
        latency_seconds: Wall-clock seconds the successful attempt took.
            Used by the analytics pipeline to compute p50/p95 SLOs.
        attempt: 1-indexed attempt number that succeeded. `attempt > 1`
            means a transient error was absorbed by the retry loop — a
            signal worth logging at INFO so vendor health is visible.
    """

    edited_bytes: bytes
    vendor: str
    latency_seconds: float
    attempt: int

    def __post_init__(self) -> None:
        if not isinstance(self.edited_bytes, (bytes, bytearray)):
            raise TypeError(
                "edited_bytes must be bytes-like, "
                f"got {type(self.edited_bytes).__name__}"
            )
        if len(self.edited_bytes) == 0:
            raise ValueError("edited_bytes must not be empty")
        if self.latency_seconds < 0:
            raise ValueError("latency_seconds must be >= 0")
        if self.attempt < 1:
            raise ValueError("attempt must be >= 1")


# ---------------------------------------------------------------------------
# Vendor caller Protocol
# ---------------------------------------------------------------------------


class VendorCaller(Protocol):
    """Callable contract every concrete vendor adapter must satisfy.

    The wrapper invokes ``vendor_caller(request, attempt_timeout)`` and
    expects either:

    - Return ``bytes`` — the edited image payload. Wrapper builds the
      `VendorResponse` envelope around it.
    - Raise `VendorError` — wrapper retries until budget is exhausted.
    - Raise any other exception — wrapper propagates immediately
      (non-retryable). Use this for client-side errors (bad input,
      missing credentials) that retrying cannot fix.

    `attempt_timeout` is the seconds remaining in the end-to-end budget
    at the moment the attempt starts. Adapters that wrap an HTTP client
    should pass this through as the request timeout so a slow vendor
    cannot block past the deadline.
    """

    def __call__(self, request: VendorRequest, attempt_timeout: float) -> bytes: ...


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def edit_image(
    request: VendorRequest,
    *,
    vendor_caller: VendorCaller,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff_base_seconds: float = DEFAULT_BACKOFF_BASE_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> VendorResponse:
    """Invoke a vendor with timeout + exponential-backoff retry.

    Args:
        request: Validated `VendorRequest`.
        vendor_caller: Concrete adapter that performs the actual call.
            Injected so production wires the real HTTP client and tests
            wire a deterministic mock. See `VendorCaller`.
        timeout_seconds: End-to-end wall-clock budget. Defaults to
            `DEFAULT_TIMEOUT_SECONDS` (25s — see module docstring).
        max_retries: Maximum *additional* attempts after the first.
            Total attempts = `1 + max_retries`. Defaults to
            `DEFAULT_MAX_RETRIES` (2 → up to 3 calls total).
        backoff_base_seconds: First sleep duration; doubles each retry.
            Defaults to `DEFAULT_BACKOFF_BASE_SECONDS` (0.5s).
        sleep: Injected sleeper. Default is `time.sleep`. Tests pass a
            stub that records the schedule without actually waiting.
        clock: Injected monotonic clock. Default is `time.monotonic`.
            Tests pass a stub list-walker for deterministic time.

    Returns:
        `VendorResponse` describing the first successful attempt.

    Raises:
        TypeError / ValueError: invalid wrapper configuration (negative
            timeout, negative max_retries, etc.). Raised eagerly before
            any vendor call — a misconfigured wrapper should fail loud,
            not after burning attempts.
        VendorTimeoutError: budget exhausted. Subclass of `VendorError`.
        VendorError: vendor raised on the final permitted attempt.
        Any other exception raised by `vendor_caller` propagates
            unchanged — by contract those are non-retryable.
    """
    # ------- eager config validation -------
    if not isinstance(request, VendorRequest):
        raise TypeError(f"request must be VendorRequest, got {type(request).__name__}")
    if not callable(vendor_caller):
        raise TypeError("vendor_caller must be callable")
    if timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be > 0")
    if max_retries < 0:
        raise ValueError("max_retries must be >= 0")
    if backoff_base_seconds < 0:
        raise ValueError("backoff_base_seconds must be >= 0")

    start = clock()
    deadline = start + timeout_seconds
    last_error: VendorError | None = None

    # ------- attempt loop -------
    # Attempt numbers are 1-indexed in the response (humans read logs);
    # the `for` index is 0-based so backoff math `2**i` reads naturally.
    for attempt_index in range(max_retries + 1):
        attempt_number = attempt_index + 1
        now = clock()
        remaining = deadline - now
        if remaining <= 0:
            # Out of budget before we even got to call the vendor.
            raise VendorTimeoutError(
                _timeout_message(timeout_seconds, attempt_number, last_error)
            )

        attempt_start = now
        try:
            edited_bytes = vendor_caller(request, remaining)
        except VendorError as exc:
            # Transient — eligible for retry if (a) we have more
            # attempts and (b) the next backoff would still fit inside
            # the budget. Otherwise re-raise as the final error.
            last_error = exc
            attempts_left = max_retries - attempt_index
            if attempts_left <= 0:
                raise
            sleep_seconds = backoff_base_seconds * (2**attempt_index)
            next_now = clock()
            if next_now + sleep_seconds >= deadline:
                # Sleeping would push us past the deadline. Don't
                # bother — surface the timeout immediately so the user
                # sees a fast failure rather than a slow one.
                raise VendorTimeoutError(
                    _timeout_message(timeout_seconds, attempt_number, exc)
                ) from exc
            sleep(sleep_seconds)
            continue

        # Success — build the response envelope.
        latency = clock() - attempt_start
        # Guard against pathologically non-monotonic injected clocks in
        # tests: latency cannot be negative in the response contract.
        if latency < 0:
            latency = 0.0
        return VendorResponse(
            edited_bytes=bytes(edited_bytes),
            vendor=request.vendor,
            latency_seconds=latency,
            attempt=attempt_number,
        )

    # The `for` loop should always either return or raise; reaching
    # here is a logic bug. Defensive raise so a refactor that breaks
    # the invariant fails loud rather than returning `None`.
    raise VendorTimeoutError(  # pragma: no cover - defensive
        _timeout_message(timeout_seconds, max_retries + 1, last_error)
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _timeout_message(
    budget_seconds: float,
    attempts_made: int,
    last_error: VendorError | None,
) -> str:
    """Build a human-readable timeout message.

    Centralised so the wording is identical whether the timeout fires
    before the first call or between retries — operators grepping logs
    only need to learn one phrase.
    """
    suffix = f" last error: {last_error!s}" if last_error is not None else ""
    return (
        f"vendor budget of {budget_seconds:.3f}s exhausted "
        f"after {attempts_made} attempt(s);{suffix}"
    )
