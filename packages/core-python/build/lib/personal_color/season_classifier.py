"""4-category season classifier (Sub-AC 10.3).

Composes the two Korean-personal-color primitives — warm/cool tone (10.1)
and high/low contrast (10.2) — into the canonical 봄/여름/가을/겨울 verdict
that the diagnosis hook surfaces to the user before the 12-step Glam Up
payment funnel.

Truth table (the *only* mapping; exhaustive on a 2x2 input):

  +----------+-------------------+-------------------+
  |          | HIGH contrast     | LOW contrast      |
  +----------+-------------------+-------------------+
  | WARM     | 봄 (SPRING)        | 가을 (AUTUMN)      |
  | COOL     | 겨울 (WINTER)       | 여름 (SUMMER)      |
  +----------+-------------------+-------------------+

Design notes:
  - Returns a `Season` enum. Same rationale as the primitives — stringly-
    typed downstream comparisons are a known bug source in funnel code.
  - `Tone.NEUTRAL` is *not* a season. The primitive intentionally returns
    NEUTRAL on low-chroma / borderline samples; resolving NEUTRAL is the
    caller's responsibility (e.g., resample, blend multiple skin patches,
    or surface a "재촬영" prompt at the diagnosis step). We raise
    ValueError rather than silently picking a season so calibration bugs
    are loud, not hidden.
  - Two convenience entry points wrap the lowest-level primitives:
      * `classify_season_from_rgb_and_lightness` — pairs the 10.1 RGB
        tone primitive with the 10.2 single-lightness contrast primitive.
        Right shape for "I have one skin sample + its brightness."
      * `classify_season_from_hsv_and_delta` — pairs the 10.1 HSV tone
        primitive with the 10.2 pair-delta contrast primitive. Right
        shape for the full diagnosis flow that compares skin to hair /
        pupil samples.
  - Composition functions delegate input validation to the underlying
    primitives. They do not silently swallow or remap their errors.
"""

from __future__ import annotations

from enum import Enum

from personal_color.contrast_classifier import (
    Contrast,
    ContrastThresholds,
    DEFAULT_CONTRAST_THRESHOLDS,
    classify_contrast_from_delta,
    classify_contrast_from_lightness,
)
from personal_color.tone_classifier import (
    DEFAULT_THRESHOLDS,
    Tone,
    ToneThresholds,
    classify_tone_hsv,
    classify_tone_rgb,
)


class Season(Enum):
    """Korean personal-color 4-category verdict.

    Each member carries a Korean display label (`korean` property) so the
    diagnosis result screen can render the hangul name without a separate
    lookup table.
    """

    SPRING = ("spring", "봄")
    SUMMER = ("summer", "여름")
    AUTUMN = ("autumn", "가을")
    WINTER = ("winter", "겨울")

    def __init__(self, slug: str, korean: str) -> None:
        # Enum members store both a stable slug (for serialization, e.g.
        # analytics events, DB columns) and the Korean display label.
        self.slug = slug
        self.korean = korean


# ---------------------------------------------------------------------------
# Truth table — the entire mapping in one place. Keeping it as data, not
# branching control flow, makes the bijection inspection in the test suite
# trivial and prevents an accidental refactor from drifting a single cell.
# ---------------------------------------------------------------------------


_SEASON_TABLE: dict[tuple[Tone, Contrast], Season] = {
    (Tone.WARM, Contrast.HIGH): Season.SPRING,
    (Tone.WARM, Contrast.LOW): Season.AUTUMN,
    (Tone.COOL, Contrast.HIGH): Season.WINTER,
    (Tone.COOL, Contrast.LOW): Season.SUMMER,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def classify_season(tone: Tone, contrast: Contrast) -> Season:
    """Map a (tone, contrast) pair to its 4-category season.

    Args:
        tone: Tone.WARM or Tone.COOL. Tone.NEUTRAL is *not* a valid season
            input — see module docstring for rationale.
        contrast: Contrast.HIGH or Contrast.LOW.

    Returns:
        The corresponding Season enum member.

    Raises:
        TypeError: if either argument is not the expected enum type.
        ValueError: if tone is Tone.NEUTRAL.
    """
    if not isinstance(tone, Tone):
        raise TypeError(
            f"tone must be a Tone enum, got {type(tone).__name__}",
        )
    if not isinstance(contrast, Contrast):
        raise TypeError(
            f"contrast must be a Contrast enum, got {type(contrast).__name__}",
        )

    try:
        return _SEASON_TABLE[(tone, contrast)]
    except KeyError as exc:
        # Only reachable for Tone.NEUTRAL given the isinstance checks above.
        raise ValueError(
            f"cannot map tone={tone.name} to a season — caller must "
            "resolve NEUTRAL undertone before classifying.",
        ) from exc


def classify_season_from_rgb_and_lightness(
    *,
    r: int,
    g: int,
    b: int,
    lightness: float,
    tone_thresholds: ToneThresholds = DEFAULT_THRESHOLDS,
    contrast_thresholds: ContrastThresholds = DEFAULT_CONTRAST_THRESHOLDS,
) -> Season:
    """Convenience: RGB → tone, single lightness → contrast → Season.

    Keyword-only to keep the call site self-documenting at the funnel layer
    (where mixed-up arg order would be a high-impact bug).
    """
    tone = classify_tone_rgb(r, g, b, thresholds=tone_thresholds)
    contrast = classify_contrast_from_lightness(
        lightness,
        thresholds=contrast_thresholds,
    )
    return classify_season(tone, contrast)


def classify_season_from_hsv_and_delta(
    *,
    h: float,
    s: float,
    v: float,
    lightness_light: float,
    lightness_dark: float,
    tone_thresholds: ToneThresholds = DEFAULT_THRESHOLDS,
    contrast_thresholds: ContrastThresholds = DEFAULT_CONTRAST_THRESHOLDS,
) -> Season:
    """Convenience: HSV → tone, lightness pair → contrast → Season.

    Keyword-only — same reason as the RGB variant; the diagnosis flow
    intentionally passes 5 floats and a name-positional call would be a
    foot-gun.
    """
    tone = classify_tone_hsv(h, s, v, thresholds=tone_thresholds)
    contrast = classify_contrast_from_delta(
        lightness_light,
        lightness_dark,
        thresholds=contrast_thresholds,
    )
    return classify_season(tone, contrast)
