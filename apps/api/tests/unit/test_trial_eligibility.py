"""Unit tests for the trial eligibility guard (Sub-AC 16c).

Acceptance criterion
--------------------
``is_trial_eligible(user_id)`` returns True for first-time subscribers,
False for users with any prior subscription history; unit tests cover
new-user, returning-user, and previously-cancelled-user cases.

Test coverage
-------------
Three mandatory AC cases:
* new-user            — no subscription history at all                → True
* returning-user      — currently active subscription                 → False
* previously-cancelled-user — had a subscription, then cancelled it   → False

Additional robustness cases:
* Trialing user       — currently in a free trial                     → False
* Expired subscription — prior subscription has expired               → False
* History belonging to a different user does not affect target user   → True
* Multiple mixed records (active + cancelled) for the same user       → False
* Enum string coercion round-trips for all four status values
* Pure function: repeated calls return identical results (no mutation)
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from api.payment.trial_eligibility import (
    SubscriptionRecord,
    SubscriptionStatus,
    is_trial_eligible,
)

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
_USER_ID = "user-test-abc123"
_OTHER_USER_ID = "user-other-xyz789"


def _make_record(
    user_id: str = _USER_ID,
    status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
    cancelled_at: datetime | None = None,
) -> SubscriptionRecord:
    """Helper: create a SubscriptionRecord for a given user and status."""
    return SubscriptionRecord(
        user_id=user_id,
        status=status,
        created_at=_NOW,
        cancelled_at=cancelled_at,
    )


# ---------------------------------------------------------------------------
# AC-required case 1: new-user (no prior subscription history)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_new_user_is_eligible() -> None:
    """신규 사용자(구독 이력 없음)는 무료 체험 자격이 있다 (True).

    첫 구독자 정의: 해당 user_id 에 해당하는 구독 이력이 전혀 없음.
    빈 시퀀스를 전달하면 항상 True 를 반환해야 한다.
    """
    result = is_trial_eligible(_USER_ID, [])
    assert result is True


# ---------------------------------------------------------------------------
# AC-required case 2: returning-user (currently active subscription)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_returning_user_with_active_subscription_is_not_eligible() -> None:
    """현재 활성 구독 중인 사용자는 무료 체험 자격이 없다 (False).

    이미 유료 구독을 하고 있는 사용자에게 무료 체험을 중복 제공하면 안 된다.
    """
    history = [_make_record(status=SubscriptionStatus.ACTIVE)]
    result = is_trial_eligible(_USER_ID, history)
    assert result is False


# ---------------------------------------------------------------------------
# AC-required case 3: previously-cancelled-user
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_previously_cancelled_user_is_not_eligible() -> None:
    """과거에 구독을 취소한 사용자는 무료 체험 자격이 없다 (False).

    취소 이력이 있다는 것은 이전에 유료 구독을 했다는 뜻이므로,
    '첫 구독자'에 해당하지 않는다.  무료 체험은 진정한 신규 사용자에게만 제공.
    """
    history = [
        _make_record(
            status=SubscriptionStatus.CANCELLED,
            cancelled_at=_NOW,
        )
    ]
    result = is_trial_eligible(_USER_ID, history)
    assert result is False


# ---------------------------------------------------------------------------
# Additional coverage: trialing user
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_trialing_user_is_not_eligible() -> None:
    """무료 체험 중인 사용자는 자격이 없다 (False).

    이미 체험 중인 사용자에게 체험을 다시 부여하면 안 된다.
    TRIALING 상태도 구독 이력에 해당한다.
    """
    history = [_make_record(status=SubscriptionStatus.TRIALING)]
    result = is_trial_eligible(_USER_ID, history)
    assert result is False


# ---------------------------------------------------------------------------
# Additional coverage: expired subscription
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_expired_subscription_user_is_not_eligible() -> None:
    """구독이 만료된 사용자는 자격이 없다 (False).

    만료된 구독도 '구독 이력'에 해당하므로 재체험 제공 금지.
    """
    history = [_make_record(status=SubscriptionStatus.EXPIRED)]
    result = is_trial_eligible(_USER_ID, history)
    assert result is False


# ---------------------------------------------------------------------------
# Additional coverage: other user's history does not contaminate target
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_other_users_history_does_not_affect_target_user() -> None:
    """다른 사용자의 구독 이력이 대상 사용자의 자격에 영향을 주지 않는다 (True).

    이력 시퀀스에 다른 사용자의 레코드가 포함되어 있어도,
    대상 user_id 에 해당하는 레코드가 없으면 True 를 반환해야 한다.
    """
    other_user_history = [
        _make_record(
            user_id=_OTHER_USER_ID,
            status=SubscriptionStatus.ACTIVE,
        )
    ]
    result = is_trial_eligible(_USER_ID, other_user_history)
    assert result is True


# ---------------------------------------------------------------------------
# Additional coverage: multiple records (all belong to same user)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_user_with_multiple_subscription_records_is_not_eligible() -> None:
    """구독 이력이 여러 건인 사용자는 자격이 없다 (False).

    여러 번 구독·취소를 반복한 사용자도 '신규'가 아니다.
    """
    history = [
        _make_record(
            status=SubscriptionStatus.CANCELLED,
            cancelled_at=_NOW,
        ),
        _make_record(status=SubscriptionStatus.ACTIVE),
    ]
    result = is_trial_eligible(_USER_ID, history)
    assert result is False


# ---------------------------------------------------------------------------
# Enum value / string coercion
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_active_enum_value_is_active_string() -> None:
    """SubscriptionStatus.ACTIVE 의 값이 'active' 문자열이다."""
    assert SubscriptionStatus.ACTIVE == "active"


@pytest.mark.unit
def test_trialing_enum_value_is_trialing_string() -> None:
    """SubscriptionStatus.TRIALING 의 값이 'trialing' 문자열이다."""
    assert SubscriptionStatus.TRIALING == "trialing"


@pytest.mark.unit
def test_cancelled_enum_value_is_cancelled_string() -> None:
    """SubscriptionStatus.CANCELLED 의 값이 'cancelled' 문자열이다."""
    assert SubscriptionStatus.CANCELLED == "cancelled"


@pytest.mark.unit
def test_expired_enum_value_is_expired_string() -> None:
    """SubscriptionStatus.EXPIRED 의 값이 'expired' 문자열이다."""
    assert SubscriptionStatus.EXPIRED == "expired"


@pytest.mark.unit
def test_string_coercion_active_round_trips() -> None:
    """'active' 문자열로 Enum을 생성하면 ACTIVE 멤버를 반환한다."""
    assert SubscriptionStatus("active") is SubscriptionStatus.ACTIVE


@pytest.mark.unit
def test_string_coercion_cancelled_round_trips() -> None:
    """'cancelled' 문자열로 Enum을 생성하면 CANCELLED 멤버를 반환한다."""
    assert SubscriptionStatus("cancelled") is SubscriptionStatus.CANCELLED


@pytest.mark.unit
def test_invalid_status_string_raises_value_error() -> None:
    """유효하지 않은 문자열로 Enum 생성 시 ValueError가 발생한다."""
    with pytest.raises(ValueError):
        SubscriptionStatus("invalid_status_xyz")


# ---------------------------------------------------------------------------
# Purity: repeated calls return identical results (no state mutation)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_is_trial_eligible_pure_new_user() -> None:
    """빈 이력에서 반복 호출해도 항상 True 를 반환한다 (순수 함수)."""
    for _ in range(3):
        assert is_trial_eligible(_USER_ID, []) is True


@pytest.mark.unit
def test_is_trial_eligible_pure_returning_user() -> None:
    """활성 구독 이력이 있을 때 반복 호출해도 항상 False 를 반환한다 (순수 함수)."""
    history = [_make_record(status=SubscriptionStatus.ACTIVE)]
    for _ in range(3):
        assert is_trial_eligible(_USER_ID, history) is False


@pytest.mark.unit
def test_is_trial_eligible_pure_cancelled_user() -> None:
    """취소된 구독 이력이 있을 때 반복 호출해도 항상 False 를 반환한다 (순수 함수)."""
    history = [_make_record(status=SubscriptionStatus.CANCELLED, cancelled_at=_NOW)]
    for _ in range(3):
        assert is_trial_eligible(_USER_ID, history) is False


# ---------------------------------------------------------------------------
# SubscriptionRecord immutability
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_subscription_record_is_frozen() -> None:
    """SubscriptionRecord 는 frozen dataclass 이다 — 필드 직접 변경 시 예외 발생."""
    record = _make_record()
    with pytest.raises((AttributeError, TypeError)):
        record.status = SubscriptionStatus.CANCELLED  # type: ignore[misc]
