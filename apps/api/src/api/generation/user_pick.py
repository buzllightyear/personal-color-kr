"""User pick service — end user selects one surviving candidate (AC12).

Seed constraints honored here
------------------------------
- Survivors = candidates that passed reject_filter.
- End user selects exactly 1 from surviving candidates.
- Operator has NO intervention in user pick.
- 0 survivors → 'no_survivors' response + re-generation suggestion flag.
- No pipeline stage bypass.
"""

from __future__ import annotations

from dataclasses import dataclass

from api.generation.reject_filter import ScoredCandidate


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class UserPickResult:
    """Result of a user pick operation.

    Attributes
    ----------
    success:
        True when a candidate was successfully picked.
    picked_candidate:
        The selected candidate (None when no survivors).
    no_survivors:
        True when the candidate pool was empty.
    suggest_regeneration:
        True when the user should be prompted to re-generate.
    """

    success: bool
    picked_candidate: ScoredCandidate | None
    no_survivors: bool
    suggest_regeneration: bool


# ---------------------------------------------------------------------------
# No survivors response
# ---------------------------------------------------------------------------

_NO_SURVIVORS_RESULT = UserPickResult(
    success=False,
    picked_candidate=None,
    no_survivors=True,
    suggest_regeneration=True,
)


# ---------------------------------------------------------------------------
# User pick service
# ---------------------------------------------------------------------------


def get_surviving_candidates(
    candidates: list[ScoredCandidate],
) -> list[ScoredCandidate]:
    """Return the list of surviving candidates for user pick.

    Candidates should have already passed the reject_filter before being
    passed here. This function returns them for display to the end user.

    Parameters
    ----------
    candidates:
        Post-reject-filter surviving candidates.

    Returns
    -------
    list[ScoredCandidate]
        Surviving candidates (may be empty).
    """
    return list(candidates)


def pick_candidate(
    candidates: list[ScoredCandidate],
    picked_index: int,
) -> UserPickResult:
    """End user selects one candidate from the surviving pool.

    No operator intervention — this is the user's autonomous choice.

    Parameters
    ----------
    candidates:
        Post-reject-filter surviving candidates.
    picked_index:
        candidate_index of the chosen ScoredCandidate.

    Returns
    -------
    UserPickResult
        Success result with the picked candidate, or no_survivors result
        if the pool is empty.

    Raises
    ------
    ValueError
        If picked_index does not match any surviving candidate.
    """
    if not candidates:
        return _NO_SURVIVORS_RESULT

    # Find the candidate with the specified candidate_index
    matching = [c for c in candidates if c.candidate_index == picked_index]
    if not matching:
        raise ValueError(
            f"No surviving candidate with candidate_index={picked_index}. "
            f"Available indices: {[c.candidate_index for c in candidates]}"
        )

    return UserPickResult(
        success=True,
        picked_candidate=matching[0],
        no_survivors=False,
        suggest_regeneration=False,
    )


__all__ = [
    "UserPickResult",
    "get_surviving_candidates",
    "pick_candidate",
]
