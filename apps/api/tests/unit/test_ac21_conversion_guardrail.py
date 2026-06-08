"""AC21: Payment conversion rate guardrail alert.

Acceptance criteria verified
-----------------------------
AC21: payment_funnel_event에서 stage 12 완료 / stage 1 진입 비율 계산.
      config 하한 미달 시 alert trigger.
      maximize 로직 부재 확인 (하한 guardrail만).

Tests are fully independent — each test builds its own InMemoryFunnelEventLog.
"""

from __future__ import annotations

import uuid

import pytest

from api.payment.funnel import (
    ConversionGuardrailResult,
    InMemoryFunnelEventLog,
    PaymentFunnelStage,
    compute_conversion_guardrail,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _new_log() -> InMemoryFunnelEventLog:
    return InMemoryFunnelEventLog()


def _uid() -> uuid.UUID:
    return uuid.uuid4()


def _enter_stage_1(log: InMemoryFunnelEventLog, user_id: uuid.UUID) -> None:
    log.log_entry(user_id, PaymentFunnelStage.가치_제시)


def _complete_stage_12(log: InMemoryFunnelEventLog, user_id: uuid.UUID) -> None:
    log.log_completion(user_id, PaymentFunnelStage.결제_모델_변형)


# ---------------------------------------------------------------------------
# AC21: Conversion rate computation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_conversion_rate_100_percent() -> None:
    """All stage-1 entries have stage-12 completions → rate = 1.0."""
    log = _new_log()
    for _ in range(5):
        uid = _uid()
        _enter_stage_1(log, uid)
        _complete_stage_12(log, uid)

    result = compute_conversion_guardrail(log, floor_threshold=0.05)
    assert result.conversion_rate == pytest.approx(1.0)
    assert result.alert_triggered is False


@pytest.mark.unit
def test_conversion_rate_zero_percent() -> None:
    """Stage-1 entries but no stage-12 completions → rate = 0.0."""
    log = _new_log()
    for _ in range(10):
        _enter_stage_1(log, _uid())

    result = compute_conversion_guardrail(log, floor_threshold=0.05)
    assert result.conversion_rate == pytest.approx(0.0)


@pytest.mark.unit
def test_conversion_rate_exact_calculation() -> None:
    """2 stage-12 completions out of 10 stage-1 entries → rate = 0.2."""
    log = _new_log()
    converters: list[uuid.UUID] = []
    for _ in range(10):
        uid = _uid()
        _enter_stage_1(log, uid)
        converters.append(uid)

    # Only first 2 convert
    for uid in converters[:2]:
        _complete_stage_12(log, uid)

    result = compute_conversion_guardrail(log, floor_threshold=0.05)
    assert result.conversion_rate == pytest.approx(0.2)


@pytest.mark.unit
def test_conversion_rate_undefined_when_no_stage_1_entries() -> None:
    """No stage-1 entries → conversion rate is None (undefined)."""
    log = _new_log()

    result = compute_conversion_guardrail(log)
    assert result.conversion_rate is None
    assert result.alert_triggered is False


# ---------------------------------------------------------------------------
# AC21: Alert trigger logic — guardrail floor only
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_alert_triggered_when_below_floor() -> None:
    """Conversion rate below floor_threshold triggers alert."""
    log = _new_log()
    # 1 converter out of 100 entries → rate = 0.01 (below 0.05 floor)
    for _ in range(100):
        uid = _uid()
        _enter_stage_1(log, uid)

    converter = _uid()
    _enter_stage_1(log, converter)
    _complete_stage_12(log, converter)

    result = compute_conversion_guardrail(log, floor_threshold=0.05)
    assert result.alert_triggered is True
    assert result.conversion_rate is not None
    assert result.conversion_rate < result.floor_threshold


@pytest.mark.unit
def test_alert_not_triggered_when_above_floor() -> None:
    """Conversion rate at or above floor_threshold does NOT trigger alert."""
    log = _new_log()
    # 5 converters out of 10 entries → rate = 0.5 (above 0.05 floor)
    for _ in range(5):
        uid = _uid()
        _enter_stage_1(log, uid)
        _complete_stage_12(log, uid)
    for _ in range(5):
        _enter_stage_1(log, _uid())

    result = compute_conversion_guardrail(log, floor_threshold=0.05)
    assert result.alert_triggered is False
    assert result.conversion_rate is not None
    assert result.conversion_rate >= result.floor_threshold


@pytest.mark.unit
def test_alert_not_triggered_exactly_at_floor() -> None:
    """Conversion rate exactly equal to floor_threshold does NOT trigger alert."""
    log = _new_log()
    # 1 converter out of 20 entries → rate = 0.05 (exactly at floor)
    for _ in range(20):
        uid = _uid()
        _enter_stage_1(log, uid)

    converter = _uid()
    _enter_stage_1(log, converter)
    _complete_stage_12(log, converter)

    # 1/21 ≈ 0.0476 — slightly below. Use exact fractions:
    # 10 entries, 1 converter = 0.1 at 0.1 floor
    log2 = _new_log()
    for _ in range(9):
        _enter_stage_1(log2, _uid())
    exact_uid = _uid()
    _enter_stage_1(log2, exact_uid)
    _complete_stage_12(log2, exact_uid)
    # 1/10 = 0.1
    result2 = compute_conversion_guardrail(log2, floor_threshold=0.1)
    assert result2.alert_triggered is False
    assert result2.conversion_rate == pytest.approx(0.1)


@pytest.mark.unit
def test_custom_floor_threshold_is_honored() -> None:
    """Custom floor_threshold parameter is used (not the 0.05 default)."""
    log = _new_log()
    # 10 converters out of 100 entries → rate = 0.1
    for _ in range(10):
        uid = _uid()
        _enter_stage_1(log, uid)
        _complete_stage_12(log, uid)
    for _ in range(90):
        _enter_stage_1(log, _uid())

    # With floor 0.2, rate 0.1 should trigger
    high_floor = compute_conversion_guardrail(log, floor_threshold=0.2)
    assert high_floor.alert_triggered is True

    # With floor 0.05, rate 0.1 should NOT trigger
    low_floor = compute_conversion_guardrail(log, floor_threshold=0.05)
    assert low_floor.alert_triggered is False


# ---------------------------------------------------------------------------
# AC21: Masking trap guard — no maximize logic
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_result_contains_no_maximize_logic() -> None:
    """ConversionGuardrailResult only exposes floor checking, no maximization."""
    result = ConversionGuardrailResult(
        conversion_rate=0.1,
        floor_threshold=0.05,
        alert_triggered=False,
        message="ok",
    )
    # Result only has guardrail fields — no 'target', 'maximize', 'optimize'
    field_names = {f for f in result.__dataclass_fields__}
    assert "target" not in field_names
    assert "maximize" not in field_names
    assert "optimize" not in field_names
    assert "alert_triggered" in field_names
    assert "floor_threshold" in field_names


@pytest.mark.unit
def test_compute_conversion_guardrail_function_does_not_maximize() -> None:
    """compute_conversion_guardrail returns a floor-only guardrail result."""
    log = _new_log()
    uid = _uid()
    _enter_stage_1(log, uid)
    _complete_stage_12(log, uid)

    result = compute_conversion_guardrail(log)
    # Function returns ConversionGuardrailResult, not an optimization target
    assert isinstance(result, ConversionGuardrailResult)
    assert hasattr(result, "floor_threshold")
    assert hasattr(result, "alert_triggered")
    # No maximize attribute
    assert not hasattr(result, "maximize")


# ---------------------------------------------------------------------------
# AC21: Stage 12 completions vs stage 1 entries only (not other stages)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_other_stage_events_do_not_affect_rate() -> None:
    """Events from stages other than 1 (entry) and 12 (completion) don't count."""
    log = _new_log()
    uid_converter = _uid()
    uid_other = _uid()

    # uid_converter: enters stage 1, completes stage 12
    _enter_stage_1(log, uid_converter)
    _complete_stage_12(log, uid_converter)

    # uid_other: enters stages 2-11, never stage 1
    for stage in [
        PaymentFunnelStage.결과_프리뷰,
        PaymentFunnelStage.사회적_증거,
        PaymentFunnelStage.긴급성_희소성,
        PaymentFunnelStage.기능_비교,
    ]:
        log.log_entry(uid_other, stage)

    result = compute_conversion_guardrail(log, floor_threshold=0.05)
    # Only 1 stage-1 entry (uid_converter), 1 stage-12 completion → rate = 1.0
    assert result.conversion_rate == pytest.approx(1.0)
    assert result.alert_triggered is False
