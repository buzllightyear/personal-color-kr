"""Payment adapters for the Korean market (Phase moat v0).

This package provides the server-side payment adapter layer for KakaoPay,
Toss Payments, and credit card PG (primary payment methods in the Korean market).

Architecture
------------
The adapter pattern decouples the application from the vendor SDK:

    KakaoPayAdapter / TossAdapter / CreditCardAdapter  <- application boundary
         |
    KakaoPaySDKProtocol / TossSDKProtocol / CreditCardSDKProtocol  <- abstraction (Protocol)
         |
    Real*SDK / Mock*SDK                <- implementations

Production code constructs ``KakaoPayAdapter(RealKakaoPaySDK(...))``;  unit
tests inject ``MockKakaoPaySDK`` without any network I/O.

Likewise for Toss Payments:
Production code constructs ``TossAdapter(RealTossSDK(...))``;  unit
tests inject ``MockTossSDK`` without any network I/O.

Likewise for credit card PG:
Production code constructs ``CreditCardAdapter(RealCreditCardSDK(...))``;  unit
tests inject ``MockCreditCardSDK`` without any network I/O.
"""

from api.payment.credit_card_adapter import (
    CreditCardAdapter,
    CreditCardCancelError,
    CreditCardCancelResult,
    CreditCardConfirmError,
    CreditCardConfirmResult,
    CreditCardError,
    CreditCardInitiateError,
    CreditCardReadyResult,
    CreditCardSDKProtocol,
)
from api.payment.kakao_pay_adapter import (
    KakaoPayAdapter,
    KakaoPayCancelError,
    KakaoPayError,
    KakaoPayInitiateError,
    KakaoPaySDKProtocol,
    PaymentApproveResult,
    PaymentCancelResult,
    PaymentReadyResult,
)
from api.payment.toss_adapter import (
    TossAdapter,
    TossCancelError,
    TossConfirmError,
    TossInitiateError,
    TossPaymentCancelResult,
    TossPaymentConfirmResult,
    TossPaymentError,
    TossPaymentReadyResult,
    TossSDKProtocol,
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
    "KakaoPayAdapter",
    "KakaoPayCancelError",
    "KakaoPayError",
    "KakaoPayInitiateError",
    "KakaoPaySDKProtocol",
    "PaymentApproveResult",
    "PaymentCancelResult",
    "PaymentReadyResult",
    "TossAdapter",
    "TossCancelError",
    "TossConfirmError",
    "TossInitiateError",
    "TossPaymentCancelResult",
    "TossPaymentConfirmResult",
    "TossPaymentError",
    "TossPaymentReadyResult",
    "TossSDKProtocol",
]
