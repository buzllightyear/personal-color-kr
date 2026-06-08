"""Toss Payments 어댑터 모듈 — 한국 시장 commoditized 결제 래퍼 (Sub-AC 2-3).

What this module does
---------------------
토스페이먼츠(Toss Payments) SDK를 애플리케이션 레벨 프로토콜로 감싸서
나머지 코드가 벤더 전용 타입을 직접 import하지 않도록 분리한다.
어댑터는 Toss SDK의 **유일한** 호출자이며, 다른 모든 모듈은 여기서 정의한
도메인 레벨 결과 타입에만 의존한다.

Toss Payments 결제 라이프사이클 (v1 간략화):
    1. ``initiate``  — 클라이언트가 Toss SDK(또는 위젯)로 결제를 요청하면
       서버는 orderId, amount, orderName을 결제 세션에 기록한다.
       Toss 서버는 ``successUrl`` / ``failUrl``로 리다이렉트한다.
    2. ``confirm``   — 사용자 승인 후 Toss가 ``paymentKey``, ``orderId``,
       ``amount``를 ``successUrl``에 쿼리 파라미터로 전달한다.
       서버는 Toss ``POST /v1/payments/confirm`` 을 호출해 결제를 확정한다.
    3. ``cancel``    — 승인된 결제를 취소(환불)하려면 Toss
       ``POST /v1/payments/{paymentKey}/cancel`` 을 호출한다.
       전액 및 부분 취소 모두 지원한다.

Seed constraints honored
-------------------------
- Toss Payments SDK = commodity vendor wrapping; 자체 ML 모델 없음.
- 어댑터는 프로덕션 코드에서 raw HTTP를 직접 호출하지 않는다 —
  ``TossSDKProtocol`` 추상화가 호출자에게 노출되는 유일한 표면이다.
- ``MockTossSDK``가 유일한 테스트 더블이다; 단위 테스트는 raw HTTP를
  monkey-patch 하지 않는다.

Usage
-----
Production::

    from api.payment.toss_adapter import TossAdapter
    from api.payment.real_toss_sdk import RealTossSDK

    adapter = TossAdapter(sdk=RealTossSDK(secret_key="test_sk_..."))
    result = await adapter.initiate(
        order_id="ord-123",
        amount_krw=12000,
        order_name="Picko 월간 구독",
    )

Testing::

    from api.payment.toss_adapter import TossAdapter, MockTossSDK, TossScenario

    sdk = MockTossSDK(scenario=TossScenario.SUCCESS)
    adapter = TossAdapter(sdk=sdk)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol

# ---------------------------------------------------------------------------
# Domain value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TossPaymentReadyResult:
    """결제 요청(initiate) 단계의 성공 결과.

    Attributes
    ----------
    order_id:
        호출자가 생성한 고유 주문 식별자.  confirm 및 cancel 호출 시
        동일 값을 그대로 전달해야 한다.
    checkout_url:
        사용자를 리다이렉트할 Toss 결제 페이지 URL.
    """

    order_id: str
    checkout_url: str


@dataclass(frozen=True)
class TossPaymentConfirmResult:
    """결제 확정(confirm) 단계의 성공 결과.

    Attributes
    ----------
    payment_key:
        Toss가 발급한 결제 고유 키.  취소(cancel) 시 필요하다.
    order_id:
        요청 시 전달된 주문 식별자 (상관 관계 추적용).
    amount_krw:
        승인된 금액 (원화).
    method:
        결제 수단 (예: ``"카드"``, ``"가상계좌"``, ``"간편결제"``).
    status:
        Toss 결제 상태 (예: ``"DONE"``).
    """

    payment_key: str
    order_id: str
    amount_krw: int
    method: str
    status: str


@dataclass(frozen=True)
class TossPaymentCancelResult:
    """결제 취소(cancel) 요청의 성공 결과.

    Attributes
    ----------
    payment_key:
        취소된 결제의 Toss 결제 키.
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


class TossPaymentError(Exception):
    """Toss Payments 어댑터 에러의 기본 클래스."""

    def __init__(self, message: str, error_code: str | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code


class TossInitiateError(TossPaymentError):
    """결제 요청 단계가 실패했을 때 발생 (예: 잘못된 secretKey, 금액 오류)."""


class TossConfirmError(TossPaymentError):
    """결제 확정 단계가 실패했을 때 발생.

    주요 원인: 만료된 paymentKey, 금액 불일치, 이중 승인 시도,
    사용자가 Toss 결제 페이지에서 취소.
    """


class TossCancelError(TossPaymentError):
    """취소 요청을 Toss가 거부했을 때 발생 (이미 환불됨, 잘못된 paymentKey 등)."""


# ---------------------------------------------------------------------------
# SDK abstraction
# ---------------------------------------------------------------------------


class TossSDKProtocol(Protocol):
    """Toss SDK 구현체가 반드시 만족해야 하는 구조적 인터페이스.

    ``RealTossSDK`` (프로덕션)와 ``MockTossSDK`` (테스트) 모두 이 프로토콜을
    구현한다.  어댑터는 이 프로토콜에만 의존하며 벤더 클래스를 직접 임포트하지
    않는다.
    """

    async def request_payment(
        self,
        *,
        order_id: str,
        amount: int,
        order_name: str,
        success_url: str,
        fail_url: str,
    ) -> dict[str, Any]:
        """결제 요청 세션을 생성하고 체크아웃 URL을 반환한다."""
        ...  # pragma: no cover

    async def confirm_payment(
        self,
        *,
        payment_key: str,
        order_id: str,
        amount: int,
    ) -> dict[str, Any]:
        """POST /v1/payments/confirm — 사용자가 승인한 결제를 서버에서 확정한다."""
        ...  # pragma: no cover

    async def cancel_payment(
        self,
        *,
        payment_key: str,
        cancel_reason: str,
        cancel_amount: int | None,
    ) -> dict[str, Any]:
        """POST /v1/payments/{paymentKey}/cancel — 결제를 취소(환불)한다."""
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# Mock SDK (for unit tests only)
# ---------------------------------------------------------------------------


class TossScenario(str, Enum):
    """``MockTossSDK``가 시뮬레이션할 수 있는 사전 프로그래밍된 시나리오."""

    SUCCESS = "success"
    """결제 요청, 확정, 취소 모두 오류 없이 성공한다."""

    FAIL_ON_REQUEST = "fail_on_request"
    """``request_payment()``가 ``TossInitiateError``를 발생시킨다 (잘못된 secretKey 등)."""

    FAIL_ON_CONFIRM = "fail_on_confirm"
    """``confirm_payment()``가 ``TossConfirmError``를 발생시킨다 (사용자 취소, 토큰 만료)."""

    CANCEL_PAYMENT = "cancel_payment"
    """결제 요청 및 확정 성공 후 ``cancel_payment()``가 성공한다."""


class MockTossSDK:
    """Toss SDK의 인프로세스 테스트 더블.

    네트워크 호출 없이 세 가지 핵심 결제 시나리오 — 성공, 실패, 취소 —
    를 시뮬레이션한다.

    Parameters
    ----------
    scenario:
        ``TossScenario`` 중 하나.  어떤 연산이 성공하고 어떤 연산이
        에러를 발생시킬지 제어한다.

    Usage
    -----
    ::

        sdk = MockTossSDK(scenario=TossScenario.SUCCESS)
        adapter = TossAdapter(sdk=sdk)
        result = await adapter.initiate(...)

    모든 호출은 ``calls`` 리스트에 ``(method_name, kwargs)`` 튜플로 기록된다.
    """

    def __init__(self, scenario: TossScenario | str = TossScenario.SUCCESS) -> None:
        self._scenario = TossScenario(scenario)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    # --- protocol implementation -------------------------------------------

    async def request_payment(
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
        self.calls.append(("request_payment", kwargs))

        if self._scenario == TossScenario.FAIL_ON_REQUEST:
            raise TossInitiateError(
                "Toss 결제 요청이 거부됐습니다 — 잘못된 secretKey 또는 금액 오류",
                error_code="INVALID_REQUEST",
            )

        return {
            "order_id": order_id,
            "checkout_url": (f"https://mockpay.toss.im/checkout/{order_id}"),
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

        if self._scenario == TossScenario.FAIL_ON_CONFIRM:
            raise TossConfirmError(
                "사용자가 Toss 결제 페이지에서 취소했습니다",
                error_code="PAY_PROCESS_CANCELED",
            )

        return {
            "paymentKey": payment_key,
            "orderId": order_id,
            "totalAmount": amount,
            "method": "카드",
            "status": "DONE",
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


class TossAdapter:
    """애플리케이션 레벨 Toss Payments 결제 어댑터.

    주입된 ``TossSDKProtocol`` 구현을 감싸고 벤더 응답을 도메인 레벨 결과
    객체로 변환한다.  어댑터는 Toss 전용 응답 구조를 아는 **유일한** 장소이다.

    Parameters
    ----------
    sdk:
        ``TossSDKProtocol``을 만족하는 임의의 객체.  단위 테스트에서는
        ``MockTossSDK``를 주입하고, 프로덕션에서는 ``RealTossSDK``를 사용한다.

    Invariants
    ----------
    * ``initiate`` 는 성공 시 항상 ``TossPaymentReadyResult``를 반환하거나
      ``TossInitiateError``를 발생시킨다.
    * ``confirm`` 은 성공 시 항상 ``TossPaymentConfirmResult``를 반환하거나
      ``TossConfirmError``를 발생시킨다.
    * ``cancel`` 은 성공 시 항상 ``TossPaymentCancelResult``를 반환하거나
      ``TossCancelError``를 발생시킨다.
    """

    # 기본 Toss 콜백 URL (호출자가 재정의하지 않을 때 사용).
    DEFAULT_SUCCESS_URL = "https://personalcolor.kr/payment/success"
    DEFAULT_FAIL_URL = "https://personalcolor.kr/payment/fail"

    def __init__(self, sdk: TossSDKProtocol) -> None:
        self._sdk = sdk

    async def initiate(
        self,
        *,
        order_id: str,
        amount_krw: int,
        order_name: str = "Picko 구독",
        success_url: str = DEFAULT_SUCCESS_URL,
        fail_url: str = DEFAULT_FAIL_URL,
    ) -> TossPaymentReadyResult:
        """새로운 Toss 결제를 요청한다.

        결제 세션을 생성하고 사용자를 리다이렉트할 체크아웃 URL이 담긴
        ``TossPaymentReadyResult``를 반환한다.

        Parameters
        ----------
        order_id:
            호출자가 생성한 이 주문의 고유 식별자.
        amount_krw:
            결제 금액 (원화, 예: 월간 구독 ``12000``, 연간 구독 ``59000``).
        order_name:
            체크아웃 페이지에 표시되는 주문명.
        success_url:
            사용자가 승인한 후 Toss가 리다이렉트하는 콜백 URL.
        fail_url:
            결제 실패 시 Toss가 리다이렉트하는 콜백 URL.

        Returns
        -------
        TossPaymentReadyResult
            주문 ID와 체크아웃 URL.

        Raises
        ------
        TossInitiateError
            Toss SDK가 결제 요청을 거부하면 발생.
        """
        raw = await self._sdk.request_payment(
            order_id=order_id,
            amount=amount_krw,
            order_name=order_name,
            success_url=success_url,
            fail_url=fail_url,
        )
        return TossPaymentReadyResult(
            order_id=str(raw["order_id"]),
            checkout_url=str(raw["checkout_url"]),
        )

    async def confirm(
        self,
        *,
        payment_key: str,
        order_id: str,
        amount_krw: int,
    ) -> TossPaymentConfirmResult:
        """사용자가 승인한 Toss 결제를 서버에서 확정한다.

        사용자가 Toss 체크아웃 페이지에서 결제를 완료한 후 서버의
        ``success_url`` 콜백 핸들러에서 호출해야 한다.
        ``payment_key``, ``order_id``, ``amount``는 Toss가 콜백 리다이렉트에
        쿼리 파라미터로 제공한다.

        Parameters
        ----------
        payment_key:
            Toss가 발급한 결제 키 (successUrl 쿼리 파라미터).
        order_id:
            ``initiate`` 에서 사용한 것과 동일한 주문 ID.
        amount_krw:
            확인할 결제 금액 (원화). Toss의 금액 불일치 방지 검증에 사용된다.

        Returns
        -------
        TossPaymentConfirmResult
            확정된 결제 세부 정보.

        Raises
        ------
        TossConfirmError
            Toss가 확정을 거부하면 발생 (사용자 취소, 금액 불일치, 이중 승인).
        """
        raw = await self._sdk.confirm_payment(
            payment_key=payment_key,
            order_id=order_id,
            amount=amount_krw,
        )
        return TossPaymentConfirmResult(
            payment_key=str(raw["paymentKey"]),
            order_id=str(raw["orderId"]),
            amount_krw=int(raw["totalAmount"]),
            method=str(raw["method"]),
            status=str(raw["status"]),
        )

    async def cancel(
        self,
        *,
        payment_key: str,
        cancel_reason: str,
        cancel_amount_krw: int | None = None,
    ) -> TossPaymentCancelResult:
        """승인된 Toss 결제를 취소(환불)한다.

        Parameters
        ----------
        payment_key:
            취소할 결제의 Toss 결제 키.
        cancel_reason:
            취소 사유 (Toss 대시보드에 기록됨).
        cancel_amount_krw:
            환불 금액 (원화).  ``None``이면 전액 환불.
            부분 환불 시 원래 금액보다 작은 값을 전달한다.

        Returns
        -------
        TossPaymentCancelResult
            취소 결과와 새로운 결제 상태.

        Raises
        ------
        TossCancelError
            Toss가 취소 요청을 거부하면 발생 (이미 환불됨, 잘못된 paymentKey 등).
        """
        raw = await self._sdk.cancel_payment(
            payment_key=payment_key,
            cancel_reason=cancel_reason,
            cancel_amount=cancel_amount_krw,
        )
        return TossPaymentCancelResult(
            payment_key=str(raw["paymentKey"]),
            cancel_amount_krw=int(raw["cancelAmount"]),
            status=str(raw["status"]),
        )


__all__ = [
    "MockTossSDK",
    "TossAdapter",
    "TossCancelError",
    "TossConfirmError",
    "TossInitiateError",
    "TossPaymentCancelResult",
    "TossPaymentConfirmResult",
    "TossPaymentError",
    "TossPaymentReadyResult",
    "TossSDKProtocol",
    "TossScenario",
]
