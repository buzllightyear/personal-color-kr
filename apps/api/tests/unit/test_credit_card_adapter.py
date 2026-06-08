"""신용카드 어댑터 모듈 단위 테스트 (Sub-AC 2-4).

Coverage
--------
세 가지 결제 시나리오를 ``MockCreditCardSDK``로 완전히 검증한다:

1. **성공(Success)** — initiate → confirm → (선택) cancel 모두 성공하고
   올바른 도메인 레벨 결과 객체를 반환한다.
2. **실패(Failure)** — ``create_payment_session()`` 또는 ``confirm_payment()``가
   예상된 어댑터 예외를 발생시킨다; 호출 횟수 어설션으로 하위 단계가 호출되지
   않음을 검증한다.
3. **취소(Cancel)** — initiate와 confirm 성공 후 ``cancel()``이
   ``status == "CANCELED"``인 ``CreditCardCancelResult``를 반환한다.

Design notes
------------
* 네트워크 호출 없음: ``MockCreditCardSDK``는 순수 인프로세스.
* DB 없음: 어댑터 층은 ORM 의존성이 없다.
* 각 테스트는 자체 ``CreditCardAdapter(sdk=MockCreditCardSDK(...))``를 생성한다.
* ``sdk.calls``의 호출 횟수로 각 단계가 정확히 예상 SDK 메서드를 호출했는지
  검증한다.
"""

from __future__ import annotations

import pytest

from api.payment.credit_card_adapter import (
    CreditCardAdapter,
    CreditCardCancelError,
    CreditCardCancelResult,
    CreditCardConfirmError,
    CreditCardConfirmResult,
    CreditCardError,
    CreditCardInitiateError,
    CreditCardReadyResult,
    CreditCardScenario,
    MockCreditCardSDK,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_adapter(
    scenario: CreditCardScenario,
) -> tuple[CreditCardAdapter, MockCreditCardSDK]:
    """*scenario*를 위한 ``(CreditCardAdapter, MockCreditCardSDK)`` 쌍을 생성한다."""
    sdk = MockCreditCardSDK(scenario=scenario)
    return CreditCardAdapter(sdk=sdk), sdk


# ---------------------------------------------------------------------------
# 시나리오 1: 결제 성공 — initiate, confirm, cancel (전체 라이프사이클)
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_success_initiate_returns_credit_card_ready_result() -> None:
    """``initiate``가 payment_id와 payment_form_url이 담긴 ``CreditCardReadyResult``를
    반환한다."""
    adapter, sdk = _make_adapter(CreditCardScenario.SUCCESS)

    result = await adapter.initiate(
        order_id="ord-cc-001",
        amount_krw=12000,
    )

    assert isinstance(result, CreditCardReadyResult)
    assert result.payment_id is not None
    assert "ord-cc-001" in result.payment_form_url

    # SDK 호출 횟수: ``create_payment_session`` 1회.
    assert len(sdk.calls) == 1
    method, kwargs = sdk.calls[0]
    assert method == "create_payment_session"
    assert kwargs["order_id"] == "ord-cc-001"
    assert kwargs["amount"] == 12000


@pytest.mark.unit
async def test_success_confirm_returns_credit_card_confirm_result() -> None:
    """``confirm``이 올바른 필드를 가진 ``CreditCardConfirmResult``를 반환한다."""
    adapter, sdk = _make_adapter(CreditCardScenario.SUCCESS)

    payment_key = "cc_pk_test_abc123"

    result = await adapter.confirm(
        payment_key=payment_key,
        order_id="ord-cc-002",
        amount_krw=12000,
    )

    assert isinstance(result, CreditCardConfirmResult)
    assert result.payment_key == payment_key
    assert result.order_id == "ord-cc-002"
    assert result.amount_krw == 12000
    assert result.card_type == "신용"
    assert result.status == "APPROVED"

    # SDK 호출 횟수: ``confirm_payment`` 1회.
    assert len(sdk.calls) == 1
    assert sdk.calls[0][0] == "confirm_payment"
    _, confirm_kwargs = sdk.calls[0]
    assert confirm_kwargs["payment_key"] == payment_key
    assert confirm_kwargs["order_id"] == "ord-cc-002"
    assert confirm_kwargs["amount"] == 12000


@pytest.mark.unit
async def test_success_full_lifecycle_initiate_confirm_cancel() -> None:
    """전체 라이프사이클: initiate → confirm → cancel 이 ``CANCELED``를 반환한다."""
    adapter, sdk = _make_adapter(CreditCardScenario.CANCEL_PAYMENT)

    ready = await adapter.initiate(
        order_id="ord-cc-cancel-001",
        amount_krw=59000,
        order_name="Picko 연간 구독",
    )
    assert isinstance(ready, CreditCardReadyResult)

    confirm_result = await adapter.confirm(
        payment_key="cc_pk_cancel_xyz",
        order_id="ord-cc-cancel-001",
        amount_krw=59000,
    )
    assert isinstance(confirm_result, CreditCardConfirmResult)
    assert confirm_result.status == "APPROVED"

    cancel_result = await adapter.cancel(
        payment_key=confirm_result.payment_key,
        cancel_reason="고객 요청",
        cancel_amount_krw=59000,
    )

    assert isinstance(cancel_result, CreditCardCancelResult)
    assert cancel_result.payment_key == confirm_result.payment_key
    assert cancel_result.cancel_amount_krw == 59000
    assert cancel_result.status == "CANCELED"

    # SDK 호출 순서: create_payment_session, confirm_payment, cancel_payment.
    call_methods = [name for name, _ in sdk.calls]
    assert call_methods == [
        "create_payment_session",
        "confirm_payment",
        "cancel_payment",
    ]

    _, cancel_kwargs = sdk.calls[2]
    assert cancel_kwargs["cancel_amount"] == 59000
    assert cancel_kwargs["cancel_reason"] == "고객 요청"


# ---------------------------------------------------------------------------
# 시나리오 2: 결제 실패 — 결제 세션 생성 단계와 확정 단계에서 SDK가 거부
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_failure_on_initiate_raises_credit_card_initiate_error() -> None:
    """``initiate``는 SDK가 세션 생성을 거부하면 ``CreditCardInitiateError``를 발생시킨다."""
    adapter, sdk = _make_adapter(CreditCardScenario.FAIL_ON_INITIATE)

    with pytest.raises(CreditCardInitiateError) as exc_info:
        await adapter.initiate(
            order_id="ord-cc-fail-initiate",
            amount_krw=12000,
        )

    assert exc_info.value.error_code == "INVALID_REQUEST"
    # 실패한 ``create_payment_session`` 하나만 시도됐다.
    assert len(sdk.calls) == 1
    assert sdk.calls[0][0] == "create_payment_session"


@pytest.mark.unit
async def test_failure_on_confirm_raises_credit_card_confirm_error() -> None:
    """``confirm``은 사용자가 취소하거나 카드 한도 초과 시 ``CreditCardConfirmError``를
    발생시킨다."""
    adapter, sdk = _make_adapter(CreditCardScenario.FAIL_ON_CONFIRM)

    with pytest.raises(CreditCardConfirmError) as exc_info:
        await adapter.confirm(
            payment_key="cc_pk_user_cancelled",
            order_id="ord-cc-fail-confirm",
            amount_krw=12000,
        )

    assert exc_info.value.error_code == "CARD_PAYMENT_CANCELED"
    # ``confirm_payment`` 하나만 시도됐다.
    assert len(sdk.calls) == 1
    assert sdk.calls[0][0] == "confirm_payment"


@pytest.mark.unit
async def test_failure_on_initiate_does_not_call_confirm_or_cancel() -> None:
    """``initiate`` 실패 후 ``confirm``이나 ``cancel``이 호출되지 않는다."""
    adapter, sdk = _make_adapter(CreditCardScenario.FAIL_ON_INITIATE)

    with pytest.raises(CreditCardInitiateError):
        await adapter.initiate(
            order_id="ord-cc-no-downstream",
            amount_krw=12000,
        )

    call_methods = [name for name, _ in sdk.calls]
    assert "confirm_payment" not in call_methods
    assert "cancel_payment" not in call_methods


# ---------------------------------------------------------------------------
# 시나리오 3: 결제 취소 — 승인된 payment_key로 직접 취소
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_cancel_only_calls_sdk_cancel() -> None:
    """직접 ``cancel`` 호출(알려진 payment_key)이 SDK cancel만 호출한다."""
    adapter, sdk = _make_adapter(CreditCardScenario.SUCCESS)

    result = await adapter.cancel(
        payment_key="cc_pk_known_direct",
        cancel_reason="단순 변심",
        cancel_amount_krw=12000,
    )

    assert isinstance(result, CreditCardCancelResult)
    assert result.payment_key == "cc_pk_known_direct"
    assert result.cancel_amount_krw == 12000
    assert result.status == "CANCELED"

    # SDK 호출 횟수: ``cancel_payment`` 1회만 (prior create/confirm 없음).
    assert len(sdk.calls) == 1
    assert sdk.calls[0][0] == "cancel_payment"


@pytest.mark.unit
async def test_cancel_full_refund_when_amount_is_none() -> None:
    """``cancel_amount_krw=None``이면 전액 환불로 처리된다."""
    adapter, sdk = _make_adapter(CreditCardScenario.SUCCESS)

    result = await adapter.cancel(
        payment_key="cc_pk_full_refund",
        cancel_reason="결제 오류",
        cancel_amount_krw=None,
    )

    assert isinstance(result, CreditCardCancelResult)
    assert result.status == "CANCELED"

    _, cancel_kwargs = sdk.calls[0]
    assert cancel_kwargs["cancel_amount"] is None


@pytest.mark.unit
async def test_cancel_partial_refund_amount() -> None:
    """부분 환불 취소는 정확한 취소 금액을 전달한다."""
    adapter, sdk = _make_adapter(CreditCardScenario.SUCCESS)

    result = await adapter.cancel(
        payment_key="cc_pk_partial",
        cancel_reason="일부 환불",
        cancel_amount_krw=6000,  # 월간 구독 12,000원의 절반
    )

    assert result.cancel_amount_krw == 6000
    _, cancel_kwargs = sdk.calls[0]
    assert cancel_kwargs["cancel_amount"] == 6000
    assert cancel_kwargs["cancel_reason"] == "일부 환불"


@pytest.mark.unit
async def test_cancel_annual_subscription_full_refund() -> None:
    """연간 구독 전액 환불이 올바른 금액을 반환한다."""
    adapter, sdk = _make_adapter(CreditCardScenario.CANCEL_PAYMENT)

    result = await adapter.cancel(
        payment_key="cc_pk_annual",
        cancel_reason="구독 취소",
        cancel_amount_krw=59000,
    )

    assert result.cancel_amount_krw == 59000
    assert result.status == "CANCELED"


# ---------------------------------------------------------------------------
# Mock SDK 구조 테스트 — 테스트 더블이 프로토콜을 만족하는지 검증
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_mock_sdk_records_calls_in_order() -> None:
    """``MockCreditCardSDK.calls``는 호출 순서대로 항목을 누적한다."""
    sdk = MockCreditCardSDK(scenario=CreditCardScenario.SUCCESS)
    adapter = CreditCardAdapter(sdk=sdk)

    await adapter.initiate(order_id="chk-cc-001", amount_krw=12000)
    await adapter.confirm(
        payment_key="cc_pk_chk001",
        order_id="chk-cc-001",
        amount_krw=12000,
    )
    await adapter.cancel(
        payment_key="cc_pk_chk001",
        cancel_reason="테스트",
        cancel_amount_krw=12000,
    )

    assert [name for name, _ in sdk.calls] == [
        "create_payment_session",
        "confirm_payment",
        "cancel_payment",
    ]


@pytest.mark.unit
async def test_mock_sdk_annual_subscription_amount() -> None:
    """Mock이 연간 구독 가격 (59,000 KRW)을 올바르게 에코한다."""
    adapter, sdk = _make_adapter(CreditCardScenario.SUCCESS)

    result = await adapter.initiate(
        order_id="annual-cc-sub-001",
        amount_krw=59000,
        order_name="Picko 연간 구독",
    )

    assert isinstance(result, CreditCardReadyResult)
    _, ready_kwargs = sdk.calls[0]
    assert ready_kwargs["amount"] == 59000
    assert ready_kwargs["order_name"] == "Picko 연간 구독"


@pytest.mark.unit
async def test_credit_card_scenario_enum_values() -> None:
    """``CreditCardScenario`` 문자열 값이 예상 리터럴과 일치한다."""
    assert CreditCardScenario.SUCCESS == "success"
    assert CreditCardScenario.FAIL_ON_INITIATE == "fail_on_initiate"
    assert CreditCardScenario.FAIL_ON_CONFIRM == "fail_on_confirm"
    assert CreditCardScenario.CANCEL_PAYMENT == "cancel_payment"


@pytest.mark.unit
def test_mock_sdk_can_be_constructed_with_string_scenario() -> None:
    """``MockCreditCardSDK``는 문자열을 scenario 인수로 받을 수 있다."""
    sdk = MockCreditCardSDK(scenario="success")
    assert sdk._scenario == CreditCardScenario.SUCCESS


@pytest.mark.unit
async def test_initiate_uses_default_urls_when_not_overridden() -> None:
    """``initiate``는 재정의하지 않으면 기본 success_url/fail_url을 사용한다."""
    adapter, sdk = _make_adapter(CreditCardScenario.SUCCESS)

    await adapter.initiate(order_id="ord-cc-default-url", amount_krw=12000)

    _, kwargs = sdk.calls[0]
    assert kwargs["success_url"] == CreditCardAdapter.DEFAULT_SUCCESS_URL
    assert kwargs["fail_url"] == CreditCardAdapter.DEFAULT_FAIL_URL


@pytest.mark.unit
async def test_initiate_respects_custom_urls() -> None:
    """``initiate``는 호출자가 제공한 커스텀 URL을 사용한다."""
    adapter, sdk = _make_adapter(CreditCardScenario.SUCCESS)

    await adapter.initiate(
        order_id="ord-cc-custom-url",
        amount_krw=12000,
        success_url="https://custom.example.com/cc/success",
        fail_url="https://custom.example.com/cc/fail",
    )

    _, kwargs = sdk.calls[0]
    assert kwargs["success_url"] == "https://custom.example.com/cc/success"
    assert kwargs["fail_url"] == "https://custom.example.com/cc/fail"


@pytest.mark.unit
async def test_confirm_status_is_approved_on_success() -> None:
    """성공 시나리오에서 confirm 결과의 status는 ``APPROVED``이다."""
    adapter, _ = _make_adapter(CreditCardScenario.SUCCESS)

    result = await adapter.confirm(
        payment_key="cc_pk_approved_check",
        order_id="ord-cc-approved",
        amount_krw=12000,
    )

    assert result.status == "APPROVED"


@pytest.mark.unit
async def test_credit_card_initiate_error_has_error_code_attribute() -> None:
    """``CreditCardInitiateError``는 ``error_code`` 속성을 포함한다."""
    error = CreditCardInitiateError("테스트 오류", error_code="TEST_CODE")
    assert error.error_code == "TEST_CODE"
    assert "테스트 오류" in str(error)


@pytest.mark.unit
async def test_credit_card_confirm_error_has_error_code_attribute() -> None:
    """``CreditCardConfirmError``는 ``error_code`` 속성을 포함한다."""
    error = CreditCardConfirmError("확정 실패", error_code="CONFIRM_FAIL")
    assert error.error_code == "CONFIRM_FAIL"


@pytest.mark.unit
async def test_credit_card_cancel_error_has_error_code_attribute() -> None:
    """``CreditCardCancelError``는 ``error_code`` 속성을 포함한다."""
    error = CreditCardCancelError("취소 실패", error_code="CANCEL_FAIL")
    assert error.error_code == "CANCEL_FAIL"


@pytest.mark.unit
def test_credit_card_error_is_base_class_of_all_errors() -> None:
    """모든 신용카드 에러 클래스가 ``CreditCardError``의 서브클래스인지 검증한다."""
    assert issubclass(CreditCardInitiateError, CreditCardError)
    assert issubclass(CreditCardConfirmError, CreditCardError)
    assert issubclass(CreditCardCancelError, CreditCardError)


@pytest.mark.unit
async def test_monthly_subscription_amount_12000_krw() -> None:
    """월간 구독 금액 12,000원이 올바르게 전달된다."""
    adapter, sdk = _make_adapter(CreditCardScenario.SUCCESS)

    result = await adapter.initiate(
        order_id="monthly-cc-001",
        amount_krw=12000,
        order_name="Picko 월간 구독",
    )

    assert isinstance(result, CreditCardReadyResult)
    _, kwargs = sdk.calls[0]
    assert kwargs["amount"] == 12000
    assert kwargs["order_name"] == "Picko 월간 구독"


@pytest.mark.unit
async def test_annual_subscription_amount_59000_krw() -> None:
    """연간 구독 금액 59,000원이 올바르게 전달된다."""
    adapter, sdk = _make_adapter(CreditCardScenario.SUCCESS)

    result = await adapter.initiate(
        order_id="annual-cc-002",
        amount_krw=59000,
        order_name="Picko 연간 구독",
    )

    assert isinstance(result, CreditCardReadyResult)
    _, kwargs = sdk.calls[0]
    assert kwargs["amount"] == 59000
