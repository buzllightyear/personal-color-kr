"""High/low contrast classifier (Sub-AC 10.2).

Second axis of the Korean personal color system after warm/cool tone (10.1).
Used as a primitive that the 4-category classifier (Sub-AC 10.3+) composes
along with the tone primitive to assign 봄/여름/가을/겨울.

Korean personal color framework (cheat sheet for downstream readers):
  - Warm + high contrast → 봄 (Spring): bright, clear
  - Cool + low  contrast → 여름 (Summer): light, muted
  - Warm + low  contrast → 가을 (Autumn): deep, muted
  - Cool + high contrast → 겨울 (Winter): dark, clear

Two input forms (mirrors 10.1's RGB+HSV split):
  - `classify_contrast_from_lightness(L)`: a single lightness scalar
    (HSV-V or HSL-L). Decides whether the sample is "high-key" (HIGH) or
    "low-key" (LOW) relative to a midpoint threshold.
  - `classify_contrast_from_delta(L_light, L_dark)`: the lightness gap
    between two samples (e.g., skin vs hair / pupil). Decides whether the
    gap is above the contrast threshold.

Design notes:
  - Returns a `Contrast` enum (HIGH / LOW). Binary per the sub-AC spec.
    Callers needing a borderline tier can compare against the threshold
    themselves.
  - Boundary semantics are strict-greater-than: exact threshold maps to
    LOW so the HIGH bucket requires a clear signal. Encoded as test cases.
  - All inputs validated at the boundary. No silent clamping — bad input
    is a programmer error and should surface immediately.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Contrast(Enum):
    """High/low contrast classification."""

    HIGH = "high"
    LOW = "low"


# ---------------------------------------------------------------------------
# Tunables — module-level frozen config so a future calibration pass
# (Sub-AC 10.3+) can override them without touching call sites.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ContrastThresholds:
    """Decision thresholds for the high/low contrast classifier."""

    # Single-lightness midpoint. A sample with lightness > this is "high-key"
    # → HIGH; <= this is "low-key" → LOW.
    lightness_midpoint: float = 0.5

    # Pair-delta threshold. |L_light - L_dark| > this counts as HIGH contrast.
    # 0.4 reflects a clear skin-vs-feature gap (e.g., light skin + dark hair)
    # while staying robust to camera exposure noise.
    delta_threshold: float = 0.4


DEFAULT_CONTRAST_THRESHOLDS = ContrastThresholds()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def classify_contrast_from_lightness(
    lightness: float,
    *,
    thresholds: ContrastThresholds = DEFAULT_CONTRAST_THRESHOLDS,
) -> Contrast:
    """Classify high/low contrast from a single lightness sample.

    Args:
        lightness: Brightness/lightness in [0.0, 1.0]. 0 = black, 1 = white.
            Accepts HSV-V or HSL-L; callers must pick one and stay consistent
            across an analysis pass.
        thresholds: Optional override of decision thresholds.

    Returns:
        Contrast.HIGH if the sample is strictly above the midpoint (high-key).
        Contrast.LOW otherwise (including the exact midpoint).

    Raises:
        TypeError: if lightness is not a real number (bool rejected).
        ValueError: if lightness is outside 0.0-1.0.
    """
    _validate_lightness("lightness", lightness)
    if lightness > thresholds.lightness_midpoint:
        return Contrast.HIGH
    return Contrast.LOW


def classify_contrast_from_delta(
    lightness_light: float,
    lightness_dark: float,
    *,
    thresholds: ContrastThresholds = DEFAULT_CONTRAST_THRESHOLDS,
) -> Contrast:
    """Classify high/low contrast from a pair of lightness samples.

    Computes |lightness_light - lightness_dark|. Caller convention is that
    the first arg is the lighter feature (skin) and the second is the
    darker feature (hair / pupils), but the function uses absolute delta
    so swapped inputs still produce a sane verdict — see the order-
    independence test.

    Args:
        lightness_light: Lightness of the lighter sample, 0.0-1.0.
        lightness_dark:  Lightness of the darker sample, 0.0-1.0.
        thresholds: Optional override of decision thresholds.

    Returns:
        Contrast.HIGH if |delta| strictly exceeds delta_threshold.
        Contrast.LOW otherwise (including the exact threshold).

    Raises:
        TypeError: if either argument is not a real number.
        ValueError: if either argument is outside 0.0-1.0.
    """
    _validate_lightness("lightness_light", lightness_light)
    _validate_lightness("lightness_dark", lightness_dark)

    delta = abs(lightness_light - lightness_dark)
    if delta > thresholds.delta_threshold:
        return Contrast.HIGH
    return Contrast.LOW


# ---------------------------------------------------------------------------
# Internal validators
# ---------------------------------------------------------------------------


def _validate_lightness(name: str, value: float) -> None:
    # Reject bools first — bool is a subclass of int in Python, and accepting
    # True/False as 1.0/0.0 would mask caller bugs.
    if isinstance(value, bool):
        raise TypeError(
            f"Lightness {name!r} must be a real number, got bool",
        )
    if not isinstance(value, (int, float)):
        raise TypeError(
            f"Lightness {name!r} must be a real number, "
            f"got {type(value).__name__}",
        )
    if not 0.0 <= value <= 1.0:
        raise ValueError(
            f"Lightness {name!r} must be in 0.0-1.0, got {value}",
        )
