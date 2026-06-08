"""AC12: user_pick — surviving candidates + end user final selection.

Acceptance criteria verified
-----------------------------
AC12: reject 필터 통과 생존 후보 목록 노출 + end user 최종 1장 선택 API.
      operator 개입 없음. 생존 후보 0개 시 'no survivors' 응답.
"""

from __future__ import annotations

import pytest

from api.generation.reject_filter import ScoredCandidate
from api.generation.user_pick import (
    UserPickResult,
    get_surviving_candidates,
    pick_candidate,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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
# AC12: surviving candidate pool
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_surviving_candidates_returns_all_passed_candidates() -> None:
    """get_surviving_candidates returns the full pool passed to it."""
    survivors = [_candidate(0), _candidate(1), _candidate(2)]
    result = get_surviving_candidates(survivors)
    assert len(result) == 3
    assert result == survivors


@pytest.mark.unit
def test_get_surviving_candidates_empty_returns_empty() -> None:
    """Empty survivor pool returns empty list."""
    assert get_surviving_candidates([]) == []


# ---------------------------------------------------------------------------
# AC12: pick_candidate — successful selection
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_pick_candidate_returns_correct_candidate() -> None:
    """End user picks candidate_index=1 from [0, 1, 2] pool."""
    survivors = [_candidate(0), _candidate(1), _candidate(2)]
    result = pick_candidate(survivors, picked_index=1)

    assert result.success is True
    assert result.no_survivors is False
    assert result.picked_candidate is not None
    assert result.picked_candidate.candidate_index == 1


@pytest.mark.unit
def test_pick_candidate_first_in_pool() -> None:
    """User can pick the first candidate."""
    survivors = [_candidate(0), _candidate(1)]
    result = pick_candidate(survivors, picked_index=0)
    assert result.success is True
    assert result.picked_candidate.candidate_index == 0


@pytest.mark.unit
def test_pick_candidate_last_in_pool() -> None:
    """User can pick the last candidate."""
    survivors = [_candidate(0), _candidate(3), _candidate(7)]
    result = pick_candidate(survivors, picked_index=7)
    assert result.success is True
    assert result.picked_candidate.candidate_index == 7


# ---------------------------------------------------------------------------
# AC12: no survivors → 'no survivors' response
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_empty_pool_returns_no_survivors_result() -> None:
    """0 surviving candidates → no_survivors=True in result."""
    result = pick_candidate([], picked_index=0)

    assert result.success is False
    assert result.no_survivors is True
    assert result.picked_candidate is None
    assert result.suggest_regeneration is True


# ---------------------------------------------------------------------------
# AC12: invalid picked_index raises ValueError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_invalid_picked_index_raises_value_error() -> None:
    """Picking a non-existent candidate_index raises ValueError."""
    survivors = [_candidate(0), _candidate(1)]
    with pytest.raises(ValueError, match="candidate_index=99"):
        pick_candidate(survivors, picked_index=99)


# ---------------------------------------------------------------------------
# AC12: operator has no intervention (pick is pure user choice)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_pick_result_has_no_operator_field() -> None:
    """UserPickResult has no operator-intervention field."""
    result = pick_candidate([_candidate(0)], picked_index=0)
    # UserPickResult should not have an 'operator' or 'operator_override' field
    assert not hasattr(result, "operator")
    assert not hasattr(result, "operator_override")
    assert not hasattr(result, "curated_by_operator")
