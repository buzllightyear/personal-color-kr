"""AC4: Automatic reject filter — 3 dimensions, score >= threshold = pass.

Acceptance criteria verified
-----------------------------
AC4: enhancer 적용 후 후보에 대해 3개 차원(identity_similarity_score,
     artifact_score, uncanny_score) 각각 score >= threshold 비교.
     미달 시 후보 제거.
     3개 차원 전부 0.0-1.0 number, 동일 비교 연산.
"""

from __future__ import annotations

import pytest

from api.generation.reject_filter import (
    RejectConfig,
    ScoredCandidate,
    apply_reject_filter,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CONFIG = RejectConfig(
    identity_threshold=0.6,
    artifact_threshold=0.6,
    uncanny_threshold=0.5,
)


def _candidate(
    idx: int = 0,
    identity: float = 0.9,
    artifact: float = 0.9,
    uncanny: float = 0.9,
) -> ScoredCandidate:
    return ScoredCandidate(
        candidate_index=idx,
        enhanced_image_ref=f"enhanced_ref_{idx}",
        identity_similarity_score=identity,
        artifact_score=artifact,
        uncanny_score=uncanny,
    )


# ---------------------------------------------------------------------------
# All-pass cases
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_all_scores_above_threshold_pass() -> None:
    """Candidate with all scores above thresholds passes the filter."""
    candidates = [_candidate(0, identity=0.9, artifact=0.9, uncanny=0.9)]
    survivors = apply_reject_filter(candidates, _CONFIG)
    assert len(survivors) == 1
    assert survivors[0].candidate_index == 0


@pytest.mark.unit
def test_scores_exactly_at_threshold_pass() -> None:
    """score == threshold is >= threshold, so candidate passes (boundary case)."""
    candidates = [
        _candidate(0, identity=0.6, artifact=0.6, uncanny=0.5)
    ]
    survivors = apply_reject_filter(candidates, _CONFIG)
    assert len(survivors) == 1


# ---------------------------------------------------------------------------
# Single-dimension rejection cases
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_identity_below_threshold_rejects_candidate() -> None:
    """Candidate with identity_similarity_score < threshold is rejected."""
    candidates = [_candidate(0, identity=0.59, artifact=0.9, uncanny=0.9)]
    survivors = apply_reject_filter(candidates, _CONFIG)
    assert len(survivors) == 0


@pytest.mark.unit
def test_artifact_below_threshold_rejects_candidate() -> None:
    """Candidate with artifact_score < threshold is rejected."""
    candidates = [_candidate(0, identity=0.9, artifact=0.59, uncanny=0.9)]
    survivors = apply_reject_filter(candidates, _CONFIG)
    assert len(survivors) == 0


@pytest.mark.unit
def test_uncanny_below_threshold_rejects_candidate() -> None:
    """Candidate with uncanny_score < threshold is rejected."""
    candidates = [_candidate(0, identity=0.9, artifact=0.9, uncanny=0.49)]
    survivors = apply_reject_filter(candidates, _CONFIG)
    assert len(survivors) == 0


# ---------------------------------------------------------------------------
# Mixed candidates: partial survival
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_mixed_candidates_only_survivors_returned() -> None:
    """Only candidates passing all 3 dimensions are returned."""
    candidates = [
        _candidate(0, identity=0.9, artifact=0.9, uncanny=0.9),  # PASS
        _candidate(1, identity=0.3, artifact=0.9, uncanny=0.9),  # FAIL identity
        _candidate(2, identity=0.9, artifact=0.3, uncanny=0.9),  # FAIL artifact
        _candidate(3, identity=0.9, artifact=0.9, uncanny=0.1),  # FAIL uncanny
        _candidate(4, identity=0.8, artifact=0.7, uncanny=0.6),  # PASS
    ]
    survivors = apply_reject_filter(candidates, _CONFIG)
    assert len(survivors) == 2
    assert {s.candidate_index for s in survivors} == {0, 4}


# ---------------------------------------------------------------------------
# All-rejected: empty survivors
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_all_candidates_rejected_returns_empty_list() -> None:
    """When all candidates fail, survivors list is empty."""
    candidates = [
        _candidate(0, identity=0.1, artifact=0.1, uncanny=0.1),
        _candidate(1, identity=0.2, artifact=0.2, uncanny=0.2),
    ]
    survivors = apply_reject_filter(candidates, _CONFIG)
    assert survivors == []


# ---------------------------------------------------------------------------
# Uniform comparison operator: same >= for all 3 dimensions
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_all_three_dimensions_use_same_gte_operator() -> None:
    """All 3 dimensions use >= comparison (not >, not <)."""
    config = RejectConfig(
        identity_threshold=0.5,
        artifact_threshold=0.5,
        uncanny_threshold=0.5,
    )
    # Exactly at threshold → passes (>= not >)
    at_threshold = _candidate(0, identity=0.5, artifact=0.5, uncanny=0.5)
    survivors = apply_reject_filter([at_threshold], config)
    assert len(survivors) == 1, "Exactly-at-threshold candidate must survive (>= semantics)"
    assert survivors[0].candidate_index == at_threshold.candidate_index
    assert survivors[0].reject_filter_passed is True

    # Just below threshold → fails
    below = _candidate(1, identity=0.49, artifact=0.5, uncanny=0.5)
    assert apply_reject_filter([below], config) == []


# ---------------------------------------------------------------------------
# Empty input
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_empty_candidate_list_returns_empty() -> None:
    """Empty input → empty output (no error)."""
    assert apply_reject_filter([], _CONFIG) == []
