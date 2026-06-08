"""무료 체험 자격 심사 — Trial eligibility guard (Sub-AC 16c).

Seed 결제 모델 (한국 정합)
--------------------------
- 월간: ₩12,000/월
- 연간: ₩59,000/연, 연결제 시 7일 무료체험 + 30일 추가 (총 37일)

무료 체험 조건 (trial eligibility)
------------------------------------
**최초 구독자만** 무료 체험 혜택을 받을 수 있다.
아래 경우에는 자격 없음:

- 현재 활성 구독 중인 사용자 (returning subscriber)
- 과거에 구독을 했다가 취소한 사용자 (previously-cancelled subscriber)
- 구독이 만료된 사용자 (expired subscriber)
- 무료 체험 중인 사용자 (trialing subscriber)

설계 원칙
---------
``is_trial_eligible`` 은 **순수 함수(pure function)**:
- DB I/O 없음 — 호출자가 구독 이력을 미리 조회해서 넘긴다.
- 상태 변경 없음 — 주어진 구독 이력 시퀀스를 읽기만 한다.
- 결정론적 — 동일한 입력에 항상 동일한 결과를 반환한다.

이 설계는 :mod:`api.payment.upsell_gate` 와 동일한 패턴을 따른다.

사용 예시
---------
::

    from api.payment.trial_eligibility import (
        SubscriptionRecord,
        SubscriptionStatus,
        is_trial_eligible,
    )

    # 구독 이력 조회 (호출자 책임)
    history = subscription_repo.get_history(user_id)

    if is_trial_eligible(user_id, history):
        # 무료 체험 37일 활성화
        ...
    else:
        # 바로 유료 구독으로 전환
        ...

Seed constraints honored
------------------------
- 결제 모델: ``$12/월, $59/연, 연결제 시 7일+30일 무료체험`` 정합.
- 강제 메커니즘 거부감 회피: 자격 있는 사용자에게만 체험 혜택을 자동 제공,
  체험 여부로 사용자를 압박하지 않는다.
- Pure function: no I/O, no state mutation. Deterministic unit testing without
  any fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Sequence

# ---------------------------------------------------------------------------
# Domain value objects
# ---------------------------------------------------------------------------


class SubscriptionStatus(str, Enum):
    """구독 상태 열거형.

    ``str`` 상속으로 JSON 직렬화 가능, Pydantic 필드 타입으로 직접 사용 가능.

    Values
    ------
    ACTIVE    : "active"   — 활성 구독 (결제 완료, 기간 내)
    TRIALING  : "trialing" — 무료 체험 중
    CANCELLED : "cancelled" — 구독 취소됨 (기간 만료 전 취소 포함)
    EXPIRED   : "expired"  — 구독 기간 만료 (갱신 없음)
    """

    ACTIVE = "active"
    """활성 구독 — 현재 결제가 완료된 상태."""

    TRIALING = "trialing"
    """무료 체험 중 — 체험 기간 내."""

    CANCELLED = "cancelled"
    """취소된 구독 — 사용자가 구독을 취소했으나 기간이 남아있을 수 있음."""

    EXPIRED = "expired"
    """만료된 구독 — 갱신 없이 기간이 끝남."""


@dataclass(frozen=True)
class SubscriptionRecord:
    """단일 구독 이력 항목.

    한 사용자가 여러 번 구독·취소·재구독할 수 있으므로 이력은 복수의
    ``SubscriptionRecord`` 시퀀스로 표현된다.  각 항목은 불변(frozen=True)이다.

    Attributes
    ----------
    user_id:
        구독 이력을 소유한 사용자의 백엔드 UUID 문자열.
    status:
        구독의 현재(또는 최종) 상태.
    created_at:
        구독이 생성된 시각 (UTC).
    cancelled_at:
        구독이 취소된 시각 (UTC).  취소 전이면 ``None``.
    """

    user_id: str
    status: SubscriptionStatus
    created_at: datetime
    cancelled_at: datetime | None = None


# ---------------------------------------------------------------------------
# Trial eligibility guard
# ---------------------------------------------------------------------------


def is_trial_eligible(
    user_id: str,
    subscription_history: Sequence[SubscriptionRecord],
) -> bool:
    """무료 체험 자격 여부를 반환한다.

    사용자가 **어떤 구독 이력도 없을 때** (진정한 첫 구독자) ``True`` 를
    반환한다.  취소·만료·활성·체험 중 구독이 **하나라도** 있으면 ``False``.

    이 함수는 **순수 함수**다: 주어진 ``subscription_history`` 시퀀스를
    읽기만 하며 어떤 부수효과도 없다.

    Parameters
    ----------
    user_id:
        자격 여부를 확인할 사용자의 백엔드 UUID 문자열.
    subscription_history:
        해당 사용자의 전체 구독 이력.  DB에서 미리 조회해 전달한다.
        다른 사용자의 레코드가 섞여 있어도 ``user_id`` 로 필터링하므로
        안전하다 (단, 호출자는 해당 사용자의 이력만 전달하는 것이 권장됨).

    Returns
    -------
    bool
        ``True``  — ``user_id`` 에 해당하는 구독 이력이 전혀 없음 (첫 구독자).
        ``False`` — ``user_id`` 에 해당하는 구독 이력이 하나 이상 존재.

    Examples
    --------
    >>> from datetime import datetime, timezone
    >>> now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    첫 구독자 (이력 없음) → True:

    >>> is_trial_eligible("user-abc", [])
    True

    활성 구독자 (현재 구독 중) → False:

    >>> record = SubscriptionRecord(
    ...     user_id="user-abc",
    ...     status=SubscriptionStatus.ACTIVE,
    ...     created_at=now,
    ... )
    >>> is_trial_eligible("user-abc", [record])
    False

    이전에 취소한 구독자 → False:

    >>> cancelled = SubscriptionRecord(
    ...     user_id="user-abc",
    ...     status=SubscriptionStatus.CANCELLED,
    ...     created_at=now,
    ...     cancelled_at=now,
    ... )
    >>> is_trial_eligible("user-abc", [cancelled])
    False
    """
    user_records = [r for r in subscription_history if r.user_id == user_id]
    return len(user_records) == 0


__all__ = [
    "SubscriptionRecord",
    "SubscriptionStatus",
    "is_trial_eligible",
]
