"""AC22: generation_candidate 점수 저장 검증.

Acceptance criteria verified
-----------------------------
AC22: reject_filter 실행 후 candidate에 identity_similarity_score·artifact_score·
      uncanny_score 3개 값이 저장되어 있음을 검증.
      사후 조회 API로 특정 candidate의 reject 사유(어떤 차원에서 미달했는지) 확인 가능.

Key invariants
--------------
1. After annotate_candidates() runs, ALL candidates (survivors + rejected) have
   their 3 scores permanently stored.
2. reject_filter_passed=True if and only if all 3 scores >= thresholds.
3. rejected_dimensions is a tuple naming every dimension that failed.
4. An empty rejected_dimensions means the candidate passed all dimensions.
5. InMemoryCandidateStore.get_rejected_dimensions(candidate_index) returns the
   exact rejected dimension names for any stored candidate.
6. Candidates that PASSED have reject_filter_passed=True and
   rejected_dimensions=().
7. Candidates that FAILED have reject_filter_passed=False and non-empty
   rejected_dimensions.
8. apply_reject_filter returns ONLY survivors (those with reject_filter_passed=True),
   but InMemoryCandidateStore retains ALL candidates for audit.
9. The 3 scores are stored on the candidate object (not ephemeral — not just in
   filter return value).
"""

from __future__ import annotations

import pytest

from api.generation.reject_filter import (
    InMemoryCandidateStore,
    RejectConfig,
    ScoredCandidate,
    annotate_candidates,
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
    idx: int,
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
# AC22 core: 3 scores present on candidate after filter
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_three_scores_stored_on_candidate_after_annotate() -> None:
    """After annotate_candidates(), all 3 scores remain accessible on the candidate.

    This verifies that identity_similarity_score, artifact_score, and uncanny_score
    are permanently stored on the candidate object — not computed on-the-fly.
    """
    candidate = _candidate(0, identity=0.7, artifact=0.8, uncanny=0.6)
    annotated = annotate_candidates([candidate], _CONFIG)

    assert len(annotated) == 1
    c = annotated[0]
    assert c.identity_similarity_score == 0.7
    assert c.artifact_score == 0.8
    assert c.uncanny_score == 0.6


@pytest.mark.unit
def test_scores_are_stored_attributes_not_properties() -> None:
    """All 3 scores are stored data attributes on ScoredCandidate."""
    candidate = _candidate(0, identity=0.55, artifact=0.72, uncanny=0.81)
    # Scores must be directly readable as object attributes
    assert candidate.identity_similarity_score == 0.55
    assert candidate.artifact_score == 0.72
    assert candidate.uncanny_score == 0.81


# ---------------------------------------------------------------------------
# AC22: reject_filter_passed stored on passing candidate
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_reject_filter_passed_true_for_passing_candidate() -> None:
    """Candidate passing all 3 dimensions has reject_filter_passed=True."""
    candidate = _candidate(0, identity=0.9, artifact=0.9, uncanny=0.9)
    annotated = annotate_candidates([candidate], _CONFIG)

    assert annotated[0].reject_filter_passed is True


@pytest.mark.unit
def test_reject_filter_passed_false_for_failing_candidate() -> None:
    """Candidate failing at least 1 dimension has reject_filter_passed=False."""
    candidate = _candidate(0, identity=0.3, artifact=0.9, uncanny=0.9)
    annotated = annotate_candidates([candidate], _CONFIG)

    assert annotated[0].reject_filter_passed is False


# ---------------------------------------------------------------------------
# AC22: rejected_dimensions names the failing dimensions
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_rejected_dimensions_empty_for_passing_candidate() -> None:
    """Passing candidate has empty rejected_dimensions tuple."""
    candidate = _candidate(0, identity=0.9, artifact=0.9, uncanny=0.9)
    annotated = annotate_candidates([candidate], _CONFIG)

    assert annotated[0].rejected_dimensions == ()


@pytest.mark.unit
def test_rejected_dimensions_names_identity_failure() -> None:
    """identity_similarity_score failure appears in rejected_dimensions."""
    candidate = _candidate(0, identity=0.3, artifact=0.9, uncanny=0.9)
    annotated = annotate_candidates([candidate], _CONFIG)

    assert "identity_similarity_score" in annotated[0].rejected_dimensions


@pytest.mark.unit
def test_rejected_dimensions_names_artifact_failure() -> None:
    """artifact_score failure appears in rejected_dimensions."""
    candidate = _candidate(0, identity=0.9, artifact=0.3, uncanny=0.9)
    annotated = annotate_candidates([candidate], _CONFIG)

    assert "artifact_score" in annotated[0].rejected_dimensions


@pytest.mark.unit
def test_rejected_dimensions_names_uncanny_failure() -> None:
    """uncanny_score failure appears in rejected_dimensions."""
    candidate = _candidate(0, identity=0.9, artifact=0.9, uncanny=0.1)
    annotated = annotate_candidates([candidate], _CONFIG)

    assert "uncanny_score" in annotated[0].rejected_dimensions


@pytest.mark.unit
def test_rejected_dimensions_names_all_three_failures() -> None:
    """All 3 failing dimensions appear in rejected_dimensions."""
    candidate = _candidate(0, identity=0.1, artifact=0.1, uncanny=0.1)
    annotated = annotate_candidates([candidate], _CONFIG)

    dims = set(annotated[0].rejected_dimensions)
    assert "identity_similarity_score" in dims
    assert "artifact_score" in dims
    assert "uncanny_score" in dims
    assert len(dims) == 3


# ---------------------------------------------------------------------------
# AC22: post-hoc lookup via InMemoryCandidateStore
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_candidate_store_retrieves_scores_after_filter() -> None:
    """InMemoryCandidateStore allows post-hoc score retrieval by candidate_index."""
    candidates = [
        _candidate(0, identity=0.9, artifact=0.9, uncanny=0.9),  # PASS
        _candidate(1, identity=0.3, artifact=0.9, uncanny=0.9),  # FAIL identity
    ]

    store = InMemoryCandidateStore()
    annotated = annotate_candidates(candidates, _CONFIG)
    store.store_all(annotated)

    # Retrieve stored scores for candidate 0
    c0 = store.get_by_index(0)
    assert c0 is not None
    assert c0.identity_similarity_score == 0.9
    assert c0.artifact_score == 0.9
    assert c0.uncanny_score == 0.9

    # Retrieve stored scores for candidate 1 (rejected)
    c1 = store.get_by_index(1)
    assert c1 is not None
    assert c1.identity_similarity_score == 0.3


@pytest.mark.unit
def test_store_get_rejected_dimensions_returns_failure_names() -> None:
    """get_rejected_dimensions() returns the dimension names that caused rejection."""
    candidates = [
        _candidate(0, identity=0.3, artifact=0.9, uncanny=0.9),  # FAIL identity
    ]
    store = InMemoryCandidateStore()
    annotated = annotate_candidates(candidates, _CONFIG)
    store.store_all(annotated)

    dims = store.get_rejected_dimensions(0)
    assert dims is not None
    assert "identity_similarity_score" in dims


@pytest.mark.unit
def test_store_get_rejected_dimensions_empty_for_passing_candidate() -> None:
    """get_rejected_dimensions() returns empty tuple for passing candidates."""
    candidates = [_candidate(0, identity=0.9, artifact=0.9, uncanny=0.9)]
    store = InMemoryCandidateStore()
    annotated = annotate_candidates(candidates, _CONFIG)
    store.store_all(annotated)

    dims = store.get_rejected_dimensions(0)
    assert dims == ()


@pytest.mark.unit
def test_store_returns_none_for_unknown_candidate() -> None:
    """get_by_index() returns None for unknown candidate_index."""
    store = InMemoryCandidateStore()
    assert store.get_by_index(99) is None
    assert store.get_rejected_dimensions(99) is None


@pytest.mark.unit
def test_store_retains_all_candidates_including_rejected() -> None:
    """InMemoryCandidateStore retains ALL candidates, not just survivors."""
    candidates = [
        _candidate(0, identity=0.9, artifact=0.9, uncanny=0.9),  # PASS
        _candidate(1, identity=0.1, artifact=0.1, uncanny=0.1),  # FAIL all
        _candidate(2, identity=0.8, artifact=0.7, uncanny=0.6),  # PASS
    ]

    store = InMemoryCandidateStore()
    annotated = annotate_candidates(candidates, _CONFIG)
    store.store_all(annotated)

    # All 3 must be retrievable
    assert store.get_by_index(0) is not None
    assert store.get_by_index(1) is not None  # rejected but still stored
    assert store.get_by_index(2) is not None

    # apply_reject_filter returns only survivors (2 in this case)
    survivors = apply_reject_filter(candidates, _CONFIG)
    assert len(survivors) == 2

    # But store has all 3
    all_candidates = store.all_candidates()
    assert len(all_candidates) == 3


# ---------------------------------------------------------------------------
# AC22: apply_reject_filter survivors have reject_filter_passed=True
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_reject_filter_survivors_have_reject_filter_passed_true() -> None:
    """Every candidate returned by apply_reject_filter has reject_filter_passed=True."""
    candidates = [
        _candidate(0, identity=0.9, artifact=0.9, uncanny=0.9),  # PASS
        _candidate(1, identity=0.3, artifact=0.9, uncanny=0.9),  # FAIL
        _candidate(2, identity=0.8, artifact=0.8, uncanny=0.8),  # PASS
    ]

    survivors = apply_reject_filter(candidates, _CONFIG)

    for s in survivors:
        assert s.reject_filter_passed is True, (
            f"Survivor candidate_index={s.candidate_index} has "
            f"reject_filter_passed={s.reject_filter_passed}, expected True."
        )


@pytest.mark.unit
def test_apply_reject_filter_survivors_have_empty_rejected_dimensions() -> None:
    """Every survivor has empty rejected_dimensions (passed all 3 dimensions)."""
    candidates = [
        _candidate(0, identity=0.9, artifact=0.9, uncanny=0.9),
        _candidate(1, identity=0.8, artifact=0.7, uncanny=0.6),
    ]

    survivors = apply_reject_filter(candidates, _CONFIG)

    for s in survivors:
        assert s.rejected_dimensions == (), (
            f"Survivor candidate_index={s.candidate_index} has non-empty "
            f"rejected_dimensions={s.rejected_dimensions!r}, expected ()."
        )


# ---------------------------------------------------------------------------
# AC22: annotate_candidates is independent of apply_reject_filter
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_annotate_candidates_returns_all_including_rejected() -> None:
    """annotate_candidates returns ALL candidates (survivors + rejected)."""
    candidates = [
        _candidate(0, identity=0.9, artifact=0.9, uncanny=0.9),  # PASS
        _candidate(1, identity=0.1, artifact=0.1, uncanny=0.1),  # FAIL all
    ]

    all_annotated = annotate_candidates(candidates, _CONFIG)
    survivors = apply_reject_filter(candidates, _CONFIG)

    # annotate_candidates returns 2, apply_reject_filter returns 1
    assert len(all_annotated) == 2
    assert len(survivors) == 1

    # The rejected candidate is in annotated but NOT in survivors
    reject_indices = {
        c.candidate_index for c in all_annotated if not c.reject_filter_passed
    }
    survivor_indices = {c.candidate_index for c in survivors}
    assert 1 in reject_indices
    assert 1 not in survivor_indices
