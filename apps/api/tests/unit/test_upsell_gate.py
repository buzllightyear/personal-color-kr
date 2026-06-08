"""Unit tests for the upsell acceptance gate function (Sub-AC 3-3).

Acceptance criterion
--------------------
업셀 오퍼 수락 여부(수락·거절·미응답)를 입력받아 해당 스텝 통과 가능 여부를
반환하는 순수 함수를 구현하고, 각 상태값에 대한 단위 테스트를 실행 가능하게 작성.

Coverage
--------
* ACCEPTED    (수락)   → gate passes (True)
* REJECTED    (거절)   → gate passes (True); Korean market: rejection = active choice
* NO_RESPONSE (미응답) → gate blocks (False); user must actively engage first
* String coercion via ``UpsellResponseStatus("accepted")`` round-trips correctly
* Invalid status string raises ValueError from the Enum constructor
* Non-enum type passed directly raises TypeError from the gate function
"""

from __future__ import annotations

import pytest

from api.payment.upsell_gate import UpsellResponseStatus, can_pass_upsell_gate

# ---------------------------------------------------------------------------
# Core gate behaviour — one test per state value (AC requirement)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_accepted_passes_gate() -> None:
    """수락(ACCEPTED) 상태는 게이트를 통과한다."""
    result = can_pass_upsell_gate(UpsellResponseStatus.ACCEPTED)
    assert result is True


@pytest.mark.unit
def test_rejected_passes_gate() -> None:
    """거절(REJECTED) 상태도 게이트를 통과한다.

    한국 시장 정합: 강제 메커니즘 거부감 회피 — 명시적 거절은 능동적 선택이므로
    다음 단계(기본 플랜)로 진행 가능.  유저를 업셀 화면에 가두지 않는다.
    """
    result = can_pass_upsell_gate(UpsellResponseStatus.REJECTED)
    assert result is True


@pytest.mark.unit
def test_no_response_blocks_gate() -> None:
    """미응답(NO_RESPONSE) 상태는 게이트를 막는다.

    유저가 오퍼에 반응하지 않은 경우 — 수락 또는 거절 중 하나를
    능동적으로 선택해야 다음 단계로 진행 가능.  강제 전환율 최대화가 아니라
    guardrail 하한 유지를 위한 최소 게이트.
    """
    result = can_pass_upsell_gate(UpsellResponseStatus.NO_RESPONSE)
    assert result is False


# ---------------------------------------------------------------------------
# Enum value identity / string coercion
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_accepted_enum_value_is_accepted_string() -> None:
    """UpsellResponseStatus.ACCEPTED 의 값이 'accepted' 문자열이다."""
    assert UpsellResponseStatus.ACCEPTED == "accepted"


@pytest.mark.unit
def test_rejected_enum_value_is_rejected_string() -> None:
    """UpsellResponseStatus.REJECTED 의 값이 'rejected' 문자열이다."""
    assert UpsellResponseStatus.REJECTED == "rejected"


@pytest.mark.unit
def test_no_response_enum_value_is_no_response_string() -> None:
    """UpsellResponseStatus.NO_RESPONSE 의 값이 'no_response' 문자열이다."""
    assert UpsellResponseStatus.NO_RESPONSE == "no_response"


@pytest.mark.unit
def test_string_coercion_accepted_round_trips() -> None:
    """'accepted' 문자열로 Enum을 생성하면 ACCEPTED 멤버를 반환한다."""
    coerced = UpsellResponseStatus("accepted")
    assert coerced is UpsellResponseStatus.ACCEPTED
    assert can_pass_upsell_gate(coerced) is True


@pytest.mark.unit
def test_string_coercion_rejected_round_trips() -> None:
    """'rejected' 문자열로 Enum을 생성하면 REJECTED 멤버를 반환한다."""
    coerced = UpsellResponseStatus("rejected")
    assert coerced is UpsellResponseStatus.REJECTED
    assert can_pass_upsell_gate(coerced) is True


@pytest.mark.unit
def test_string_coercion_no_response_round_trips() -> None:
    """'no_response' 문자열로 Enum을 생성하면 NO_RESPONSE 멤버를 반환한다."""
    coerced = UpsellResponseStatus("no_response")
    assert coerced is UpsellResponseStatus.NO_RESPONSE
    assert can_pass_upsell_gate(coerced) is False


# ---------------------------------------------------------------------------
# Guard: invalid input is rejected cleanly
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_invalid_status_string_raises_value_error() -> None:
    """유효하지 않은 문자열로 Enum 생성 시 ValueError가 발생한다."""
    with pytest.raises(ValueError):
        UpsellResponseStatus("invalid_status")


@pytest.mark.unit
def test_non_enum_type_raises_type_error() -> None:
    """Enum 멤버가 아닌 값을 gate 함수에 직접 전달하면 TypeError가 발생한다."""
    with pytest.raises(TypeError):
        can_pass_upsell_gate("accepted")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Purity: repeated calls return the same result (no state mutation)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_gate_is_pure_accepted() -> None:
    """ACCEPTED 상태에서 gate 함수를 반복 호출해도 동일한 결과를 반환한다 (순수 함수)."""
    for _ in range(3):
        assert can_pass_upsell_gate(UpsellResponseStatus.ACCEPTED) is True


@pytest.mark.unit
def test_gate_is_pure_rejected() -> None:
    """REJECTED 상태에서 gate 함수를 반복 호출해도 동일한 결과를 반환한다 (순수 함수)."""
    for _ in range(3):
        assert can_pass_upsell_gate(UpsellResponseStatus.REJECTED) is True


@pytest.mark.unit
def test_gate_is_pure_no_response() -> None:
    """NO_RESPONSE 상태에서 gate 함수를 반복 호출해도 동일한 결과를 반환한다 (순수 함수)."""
    for _ in range(3):
        assert can_pass_upsell_gate(UpsellResponseStatus.NO_RESPONSE) is False
