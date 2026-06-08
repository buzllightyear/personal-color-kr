"""Unit tests for the KakaoPay adapter module (Sub-AC 2-2).

Coverage
--------
Three payment scenarios are fully exercised against the ``MockKakaoPaySDK``:

1. **Success** — initiate → confirm → (optional cancel) all succeed and return
   the correct domain-level result objects.
2. **Failure** — ``ready()`` or ``approve()`` raises the expected adapter
   exception; no writes to the DB (tested with call-count assertions).
3. **Cancel** — initiate and confirm succeed, then ``cancel()`` returns a
   ``PaymentCancelResult`` with ``status == "CANCEL_PAYMENT"``.

Design notes
------------
* No network calls: ``MockKakaoPaySDK`` is pure in-process.
* No DB: the adapter layer has no ORM dependency.
* Each test constructs its own ``KakaoPayAdapter(sdk=MockKakaoPaySDK(...))``.
* Call counts on ``sdk.calls`` verify that each step calls exactly the
  expected SDK method.
"""

from __future__ import annotations

import pytest

from api.payment.kakao_pay_adapter import (
    KakaoPayAdapter,
    KakaoPayConfirmError,
    KakaoPayInitiateError,
    MockKakaoPaySDK,
    PaymentApproveResult,
    PaymentCancelResult,
    PaymentReadyResult,
    PaymentScenario,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_adapter(scenario: PaymentScenario) -> tuple[KakaoPayAdapter, MockKakaoPaySDK]:
    """Construct a ``(KakaoPayAdapter, MockKakaoPaySDK)`` pair for *scenario*."""
    sdk = MockKakaoPaySDK(scenario=scenario)
    return KakaoPayAdapter(sdk=sdk), sdk


# ---------------------------------------------------------------------------
# Scenario 1: Payment success — initiate, confirm, cancel (full lifecycle)
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_success_initiate_returns_payment_ready_result() -> None:
    """``initiate`` returns a ``PaymentReadyResult`` with tid and redirect URL."""
    adapter, sdk = _make_adapter(PaymentScenario.SUCCESS)

    result = await adapter.initiate(
        order_id="ord-success-001",
        user_id="usr-001",
        amount_krw=12000,
    )

    assert isinstance(result, PaymentReadyResult)
    assert result.tid == "mock-tid-ord-success-001"
    assert "ord-success-001" in result.next_redirect_mobile_url

    # Exactly one SDK call: ``ready``.
    assert len(sdk.calls) == 1
    method, kwargs = sdk.calls[0]
    assert method == "ready"
    assert kwargs["order_id"] == "ord-success-001"
    assert kwargs["user_id"] == "usr-001"
    assert kwargs["total_amount"] == 12000


@pytest.mark.unit
async def test_success_confirm_returns_payment_approve_result() -> None:
    """``confirm`` returns a ``PaymentApproveResult`` with correct fields."""
    adapter, sdk = _make_adapter(PaymentScenario.SUCCESS)

    # Initiate first to obtain tid.
    ready = await adapter.initiate(
        order_id="ord-success-002",
        user_id="usr-002",
        amount_krw=12000,
    )

    result = await adapter.confirm(
        tid=ready.tid,
        order_id="ord-success-002",
        user_id="usr-002",
        pg_token="pg-token-abc",
    )

    assert isinstance(result, PaymentApproveResult)
    assert result.tid == ready.tid
    assert result.order_id == "ord-success-002"
    assert result.amount_krw == 12000
    assert result.payment_method_type == "CARD"

    # Two SDK calls: ``ready`` then ``approve``.
    assert len(sdk.calls) == 2
    assert sdk.calls[0][0] == "ready"
    assert sdk.calls[1][0] == "approve"
    _, approve_kwargs = sdk.calls[1]
    assert approve_kwargs["tid"] == ready.tid
    assert approve_kwargs["pg_token"] == "pg-token-abc"


@pytest.mark.unit
async def test_success_cancel_after_approve_returns_cancel_payment_status() -> None:
    """Full lifecycle: initiate → confirm → cancel returns ``CANCEL_PAYMENT``."""
    adapter, sdk = _make_adapter(PaymentScenario.CANCEL_PAYMENT)

    ready = await adapter.initiate(
        order_id="ord-cancel-001",
        user_id="usr-003",
        amount_krw=59000,
    )
    await adapter.confirm(
        tid=ready.tid,
        order_id="ord-cancel-001",
        user_id="usr-003",
        pg_token="pg-token-xyz",
    )
    cancel_result = await adapter.cancel(
        tid=ready.tid,
        cancel_amount_krw=59000,
    )

    assert isinstance(cancel_result, PaymentCancelResult)
    assert cancel_result.tid == ready.tid
    assert cancel_result.cancel_amount_krw == 59000
    assert cancel_result.status == "CANCEL_PAYMENT"

    # Three SDK calls: ready, approve, cancel.
    call_methods = [name for name, _ in sdk.calls]
    assert call_methods == ["ready", "approve", "cancel"]

    _, cancel_kwargs = sdk.calls[2]
    assert cancel_kwargs["cancel_amount"] == 59000


# ---------------------------------------------------------------------------
# Scenario 2: Payment failure — SDK rejects at initiation and at confirmation
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_failure_on_ready_raises_kakao_pay_initiate_error() -> None:
    """``initiate`` raises ``KakaoPayInitiateError`` when SDK rejects the request."""
    adapter, sdk = _make_adapter(PaymentScenario.FAIL_ON_READY)

    with pytest.raises(KakaoPayInitiateError) as exc_info:
        await adapter.initiate(
            order_id="ord-fail-ready",
            user_id="usr-fail",
            amount_krw=12000,
        )

    assert exc_info.value.error_code == "INVALID_REQUEST"
    # Only one SDK call attempted (the failing ``ready``).
    assert len(sdk.calls) == 1
    assert sdk.calls[0][0] == "ready"


@pytest.mark.unit
async def test_failure_on_approve_raises_kakao_pay_confirm_error() -> None:
    """``confirm`` raises ``KakaoPayConfirmError`` when the user cancels checkout."""
    adapter, sdk = _make_adapter(PaymentScenario.FAIL_ON_APPROVE)

    # ``ready()`` succeeds in this scenario.
    ready = await adapter.initiate(
        order_id="ord-fail-approve",
        user_id="usr-fail-approve",
        amount_krw=12000,
    )
    assert isinstance(ready, PaymentReadyResult)

    with pytest.raises(KakaoPayConfirmError) as exc_info:
        await adapter.confirm(
            tid=ready.tid,
            order_id="ord-fail-approve",
            user_id="usr-fail-approve",
            pg_token="expired-token",
        )

    assert exc_info.value.error_code == "USER_CANCEL"
    # Two SDK calls: ``ready`` (success) + ``approve`` (failure).
    assert len(sdk.calls) == 2
    assert sdk.calls[0][0] == "ready"
    assert sdk.calls[1][0] == "approve"


@pytest.mark.unit
async def test_failure_on_ready_does_not_call_approve_or_cancel() -> None:
    """After an ``initiate`` failure, no ``approve`` or ``cancel`` is called."""
    adapter, sdk = _make_adapter(PaymentScenario.FAIL_ON_READY)

    with pytest.raises(KakaoPayInitiateError):
        await adapter.initiate(
            order_id="ord-no-downstream",
            user_id="usr-x",
            amount_krw=12000,
        )

    call_methods = [name for name, _ in sdk.calls]
    assert "approve" not in call_methods
    assert "cancel" not in call_methods


# ---------------------------------------------------------------------------
# Scenario 3: Payment cancel — standalone cancel on an approved tid
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_cancel_only_calls_sdk_cancel() -> None:
    """Direct ``cancel`` call (with a known tid) invokes only the SDK cancel."""
    adapter, sdk = _make_adapter(PaymentScenario.SUCCESS)

    result = await adapter.cancel(
        tid="known-tid-direct",
        cancel_amount_krw=12000,
    )

    assert isinstance(result, PaymentCancelResult)
    assert result.tid == "known-tid-direct"
    assert result.cancel_amount_krw == 12000
    assert result.status == "CANCEL_PAYMENT"

    # Only one SDK call: ``cancel`` (no prior ready/approve in this test).
    assert len(sdk.calls) == 1
    assert sdk.calls[0][0] == "cancel"


@pytest.mark.unit
async def test_cancel_preserves_tid_from_initiate() -> None:
    """The ``tid`` from ``initiate`` flows into the cancel result unchanged."""
    adapter, sdk = _make_adapter(PaymentScenario.CANCEL_PAYMENT)

    ready = await adapter.initiate(
        order_id="ord-tid-chain",
        user_id="usr-chain",
        amount_krw=59000,
    )
    cancel_result = await adapter.cancel(
        tid=ready.tid,
        cancel_amount_krw=59000,
    )

    assert cancel_result.tid == ready.tid


@pytest.mark.unit
async def test_cancel_partial_refund_amount() -> None:
    """Partial-refund cancel forwards the exact cancel amount."""
    adapter, sdk = _make_adapter(PaymentScenario.SUCCESS)

    result = await adapter.cancel(
        tid="partial-refund-tid",
        cancel_amount_krw=6000,  # half the 12,000 monthly price
    )

    assert result.cancel_amount_krw == 6000
    _, cancel_kwargs = sdk.calls[0]
    assert cancel_kwargs["cancel_amount"] == 6000
    assert cancel_kwargs["cancel_tax_free_amount"] == 0


# ---------------------------------------------------------------------------
# Mock SDK structural tests — verify the test double satisfies the protocol
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_mock_sdk_records_calls_in_order() -> None:
    """``MockKakaoPaySDK.calls`` accumulates entries in invocation order."""
    sdk = MockKakaoPaySDK(scenario=PaymentScenario.SUCCESS)
    adapter = KakaoPayAdapter(sdk=sdk)

    await adapter.initiate(order_id="chk-001", user_id="u", amount_krw=12000)
    ready_tid = sdk.calls[0][1]["order_id"]
    await adapter.confirm(
        tid=f"mock-tid-{ready_tid}",
        order_id="chk-001",
        user_id="u",
        pg_token="tok",
    )
    await adapter.cancel(tid=f"mock-tid-{ready_tid}", cancel_amount_krw=12000)

    assert [name for name, _ in sdk.calls] == ["ready", "approve", "cancel"]


@pytest.mark.unit
async def test_mock_sdk_annual_subscription_amount() -> None:
    """The mock correctly echoes the annual subscription price (59,000 KRW)."""
    adapter, sdk = _make_adapter(PaymentScenario.SUCCESS)

    result = await adapter.initiate(
        order_id="annual-sub-001",
        user_id="usr-annual",
        amount_krw=59000,
        item_name="Picko 연간 구독",
    )

    assert isinstance(result, PaymentReadyResult)
    _, ready_kwargs = sdk.calls[0]
    assert ready_kwargs["total_amount"] == 59000
    assert ready_kwargs["item_name"] == "Picko 연간 구독"


@pytest.mark.unit
def test_payment_scenario_enum_values() -> None:
    """``PaymentScenario`` string values match expected literals."""
    assert PaymentScenario.SUCCESS == "success"
    assert PaymentScenario.FAIL_ON_READY == "fail_on_ready"
    assert PaymentScenario.FAIL_ON_APPROVE == "fail_on_approve"
    assert PaymentScenario.CANCEL_PAYMENT == "cancel_payment"


@pytest.mark.unit
def test_mock_sdk_can_be_constructed_with_string_scenario() -> None:
    """``MockKakaoPaySDK`` accepts a plain string as the scenario argument."""
    sdk = MockKakaoPaySDK(scenario="success")
    assert sdk._scenario == PaymentScenario.SUCCESS
