"""AC2: 생짜 경로 차단 게이트 — enhanced_image_ref null 체크 통합 테스트.

Acceptance criteria verified
-----------------------------
AC2: enhanced_image_ref가 null인 candidate를 output gate에 전달하면 거부 응답.
     enhanced_image_ref 존재 자체가 경유 증거 (boolean 플래그 아님).

Key invariants
--------------
1. require_enhanced_scored_candidate() rejects a ScoredCandidate where
   enhanced_image_ref is None — this means the candidate was NOT routed
   through the enhancer.
2. require_enhanced_scored_candidate() passes a ScoredCandidate where
   enhanced_image_ref is non-null (structural proof of enhancer passage).
3. The proof is the EXISTENCE (non-nullness) of enhanced_image_ref — not a
   boolean flag like is_enhanced=True/False.
4. RawOutputError is raised with a message mentioning enhanced_image_ref.
5. Non-ScoredCandidate types also raise RawOutputError.

This is an integration test: it tests the coordination between ScoredCandidate
(reject_filter module) and require_enhanced_scored_candidate (output_gate module).
"""

from __future__ import annotations

import pytest

from api.generation.output_gate import (
    RawOutputError,
    require_enhanced_scored_candidate,
)
from api.generation.reject_filter import ScoredCandidate


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _scored_candidate(
    enhanced_image_ref: str | None,
    candidate_index: int = 0,
) -> ScoredCandidate:
    return ScoredCandidate(
        candidate_index=candidate_index,
        enhanced_image_ref=enhanced_image_ref,
        identity_similarity_score=0.9,
        artifact_score=0.9,
        uncanny_score=0.9,
    )


# ---------------------------------------------------------------------------
# AC2 core: enhanced_image_ref=None is rejected
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_scored_candidate_with_null_enhanced_image_ref_is_rejected() -> None:
    """ScoredCandidate with enhanced_image_ref=None raises RawOutputError.

    This is the canonical AC2 assertion:
        "enhanced_image_ref가 null인 candidate를 output gate에 전달하면 거부 응답"
        (Passing a candidate with null enhanced_image_ref to the output gate
         results in a rejection response).

    A null enhanced_image_ref means the candidate was NOT routed through the
    enhancer — it is raw, unenhanced AI output.
    """
    candidate = _scored_candidate(enhanced_image_ref=None)

    with pytest.raises(RawOutputError):
        require_enhanced_scored_candidate(candidate)


# ---------------------------------------------------------------------------
# AC2: non-null enhanced_image_ref passes gate
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_scored_candidate_with_non_null_enhanced_image_ref_passes() -> None:
    """ScoredCandidate with non-null enhanced_image_ref passes the gate.

    "enhanced_image_ref 존재 자체가 경유 증거" — the presence (non-nullness)
    of enhanced_image_ref is the proof of enhancer passage.
    """
    candidate = _scored_candidate(enhanced_image_ref="enhanced://bucket/image_0.jpg")

    result = require_enhanced_scored_candidate(candidate)

    assert result is candidate, (
        "require_enhanced_scored_candidate must return the same candidate "
        "unchanged when enhanced_image_ref is non-null."
    )


# ---------------------------------------------------------------------------
# AC2: structural proof is existence, not a boolean flag
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_proof_is_enhanced_image_ref_existence_not_boolean_flag() -> None:
    """The proof of enhancer passage is enhanced_image_ref (non-null), not a flag.

    This test verifies that:
    1. ScoredCandidate does NOT have an is_enhanced boolean field
    2. The gate checks enhanced_image_ref is not None (structural proof)
    """
    candidate_with_ref = _scored_candidate(enhanced_image_ref="s3://bucket/img.jpg")
    candidate_without_ref = _scored_candidate(enhanced_image_ref=None)

    # Verify no boolean flag field exists on ScoredCandidate
    assert not hasattr(candidate_with_ref, "is_enhanced"), (
        "ScoredCandidate must not have an is_enhanced boolean flag. "
        "The proof is enhanced_image_ref existence (AC2 constraint)."
    )
    assert not hasattr(candidate_with_ref, "enhancer_applied"), (
        "ScoredCandidate must not have an enhancer_applied boolean flag."
    )

    # Non-null enhanced_image_ref → passes
    result = require_enhanced_scored_candidate(candidate_with_ref)
    assert result is candidate_with_ref

    # None enhanced_image_ref → rejected
    with pytest.raises(RawOutputError):
        require_enhanced_scored_candidate(candidate_without_ref)


# ---------------------------------------------------------------------------
# AC2: error message mentions enhanced_image_ref
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_error_message_mentions_enhanced_image_ref() -> None:
    """RawOutputError message mentions enhanced_image_ref for diagnosis."""
    candidate = _scored_candidate(enhanced_image_ref=None)

    with pytest.raises(RawOutputError, match="enhanced_image_ref"):
        require_enhanced_scored_candidate(candidate)


# ---------------------------------------------------------------------------
# AC2: non-ScoredCandidate types also rejected
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "non_candidate",
    [
        b"raw fal.ai output",
        "raw string",
        None,
        42,
        {"enhanced_image_ref": "fake"},  # dict with the field name — still rejected
    ],
    ids=["bytes", "str", "None", "int", "dict_with_key"],
)
def test_non_scored_candidate_types_rejected(non_candidate: object) -> None:
    """Non-ScoredCandidate types raise RawOutputError at the gate."""
    with pytest.raises(RawOutputError):
        require_enhanced_scored_candidate(non_candidate)


# ---------------------------------------------------------------------------
# AC2: RawOutputError is a proper exception
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_raw_output_error_is_exception_subclass() -> None:
    """RawOutputError inherits from Exception."""
    assert issubclass(RawOutputError, Exception)
