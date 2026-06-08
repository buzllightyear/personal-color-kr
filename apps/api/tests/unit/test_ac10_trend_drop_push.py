"""AC10: Trend drop push — operator pushes drop to segment-matched users.

Acceptance criteria verified
-----------------------------
AC10: operator가 trend_id + recipe_id + target_segment_id로 drop push →
      해당 segment 매칭 user에게 알림 placeholder 발송 + restyle 진입점 생성.
"""

from __future__ import annotations

import uuid

import pytest

from api.trend_drop.push import (
    InMemoryTrendSegmentRepository,
    SegmentCriteria,
    UserForSegment,
    push_trend_drop,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _user(
    user_id: uuid.UUID | None = None,
    personal_color: str = "봄",
    subscription_status: str = "active",
) -> UserForSegment:
    return UserForSegment(
        user_id=user_id or uuid.uuid4(),
        personal_color=personal_color,
        subscription_status=subscription_status,
    )


# ---------------------------------------------------------------------------
# AC10: push creates drop + matches users + restyle CTA
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_push_creates_drop_with_matched_users() -> None:
    """Push to '봄' segment matches only 봄 users."""
    segment_repo = InMemoryTrendSegmentRepository()
    segment = segment_repo.create(
        "봄 사용자",
        SegmentCriteria(personal_color="봄"),
    )

    users = [
        _user(personal_color="봄"),
        _user(personal_color="봄"),
        _user(personal_color="겨울"),  # should NOT match
    ]

    trend_id = uuid.uuid4()
    drop = push_trend_drop(
        trend_id=trend_id,
        recipe_id="recipe_aurora_1",
        target_segment_id=segment.segment_id,
        operator_id="operator_singleton",
        restyle_cta="https://app.example.com/restyle/trend_aurora",
        users=users,
        segment_repo=segment_repo,
    )

    assert drop.drop_id is not None
    assert drop.trend_id == trend_id
    assert drop.recipe_id == "recipe_aurora_1"
    assert drop.target_segment_id == segment.segment_id
    assert drop.pushed_by == "operator_singleton"
    assert drop.notification_status == "sent"
    assert len(drop.matched_user_ids) == 2  # only the 2 봄 users


@pytest.mark.unit
def test_push_restyle_cta_is_present() -> None:
    """Push record includes the restyle CTA (entry point creation)."""
    segment_repo = InMemoryTrendSegmentRepository()
    segment = segment_repo.create("전체", SegmentCriteria())  # no criteria = all

    users = [_user()]
    restyle_url = "https://app.example.com/restyle/aurora"

    drop = push_trend_drop(
        trend_id=uuid.uuid4(),
        recipe_id="recipe_aurora_1",
        target_segment_id=segment.segment_id,
        operator_id="operator_singleton",
        restyle_cta=restyle_url,
        users=users,
        segment_repo=segment_repo,
    )

    assert drop.restyle_cta == restyle_url


@pytest.mark.unit
def test_push_to_all_segment_matches_all_users() -> None:
    """Segment with no criteria (all users) matches every user."""
    segment_repo = InMemoryTrendSegmentRepository()
    segment = segment_repo.create("전체", SegmentCriteria())  # wildcard

    users = [
        _user(personal_color="봄"),
        _user(personal_color="여름"),
        _user(personal_color="가을"),
    ]

    drop = push_trend_drop(
        trend_id=uuid.uuid4(),
        recipe_id="recipe_test_1",
        target_segment_id=segment.segment_id,
        operator_id="operator_singleton",
        restyle_cta="https://example.com/restyle",
        users=users,
        segment_repo=segment_repo,
    )

    assert len(drop.matched_user_ids) == 3


@pytest.mark.unit
def test_push_to_nonexistent_segment_raises_value_error() -> None:
    """Push to unknown segment_id raises ValueError."""
    segment_repo = InMemoryTrendSegmentRepository()

    with pytest.raises(ValueError, match="Segment .* not found"):
        push_trend_drop(
            trend_id=uuid.uuid4(),
            recipe_id="recipe_test_1",
            target_segment_id=uuid.uuid4(),  # does not exist
            operator_id="operator_singleton",
            restyle_cta="https://example.com/restyle",
            users=[_user()],
            segment_repo=segment_repo,
        )


@pytest.mark.unit
def test_push_to_empty_user_list_has_no_matched_users() -> None:
    """Push with empty user list results in 0 matched users."""
    segment_repo = InMemoryTrendSegmentRepository()
    segment = segment_repo.create("봄", SegmentCriteria(personal_color="봄"))

    drop = push_trend_drop(
        trend_id=uuid.uuid4(),
        recipe_id="recipe_test_1",
        target_segment_id=segment.segment_id,
        operator_id="operator_singleton",
        restyle_cta="https://example.com/restyle",
        users=[],
        segment_repo=segment_repo,
    )

    assert drop.matched_user_ids == []
