"""Tests for personal_color.generate.orchestrator (Sub-AC 2b-ii).

Verifies the auto-retry-within-budget generation orchestrator with:
  - Stub generation function (no real HTTP calls)
  - Stub rejection scorer (no PIL artifact checks, no fal.ai NSFW calls)

The rejection module is fully stubbed for isolation: tests inject a
``_score_fn`` that returns pre-determined :class:`RejectionVerdict` objects,
and use :class:`StubNsfwClassifier` when the default scorer is exercised.

Test coverage:
    - Happy path: first attempt passes rejection → OrchestrationResult, retry_count=0
    - One rejection then success → retry_count=1
    - Multiple rejections then success → retry_count=N
    - Budget exhausted (all rejected) → GenerationBudgetExhaustedError
    - Budget already exhausted on entry → GenerationBudgetExhaustedError, no attempt made
    - Non-retryable FalGenerationError propagated immediately (no retry)
    - Non-retryable error is NOT wrapped as GenerationBudgetExhaustedError
    - Retryable FalGenerationError triggers retry, second attempt can succeed
    - Retryable errors increment retry_count by one per failed attempt
    - Retryable errors + budget exhausted → GenerationBudgetExhaustedError
    - OrchestrationResult is frozen (immutable dataclass)
    - OrchestrationResult.last_verdict.passed is always True
    - retry_count matches the number of failed attempts before success
    - GenerationBudgetExhaustedError carries retry_count attribute (int)
    - GenerationBudgetExhaustedError carries last_reject_reason (str | None)
    - GenerationBudgetExhaustedError is subclass of Exception
    - nsfw_classifier is forwarded verbatim to _score_fn
    - api_key is forwarded verbatim to _generate_fn
    - config is forwarded verbatim to _generate_fn
    - selfie_bytes are forwarded verbatim to _generate_fn
    - timeout passed to _generate_fn is positive and <= total_budget_seconds
"""

from __future__ import annotations

from typing import Final

import pytest

from personal_color.generate.fal_client import FalGenerationConfig, FalGenerationError
from personal_color.generate.orchestrator import (
    GenerationBudgetExhaustedError,
    OrchestrationResult,
    orchestrate_generation,
)
from personal_color.generate.rejection import (
    NsfwClassifier,
    RejectionVerdict,
    StubNsfwClassifier,
)

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

_FAKE_SELFIE: Final[bytes] = b"FAKE_SELFIE_PNG_BYTES"
_FAKE_RESULT: Final[bytes] = b"FAKE_GENERATED_IMAGE_BYTES"
_TEST_API_KEY: Final[str] = "test-key-id:test-key-secret"

_MINIMAL_CONFIG: Final[FalGenerationConfig] = FalGenerationConfig(
    model_id="fal-ai/flux/dev",
    prompt="spring warm-tone styling",
)

# Pre-built verdict objects (frozen dataclasses — safe to reuse as constants).
_PASSING_VERDICT: Final[RejectionVerdict] = RejectionVerdict(
    nsfw_flag=False,
    artifact_flag=False,
    passed=True,
    nsfw_score=0.0,
    artifact_score=0.0,
    reject_reason=None,
)

_NSFW_VERDICT: Final[RejectionVerdict] = RejectionVerdict(
    nsfw_flag=True,
    artifact_flag=False,
    passed=False,
    nsfw_score=0.95,
    artifact_score=0.0,
    reject_reason="nsfw",
)

_ARTIFACT_VERDICT: Final[RejectionVerdict] = RejectionVerdict(
    nsfw_flag=False,
    artifact_flag=True,
    passed=False,
    nsfw_score=0.0,
    artifact_score=1.0,
    reject_reason="artifact",
)

# A single StubNsfwClassifier instance reused throughout (safe — stateless).
_STUB_NSFW: Final[StubNsfwClassifier] = StubNsfwClassifier(score=0.0)

# ---------------------------------------------------------------------------
# Stub generation functions
# ---------------------------------------------------------------------------


def _always_succeed_generate(
    config: FalGenerationConfig,
    selfie_bytes: bytes,
    *,
    api_key: str,
    timeout: float,
) -> bytes:
    """Stub generate: always returns _FAKE_RESULT immediately."""
    return _FAKE_RESULT


def _make_fail_then_succeed_generate(
    fail_count: int,
    *,
    retryable: bool = True,
) -> object:
    """Return a stub generate that raises FalGenerationError `fail_count` times then succeeds."""
    calls: list[int] = [0]

    def _stub(
        config: FalGenerationConfig,
        selfie_bytes: bytes,
        *,
        api_key: str,
        timeout: float,
    ) -> bytes:
        calls[0] += 1
        if calls[0] <= fail_count:
            raise FalGenerationError(
                f"stub failure #{calls[0]}",
                retryable=retryable,
            )
        return _FAKE_RESULT

    return _stub


def _always_retryable_fail_generate(
    config: FalGenerationConfig,
    selfie_bytes: bytes,
    *,
    api_key: str,
    timeout: float,
) -> bytes:
    """Stub generate: always raises a retryable FalGenerationError."""
    raise FalGenerationError("transient fal.ai error", retryable=True)


def _always_permanent_fail_generate(
    config: FalGenerationConfig,
    selfie_bytes: bytes,
    *,
    api_key: str,
    timeout: float,
) -> bytes:
    """Stub generate: always raises a non-retryable FalGenerationError."""
    raise FalGenerationError("permanent fal.ai error", retryable=False, status_code=401)


# ---------------------------------------------------------------------------
# Stub score functions
# ---------------------------------------------------------------------------


def _always_pass_score(
    image_input: bytes | str,
    *,
    nsfw_classifier: NsfwClassifier,
) -> RejectionVerdict:
    """Stub score: always returns the passing verdict."""
    return _PASSING_VERDICT


def _always_nsfw_reject_score(
    image_input: bytes | str,
    *,
    nsfw_classifier: NsfwClassifier,
) -> RejectionVerdict:
    """Stub score: always returns the NSFW rejection verdict."""
    return _NSFW_VERDICT


def _make_reject_then_pass_score(reject_count: int) -> object:
    """Return a stub score that rejects `reject_count` times then passes."""
    calls: list[int] = [0]

    def _stub(
        image_input: bytes | str,
        *,
        nsfw_classifier: NsfwClassifier,
    ) -> RejectionVerdict:
        calls[0] += 1
        if calls[0] <= reject_count:
            return _NSFW_VERDICT
        return _PASSING_VERDICT

    return _stub


# ---------------------------------------------------------------------------
# 1. Happy path — first attempt passes
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_first_attempt_passes_returns_orchestration_result() -> None:
    """When the first generation passes rejection, return an OrchestrationResult."""
    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        _generate_fn=_always_succeed_generate,
        _score_fn=_always_pass_score,
    )

    assert isinstance(result, OrchestrationResult)


@pytest.mark.unit
def test_first_attempt_result_image_bytes_correct() -> None:
    """OrchestrationResult.image_bytes must equal the bytes returned by generate_fn."""
    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        _generate_fn=_always_succeed_generate,
        _score_fn=_always_pass_score,
    )

    assert result.image_bytes == _FAKE_RESULT


@pytest.mark.unit
def test_first_attempt_retry_count_is_zero() -> None:
    """When the first attempt passes, retry_count must be 0."""
    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        _generate_fn=_always_succeed_generate,
        _score_fn=_always_pass_score,
    )

    assert result.retry_count == 0


@pytest.mark.unit
def test_first_attempt_last_verdict_passed_is_true() -> None:
    """OrchestrationResult.last_verdict.passed must be True."""
    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        _generate_fn=_always_succeed_generate,
        _score_fn=_always_pass_score,
    )

    assert result.last_verdict.passed is True


# ---------------------------------------------------------------------------
# 2. Rejection → retry → success
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_one_rejection_then_success_retry_count_one() -> None:
    """First attempt rejected, second passes → retry_count=1."""
    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        total_budget_seconds=30.0,
        _generate_fn=_always_succeed_generate,
        _score_fn=_make_reject_then_pass_score(reject_count=1),
    )

    assert result.retry_count == 1


@pytest.mark.unit
def test_two_rejections_then_success_retry_count_two() -> None:
    """Two rejections then success → retry_count=2."""
    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        total_budget_seconds=30.0,
        _generate_fn=_always_succeed_generate,
        _score_fn=_make_reject_then_pass_score(reject_count=2),
    )

    assert result.retry_count == 2


@pytest.mark.unit
def test_multiple_rejections_last_verdict_passed_true() -> None:
    """After multiple rejections, OrchestrationResult.last_verdict.passed is True."""
    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        total_budget_seconds=30.0,
        _generate_fn=_always_succeed_generate,
        _score_fn=_make_reject_then_pass_score(reject_count=3),
    )

    assert result.last_verdict.passed is True


# ---------------------------------------------------------------------------
# 3. Budget exhausted — all rejected
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_budget_exhausted_raises_error() -> None:
    """When all attempts are rejected and budget runs out, raise GenerationBudgetExhaustedError."""
    with pytest.raises(GenerationBudgetExhaustedError):
        orchestrate_generation(
            _MINIMAL_CONFIG,
            _FAKE_SELFIE,
            api_key=_TEST_API_KEY,
            nsfw_classifier=_STUB_NSFW,
            total_budget_seconds=0.01,  # 10 ms — expires quickly
            _generate_fn=_always_succeed_generate,
            _score_fn=_always_nsfw_reject_score,
        )


@pytest.mark.unit
def test_budget_exhausted_error_retry_count_is_int() -> None:
    """GenerationBudgetExhaustedError.retry_count must be an integer >= 0."""
    with pytest.raises(GenerationBudgetExhaustedError) as exc_info:
        orchestrate_generation(
            _MINIMAL_CONFIG,
            _FAKE_SELFIE,
            api_key=_TEST_API_KEY,
            nsfw_classifier=_STUB_NSFW,
            total_budget_seconds=0.01,
            _generate_fn=_always_succeed_generate,
            _score_fn=_always_nsfw_reject_score,
        )

    assert isinstance(exc_info.value.retry_count, int)
    assert exc_info.value.retry_count >= 0


@pytest.mark.unit
def test_budget_exhausted_error_last_reject_reason_set() -> None:
    """After at least one rejection, last_reject_reason reflects the rejection reason."""
    with pytest.raises(GenerationBudgetExhaustedError) as exc_info:
        orchestrate_generation(
            _MINIMAL_CONFIG,
            _FAKE_SELFIE,
            api_key=_TEST_API_KEY,
            nsfw_classifier=_STUB_NSFW,
            total_budget_seconds=0.01,
            _generate_fn=_always_succeed_generate,
            _score_fn=_always_nsfw_reject_score,
        )

    # At least one rejection must have set last_reject_reason.
    assert exc_info.value.last_reject_reason in ("nsfw", "artifact", "nsfw+artifact")


# ---------------------------------------------------------------------------
# 4. Budget exhausted on entry (before any attempt)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_negative_budget_raises_immediately() -> None:
    """A negative total_budget_seconds raises GenerationBudgetExhaustedError before any attempt."""
    call_count: list[int] = [0]

    def _counting_generate(
        config: FalGenerationConfig,
        selfie_bytes: bytes,
        *,
        api_key: str,
        timeout: float,
    ) -> bytes:
        call_count[0] += 1
        return _FAKE_RESULT

    with pytest.raises(GenerationBudgetExhaustedError) as exc_info:
        orchestrate_generation(
            _MINIMAL_CONFIG,
            _FAKE_SELFIE,
            api_key=_TEST_API_KEY,
            nsfw_classifier=_STUB_NSFW,
            total_budget_seconds=-1.0,  # already expired
            _generate_fn=_counting_generate,
            _score_fn=_always_pass_score,
        )

    # No attempt should have been made.
    assert call_count[0] == 0
    assert exc_info.value.retry_count == 0
    assert exc_info.value.last_reject_reason is None


# ---------------------------------------------------------------------------
# 5. Non-retryable FalGenerationError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_non_retryable_error_propagates_immediately() -> None:
    """A non-retryable FalGenerationError must propagate without retry."""
    with pytest.raises(FalGenerationError) as exc_info:
        orchestrate_generation(
            _MINIMAL_CONFIG,
            _FAKE_SELFIE,
            api_key=_TEST_API_KEY,
            nsfw_classifier=_STUB_NSFW,
            _generate_fn=_always_permanent_fail_generate,
            _score_fn=_always_pass_score,
        )

    assert exc_info.value.retryable is False


@pytest.mark.unit
def test_non_retryable_error_not_wrapped_in_budget_error() -> None:
    """A non-retryable FalGenerationError must NOT be wrapped as GenerationBudgetExhaustedError."""
    # Must raise FalGenerationError specifically, not the budget error subtype.
    with pytest.raises(FalGenerationError):
        orchestrate_generation(
            _MINIMAL_CONFIG,
            _FAKE_SELFIE,
            api_key=_TEST_API_KEY,
            nsfw_classifier=_STUB_NSFW,
            _generate_fn=_always_permanent_fail_generate,
            _score_fn=_always_pass_score,
        )

    # Verify GenerationBudgetExhaustedError was NOT raised.
    try:
        orchestrate_generation(
            _MINIMAL_CONFIG,
            _FAKE_SELFIE,
            api_key=_TEST_API_KEY,
            nsfw_classifier=_STUB_NSFW,
            _generate_fn=_always_permanent_fail_generate,
            _score_fn=_always_pass_score,
        )
    except FalGenerationError:
        pass  # expected
    except GenerationBudgetExhaustedError:
        pytest.fail(
            "GenerationBudgetExhaustedError raised; expected FalGenerationError"
        )


@pytest.mark.unit
def test_non_retryable_error_score_fn_not_called() -> None:
    """When a non-retryable error occurs, the score function is never called."""
    score_call_count: list[int] = [0]

    def _counting_score(
        image_input: bytes | str,
        *,
        nsfw_classifier: NsfwClassifier,
    ) -> RejectionVerdict:
        score_call_count[0] += 1
        return _PASSING_VERDICT

    with pytest.raises(FalGenerationError):
        orchestrate_generation(
            _MINIMAL_CONFIG,
            _FAKE_SELFIE,
            api_key=_TEST_API_KEY,
            nsfw_classifier=_STUB_NSFW,
            _generate_fn=_always_permanent_fail_generate,
            _score_fn=_counting_score,
        )

    assert score_call_count[0] == 0


# ---------------------------------------------------------------------------
# 6. Retryable FalGenerationError → retry within budget
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_retryable_error_then_success_returns_result() -> None:
    """After one retryable failure, the second attempt succeeds."""
    generate_stub = _make_fail_then_succeed_generate(fail_count=1, retryable=True)

    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        total_budget_seconds=30.0,
        _generate_fn=generate_stub,
        _score_fn=_always_pass_score,
    )

    assert isinstance(result, OrchestrationResult)
    assert result.image_bytes == _FAKE_RESULT


@pytest.mark.unit
def test_retryable_error_increments_retry_count() -> None:
    """Each retryable generation failure increments retry_count by 1."""
    fail_count = 2
    generate_stub = _make_fail_then_succeed_generate(fail_count=fail_count, retryable=True)

    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        total_budget_seconds=30.0,
        _generate_fn=generate_stub,
        _score_fn=_always_pass_score,
    )

    assert result.retry_count == fail_count


@pytest.mark.unit
def test_retryable_error_budget_exhausted_raises() -> None:
    """When retryable errors exhaust the budget, raise GenerationBudgetExhaustedError."""
    with pytest.raises(GenerationBudgetExhaustedError):
        orchestrate_generation(
            _MINIMAL_CONFIG,
            _FAKE_SELFIE,
            api_key=_TEST_API_KEY,
            nsfw_classifier=_STUB_NSFW,
            total_budget_seconds=0.01,  # expires quickly
            _generate_fn=_always_retryable_fail_generate,
            _score_fn=_always_pass_score,
        )


@pytest.mark.unit
def test_retryable_error_budget_exhausted_retry_count_positive() -> None:
    """After retryable errors exhaust budget, retry_count must be >= 1."""
    with pytest.raises(GenerationBudgetExhaustedError) as exc_info:
        orchestrate_generation(
            _MINIMAL_CONFIG,
            _FAKE_SELFIE,
            api_key=_TEST_API_KEY,
            nsfw_classifier=_STUB_NSFW,
            total_budget_seconds=0.01,
            _generate_fn=_always_retryable_fail_generate,
            _score_fn=_always_pass_score,
        )

    assert exc_info.value.retry_count >= 1


# ---------------------------------------------------------------------------
# 7. OrchestrationResult is frozen
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_orchestration_result_is_frozen() -> None:
    """OrchestrationResult must be immutable (frozen dataclass)."""
    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        _generate_fn=_always_succeed_generate,
        _score_fn=_always_pass_score,
    )

    with pytest.raises((AttributeError, TypeError)):
        result.retry_count = 99  # type: ignore[misc]


@pytest.mark.unit
def test_orchestration_result_image_bytes_frozen() -> None:
    """OrchestrationResult.image_bytes must not be reassignable."""
    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        _generate_fn=_always_succeed_generate,
        _score_fn=_always_pass_score,
    )

    with pytest.raises((AttributeError, TypeError)):
        result.image_bytes = b"mutated"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# 8. GenerationBudgetExhaustedError attributes
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_budget_exhausted_error_is_exception() -> None:
    """GenerationBudgetExhaustedError must be a subclass of Exception."""
    err = GenerationBudgetExhaustedError("test", retry_count=0)
    assert isinstance(err, Exception)


@pytest.mark.unit
def test_budget_exhausted_error_default_last_reject_reason_none() -> None:
    """GenerationBudgetExhaustedError defaults to last_reject_reason=None."""
    err = GenerationBudgetExhaustedError("test", retry_count=0)
    assert err.last_reject_reason is None


@pytest.mark.unit
def test_budget_exhausted_error_explicit_reject_reason() -> None:
    """GenerationBudgetExhaustedError stores the supplied last_reject_reason."""
    err = GenerationBudgetExhaustedError(
        "test", retry_count=3, last_reject_reason="nsfw"
    )
    assert err.last_reject_reason == "nsfw"
    assert err.retry_count == 3


@pytest.mark.unit
def test_budget_exhausted_error_str_contains_message() -> None:
    """GenerationBudgetExhaustedError message is accessible via str()."""
    err = GenerationBudgetExhaustedError("budget gone", retry_count=1)
    assert "budget gone" in str(err)


# ---------------------------------------------------------------------------
# 9. Argument forwarding
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_api_key_forwarded_to_generate_fn() -> None:
    """The api_key must be forwarded verbatim to _generate_fn."""
    received_keys: list[str] = []

    def _capturing_generate(
        config: FalGenerationConfig,
        selfie_bytes: bytes,
        *,
        api_key: str,
        timeout: float,
    ) -> bytes:
        received_keys.append(api_key)
        return _FAKE_RESULT

    orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        _generate_fn=_capturing_generate,
        _score_fn=_always_pass_score,
    )

    assert received_keys == [_TEST_API_KEY]


@pytest.mark.unit
def test_config_forwarded_to_generate_fn() -> None:
    """The recipe config must be forwarded verbatim to _generate_fn."""
    received_configs: list[FalGenerationConfig] = []

    def _capturing_generate(
        config: FalGenerationConfig,
        selfie_bytes: bytes,
        *,
        api_key: str,
        timeout: float,
    ) -> bytes:
        received_configs.append(config)
        return _FAKE_RESULT

    orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        _generate_fn=_capturing_generate,
        _score_fn=_always_pass_score,
    )

    assert received_configs == [_MINIMAL_CONFIG]


@pytest.mark.unit
def test_selfie_bytes_forwarded_to_generate_fn() -> None:
    """The selfie bytes must be forwarded verbatim to _generate_fn."""
    received_selfies: list[bytes] = []

    def _capturing_generate(
        config: FalGenerationConfig,
        selfie_bytes: bytes,
        *,
        api_key: str,
        timeout: float,
    ) -> bytes:
        received_selfies.append(selfie_bytes)
        return _FAKE_RESULT

    orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        _generate_fn=_capturing_generate,
        _score_fn=_always_pass_score,
    )

    assert received_selfies == [_FAKE_SELFIE]


@pytest.mark.unit
def test_timeout_passed_to_generate_fn_is_positive() -> None:
    """The timeout forwarded to _generate_fn must be positive."""
    received_timeouts: list[float] = []

    def _capturing_generate(
        config: FalGenerationConfig,
        selfie_bytes: bytes,
        *,
        api_key: str,
        timeout: float,
    ) -> bytes:
        received_timeouts.append(timeout)
        return _FAKE_RESULT

    orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        total_budget_seconds=30.0,
        _generate_fn=_capturing_generate,
        _score_fn=_always_pass_score,
    )

    assert len(received_timeouts) == 1
    assert received_timeouts[0] > 0


@pytest.mark.unit
def test_timeout_passed_to_generate_fn_does_not_exceed_budget() -> None:
    """The timeout forwarded to _generate_fn must be <= total_budget_seconds."""
    received_timeouts: list[float] = []
    total_budget = 30.0

    def _capturing_generate(
        config: FalGenerationConfig,
        selfie_bytes: bytes,
        *,
        api_key: str,
        timeout: float,
    ) -> bytes:
        received_timeouts.append(timeout)
        return _FAKE_RESULT

    orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        total_budget_seconds=total_budget,
        _generate_fn=_capturing_generate,
        _score_fn=_always_pass_score,
    )

    assert received_timeouts[0] <= total_budget


@pytest.mark.unit
def test_nsfw_classifier_forwarded_to_score_fn() -> None:
    """The nsfw_classifier must be forwarded verbatim to _score_fn."""
    received_classifiers: list[NsfwClassifier] = []

    def _capturing_score(
        image_input: bytes | str,
        *,
        nsfw_classifier: NsfwClassifier,
    ) -> RejectionVerdict:
        received_classifiers.append(nsfw_classifier)
        return _PASSING_VERDICT

    stub_classifier = StubNsfwClassifier(score=0.05)

    orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=stub_classifier,
        _generate_fn=_always_succeed_generate,
        _score_fn=_capturing_score,
    )

    assert len(received_classifiers) == 1
    assert received_classifiers[0] is stub_classifier


@pytest.mark.unit
def test_generated_bytes_forwarded_to_score_fn() -> None:
    """The raw bytes from _generate_fn must be forwarded verbatim to _score_fn."""
    received_inputs: list[bytes | str] = []

    def _capturing_score(
        image_input: bytes | str,
        *,
        nsfw_classifier: NsfwClassifier,
    ) -> RejectionVerdict:
        received_inputs.append(image_input)
        return _PASSING_VERDICT

    orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        _generate_fn=_always_succeed_generate,
        _score_fn=_capturing_score,
    )

    assert received_inputs == [_FAKE_RESULT]


# ---------------------------------------------------------------------------
# 10. Mixed rejection and generation failure scenario
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_rejection_then_retryable_error_then_success() -> None:
    """Score rejection followed by generation error followed by success works correctly."""
    generate_calls: list[int] = [0]
    score_calls: list[int] = [0]

    def _mixed_generate(
        config: FalGenerationConfig,
        selfie_bytes: bytes,
        *,
        api_key: str,
        timeout: float,
    ) -> bytes:
        generate_calls[0] += 1
        if generate_calls[0] == 2:
            # Second generate call fails with a retryable error.
            raise FalGenerationError("transient", retryable=True)
        return _FAKE_RESULT

    def _reject_first_score(
        image_input: bytes | str,
        *,
        nsfw_classifier: NsfwClassifier,
    ) -> RejectionVerdict:
        score_calls[0] += 1
        if score_calls[0] == 1:
            return _NSFW_VERDICT  # first scored image rejected
        return _PASSING_VERDICT  # second scored image passes

    result = orchestrate_generation(
        _MINIMAL_CONFIG,
        _FAKE_SELFIE,
        api_key=_TEST_API_KEY,
        nsfw_classifier=_STUB_NSFW,
        total_budget_seconds=30.0,
        _generate_fn=_mixed_generate,
        _score_fn=_reject_first_score,
    )

    # 3 generate calls: 1 (rejected) + 2 (retryable error) + 3 (success)
    # 2 score calls: 1 (rejected) + 2 (passed)
    assert generate_calls[0] == 3
    assert score_calls[0] == 2
    assert result.retry_count == 2
    assert result.last_verdict.passed is True
