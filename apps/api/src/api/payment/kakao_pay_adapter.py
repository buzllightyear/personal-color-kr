"""KakaoPay adapter module — commoditized payment wrapper (Korean market).

What this module does
---------------------
Wraps the KakaoPay payment SDK behind an application-level protocol so the
rest of the codebase never imports vendor-specific types directly.  The
adapter is the **only** caller of the KakaoPay SDK; every other module
depends on the domain-level result types defined here.

KakaoPay payment lifecycle (v1 simplified):
    1. ``initiate``  — POST to KakaoPay ``/v1/payment/ready``.  Returns a
       ``tid`` (transaction ID) and a mobile/web redirect URL.  The caller
       redirects the user to the KakaoPay checkout page.
    2. ``confirm``   — After the user approves, KakaoPay POSTs a ``pg_token``
       to the app's callback URL.  The app calls KakaoPay
       ``/v1/payment/approve`` with ``tid`` + ``pg_token``.
    3. ``cancel``    — Cancel a previously approved payment via KakaoPay
       ``/v1/payment/cancel``.  Used for refunds and test teardown.

Seed constraints honored
-------------------------
- KakaoPay SDK = commodity vendor wrapping; no custom ML model.
- Adapter does NOT bypass via raw HTTP in production code — the
  ``KakaoPaySDKProtocol`` abstraction is the only surface exposed to callers.
- The mock SDK (``MockKakaoPaySDK``) is the *only* test double; unit tests
  must not monkey-patch raw HTTP calls.

Usage
-----
Production::

    from api.payment.kakao_pay_adapter import KakaoPayAdapter
    from api.payment.real_kakao_pay_sdk import RealKakaoPaySDK

    adapter = KakaoPayAdapter(sdk=RealKakaoPaySDK(cid="TC0ONETIME", ...))
    result = await adapter.initiate(order_id="ord-123", user_id="usr-456", amount_krw=12000)

Testing::

    from api.payment.kakao_pay_adapter import KakaoPayAdapter, MockKakaoPaySDK

    sdk = MockKakaoPaySDK(scenario="success")
    adapter = KakaoPayAdapter(sdk=sdk)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol

# ---------------------------------------------------------------------------
# Domain value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PaymentReadyResult:
    """Successful result of the payment-initiation step.

    Attributes
    ----------
    tid:
        KakaoPay transaction ID.  Must be passed to ``confirm`` and
        ``cancel`` unchanged.
    next_redirect_mobile_url:
        The KakaoPay-hosted checkout URL to redirect the mobile user to.
    """

    tid: str
    next_redirect_mobile_url: str


@dataclass(frozen=True)
class PaymentApproveResult:
    """Successful result of the payment-confirmation step.

    Attributes
    ----------
    tid:
        The confirmed transaction ID (echoed from ``initiate``).
    order_id:
        The caller-supplied order identifier (echoed for correlation).
    amount_krw:
        The approved amount in Korean Won.
    payment_method_type:
        The payment method used (e.g. ``"CARD"``, ``"MONEY"``).
    """

    tid: str
    order_id: str
    amount_krw: int
    payment_method_type: str


@dataclass(frozen=True)
class PaymentCancelResult:
    """Successful result of a payment-cancellation request.

    Attributes
    ----------
    tid:
        The cancelled transaction ID.
    cancel_amount_krw:
        The amount that was cancelled in Korean Won.
    status:
        The new payment status after cancellation (typically
        ``"CANCEL_PAYMENT"``).
    """

    tid: str
    cancel_amount_krw: int
    status: str


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class KakaoPayError(Exception):
    """Base class for all KakaoPay adapter errors."""

    def __init__(self, message: str, error_code: str | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code


class KakaoPayInitiateError(KakaoPayError):
    """Raised when the payment-initiation step fails (e.g. invalid CID)."""


class KakaoPayConfirmError(KakaoPayError):
    """Raised when the payment-confirmation step fails.

    Common causes: expired ``pg_token``, user-cancelled on the KakaoPay
    checkout page, or a duplicate-approval attempt.
    """


class KakaoPayCancelError(KakaoPayError):
    """Raised when the cancellation request is rejected by KakaoPay."""


# ---------------------------------------------------------------------------
# SDK abstraction
# ---------------------------------------------------------------------------


class KakaoPaySDKProtocol(Protocol):
    """Structural interface that any KakaoPay SDK implementation must satisfy.

    Both ``RealKakaoPaySDK`` (production) and ``MockKakaoPaySDK`` (tests)
    implement this protocol.  The adapter depends *only* on this protocol;
    it never imports vendor classes directly.
    """

    async def ready(
        self,
        *,
        order_id: str,
        user_id: str,
        item_name: str,
        quantity: int,
        total_amount: int,
        tax_free_amount: int,
        approval_url: str,
        fail_url: str,
        cancel_url: str,
    ) -> dict[str, Any]:
        """POST /v1/payment/ready — initiate a new payment."""
        ...  # pragma: no cover

    async def approve(
        self,
        *,
        tid: str,
        order_id: str,
        user_id: str,
        pg_token: str,
    ) -> dict[str, Any]:
        """POST /v1/payment/approve — confirm a user-approved payment."""
        ...  # pragma: no cover

    async def cancel(
        self,
        *,
        tid: str,
        cancel_amount: int,
        cancel_tax_free_amount: int,
    ) -> dict[str, Any]:
        """POST /v1/payment/cancel — cancel (refund) a payment."""
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# Mock SDK (for unit tests only)
# ---------------------------------------------------------------------------


class PaymentScenario(str, Enum):
    """Pre-programmed scenarios that ``MockKakaoPaySDK`` can simulate."""

    SUCCESS = "success"
    """Payment is initiated, approved, and cancelled without errors."""

    FAIL_ON_READY = "fail_on_ready"
    """``ready()`` raises ``KakaoPayInitiateError`` (invalid CID etc.)."""

    FAIL_ON_APPROVE = "fail_on_approve"
    """``approve()`` raises ``KakaoPayConfirmError`` (user cancels, expired token)."""

    CANCEL_PAYMENT = "cancel_payment"
    """Payment is initiated and approved; ``cancel()`` succeeds."""


class MockKakaoPaySDK:
    """In-process test double for the KakaoPay SDK.

    Simulates the three core payment scenarios — success, failure, and
    cancellation — without making any network calls.

    Parameters
    ----------
    scenario:
        One of ``PaymentScenario``.  Controls which operations succeed and
        which raise errors.

    Usage
    -----
    ::

        sdk = MockKakaoPaySDK(scenario=PaymentScenario.SUCCESS)
        adapter = KakaoPayAdapter(sdk=sdk)
        result = await adapter.initiate(...)

    The mock records every call in the ``calls`` list for assertion.
    Each entry is a ``(method_name, kwargs)`` tuple.
    """

    def __init__(
        self, scenario: PaymentScenario | str = PaymentScenario.SUCCESS
    ) -> None:
        self._scenario = PaymentScenario(scenario)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    # --- protocol implementation -------------------------------------------

    async def ready(
        self,
        *,
        order_id: str,
        user_id: str,
        item_name: str,
        quantity: int,
        total_amount: int,
        tax_free_amount: int,
        approval_url: str,
        fail_url: str,
        cancel_url: str,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "order_id": order_id,
            "user_id": user_id,
            "item_name": item_name,
            "quantity": quantity,
            "total_amount": total_amount,
            "tax_free_amount": tax_free_amount,
            "approval_url": approval_url,
            "fail_url": fail_url,
            "cancel_url": cancel_url,
        }
        self.calls.append(("ready", kwargs))

        if self._scenario == PaymentScenario.FAIL_ON_READY:
            raise KakaoPayInitiateError(
                "Invalid CID — payment initiation rejected by KakaoPay",
                error_code="INVALID_REQUEST",
            )

        return {
            "tid": f"mock-tid-{order_id}",
            "next_redirect_mobile_url": (
                f"https://mockpay.kakao.com/app/payment/{order_id}"
            ),
        }

    async def approve(
        self,
        *,
        tid: str,
        order_id: str,
        user_id: str,
        pg_token: str,
    ) -> dict[str, Any]:
        kwargs_approve: dict[str, Any] = {
            "tid": tid,
            "order_id": order_id,
            "user_id": user_id,
            "pg_token": pg_token,
        }
        self.calls.append(("approve", kwargs_approve))

        if self._scenario == PaymentScenario.FAIL_ON_APPROVE:
            raise KakaoPayConfirmError(
                "User cancelled payment on the KakaoPay checkout page",
                error_code="USER_CANCEL",
            )

        return {
            "tid": tid,
            "order_id": order_id,
            "total_amount": 12000,
            "payment_method_type": "CARD",
        }

    async def cancel(
        self,
        *,
        tid: str,
        cancel_amount: int,
        cancel_tax_free_amount: int,
    ) -> dict[str, Any]:
        kwargs_cancel: dict[str, Any] = {
            "tid": tid,
            "cancel_amount": cancel_amount,
            "cancel_tax_free_amount": cancel_tax_free_amount,
        }
        self.calls.append(("cancel", kwargs_cancel))

        return {
            "tid": tid,
            "cancel_amount": cancel_amount,
            "status": "CANCEL_PAYMENT",
        }


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class KakaoPayAdapter:
    """Application-level KakaoPay payment adapter.

    Wraps an injected ``KakaoPaySDKProtocol`` implementation and translates
    vendor responses into domain-level result objects.  The adapter is the
    **only** place in the application that knows about KakaoPay-specific
    response shapes.

    Parameters
    ----------
    sdk:
        Any object that satisfies ``KakaoPaySDKProtocol``.  Pass
        ``MockKakaoPaySDK`` in unit tests and ``RealKakaoPaySDK`` in
        production.

    Invariants
    ----------
    * ``initiate`` always returns a ``PaymentReadyResult`` on success,
      or raises ``KakaoPayInitiateError``.
    * ``confirm`` always returns a ``PaymentApproveResult`` on success,
      or raises ``KakaoPayConfirmError``.
    * ``cancel`` always returns a ``PaymentCancelResult`` on success,
      or raises ``KakaoPayCancelError``.
    """

    # Default KakaoPay callback URLs used when callers do not override them.
    DEFAULT_APPROVAL_URL = "https://personalcolor.kr/payment/success"
    DEFAULT_FAIL_URL = "https://personalcolor.kr/payment/fail"
    DEFAULT_CANCEL_URL = "https://personalcolor.kr/payment/cancel"

    def __init__(self, sdk: KakaoPaySDKProtocol) -> None:
        self._sdk = sdk

    async def initiate(
        self,
        *,
        order_id: str,
        user_id: str,
        amount_krw: int,
        item_name: str = "Picko 구독",
        quantity: int = 1,
        approval_url: str = DEFAULT_APPROVAL_URL,
        fail_url: str = DEFAULT_FAIL_URL,
        cancel_url: str = DEFAULT_CANCEL_URL,
    ) -> PaymentReadyResult:
        """Initiate a new KakaoPay payment.

        Calls the KakaoPay ``/v1/payment/ready`` endpoint and returns a
        ``PaymentReadyResult`` containing the ``tid`` and the mobile
        redirect URL for the checkout page.

        Parameters
        ----------
        order_id:
            Caller-generated unique identifier for this order.
        user_id:
            The authenticated user's ID (used by KakaoPay for deduplication
            and fraud detection).
        amount_krw:
            Total payment amount in Korean Won (e.g. ``12000`` for the
            monthly subscription, ``59000`` for annual).
        item_name:
            Human-readable product description shown on the checkout page.
        quantity:
            Number of items; typically ``1`` for a subscription.
        approval_url:
            Callback URL KakaoPay redirects to after the user approves.
        fail_url:
            Callback URL KakaoPay redirects to on payment failure.
        cancel_url:
            Callback URL KakaoPay redirects to if the user cancels.

        Returns
        -------
        PaymentReadyResult
            The initiated payment's ``tid`` and mobile redirect URL.

        Raises
        ------
        KakaoPayInitiateError
            If the KakaoPay SDK rejects the initiation request.
        """
        raw = await self._sdk.ready(
            order_id=order_id,
            user_id=user_id,
            item_name=item_name,
            quantity=quantity,
            total_amount=amount_krw,
            tax_free_amount=0,
            approval_url=approval_url,
            fail_url=fail_url,
            cancel_url=cancel_url,
        )
        return PaymentReadyResult(
            tid=str(raw["tid"]),
            next_redirect_mobile_url=str(raw["next_redirect_mobile_url"]),
        )

    async def confirm(
        self,
        *,
        tid: str,
        order_id: str,
        user_id: str,
        pg_token: str,
    ) -> PaymentApproveResult:
        """Confirm (approve) a user-authorized KakaoPay payment.

        Must be called from the server's ``approval_url`` callback handler
        after the user completes authorization on the KakaoPay checkout page.
        The ``pg_token`` is provided by KakaoPay as a query parameter on the
        callback redirect.

        Parameters
        ----------
        tid:
            Transaction ID returned by :meth:`initiate`.
        order_id:
            The same order ID used in :meth:`initiate`.
        user_id:
            The same user ID used in :meth:`initiate`.
        pg_token:
            Short-lived token KakaoPay appends to the approval callback URL.

        Returns
        -------
        PaymentApproveResult
            The confirmed transaction details.

        Raises
        ------
        KakaoPayConfirmError
            If KakaoPay rejects the approval (user cancelled, token expired,
            or duplicate approval attempt).
        """
        raw = await self._sdk.approve(
            tid=tid,
            order_id=order_id,
            user_id=user_id,
            pg_token=pg_token,
        )
        return PaymentApproveResult(
            tid=str(raw["tid"]),
            order_id=str(raw["order_id"]),
            amount_krw=int(raw["total_amount"]),
            payment_method_type=str(raw["payment_method_type"]),
        )

    async def cancel(
        self,
        *,
        tid: str,
        cancel_amount_krw: int,
    ) -> PaymentCancelResult:
        """Cancel (refund) an approved KakaoPay payment.

        Parameters
        ----------
        tid:
            Transaction ID of the payment to cancel.
        cancel_amount_krw:
            Amount to refund in Korean Won.  May be partial (less than the
            original ``amount_krw``) for partial refunds.

        Returns
        -------
        PaymentCancelResult
            The cancellation result with the new transaction status.

        Raises
        ------
        KakaoPayCancelError
            If KakaoPay rejects the cancellation request (already refunded,
            invalid TID, etc.).
        """
        raw = await self._sdk.cancel(
            tid=tid,
            cancel_amount=cancel_amount_krw,
            cancel_tax_free_amount=0,
        )
        return PaymentCancelResult(
            tid=str(raw["tid"]),
            cancel_amount_krw=int(raw["cancel_amount"]),
            status=str(raw["status"]),
        )


__all__ = [
    "KakaoPayAdapter",
    "KakaoPayCancelError",
    "KakaoPayConfirmError",
    "KakaoPayError",
    "KakaoPayInitiateError",
    "KakaoPaySDKProtocol",
    "MockKakaoPaySDK",
    "PaymentApproveResult",
    "PaymentCancelResult",
    "PaymentReadyResult",
    "PaymentScenario",
]
