"""Auto-retry-within-budget generation orchestrator (Sub-AC 2b-ii).

Core invariant
--------------
Run ``generate_fn`` → score result via ``score_fn`` → accept if ``passed``,
else retry until the wall-clock budget is exhausted.  Raise
:class:`GenerationBudgetExhaustedError` when the budget runs out before a
passing candidate is found.

Design
------
* Wall-clock budget is enforced via ``time.monotonic()`` — no sleep.
* The remaining budget is passed as the per-attempt ``timeout`` to
  ``generate_fn`` so a slow generation attempt cannot consume more than the
  remaining wall clock.
* The generation callable is **injected** (``_generate_fn`` parameter, default:
  :func:`~personal_color.generate.fal_client.generate_from_recipe`) so tests
  substitute a lightweight stub without real HTTP calls.
* The scoring callable is **injected** (``_score_fn`` parameter, default:
  :func:`~personal_color.generate.rejection.score_image`) so tests substitute
  a deterministic stub for complete isolation from PIL and the NSFW classifier.
* NSFW classification is injected via ``nsfw_classifier`` (the caller provides
  :class:`~personal_color.generate.rejection.StubNsfwClassifier` in tests,
  :class:`~personal_color.generate.rejection.FalNsfwClassifier` in production).

Seed constraints honored here
------------------------------
* 30-second total wall-clock budget (``total_budget_seconds`` default).
* Auto-retries consumed within budget — no hard cap on retry count in Phase 1.
* One generation at a time — serial loop, no concurrency.
* Raise terminal error on exhaustion (:class:`GenerationBudgetExhaustedError`).
* Non-retryable generation failures propagate immediately without retry.
* ``retry_count`` tracks the number of failed attempts before a successful
  candidate is accepted (0 = first attempt succeeded).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Final, Protocol, runtime_checkable

from personal_color.generate.fal_client import (
    FalGenerationConfig,
    FalGenerationError,
    generate_from_recipe,
)
from personal_color.generate.rejection import (
    NsfwClassifier,
    RejectionVerdict,
    score_image,
)

_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Protocols for injectable callables
# ---------------------------------------------------------------------------


@runtime_checkable
class GenerateFn(Protocol):
    """Protocol for the injectable image generation callable.

    The default implementation is
    :func:`~personal_color.generate.fal_client.generate_from_recipe`.
    Tests substitute a lightweight stub to avoid real HTTP round-trips.
    """

    def __call__(
        self,
        config: FalGenerationConfig,
        selfie_bytes: bytes,
        *,
        api_key: str,
        timeout: float,
    ) -> bytes:
        """Generate an image from a recipe config and return raw bytes."""
        ...


@runtime_checkable
class ScoreFn(Protocol):
    """Protocol for the injectable rejection scoring callable.

    The default implementation is
    :func:`~personal_color.generate.rejection.score_image`.
    Tests substitute a deterministic stub for complete isolation from PIL.
    """

    def __call__(
        self,
        image_input: bytes | str,
        *,
        nsfw_classifier: NsfwClassifier,
    ) -> RejectionVerdict:
        """Score an image and return a rejection verdict."""
        ...


# ---------------------------------------------------------------------------
# Result and error types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OrchestrationResult:
    """Result of a successful orchestrated generation run.

    Attributes
    ----------
    image_bytes:
        The raw image bytes of the accepted candidate.
    retry_count:
        Number of failed attempts consumed before this successful candidate.
        Zero means the first generation attempt passed rejection immediately.
    last_verdict:
        The :class:`~personal_color.generate.rejection.RejectionVerdict`
        of the accepted candidate — ``passed`` is always ``True`` here.
    """

    image_bytes: bytes
    retry_count: int
    last_verdict: RejectionVerdict


class GenerationBudgetExhaustedError(Exception):
    """Raised when the wall-clock budget runs out before a passing candidate.

    Attributes
    ----------
    retry_count:
        Total number of failed generation attempts made before the budget
        ran out.
    last_reject_reason:
        The ``reject_reason`` of the last scored candidate, or ``None`` when
        the budget ran out before any candidate could be scored (e.g. all
        attempts raised retryable :class:`~.fal_client.FalGenerationError`).
    """

    def __init__(
        self,
        message: str,
        *,
        retry_count: int,
        last_reject_reason: str | None = None,
    ) -> None:
        super().__init__(message)
        self.retry_count = retry_count
        self.last_reject_reason = last_reject_reason


# ---------------------------------------------------------------------------
# Orchestrator entry point
# ---------------------------------------------------------------------------


def orchestrate_generation(
    config: FalGenerationConfig,
    selfie_bytes: bytes,
    *,
    api_key: str,
    nsfw_classifier: NsfwClassifier,
    total_budget_seconds: float = 30.0,
    _generate_fn: GenerateFn | None = None,
    _score_fn: ScoreFn | None = None,
) -> OrchestrationResult:
    """Generate an AI image, reject and retry within a hard wall-clock budget.

    Orchestrates the generate → score → accept/retry loop:

    1. Compute a deadline once: ``deadline = time.monotonic() + total_budget_seconds``.
    2. While the deadline has not passed:

       a. Compute remaining budget; raise :class:`GenerationBudgetExhaustedError`
          if already <= 0.
       b. Call ``_generate_fn`` with the remaining budget as the per-call
          timeout.
       c. Call ``_score_fn`` on the raw bytes with ``nsfw_classifier``.
       d. If ``passed``, return :class:`OrchestrationResult`.
       e. If rejected, increment ``retry_count`` and loop.
       f. On a retryable :class:`~.fal_client.FalGenerationError`, increment
          ``retry_count``; if budget is gone raise
          :class:`GenerationBudgetExhaustedError`, else loop.
       g. On a **non-retryable** :class:`~.fal_client.FalGenerationError`,
          re-raise immediately — retrying would produce the same outcome.

    Parameters
    ----------
    config:
        Recipe-derived generation parameters.
    selfie_bytes:
        Raw selfie image bytes.
    api_key:
        fal.ai API key.  Forwarded verbatim to ``_generate_fn``; never logged.
    nsfw_classifier:
        Injectable NSFW classifier.  Use
        :class:`~personal_color.generate.rejection.FalNsfwClassifier` in
        production and :class:`~personal_color.generate.rejection.StubNsfwClassifier`
        in tests.
    total_budget_seconds:
        Total wall-clock budget for all attempts combined.  Default 30 s
        matches the Seed Contract's end-to-end SLO.
    _generate_fn:
        Injectable generation callable (default:
        :func:`~personal_color.generate.fal_client.generate_from_recipe`).
        Tests pass a stub here to avoid real HTTP calls.
    _score_fn:
        Injectable scoring callable (default:
        :func:`~personal_color.generate.rejection.score_image`).
        Tests pass a stub here for complete rejection-module isolation.

    Returns
    -------
    OrchestrationResult
        Frozen dataclass with ``image_bytes``, ``retry_count``, and
        ``last_verdict`` (``passed=True`` guaranteed).

    Raises
    ------
    GenerationBudgetExhaustedError
        When the wall-clock budget is consumed without a passing candidate.
        ``retry_count`` is the total number of failed attempts made.
    FalGenerationError
        When a **non-retryable** generation failure occurs (HTTP 4xx
        excluding 429, malformed response).  Propagated as-is — the caller
        should surface this as a terminal generation error.
    """
    generate: GenerateFn = (
        _generate_fn if _generate_fn is not None else generate_from_recipe
    )
    score: ScoreFn = _score_fn if _score_fn is not None else score_image

    deadline: float = time.monotonic() + total_budget_seconds
    retry_count: int = 0
    last_reject_reason: str | None = None

    while True:
        # ------------------------------------------------------------------
        # Budget check at loop entry (also fires on the very first iteration
        # when total_budget_seconds is 0 or negative).
        # ------------------------------------------------------------------
        remaining: float = deadline - time.monotonic()
        if remaining <= 0:
            raise GenerationBudgetExhaustedError(
                f"generation budget of {total_budget_seconds}s exhausted after "
                f"{retry_count} failed attempt(s)",
                retry_count=retry_count,
                last_reject_reason=last_reject_reason,
            )

        # ------------------------------------------------------------------
        # Generation step
        # ------------------------------------------------------------------
        try:
            raw_bytes: bytes = generate(
                config,
                selfie_bytes,
                api_key=api_key,
                timeout=remaining,
            )
        except FalGenerationError as exc:
            if not exc.retryable:
                # Terminal failure: propagate immediately, no retry.
                raise

            # Transient failure: consume one retry slot and check budget.
            retry_count += 1
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise GenerationBudgetExhaustedError(
                    f"generation budget of {total_budget_seconds}s exhausted "
                    f"after {retry_count} failed attempt(s) "
                    f"(last error: {exc})",
                    retry_count=retry_count,
                    last_reject_reason=last_reject_reason,
                ) from exc

            _LOGGER.warning(
                "orchestrator: retryable generation error attempt=%d: %s",
                retry_count,
                exc,
            )
            continue

        # ------------------------------------------------------------------
        # Rejection scoring step
        # ------------------------------------------------------------------
        verdict: RejectionVerdict = score(
            raw_bytes, nsfw_classifier=nsfw_classifier
        )

        if verdict.passed:
            _LOGGER.info(
                "orchestrator: accepted attempt=%d retry_count=%d",
                retry_count + 1,
                retry_count,
            )
            return OrchestrationResult(
                image_bytes=raw_bytes,
                retry_count=retry_count,
                last_verdict=verdict,
            )

        # Rejected — log and retry within remaining budget.
        _LOGGER.info(
            "orchestrator: rejected attempt=%d reason=%s "
            "nsfw_score=%.4f artifact_score=%.4f",
            retry_count + 1,
            verdict.reject_reason,
            verdict.nsfw_score,
            verdict.artifact_score,
        )
        last_reject_reason = verdict.reject_reason
        retry_count += 1


__all__ = [
    "GenerateFn",
    "ScoreFn",
    "OrchestrationResult",
    "GenerationBudgetExhaustedError",
    "orchestrate_generation",
]
