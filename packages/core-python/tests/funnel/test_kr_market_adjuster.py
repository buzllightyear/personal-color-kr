"""Unit tests for `adjust_target_for_kr_market` (Sub-AC 1.3).

The contract under test::

    adjust_target_for_kr_market(base_target: float, market_factors: dict) -> float

Returns a Korean-market-adjusted conversion-rate target as a fraction in
``[1e-6, 1.0]``. See `src/funnel/kr_market_adjuster.py` for the full
contract, factor catalogue, and arithmetic.

Coverage matrix (the AC-required edge cases):

  1. Neutral / no-op behaviour
     a. Empty market_factors                   → base unchanged
     b. All factors at neutral midpoint 0.5    → base unchanged
  2. Single-factor adjustments
     a. ios_share=1.0                          → lift by +30%
     b. ios_share=0.0                          → drag by −30%
     c. subscription_market_saturation=1.0     → drag by −25%
     d. referral_gate_friction=1.0             → drag by −20%
     e. magazine_retention_bonus=1.0           → lift by +15%
     f. price_anchor_acceptance=1.0            → lift by +20%
  3. Multi-factor composition
     a. Two lifts compose multiplicatively
     b. A lift and a drag partially cancel
  4. Clamping
     a. Result above 1.0 is clamped to 1.0
     b. Result below 1e-6 is clamped to 1e-6
  5. Purity
     a. Same input → same output
     b. Input dict is not mutated
  6. Constants pinned
     a. DEFAULT_NORTH_STAR_TARGET == 0.055
     b. SUPPORTED_MARKET_FACTORS covers the five Korean-market signals
  7. Input validation
     a. base_target=None                       → TypeError
     b. base_target=bool                       → TypeError
     c. base_target=NaN                        → ValueError
     d. base_target=inf                        → ValueError
     e. base_target=0.0                        → ValueError
     f. base_target=-0.1                       → ValueError
     g. base_target>1.0                        → ValueError
     h. market_factors=None                    → TypeError
     i. market_factors=[]                      → TypeError
     j. Unknown factor key                     → ValueError
     k. Non-string factor key                  → ValueError
     l. bool factor value                      → TypeError
     m. Non-numeric factor value               → TypeError
     n. NaN factor value                       → ValueError
     o. Factor value < 0                       → ValueError
     p. Factor value > 1                       → ValueError
"""

from __future__ import annotations

import math

import pytest

from funnel.kr_market_adjuster import (
    DEFAULT_NORTH_STAR_TARGET,
    SUPPORTED_MARKET_FACTORS,
    adjust_target_for_kr_market,
)

# ---------------------------------------------------------------------------
# 1. Neutral / no-op behaviour
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_empty_market_factors_returns_base_unchanged() -> None:
    # No opt-in factors ⇒ neutral coefficient of 1.0 ⇒ base passes through.
    # This keeps the function safe to wrap unconditionally around any
    # base target — same identity invariant as the TS-side `isAboveThreshold`
    # with its default target.
    assert adjust_target_for_kr_market(0.055, {}) == pytest.approx(0.055)


@pytest.mark.unit
def test_all_factors_at_neutral_midpoint_returns_base_unchanged() -> None:
    # The midpoint of each factor (0.5) is defined as "no signal";
    # supplying every factor at the midpoint must compose to a coefficient
    # of exactly 1.0.
    neutral = {key: 0.5 for key in SUPPORTED_MARKET_FACTORS}

    adjusted = adjust_target_for_kr_market(0.055, neutral)

    assert adjusted == pytest.approx(0.055)


# ---------------------------------------------------------------------------
# 2. Single-factor adjustments — pin the Korean-market sensitivities
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_ios_share_full_lifts_target_by_thirty_percent() -> None:
    # KR iOS users have higher willingness-to-pay on subscription apps.
    # ios_share=1.0 must lift the target by the full +30%.
    adjusted = adjust_target_for_kr_market(0.055, {"ios_share": 1.0})

    assert adjusted == pytest.approx(0.055 * 1.30)


@pytest.mark.unit
def test_ios_share_zero_drags_target_by_thirty_percent() -> None:
    # Symmetric counterpart: ios_share=0.0 drags by −30%.
    adjusted = adjust_target_for_kr_market(0.055, {"ios_share": 0.0})

    assert adjusted == pytest.approx(0.055 * 0.70)


@pytest.mark.unit
def test_subscription_saturation_full_drags_target_by_twenty_five_percent() -> None:
    # Korean OTT / commerce subscription fatigue (Coupang Wow, Naver Plus,
    # Tving, Wavve, ...). saturation=1.0 ⇒ −25%.
    adjusted = adjust_target_for_kr_market(
        0.055,
        {"subscription_market_saturation": 1.0},
    )

    assert adjusted == pytest.approx(0.055 * 0.75)


@pytest.mark.unit
def test_referral_gate_friction_full_drags_target_by_twenty_percent() -> None:
    # 10-단계 1-명 추천 게이트 friction. friction=1.0 ⇒ −20%.
    adjusted = adjust_target_for_kr_market(
        0.055,
        {"referral_gate_friction": 1.0},
    )

    assert adjusted == pytest.approx(0.055 * 0.80)


@pytest.mark.unit
def test_magazine_retention_bonus_full_lifts_target_by_fifteen_percent() -> None:
    # Monthly self-curated magazine retention layer. bonus=1.0 ⇒ +15%.
    adjusted = adjust_target_for_kr_market(
        0.055,
        {"magazine_retention_bonus": 1.0},
    )

    assert adjusted == pytest.approx(0.055 * 1.15)


@pytest.mark.unit
def test_price_anchor_acceptance_full_lifts_target_by_twenty_percent() -> None:
    # $12/월 · $59/연 (37-day trial) price anchor acceptance. ⇒ +20%.
    adjusted = adjust_target_for_kr_market(
        0.055,
        {"price_anchor_acceptance": 1.0},
    )

    assert adjusted == pytest.approx(0.055 * 1.20)


# ---------------------------------------------------------------------------
# 3. Multi-factor composition
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_two_lifts_compose_multiplicatively() -> None:
    # ios_share + price_anchor_acceptance at 1.0 ⇒ ×1.30 × ×1.20 = ×1.56.
    adjusted = adjust_target_for_kr_market(
        0.05,
        {"ios_share": 1.0, "price_anchor_acceptance": 1.0},
    )

    assert adjusted == pytest.approx(0.05 * 1.30 * 1.20)


@pytest.mark.unit
def test_lift_and_drag_partially_cancel() -> None:
    # +15% magazine vs −20% referral friction ⇒ ×1.15 × ×0.80 = ×0.92.
    adjusted = adjust_target_for_kr_market(
        0.055,
        {
            "magazine_retention_bonus": 1.0,
            "referral_gate_friction": 1.0,
        },
    )

    assert adjusted == pytest.approx(0.055 * 1.15 * 0.80)


# ---------------------------------------------------------------------------
# 4. Clamping
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_result_above_one_is_clamped() -> None:
    # A base near the upper bound with maximum lift would overflow past 1.0;
    # we clamp to keep the target physically achievable.
    adjusted = adjust_target_for_kr_market(
        0.95,
        {
            "ios_share": 1.0,
            "magazine_retention_bonus": 1.0,
            "price_anchor_acceptance": 1.0,
        },
    )

    assert adjusted == 1.0


@pytest.mark.unit
def test_result_at_floor_stays_strictly_positive() -> None:
    # A tiny base with maximum drag would otherwise produce a near-zero
    # target; the floor of 1e-6 keeps the threshold classifier well-defined.
    adjusted = adjust_target_for_kr_market(
        1e-6,
        {
            "ios_share": 0.0,
            "subscription_market_saturation": 1.0,
            "referral_gate_friction": 1.0,
        },
    )

    assert adjusted >= 1e-6
    assert adjusted <= 1e-6  # exactly the floor


# ---------------------------------------------------------------------------
# 5. Purity
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_same_input_returns_same_output() -> None:
    factors = {"ios_share": 0.7, "magazine_retention_bonus": 0.6}

    first = adjust_target_for_kr_market(0.055, factors)
    second = adjust_target_for_kr_market(0.055, factors)

    assert first == second


@pytest.mark.unit
def test_input_dict_is_not_mutated() -> None:
    factors = {"ios_share": 0.7, "magazine_retention_bonus": 0.6}
    snapshot = dict(factors)

    adjust_target_for_kr_market(0.055, factors)

    assert factors == snapshot


# ---------------------------------------------------------------------------
# 6. Constants pinned — the Seed wires these into the threshold classifier
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_default_north_star_target_is_pinned_to_5_5_percent() -> None:
    # The Seed exit condition references the 5.5% bar literally. Pin it.
    assert DEFAULT_NORTH_STAR_TARGET == 0.055


@pytest.mark.unit
def test_supported_market_factors_covers_the_five_korean_signals() -> None:
    # Each of the five Korean-market signals from the Seed ontology must
    # be addressable; an empty / partial table would silently neutralise
    # a real adjustment downstream.
    assert set(SUPPORTED_MARKET_FACTORS) == {
        "ios_share",
        "subscription_market_saturation",
        "referral_gate_friction",
        "magazine_retention_bonus",
        "price_anchor_acceptance",
    }


# ---------------------------------------------------------------------------
# 7. Input validation — base_target
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_base_target_none_raises_type_error() -> None:
    with pytest.raises(TypeError, match="base_target"):
        adjust_target_for_kr_market(None, {})  # type: ignore[arg-type]


@pytest.mark.unit
def test_base_target_bool_raises_type_error() -> None:
    # bool is an int subclass; `True` would silently mean target=1.0.
    with pytest.raises(TypeError, match="bool"):
        adjust_target_for_kr_market(True, {})  # type: ignore[arg-type]


@pytest.mark.unit
def test_base_target_nan_raises_value_error() -> None:
    with pytest.raises(ValueError, match="finite"):
        adjust_target_for_kr_market(math.nan, {})


@pytest.mark.unit
def test_base_target_infinity_raises_value_error() -> None:
    with pytest.raises(ValueError, match="finite"):
        adjust_target_for_kr_market(math.inf, {})


@pytest.mark.unit
def test_base_target_zero_raises_value_error() -> None:
    # A 0 target would disable the threshold classifier entirely.
    with pytest.raises(ValueError, match=r"\(0.0, 1.0\]"):
        adjust_target_for_kr_market(0.0, {})


@pytest.mark.unit
def test_base_target_negative_raises_value_error() -> None:
    with pytest.raises(ValueError, match=r"\(0.0, 1.0\]"):
        adjust_target_for_kr_market(-0.01, {})


@pytest.mark.unit
def test_base_target_above_one_raises_value_error() -> None:
    with pytest.raises(ValueError, match=r"\(0.0, 1.0\]"):
        adjust_target_for_kr_market(1.5, {})


# ---------------------------------------------------------------------------
# 7. Input validation — market_factors
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_market_factors_none_raises_type_error() -> None:
    with pytest.raises(TypeError, match="mapping"):
        adjust_target_for_kr_market(0.055, None)  # type: ignore[arg-type]


@pytest.mark.unit
def test_market_factors_list_raises_type_error() -> None:
    with pytest.raises(TypeError, match="mapping"):
        adjust_target_for_kr_market(0.055, [])  # type: ignore[arg-type]


@pytest.mark.unit
def test_unknown_factor_key_raises_value_error() -> None:
    # Silent acceptance of typos would silently revert to "neutral" and
    # report an *un*-adjusted target while looking adjusted. Refuse.
    with pytest.raises(ValueError, match="unknown market factor"):
        adjust_target_for_kr_market(0.055, {"ios_shaer": 0.5})  # typo


@pytest.mark.unit
def test_non_string_factor_key_raises_value_error() -> None:
    with pytest.raises(ValueError, match="market_factors keys must be str"):
        adjust_target_for_kr_market(0.055, {123: 0.5})  # type: ignore[dict-item]


@pytest.mark.unit
def test_bool_factor_value_raises_type_error() -> None:
    with pytest.raises(TypeError, match="bool"):
        adjust_target_for_kr_market(
            0.055,
            {"ios_share": True},  # type: ignore[dict-item]
        )


@pytest.mark.unit
def test_non_numeric_factor_value_raises_type_error() -> None:
    with pytest.raises(TypeError, match="real number"):
        adjust_target_for_kr_market(
            0.055,
            {"ios_share": "0.5"},  # type: ignore[dict-item]
        )


@pytest.mark.unit
def test_nan_factor_value_raises_value_error() -> None:
    with pytest.raises(ValueError, match="finite"):
        adjust_target_for_kr_market(0.055, {"ios_share": math.nan})


@pytest.mark.unit
def test_negative_factor_value_raises_value_error() -> None:
    with pytest.raises(ValueError, match=r"\[0.0, 1.0\]"):
        adjust_target_for_kr_market(0.055, {"ios_share": -0.1})


@pytest.mark.unit
def test_factor_value_above_one_raises_value_error() -> None:
    with pytest.raises(ValueError, match=r"\[0.0, 1.0\]"):
        adjust_target_for_kr_market(0.055, {"ios_share": 1.2})
