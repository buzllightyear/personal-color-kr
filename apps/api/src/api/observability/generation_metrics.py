"""Request-level generation outcome metrics via Sentry (AC3).

The Seed Contract requires a **rolling, request-level** generation success rate
(button tap → delivered image within 30 s, target ≥ 95 %) observable through the
*existing* Sentry integration — no new dashboard, no Slack, no extra infra.

Each ``POST /v1/generate`` request already runs inside a Sentry transaction
(``FastApiIntegration``). This module tags that transaction with the
generation ``outcome`` (``success`` / ``failed`` / ``unavailable``) and the
``retry_count`` so the rolling success rate is derivable in Sentry Discover as

    count_if(generation.outcome, equals, success) / count(generation.outcome)

over any time window. Failures additionally surface as a ``warning`` event so
a spike is visible without building a query.

Design:
    - A :class:`GenerationMetricsRecorder` Protocol decouples the handler from
      Sentry; tests inject a stub and assert the outcome/retry_count without a
      live Sentry client.
    - :class:`SentryGenerationMetricsRecorder` is the production implementation.
      It is safe to call when Sentry is disabled (no DSN): the ``sentry_sdk``
      no-op hub simply drops the tag/breadcrumb/message.
"""

from __future__ import annotations

from typing import Final, Protocol

import sentry_sdk

# ---------------------------------------------------------------------------
# Outcome constants (the tag values the rolling success rate is computed over)
# ---------------------------------------------------------------------------

#: A watermarked image was delivered within the budget.
OUTCOME_SUCCESS: Final[str] = "success"

#: Generation could not produce a passing candidate within the 30 s budget, or
#: a non-retryable vendor error occurred. Counts against the success rate.
OUTCOME_FAILED: Final[str] = "failed"

#: Generation was not attempted because the service is misconfigured (e.g. the
#: fal.ai key is absent). Tracked separately so config gaps don't masquerade as
#: model-quality failures in the success-rate denominator.
OUTCOME_UNAVAILABLE: Final[str] = "unavailable"

#: Sentry tag keys.
_TAG_OUTCOME: Final[str] = "generation.outcome"
_TAG_RETRY_COUNT: Final[str] = "generation.retry_count"


class GenerationMetricsRecorder(Protocol):
    """Records a single request-level generation outcome."""

    def record_outcome(self, outcome: str, *, retry_count: int) -> None:
        """Record the terminal outcome of one generation request."""
        ...


class SentryGenerationMetricsRecorder:
    """Production recorder: tags the active Sentry transaction + breadcrumb.

    Tagging the current scope attributes the outcome to the in-flight request
    transaction so the rolling success rate is a tag aggregation. A breadcrumb
    preserves per-request context on any later event, and non-success outcomes
    are captured as ``warning`` messages for at-a-glance visibility.
    """

    def record_outcome(self, outcome: str, *, retry_count: int) -> None:
        sentry_sdk.set_tag(_TAG_OUTCOME, outcome)
        sentry_sdk.set_tag(_TAG_RETRY_COUNT, str(retry_count))
        sentry_sdk.add_breadcrumb(
            category="generation",
            message=outcome,
            level="info" if outcome == OUTCOME_SUCCESS else "warning",
            data={"retry_count": retry_count},
        )
        if outcome != OUTCOME_SUCCESS:
            sentry_sdk.capture_message(f"generation_{outcome}", level="warning")


#: Process-wide singleton — the recorder is stateless, so one instance is reused.
_RECORDER: Final[SentryGenerationMetricsRecorder] = SentryGenerationMetricsRecorder()


def get_generation_metrics_recorder() -> GenerationMetricsRecorder:
    """FastAPI dependency returning the production Sentry recorder.

    Tests override this via ``app.dependency_overrides`` with a stub recorder.
    """
    return _RECORDER
