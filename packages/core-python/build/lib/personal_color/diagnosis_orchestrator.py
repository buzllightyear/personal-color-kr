"""End-to-end diagnosis orchestrator (Sub-AC 10.5).

Takes the per-region representative colors produced by the region extractor
(Sub-AC 10.4) and threads them through the warm/cool tone primitive (10.1),
the high/low contrast primitive (10.2), and the 4-category season classifier
(10.3) to produce a single 봄/여름/가을/겨울 verdict plus a calibrated
confidence score.

Why a dedicated orchestrator layer:

  - The 12-step Glam Up payment funnel surfaces *one* result and *one*
    confidence number on the diagnosis-result screen. The funnel must not
    branch on primitive enums (Tone/Contrast) at the UI layer — primitives
    are math, the funnel is product. This module is the seam between them.
  - Confidence is a product concern, not a primitive concern. The 10.1/10.2
    primitives return discrete enums; this module converts the *underlying
    signal strength* into a 0-1 confidence the funnel can render as
    "당신은 92% 봄 웜톤입니다" or gate "재촬영" prompts on a threshold.
  - Decouples *where colors come from* (region extraction vs landmark
    adapter vs manual color picker) from *how they become a Season*. The
    orchestrator accepts a `RegionColors`; whatever produces it is the
    caller's choice.

Pipeline:

  RegionColors  ──┬─►  skin RGB  ─►  classify_tone_rgb   ─►  Tone
                  │
                  ├─►  skin luma ─┐
                  │               ├─►  classify_contrast_from_delta ─►  Contrast
                  └─►  hair luma ─┘
                                                            │
                          Tone ──┬───────────────────────► classify_season ─► Season
                                 │
                  Tone signal ──►│ tone_confidence (0-1)
                                 │
                  Contrast signal ►│ contrast_confidence (0-1)
                                                       │
                                            geometric mean ─► overall confidence

Design notes:

  - Lightness: Rec. 601 luma `(0.299 R + 0.587 G + 0.114 B) / 255`. The
    contrast primitive's docstring permits HSV-V or HSL-L; perceptual
    luma is the more honest metric for "skin vs hair brightness gap" and
    is what consumer image pipelines (and the future MediaPipe / Face++
    adapter) emit.
  - NEUTRAL handling: the 10.1 RGB primitive returns Tone.NEUTRAL when
    |R - B| is within the chroma floor. The funnel must show *some*
    verdict — making the user retake the selfie on every borderline tone
    would tank the diagnosis→payment conversion. The orchestrator falls
    back to sign(R - B) (ties → WARM, mild East-Asian-skin yellow-undertone
    prior) and surfaces the weakness through the confidence score, not
    through an exception. Callers (the funnel) can gate on confidence
    themselves.
  - Confidence: geometric mean of per-axis confidences. Each axis is a
    saturating function of its signal magnitude. This keeps the number
    interpretable ("both axes strong" → high; "one axis weak" → pulled
    down even if the other is strong), and refuses to overclaim from a
    single dominant signal.
  - Inputs and tuning knobs are passed through. The orchestrator does not
    re-validate what the primitives already validate; it relies on their
    boundary checks and lets exceptions propagate.
  - Returns a frozen dataclass that surfaces every intermediate signal
    (tone, contrast, per-axis luma, per-axis confidence). The funnel layer
    only needs `season` + `confidence`; the rest exists for the analytics
    pipeline and for future calibration passes that compare measured
    confidence-vs-actual outcomes.
"""

from __future__ import annotations

from dataclasses import dataclass

from personal_color.contrast_classifier import (
    Contrast,
    ContrastThresholds,
    DEFAULT_CONTRAST_THRESHOLDS,
    classify_contrast_from_delta,
)
from personal_color.region_extractor import (
    Aggregation,
    FaceRegions,
    Image,
    RegionColors,
    extract_face_region_colors,
)
from personal_color.season_classifier import (
    Season,
    classify_season,
)
from personal_color.tone_classifier import (
    DEFAULT_THRESHOLDS,
    Tone,
    ToneThresholds,
    classify_tone_rgb,
)


# ---------------------------------------------------------------------------
# Tunables — kept as a frozen dataclass so a future calibration pass can
# tweak the confidence shaping without touching call sites in the funnel.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConfidenceScales:
    """Saturation scales used to map raw signal magnitudes into 0-1.

    For a signal `s >= 0`, the per-axis confidence is `min(s / scale, 1)`.
    `scale` is the signal value at which the axis is considered "fully
    confident". Numbers below `scale` taper linearly; numbers above clamp
    to 1.0. Linear (not sigmoid) on purpose — linear keeps the relationship
    between signal and shown percentage interpretable for the funnel UI
    ("twice as much skin-vs-hair gap → twice the contrast confidence,
    up to the ceiling") and easy to recalibrate from analytics data.
    """

    # Tone: |R - B| over 0-255. ~40 is the high-confidence threshold for
    # human skin tones — strongly yellow or strongly blue undertones. Above
    # this we're not getting any more useful signal from RGB alone.
    tone_rgb_chroma_scale: int = 40

    # Contrast: |luma_skin - luma_hair| over 0-1. ~0.6 covers the typical
    # span between bright Korean skin (luma ~0.75) and natural-black hair
    # (luma ~0.15). Above this and we're either dealing with a clip-out
    # or a non-natural sample.
    luma_delta_scale: float = 0.6


DEFAULT_CONFIDENCE_SCALES = ConfidenceScales()


# Rec. 601 luma coefficients — used to convert each region's representative
# RGB into a single brightness scalar for the contrast primitive. Kept as
# named constants so the test suite can pin the exact formula.
_REC601_R = 0.299
_REC601_G = 0.587
_REC601_B = 0.114


# ---------------------------------------------------------------------------
# Public result type
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DiagnosisResult:
    """Output of the diagnosis orchestrator.

    Attributes:
        season: The 4-category Korean personal-color verdict (봄/여름/가을/겨울).
        confidence: Overall confidence in `season`, 0.0-1.0. Geometric mean
            of `tone_confidence` and `contrast_confidence`. 0 means *both*
            axes had zero signal; 1 means both axes saturated.
        tone: The intermediate warm/cool verdict. Never `Tone.NEUTRAL` —
            the orchestrator commits to WARM or COOL even on borderline
            inputs (see module docstring). Surface to analytics, not to UI.
        contrast: The intermediate HIGH/LOW contrast verdict.
        tone_confidence: Per-axis tone confidence, 0.0-1.0.
        contrast_confidence: Per-axis contrast confidence, 0.0-1.0.
        skin_luma: Rec. 601 luma of the skin region color, 0.0-1.0.
        hair_luma: Rec. 601 luma of the hair region color, 0.0-1.0.
        eyes_luma: Rec. 601 luma of the eyes region color, 0.0-1.0.
            Currently informational — eyes are reserved for a future
            tertiary-feature pass that disambiguates borderline cases.
    """

    season: Season
    confidence: float
    tone: Tone
    contrast: Contrast
    tone_confidence: float
    contrast_confidence: float
    skin_luma: float
    hair_luma: float
    eyes_luma: float


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def diagnose_from_region_colors(
    colors: RegionColors,
    *,
    tone_thresholds: ToneThresholds = DEFAULT_THRESHOLDS,
    contrast_thresholds: ContrastThresholds = DEFAULT_CONTRAST_THRESHOLDS,
    confidence_scales: ConfidenceScales = DEFAULT_CONFIDENCE_SCALES,
) -> DiagnosisResult:
    """Compose the diagnosis primitives over per-region representative colors.

    Args:
        colors: Skin / eyes / hair representative RGB tuples (from the
            region extractor, Sub-AC 10.4).
        tone_thresholds: Override 10.1 tone primitive thresholds.
        contrast_thresholds: Override 10.2 contrast primitive thresholds.
        confidence_scales: Override the saturation scales used to shape
            confidence from raw signal magnitudes.

    Returns:
        A `DiagnosisResult` with the final season, the overall confidence,
        and all intermediate signals (for analytics + future calibration).

    Raises:
        TypeError: if `colors` is not a `RegionColors` instance, or any
            channel is the wrong type (propagated from the 10.1 primitive).
        ValueError: if any channel is outside 0-255 (propagated from the
            10.1 primitive).
    """
    if not isinstance(colors, RegionColors):
        raise TypeError(
            f"colors must be a RegionColors instance, "
            f"got {type(colors).__name__}",
        )
    _validate_confidence_scales(confidence_scales)

    r, g, b = colors.skin
    skin_luma = _rec601_luma(colors.skin)
    hair_luma = _rec601_luma(colors.hair)
    eyes_luma = _rec601_luma(colors.eyes)

    # --- tone (10.1) -------------------------------------------------------
    tone_primitive = classify_tone_rgb(r, g, b, thresholds=tone_thresholds)
    tone = _resolve_neutral_tone(tone_primitive, r=r, b=b)

    # --- contrast (10.2) ---------------------------------------------------
    contrast = classify_contrast_from_delta(
        skin_luma,
        hair_luma,
        thresholds=contrast_thresholds,
    )

    # --- season (10.3) -----------------------------------------------------
    season = classify_season(tone, contrast)

    # --- confidence shaping ------------------------------------------------
    tone_confidence = _saturating_confidence(
        signal=abs(r - b),
        scale=confidence_scales.tone_rgb_chroma_scale,
    )
    contrast_confidence = _saturating_confidence(
        signal=abs(skin_luma - hair_luma),
        scale=confidence_scales.luma_delta_scale,
    )
    overall_confidence = _geometric_mean(tone_confidence, contrast_confidence)

    return DiagnosisResult(
        season=season,
        confidence=overall_confidence,
        tone=tone,
        contrast=contrast,
        tone_confidence=tone_confidence,
        contrast_confidence=contrast_confidence,
        skin_luma=skin_luma,
        hair_luma=hair_luma,
        eyes_luma=eyes_luma,
    )


def diagnose_from_image(
    image: Image,
    regions: FaceRegions,
    *,
    aggregation: Aggregation = Aggregation.MEDIAN,
    tone_thresholds: ToneThresholds = DEFAULT_THRESHOLDS,
    contrast_thresholds: ContrastThresholds = DEFAULT_CONTRAST_THRESHOLDS,
    confidence_scales: ConfidenceScales = DEFAULT_CONFIDENCE_SCALES,
) -> DiagnosisResult:
    """End-to-end convenience: image + region rects → DiagnosisResult.

    Glues the region extractor (10.4) onto `diagnose_from_region_colors`.
    Intended for tests and for callers that already hold a raw image plus
    landmark-derived rectangles.

    Args:
        image: 2D rows-first array of RGB tuples (see 10.4 contract).
        regions: `FaceRegions` bundle for skin / eyes / hair.
        aggregation: MEDIAN (default, robust) or MEAN for the per-region
            color collapse.
        tone_thresholds: Override 10.1 thresholds.
        contrast_thresholds: Override 10.2 thresholds.
        confidence_scales: Override confidence saturation scales.

    Returns:
        A `DiagnosisResult`. See `diagnose_from_region_colors`.

    Raises:
        TypeError / ValueError: propagated from the region extractor or
            the tone/contrast primitives.
    """
    colors = extract_face_region_colors(image, regions, aggregation=aggregation)
    return diagnose_from_region_colors(
        colors,
        tone_thresholds=tone_thresholds,
        contrast_thresholds=contrast_thresholds,
        confidence_scales=confidence_scales,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _rec601_luma(rgb: tuple[int, int, int]) -> float:
    """Rec. 601 luma from an 8-bit RGB tuple. Returns a float in 0.0-1.0."""
    r, g, b = rgb
    return (_REC601_R * r + _REC601_G * g + _REC601_B * b) / 255.0


def _resolve_neutral_tone(primitive_tone: Tone, *, r: int, b: int) -> Tone:
    """Commit a primitive Tone verdict to WARM or COOL.

    The 10.1 RGB primitive returns Tone.NEUTRAL for low-chroma inputs (the
    chroma floor). The diagnosis funnel must surface *some* season; we
    decide by the sign of (R - B). Tie (R == B) → WARM, reflecting the
    mild yellow-undertone prior of East-Asian skin and giving a
    deterministic tiebreaker. The weakness shows up as low confidence,
    not as a missing verdict.
    """
    if primitive_tone is Tone.WARM:
        return Tone.WARM
    if primitive_tone is Tone.COOL:
        return Tone.COOL
    # NEUTRAL — fall back to sign(R - B). Ties to WARM.
    return Tone.COOL if (r - b) < 0 else Tone.WARM


def _saturating_confidence(*, signal: float, scale: float) -> float:
    """Clamp `signal / scale` into 0.0-1.0.

    Linear ramp from 0 at signal=0 to 1 at signal=scale; flat at 1 above.
    Linear (not sigmoid) per the ConfidenceScales docstring.
    """
    if signal <= 0:
        return 0.0
    ratio = signal / scale
    if ratio >= 1.0:
        return 1.0
    return ratio


def _geometric_mean(a: float, b: float) -> float:
    """Geometric mean of two values in 0.0-1.0.

    Equivalent to sqrt(a * b). Pulls the overall confidence down whenever
    *either* axis is weak, even if the other is saturated. Matches the
    product intent — we should not surface "95% 봄" when only the contrast
    signal is strong and the tone signal is borderline.
    """
    if a <= 0 or b <= 0:
        return 0.0
    return (a * b) ** 0.5


def _validate_confidence_scales(scales: ConfidenceScales) -> None:
    if not isinstance(scales, ConfidenceScales):
        raise TypeError(
            f"confidence_scales must be a ConfidenceScales instance, "
            f"got {type(scales).__name__}",
        )
    if scales.tone_rgb_chroma_scale <= 0:
        raise ValueError(
            f"tone_rgb_chroma_scale must be > 0, "
            f"got {scales.tone_rgb_chroma_scale}",
        )
    if scales.luma_delta_scale <= 0:
        raise ValueError(
            f"luma_delta_scale must be > 0, got {scales.luma_delta_scale}",
        )
