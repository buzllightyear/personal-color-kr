"""AC23: segment 소속 단일 원천 검증.

Acceptance criteria verified
-----------------------------
AC23: user entity에 segment_ids 저장 필드 부재 확인(grep 0건).
      segment 소속 조회는 trend_segment.criteria → user 매칭 계산 경로만 존재.
      criteria 변경 시 소속 결과 즉시 반영 검증.

Key invariants
--------------
1. UserForSegment has NO segment_ids / assigned_segment_ids field.
2. TrendSegmentRecord has NO assigned_user_ids field.
3. Segment membership is computed ONLY by get_matching_segments(user, repo).
4. After update_criteria() changes segment criteria, the NEXT call to
   get_matching_segments() immediately reflects the new criteria — no
   stale cache of segment membership on any entity.
5. A user is in a segment if and only if the user's attributes match the
   criteria declared on that segment.
6. No segment membership data is stored on the user entity — the single
   source of truth is trend_segment.criteria.
"""

from __future__ import annotations

import subprocess
import uuid
from pathlib import Path

import pytest

from api.trend_drop.push import (
    InMemoryTrendSegmentRepository,
    SegmentCriteria,
    UserForSegment,
    get_matching_segments,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _user(
    personal_color: str = "봄",
    subscription_status: str = "active",
) -> UserForSegment:
    return UserForSegment(
        user_id=uuid.uuid4(),
        personal_color=personal_color,
        subscription_status=subscription_status,
    )


# ---------------------------------------------------------------------------
# AC23 invariant 0: grep for segment_ids field declarations = 0 in src
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_no_segment_ids_field_declaration_in_source() -> None:
    """Grep for 'segment_ids' typed field declarations returns 0 results.

    AC23 requires that no user entity stores segment_ids. This test greps
    the source tree for typed field declarations (e.g. 'segment_ids:',
    'segment_ids =') to enforce this at the code level.
    """
    src_dir = Path(__file__).parent.parent.parent / "src"

    # Grep for typed field patterns like "segment_ids:" or "segment_ids ="
    result = subprocess.run(
        ["grep", "-rn", r"segment_ids\s*[=:]", str(src_dir), "--include=*.py"],
        capture_output=True,
        text=True,
    )
    matches = result.stdout.strip()

    # Filter out comment lines (lines starting with #)
    non_comment_matches = [
        line
        for line in matches.splitlines()
        if line and not line.split(":", 2)[-1].strip().startswith("#")
    ]

    assert non_comment_matches == [], (
        "Found segment_ids field declaration(s) in source (AC23 violation):\n"
        + "\n".join(non_comment_matches)
    )


# ---------------------------------------------------------------------------
# AC23 invariant 1: UserForSegment has no segment_ids field
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_user_for_segment_has_no_segment_ids_field() -> None:
    """UserForSegment entity has NO segment_ids or assigned_segment_ids field.

    Segment membership is computed from criteria — never stored on the user.
    """
    user = _user()
    assert not hasattr(
        user, "segment_ids"
    ), "UserForSegment must not have segment_ids (AC23: no user-side storage)"
    assert not hasattr(
        user, "assigned_segment_ids"
    ), "UserForSegment must not have assigned_segment_ids (AC23 violation)"


@pytest.mark.unit
def test_trend_segment_record_has_no_assigned_user_ids_field() -> None:
    """TrendSegmentRecord has NO assigned_user_ids field.

    The segment does not store which users are in it — membership is
    computed on-demand from criteria.
    """
    repo = InMemoryTrendSegmentRepository()
    segment = repo.create("봄", SegmentCriteria(personal_color="봄"))
    assert not hasattr(
        segment, "assigned_user_ids"
    ), "TrendSegmentRecord must not have assigned_user_ids (AC23 violation)"


# ---------------------------------------------------------------------------
# AC23 invariant 2: membership is computed from criteria only
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_user_matches_segment_when_criteria_match() -> None:
    """User with matching personal_color appears in segment membership."""
    repo = InMemoryTrendSegmentRepository()
    segment = repo.create("봄 segment", SegmentCriteria(personal_color="봄"))

    user = _user(personal_color="봄")
    segments = get_matching_segments(user, repo)

    segment_ids = {s.segment_id for s in segments}
    assert segment.segment_id in segment_ids


@pytest.mark.unit
def test_user_not_in_segment_when_criteria_do_not_match() -> None:
    """User with non-matching personal_color is NOT in the segment."""
    repo = InMemoryTrendSegmentRepository()
    segment = repo.create("봄 segment", SegmentCriteria(personal_color="봄"))

    user = _user(personal_color="겨울")  # does NOT match
    segments = get_matching_segments(user, repo)

    segment_ids = {s.segment_id for s in segments}
    assert segment.segment_id not in segment_ids


@pytest.mark.unit
def test_user_in_multiple_segments_when_matching_multiple_criteria() -> None:
    """User matching multiple segment criteria appears in all matching segments."""
    repo = InMemoryTrendSegmentRepository()
    seg_color = repo.create("봄 색상", SegmentCriteria(personal_color="봄"))
    seg_active = repo.create("활성 구독", SegmentCriteria(subscription_status="active"))
    _seg_other = repo.create("겨울 색상", SegmentCriteria(personal_color="겨울"))

    user = _user(personal_color="봄", subscription_status="active")
    segments = get_matching_segments(user, repo)

    segment_ids = {s.segment_id for s in segments}
    assert seg_color.segment_id in segment_ids
    assert seg_active.segment_id in segment_ids
    # seg_other (겨울 색상) must NOT be included
    assert _seg_other.segment_id not in segment_ids


@pytest.mark.unit
def test_wildcard_segment_matches_all_users() -> None:
    """Segment with no criteria (empty SegmentCriteria) matches all users."""
    repo = InMemoryTrendSegmentRepository()
    wildcard = repo.create("전체", SegmentCriteria())  # no criteria = match all

    users = [
        _user(personal_color="봄"),
        _user(personal_color="여름"),
        _user(personal_color="가을"),
        _user(personal_color="겨울"),
    ]

    for user in users:
        segs = get_matching_segments(user, repo)
        seg_ids = {s.segment_id for s in segs}
        assert wildcard.segment_id in seg_ids, (
            f"User with personal_color={user.personal_color!r} should match "
            f"wildcard segment but did not."
        )


# ---------------------------------------------------------------------------
# AC23 invariant 3: criteria change immediately reflected (no stale cache)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_criteria_change_immediately_reflects_in_membership() -> None:
    """After update_criteria(), get_matching_segments() immediately returns new result.

    There is no cached segment membership on the user — the next call to
    get_matching_segments() uses the updated criteria.
    """
    repo = InMemoryTrendSegmentRepository()
    # Create segment for "봄" users
    segment = repo.create("봄 segment", SegmentCriteria(personal_color="봄"))

    user = _user(personal_color="봄")

    # Before criteria change: user IS in segment
    segs_before = get_matching_segments(user, repo)
    assert any(
        s.segment_id == segment.segment_id for s in segs_before
    ), "User should be in '봄 segment' before criteria change."

    # Change criteria to "겨울" — user should immediately leave the segment
    repo.update_criteria(segment.segment_id, SegmentCriteria(personal_color="겨울"))

    # After criteria change: same user is NO LONGER in segment
    segs_after = get_matching_segments(user, repo)
    assert not any(s.segment_id == segment.segment_id for s in segs_after), (
        "User should NOT be in segment after criteria changed to '겨울'. "
        "Membership must reflect current criteria, not cached membership."
    )


@pytest.mark.unit
def test_adding_user_to_segment_via_criteria_update() -> None:
    """User not in segment becomes part of it after criteria is loosened."""
    repo = InMemoryTrendSegmentRepository()
    # Narrow criteria: only "봄" active subscribers
    segment = repo.create(
        "narrow",
        SegmentCriteria(personal_color="봄", subscription_status="active"),
    )

    user = _user(personal_color="봄", subscription_status="trialing")

    # Before: user is NOT in segment (trialing, not active)
    segs_before = get_matching_segments(user, repo)
    assert not any(s.segment_id == segment.segment_id for s in segs_before)

    # Loosen criteria: remove subscription_status requirement
    repo.update_criteria(segment.segment_id, SegmentCriteria(personal_color="봄"))

    # After: user IS now in segment (only personal_color checked)
    segs_after = get_matching_segments(user, repo)
    assert any(
        s.segment_id == segment.segment_id for s in segs_after
    ), "User should now be in segment after criteria was loosened."


# ---------------------------------------------------------------------------
# AC23: get_matching_segments is the ONLY computation path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_matching_segments_is_only_path_to_membership() -> None:
    """get_matching_segments is the single computation entry point for membership.

    Verifies that there is no segment_ids field on UserForSegment to bypass
    with — the only way to determine if a user is in a segment is to call
    get_matching_segments() which evaluates criteria in real time.
    """
    repo = InMemoryTrendSegmentRepository()
    seg = repo.create("test", SegmentCriteria(personal_color="여름"))

    user = _user(personal_color="여름")

    # Membership is computed via criteria matching — not from a field
    result = get_matching_segments(user, repo)

    assert any(s.segment_id == seg.segment_id for s in result)
    # No shortcut attribute exists on the user
    assert not hasattr(user, "segment_ids")
    assert not hasattr(user, "assigned_segment_ids")


@pytest.mark.unit
def test_empty_segment_repo_returns_empty_membership() -> None:
    """User with no segments in repo belongs to no segments."""
    repo = InMemoryTrendSegmentRepository()
    user = _user(personal_color="봄")

    result = get_matching_segments(user, repo)
    assert result == []


@pytest.mark.unit
def test_multiple_users_same_segment_criteria_all_match() -> None:
    """Multiple users matching the same criteria are all in the segment."""
    repo = InMemoryTrendSegmentRepository()
    seg = repo.create("봄 all", SegmentCriteria(personal_color="봄"))

    users = [_user(personal_color="봄") for _ in range(3)]

    for user in users:
        result = get_matching_segments(user, repo)
        assert any(
            s.segment_id == seg.segment_id for s in result
        ), "Every '봄' user should match the '봄' segment."
