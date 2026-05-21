"""Korean-market conversion-target adjuster (Sub-AC 1.3).

The Seed pins the Phase-0 north-star to a 5.5% payment conversion rate,
but the exit condition explicitly allows the team to RECONSIDER the
target for the Korean-market context:

    exit_conditions:
      - 결제 전환율 5.5%+ 또는 한국 시장 조정 target 결정·도달

This module provides the canonical arithmetic for that adjustment so the
threshold classifier (`src/funnel/threshold.ts`), the windowed
aggregator (`src/funnel/window_aggregator.py`), and the pivot-alert
hooks all see one consistent "Korean-market adjusted target".

Composition with the rest of the funnel pipeline::

    events  ── aggregate_conversion_rate ──► rate (fraction in [0, 1])

    base_target = 0.055
            │
            ▼
    adjust_target_for_kr_market(base, kr_factors) ──► adjusted_target
                                                            │
                                                            ▼
                                          evaluate_conversion_rate_threshold
                                          (or `isAboveThreshold(rate, target)`)

The result is a fraction in (0.0, 1.0], directly comparable to the
output of `aggregate_conversion_rate` and to the `target` parameter of
the TS-side `isAboveThreshold` helper.

Market factors
==============

Each entry of `market_factors` is a normalised indicator in [0.0, 1.0]
describing the *strength* of that Korean-market signal:

    ============================== ===== ===================================
    key                            sign  meaning
    ============================== ===== ===================================
    ios_share                      lift  Higher KR iOS share → higher
                                         willingness-to-pay → lift target.
    subscription_market_saturation drag  Korean OTT / commerce subscription
                                         fatigue. Higher → drag target.
    referral_gate_friction         drag  Friction from the 10-단계 1-명
                                         추천 게이트. Higher → drag.
    magazine_retention_bonus       lift  Lift from the curator-led monthly
                                         magazine retention layer (본인
                                         시그니처 큐레이션, 월 1회).
    price_anchor_acceptance        lift  Acceptance of the $12/월 · $59/연
                                         (37-day trial) price anchor.
    ============================== ===== ===================================

Each known factor has a fixed sensitivity (see `_FACTOR_SENSITIVITY`).
At ``value = 0.5`` (the neutral midpoint) the factor contributes a
coefficient of ``1.0`` (no change). At ``value = 1.0`` the coefficient
swings by ``+sensitivity`` for "lift" factors and ``-sensitivity`` for
"drag" factors. At ``value = 0.0`` the swing reverses sign. Factors
compose multiplicatively::

    coefficient_i = 1.0 + sensitivity_i * 2 * (value_i - 0.5)
    adjusted      = base_target * Π coefficient_i

The neutral default (``value = 0.5`` for every factor, equivalent to an
empty ``market_factors`` dict) yields the base target unchanged. This
keeps `adjust_target_for_kr_market(0.055, {}) == 0.055` and turns the
function into a no-op for callers who do not opt in.

Unknown factor keys
-------------------

Reject with ``ValueError``. We refuse silent typos because a misspelt
factor key would silently revert to neutral and the dashboard would
report an *un*-adjusted target while looking adjusted. Failing loudly is
the only way to keep the metric trustworthy.

Why a Python module sitting next to a TS threshold classifier
-------------------------------------------------------------

Same rationale as `window_aggregator.py`: the TS side fires events from
the funnel runtime, the Python side owns the server-side metric pipeline
that the retention API, magazine-eligibility scheduler, and pivot-alert
hooks read from. The TS `evaluateConversionRateThreshold` is for the
client/edge runtime; this module is for the server.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final

# ---------------------------------------------------------------------------
# Public constants
# ---------------------------------------------------------------------------


#: Canonical Phase-0 north-star target, expressed as a fraction in [0, 1].
#: Mirrors the TS-side `DEFAULT_NORTH_STAR_TARGET_PERCENT = 5.5` constant
#: in `src/funnel/threshold.ts` (the TS constant is in percent points; we
#: standardise on the fraction here to compose with
#: `aggregate_conversion_rate`).
DEFAULT_NORTH_STAR_TARGET: Final[float] = 0.055


#: Per-factor sensitivities. A positive sensitivity means "higher
#: indicator → higher target" (lift); a negative sensitivity means
#: "higher indicator → lower target" (drag). The magnitude bounds the
#: maximum per-factor swing — e.g. `ios_share=1.0` lifts the target by
#: up to +30%; `ios_share=0.0` drags it by up to −30%.
_FACTOR_SENSITIVITY: Final[Mapping[str, float]] = {
    # Korean iOS share is structurally lower than the US but iOS users
    # convert at materially higher rates on subscription apps. ±30% swing.
    "ios_share": +0.30,
    # Korean subscription market saturation (Coupang Wow, Naver Plus,
    # Tving, Wavve, ...). High saturation → real subscription fatigue.
    "subscription_market_saturation": -0.25,
    # Friction from the 10-단계 1-명 추천 게이트 (Korean variant of the
    # Glam Up funnel). Some friction is intended; too much shaves
    # conversion.
    "referral_gate_friction": -0.20,
    # Lift from the monthly self-curated magazine retention layer (본인
    # 시그니처 큐레이션, 월 1회). Stable retention drives subscription
    # economics.
    "magazine_retention_bonus": +0.15,
    # Acceptance of the $12/월 · $59/연 price anchor by Korean users
    # (with the 7-day free trial + 30 추가 = 총 37일 trial window).
    "price_anchor_acceptance": +0.20,
}


#: Public, immutable view of the supported factor keys. Useful for
#: documentation / CLI / dashboard validation without forcing callers to
#: import the private sensitivity table.
SUPPORTED_MARKET_FACTORS: Final[tuple[str, ...]] = tuple(_FACTOR_SENSITIVITY)


#: Hard lower clamp. A target of exactly 0.0 disables the threshold
#: classifier entirely (every observed rate would `PASS`), which is
#: almost certainly a bug, so we keep the floor strictly positive.
_MIN_ADJUSTED_TARGET: Final[float] = 1e-6

#: Hard upper clamp. A target above 1.0 is impossible to hit.
_MAX_ADJUSTED_TARGET: Final[float] = 1.0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def adjust_target_for_kr_market(
    base_target: float,
    market_factors: dict,
) -> float:
    """Adjust a base conversion-rate target for Korean-market signals.

    Args:
        base_target: The unadjusted target as a fraction in (0.0, 1.0]
            — e.g. ``0.055`` for the canonical 5.5% north-star. Must be
            strictly positive; ``0.0`` would disable the threshold and is
            refused as an obvious bug.
        market_factors: A mapping from factor key to a normalised
            indicator in [0.0, 1.0]. See the module docstring for the
            supported keys and their semantics. Unknown keys raise
            ``ValueError`` (silent typos would silently neutralise an
            adjustment). An empty mapping yields the base target
            unchanged.

    Returns:
        The adjusted target as a fraction, clamped to
        ``[1e-6, 1.0]``.

    Raises:
        TypeError: ``base_target`` is not a real number (`bool` is
            refused as an int subclass), or ``market_factors`` is not a
            mapping, or a factor value is not a real number.
        ValueError: ``base_target`` is NaN / non-finite / out of range,
            ``market_factors`` contains an unknown key, or a factor
            value is NaN / non-finite / outside [0.0, 1.0].
    """
    target = _validate_base_target(base_target)
    factors = _validate_market_factors(market_factors)

    coefficient = 1.0
    for key, value in factors.items():
        sensitivity = _FACTOR_SENSITIVITY[key]
        # Centre on 0.5 and scale so value=1.0 → +sensitivity, value=0.0
        # → -sensitivity. Factors compose multiplicatively so the
        # combined adjustment is dimensionally consistent.
        coefficient *= 1.0 + sensitivity * 2.0 * (value - 0.5)

    adjusted = target * coefficient
    # Clamp to (0, 1]. The lower clamp keeps the target strictly
    # positive (a 0 target degenerates the classifier to "always PASS");
    # the upper clamp keeps it physically meaningful.
    if adjusted < _MIN_ADJUSTED_TARGET:
        return _MIN_ADJUSTED_TARGET
    if adjusted > _MAX_ADJUSTED_TARGET:
        return _MAX_ADJUSTED_TARGET
    return adjusted


# ---------------------------------------------------------------------------
# Internal validators
# ---------------------------------------------------------------------------


def _validate_base_target(value: object) -> float:
    """Coerce/validate ``base_target`` to a finite float in (0.0, 1.0]."""
    # `bool` is a subclass of `int`; accepting `True`/`False` would
    # silently mean "target = 1.0 / 0.0" which is almost certainly a
    # caller bug. Refuse explicitly — same discipline as
    # `window_aggregator._validate_window_months`.
    if isinstance(value, bool):
        raise TypeError(
            f"base_target must be a real number, got bool ({value!r})",
        )
    if not isinstance(value, (int, float)):
        raise TypeError(
            f"base_target must be a real number, got {type(value).__name__}",
        )
    numeric = float(value)
    if numeric != numeric or numeric in (float("inf"), float("-inf")):
        # NaN compares unequal to itself; the second test catches ±inf.
        raise ValueError(
            f"base_target must be finite, got {numeric!r}",
        )
    if numeric <= 0.0 or numeric > 1.0:
        raise ValueError(
            f"base_target must lie in (0.0, 1.0], got {numeric!r}",
        )
    return numeric


def _validate_market_factors(value: object) -> Mapping[str, float]:
    """Coerce/validate ``market_factors`` and each value."""
    if value is None:
        raise TypeError(
            "market_factors must be a mapping, got None",
        )
    if not isinstance(value, Mapping):
        raise TypeError(
            f"market_factors must be a mapping, got {type(value).__name__}",
        )

    validated: dict[str, float] = {}
    for raw_key, raw_value in value.items():
        if not isinstance(raw_key, str):
            raise ValueError(
                f"market_factors keys must be str, got {type(raw_key).__name__}",
            )
        if raw_key not in _FACTOR_SENSITIVITY:
            # Silent acceptance of typos would silently revert to
            # "neutral" and make the adjusted target look unadjusted.
            # Refuse loudly with a helpful hint.
            raise ValueError(
                f"unknown market factor {raw_key!r}; "
                f"supported keys are {SUPPORTED_MARKET_FACTORS!r}",
            )
        if isinstance(raw_value, bool):
            raise TypeError(
                f"market_factors[{raw_key!r}] must be a real number, "
                f"got bool ({raw_value!r})",
            )
        if not isinstance(raw_value, (int, float)):
            raise TypeError(
                f"market_factors[{raw_key!r}] must be a real number, "
                f"got {type(raw_value).__name__}",
            )
        numeric = float(raw_value)
        if numeric != numeric or numeric in (float("inf"), float("-inf")):
            raise ValueError(
                f"market_factors[{raw_key!r}] must be finite, got {numeric!r}",
            )
        if numeric < 0.0 or numeric > 1.0:
            raise ValueError(
                f"market_factors[{raw_key!r}] must lie in [0.0, 1.0], "
                f"got {numeric!r}",
            )
        validated[raw_key] = numeric
    return validated
