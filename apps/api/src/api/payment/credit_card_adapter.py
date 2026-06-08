"""신용카드 어댑터 모듈 — 신용카드 PG SDK commoditized 래퍼 (Sub-AC 2-4).

What this module does
---------------------
신용카드 PG(Payment Gateway) SDK를 애플리케이션 레벨 프로토콜로 감싸서
나머지 코드가 벤더 전용 타입을 직접 import하지 않도록 분리한다.
어댑터는 신용카드 PG SDK의 **유일한** 호출자이며, 다른 모든 모듈은 여기서
정의한 도메인 레벨 결과 타입에만 의존한다.

신용카드 PG 결제 라이프사이클 (v1 간략화, 한국 시장 KCP/INICIS/나이스페이 호환):
    1. ``initiate``  — PG 결제 세션을 생성하고 카드 정보 입력 폼 URL을 반환한다.
       클라이언트는 해당 URL로 리다이렉트하거나 팝업을 띄운다.
       PG 서버는 사용자 승인 후 ``success_url`` / ``fail_url``로 리다이렉트한다.
    2. ``confirm``   — 사용자가 카드 폼을 완료하면 PG가 ``payment_key``를
       ``success_url``에 쿼리 파라미터로 전달한다.
       서버는 PG ``POST /payments/confirm``을 호출해 결제를 확정한다.
    3. ``cancel``    — 승인된 결제를 취소(환불)하려면 PG의 취소 API를 호출한다.
       전액 및 부분 취소 모두 지원한다.

Seed constraints honored
-------------------------
- 신용카드 PG SDK = commodity vendor wrapping; 자체 ML 모델 없음.
- 어댑터는 프로덕션 코드에서 raw HTTP를 직접 호출하지 않는다 —
  ``CreditCardSDKProtocol`` 추상화가 호출자에게 노출되는 유일한 표면이다.
- ``MockCreditCardSDK``가 유일한 테스트 더블이다; 단위 테스트는 raw HTTP를
  monkey-patch 하지 않는다.

Usage
-----
Production::

    from api.payment.credit_card_adapter import CreditCardAdapter
    from api.payment.real_credit_card_sdk import RealCreditCardSDK

    adapter = CreditCardAdapter(sdk=RealCreditCardSDK(merchant_id="...", api_key="..."))
    result = await adapter.initiate(
        order_id="ord-123",
        amount_krw=12000,
        order_name="Picko 월간 구독",
    )

Testing::

    from api.payment.credit_card_adapter import CreditCardAdapter, MockCreditCardSDK, CreditCardScenario

    sdk = MockCreditCardSDK(scenario=CreditCardScenario.SUCCESS)
    adapter = CreditCardAdapter(sdk=sdk)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol

# ---------------------------------------------------------------------------
# Domain value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CreditCardReadyResult:
    """결제 요청(initiate) 단계의 성공 결과.

    Attributes
    ----------
    payment_id:
        PG가 발급한 결제 세션 고유 식별자.  confirm 및 cancel 호출 시
        동일 값을 그대로 전달해야 한다.
    payment_form_url:
        사용자를 리다이렉트하거나 팝업으로 띄울 PG 신용카드 입력 폼 URL.
    """

    payment_id: str
    payment_form_url: str


@dataclass(frozen=True)
class CreditCardConfirmResult:
    """결제 확정(confirm) 단계의 성공 결과.

    Attributes
    ----------
    payment_key:
        PG가 발급한 결제 고유 키.  취소(cancel) 시 필요하다.
    order_id:
        요청 시 전달된 주문 식별자 (상관 관계 추적용).
    amount_krw:
        승인된 금액 (원화).
    card_type:
        카드 유형 (예: ``"신용"``, ``"체크"``).
    status:
        PG 결제 상태 (예: ``"APPROVED"``).
    """

    payment_key: str
    order_id: str
    amount_krw: int
    card_type: str
    status: str


@dataclass(frozen=True)
class CreditCardCancelResult:
    """결제 취소(cancel) 요청의 성공 결과.

    Attributes
    ----------
    payment_key:
        취소된 결제의 PG 결제 키.
    cancel_amount_krw:
        취소(환불)된 금액 (원화).
    status:
        취소 후 결제 상태 (예: ``"CANCELED"``).
    """

    payment_key: str
    cancel_amount_krw: int
    status: str


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class CreditCardError(Exception):
    """신용카드 PG 어댑터 에러의 기본 클래스."""

    def __init__(self, message: str, error_code: str | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code


class CreditCardInitiateError(CreditCardError):
    """결제 요청 단계가 실패했을 때 발생 (예: 잘못된 merchant_id, 금액 오류)."""


class CreditCardConfirmError(CreditCardError):
    """결제 확정 단계가 실패했을 때 발생.

    주요 원인: 만료된 payment_key, 카드 한도 초과, 이중 승인 시도,
    사용자가 PG 카드 입력 폼에서 취소.
    """


class CreditCardCancelError(CreditCardError):
    """취소 요청을 PG가 거부했을 때 발생 (이미 환불됨, 잘못된 payment_key 등)."""


# ---------------------------------------------------------------------------
# SDK abstraction
# ---------------------------------------------------------------------------


class CreditCardSDKProtocol(Protocol):
    """신용카드 PG SDK 구현체가 반드시 만족해야 하는 구조적 인터페이스.

    ``RealCreditCardSDK`` (프로덕션)와 ``MockCreditCardSDK`` (테스트) 모두 이
    프로토콜을 구현한다.  어댑터는 이 프로토콜에만 의존하며 벤더 클래스를 직접
    임포트하지 않는다.
    """

    async def create_payment_session(
        self,
        *,
        order_id: str,
        amount: int,
        order_name: str,
        success_url: str,
        fail_url: str,
    ) -> dict[str, Any]:
        """결제 세션을 생성하고 카드 입력 폼 URL을 반환한다."""
        ...  # pragma: no cover

    async def confirm_payment(
        self,
        *,
        payment_key: str,
        order_id: str,
        amount: int,
    ) -> dict[str, Any]:
        """POST /payments/confirm — 사용자가 승인한 결제를 서버에서 확정한다."""
        ...  # pragma: no cover

    async def cancel_payment(
        self,
        *,
        payment_key: str,
        cancel_reason: str,
        cancel_amount: int | None,
    ) -> dict[str, Any]:
        """POST /payments/{paymentKey}/cancel — 결제를 취소(환불)한다."""
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# Mock SDK (for unit tests only)
# ---------------------------------------------------------------------------


class CreditCardScenario(str, Enum):
    """``MockCreditCardSDK``가 시뮬레이션할 수 있는 사전 프로그래밍된 시나리오."""

    SUCCESS = "success"
    """결제 요청, 확정, 취소 모두 오류 없이 성공한다."""

    FAIL_ON_INITIATE = "fail_on_initiate"
    """``create_payment_session()``가 ``CreditCardInitiateError``를 발생시킨다
    (잘못된 merchant_id 또는 금액 오류 등)."""

    FAIL_ON_CONFIRM = "fail_on_confirm"
    """``confirm_payment()``가 ``CreditCardConfirmError``를 발생시킨다
    (사용자 취소, 카드 한도 초과, 만료된 payment_key)."""

    CANCEL_PAYMENT = "cancel_payment"
    """결제 요청 및 확정 성공 후 ``cancel_payment()``가 성공한다."""


class MockCreditCardSDK:
    """신용카드 PG SDK의 인프로세스 테스트 더블.

    네트워크 호출 없이 세 가지 핵심 결제 시나리오 — 성공, 실패, 취소 —
    를 시뮬레이션한다.

    Parameters
    ----------
    scenario:
        ``CreditCardScenario`` 중 하나.  어떤 연산이 성공하고 어떤 연산이
        에러를 발생시킬지 제어한다.

    Usage
    -----
    ::

        sdk = MockCreditCardSDK(scenario=CreditCardScenario.SUCCESS)
        adapter = CreditCardAdapter(sdk=sdk)
        result = await adapter.initiate(...)

    모든 호출은 ``calls`` 리스트에 ``(method_name, kwargs)`` 튜플로 기록된다.
    """

    def __init__(
        self, scenario: CreditCardScenario | str = CreditCardScenario.SUCCESS
    ) -> None:
        self._scenario = CreditCardScenario(scenario)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    # --- protocol implementation -------------------------------------------

    async def create_payment_session(
        self,
        *,
        order_id: str,
        amount: int,
        order_name: str,
        success_url: str,
        fail_url: str,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "order_id": order_id,
            "amount": amount,
            "order_name": order_name,
            "success_url": success_url,
            "fail_url": fail_url,
        }
        self.calls.append(("create_payment_session", kwargs))

        if self._scenario == CreditCardScenario.FAIL_ON_INITIATE:
            raise CreditCardInitiateError(
                "신용카드 PG 결제 세션 생성 실패 — 잘못된 merchant_id 또는 금액 오류",
                error_code="INVALID_REQUEST",
            )

        return {
            "payment_id": f"mock-pid-{order_id}",
            "payment_form_url": (
                f"https://mockpg.kr/card-form/{order_id}"
            ),
        }

    async def confirm_payment(
        self,
        *,
        payment_key: str,
        order_id: str,
        amount: int,
    ) -> dict[str, Any]:
        kwargs_confirm: dict[str, Any] = {
            "payment_key": payment_key,
            "order_id": order_id,
            "amount": amount,
        }
        self.calls.append(("confirm_payment", kwargs_confirm))

        if self._scenario == CreditCardScenario.FAIL_ON_CONFIRM:
            raise CreditCardConfirmError(
                "사용자가 신용카드 결제 폼에서 취소했거나 카드 한도를 초과했습니다",
                error_code="CARD_PAYMENT_CANCELED",
            )

        return {
            "paymentKey": payment_key,
            "orderId": order_id,
            "totalAmount": amount,
            "cardType": "신용",
            "status": "APPROVED",
        }

    async def cancel_payment(
        self,
        *,
        payment_key: str,
        cancel_reason: str,
        cancel_amount: int | None,
    ) -> dict[str, Any]:
        kwargs_cancel: dict[str, Any] = {
            "payment_key": payment_key,
            "cancel_reason": cancel_reason,
            "cancel_amount": cancel_amount,
        }
        self.calls.append(("cancel_payment", kwargs_cancel))

        effective_cancel_amount = cancel_amount if cancel_amount is not None else 0
        return {
            "paymentKey": payment_key,
            "cancelAmount": effective_cancel_amount,
            "status": "CANCELED",
        }


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class CreditCardAdapter:
    """애플리케이션 레벨 신용카드 PG 결제 어댑터.

    주입된 ``CreditCardSDKProtocol`` 구현을 감싸고 벤더 응답을 도메인 레벨 결과
    객체로 변환한다.  어댑터는 신용카드 PG 전용 응답 구조를 아는 **유일한**
    장소이다.

    Parameters
    ----------
    sdk:
        ``CreditCardSDKProtocol``을 만족하는 임의의 객체.  단위 테스트에서는
        ``MockCreditCardSDK``를 주입하고, 프로덕션에서는 ``RealCreditCardSDK``를
        사용한다.

    Invariants
    ----------
    * ``initiate`` 는 성공 시 항상 ``CreditCardReadyResult``를 반환하거나
      ``CreditCardInitiateError``를 발생시킨다.
    * ``confirm`` 은 성공 시 항상 ``CreditCardConfirmResult``를 반환하거나
      ``CreditCardConfirmError``를 발생시킨다.
    * ``cancel`` 은 성공 시 항상 ``CreditCardCancelResult``를 반환하거나
      ``CreditCardCancelError``를 발생시킨다.
    """

    # 기본 PG 콜백 URL (호출자가 재정의하지 않을 때 사용).
    DEFAULT_SUCCESS_URL = "https://personalcolor.kr/payment/success"
    DEFAULT_FAIL_URL = "https://personalcolor.kr/payment/fail"

    def __init__(self, sdk: CreditCardSDKProtocol) -> None:
        self._sdk = sdk

    async def initiate(
        self,
        *,
        order_id: str,
        amount_krw: int,
        order_name: str = "Picko 구독",
        success_url: str = DEFAULT_SUCCESS_URL,
        fail_url: str = DEFAULT_FAIL_URL,
    ) -> CreditCardReadyResult:
        """신용카드 PG 결제 세션을 생성한다.

        PG 결제 세션을 생성하고 사용자를 리다이렉트할 카드 입력 폼 URL이 담긴
        ``CreditCardReadyResult``를 반환한다.

        Parameters
        ----------
        order_id:
            호출자가 생성한 이 주문의 고유 식별자.
        amount_krw:
            결제 금액 (원화, 예: 월간 구독 ``12000``, 연간 구독 ``59000``).
        order_name:
            카드 입력 폼에 표시되는 주문명.
        success_url:
            사용자가 카드 입력을 완료한 후 PG가 리다이렉트하는 콜백 URL.
        fail_url:
            결제 실패 시 PG가 리다이렉트하는 콜백 URL.

        Returns
        -------
        CreditCardReadyResult
            결제 세션 ID와 카드 입력 폼 URL.

        Raises
        ------
        CreditCardInitiateError
            신용카드 PG SDK가 결제 세션 생성을 거부하면 발생.
        """
        raw = await self._sdk.create_payment_session(
            order_id=order_id,
            amount=amount_krw,
            order_name=order_name,
            success_url=success_url,
            fail_url=fail_url,
        )
        return CreditCardReadyResult(
            payment_id=str(raw["payment_id"]),
            payment_form_url=str(raw["payment_form_url"]),
        )

    async def confirm(
        self,
        *,
        payment_key: str,
        order_id: str,
        amount_krw: int,
    ) -> CreditCardConfirmResult:
        """사용자가 카드 폼을 완료한 후 신용카드 결제를 서버에서 확정한다.

        사용자가 PG 카드 입력 폼에서 결제를 완료한 후 서버의 ``success_url``
        콜백 핸들러에서 호출해야 한다. ``payment_key``, ``order_id``, ``amount``는
        PG가 콜백 리다이렉트에 쿼리 파라미터로 제공한다.

        Parameters
        ----------
        payment_key:
            PG가 발급한 결제 키 (success_url 쿼리 파라미터).
        order_id:
            ``initiate``에서 사용한 것과 동일한 주문 ID.
        amount_krw:
            확인할 결제 금액 (원화). PG의 금액 불일치 방지 검증에 사용된다.

        Returns
        -------
        CreditCardConfirmResult
            확정된 결제 세부 정보.

        Raises
        ------
        CreditCardConfirmError
            PG가 확정을 거부하면 발생 (사용자 취소, 카드 한도 초과, 이중 승인).
        """
        raw = await self._sdk.confirm_payment(
            payment_key=payment_key,
            order_id=order_id,
            amount=amount_krw,
        )
        return CreditCardConfirmResult(
            payment_key=str(raw["paymentKey"]),
            order_id=str(raw["orderId"]),
            amount_krw=int(raw["totalAmount"]),
            card_type=str(raw["cardType"]),
            status=str(raw["status"]),
        )

    async def cancel(
        self,
        *,
        payment_key: str,
        cancel_reason: str,
        cancel_amount_krw: int | None = None,
    ) -> CreditCardCancelResult:
        """승인된 신용카드 결제를 취소(환불)한다.

        Parameters
        ----------
        payment_key:
            취소할 결제의 PG 결제 키.
        cancel_reason:
            취소 사유 (PG 대시보드에 기록됨).
        cancel_amount_krw:
            환불 금액 (원화).  ``None``이면 전액 환불.
            부분 환불 시 원래 금액보다 작은 값을 전달한다.

        Returns
        -------
        CreditCardCancelResult
            취소 결과와 새로운 결제 상태.

        Raises
        ------
        CreditCardCancelError
            PG가 취소 요청을 거부하면 발생 (이미 환불됨, 잘못된 payment_key 등).
        """
        raw = await self._sdk.cancel_payment(
            payment_key=payment_key,
            cancel_reason=cancel_reason,
            cancel_amount=cancel_amount_krw,
        )
        return CreditCardCancelResult(
            payment_key=str(raw["paymentKey"]),
            cancel_amount_krw=int(raw["cancelAmount"]),
            status=str(raw["status"]),
        )


__all__ = [
    "CreditCardAdapter",
    "CreditCardCancelError",
    "CreditCardCancelResult",
    "CreditCardConfirmError",
    "CreditCardConfirmResult",
    "CreditCardError",
    "CreditCardInitiateError",
    "CreditCardReadyResult",
    "CreditCardSDKProtocol",
    "CreditCardScenario",
    "MockCreditCardSDK",
]
