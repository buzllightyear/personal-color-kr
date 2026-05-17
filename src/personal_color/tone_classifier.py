"""Warm/cool tone classifier (Sub-AC 10.1).

Used as the lowest-level primitive behind the personal-color hook funnel.
Higher-level diagnosis (봄/여름/가을/겨울 4-category classification, Sub-AC 10.2+)
composes this primitive over a sampled set of skin/lip/eye pixels.

Design notes:
  - Returns a `Tone` enum, not a string. Enums force callers to handle the
    three branches explicitly and prevent stringly-typed comparison bugs in
    downstream funnel logic.
  - `classify_tone_rgb` uses R - B delta (yellow vs blue undertone), with a
    saturation floor so near-grayscale pixels don't get a false warm/cool
    verdict from sensor noise.
  - `classify_tone_hsv` uses hue ranges with the same saturation floor.
  - All inputs validated at the boundary. No silent clamping — bad input is
    a programmer error and should surface immediately.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Tone(Enum):
    """Personal-color undertone classification."""

    WARM = "warm"
    COOL = "cool"
    NEUTRAL = "neutral"


# ---------------------------------------------------------------------------
# Tunables — kept as module-level frozen config so a future calibration pass
# (Sub-AC 10.3+) can override them without touching call sites.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ToneThresholds:
    """Decision thresholds for the warm/cool classifier."""

    # RGB: |R - B| must exceed this many levels (out of 255) to count as a
    # real undertone signal. Below the floor the pixel is treated as neutral.
    rgb_chroma_floor: int = 4

    # HSV: saturation must be at least this much to count as a real hue.
    # Below the floor (near-grayscale) we always return NEUTRAL.
    hsv_saturation_floor: float = 0.08

    # HSV warm band: hue in [0, warm_upper] or (warm_lower_wrap, 360]
    hsv_warm_upper: float = 60.0
    hsv_warm_lower_wrap: float = 300.0

    # HSV cool band: hue in [cool_lower, cool_upper]
    hsv_cool_lower: float = 180.0
    hsv_cool_upper: float = 270.0


DEFAULT_THRESHOLDS = ToneThresholds()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def classify_tone_rgb(
    r: int,
    g: int,  # noqa: ARG001 — green channel reserved for future calibration
    b: int,
    *,
    thresholds: ToneThresholds = DEFAULT_THRESHOLDS,
) -> Tone:
    """Classify warm/cool tone from an 8-bit RGB sample.

    Args:
        r: Red channel, 0-255 inclusive.
        g: Green channel, 0-255 inclusive (currently unused; reserved for
            future yellow-vs-blue weighted variant).
        b: Blue channel, 0-255 inclusive.
        thresholds: Optional override of decision thresholds.

    Returns:
        Tone.WARM, Tone.COOL, or Tone.NEUTRAL.

    Raises:
        TypeError: if any channel is not an int.
        ValueError: if any channel is outside 0-255.
    """
    _validate_rgb_channel("r", r)
    _validate_rgb_channel("g", g)
    _validate_rgb_channel("b", b)

    delta = r - b
    if abs(delta) <= thresholds.rgb_chroma_floor:
        return Tone.NEUTRAL
    return Tone.WARM if delta > 0 else Tone.COOL


def classify_tone_hsv(
    h: float,
    s: float,
    v: float,  # noqa: ARG001 — value reserved for future brightness weighting
    *,
    thresholds: ToneThresholds = DEFAULT_THRESHOLDS,
) -> Tone:
    """Classify warm/cool tone from an HSV sample.

    Args:
        h: Hue in degrees, 0-360 inclusive.
        s: Saturation, 0.0-1.0 inclusive.
        v: Value (brightness), 0.0-1.0 inclusive. Currently unused; reserved
            for future low-light handling.
        thresholds: Optional override of decision thresholds.

    Returns:
        Tone.WARM, Tone.COOL, or Tone.NEUTRAL.

    Raises:
        ValueError: if any component is outside its valid range.
    """
    _validate_hsv(h, s, v)

    # Near-grayscale → no meaningful hue → neutral.
    if s < thresholds.hsv_saturation_floor:
        return Tone.NEUTRAL

    # Warm band: 0..upper inclusive on the lower side, and (lower_wrap..360]
    # on the upper side. Hue 360 wraps to 0 (red), so include it as warm.
    if h <= thresholds.hsv_warm_upper:
        return Tone.WARM
    if h > thresholds.hsv_warm_lower_wrap:
        return Tone.WARM

    # Cool band: a single contiguous interval.
    if thresholds.hsv_cool_lower <= h <= thresholds.hsv_cool_upper:
        return Tone.COOL

    # Yellow-green (60-180) and purple (270-300) — intermediate, neutral.
    return Tone.NEUTRAL


# ---------------------------------------------------------------------------
# Internal validators
# ---------------------------------------------------------------------------


def _validate_rgb_channel(name: str, value: int) -> None:
    # Reject bools first — bool is a subclass of int in Python, and accepting
    # True/False as 1/0 would mask caller bugs.
    if not isinstance(value, int) or isinstance(value, bool):
        raise TypeError(
            f"RGB channel {name!r} must be int, got {type(value).__name__}",
        )
    if not 0 <= value <= 255:
        raise ValueError(
            f"RGB channel {name!r} must be in 0-255, got {value}",
        )


def _validate_hsv(h: float, s: float, v: float) -> None:
    if not 0.0 <= h <= 360.0:
        raise ValueError(f"HSV hue must be in 0-360, got {h}")
    if not 0.0 <= s <= 1.0:
        raise ValueError(f"HSV saturation must be in 0-1, got {s}")
    if not 0.0 <= v <= 1.0:
        raise ValueError(f"HSV value must be in 0-1, got {v}")
