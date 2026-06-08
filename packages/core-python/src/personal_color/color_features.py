"""Rule-based color feature extraction from skin pixel arrays (Sub-AC 12.1.3).

Given a flat tuple of skin-only RGB pixels (the ``pixels`` field from
:class:`personal_color.skin_extractor.SkinExtractionResult`), this module
returns a three-component color feature vector used by the personal-color
season classifier.

The three features
------------------
색온도 (color temperature)
    Normalized warm/cool signal derived from the red-minus-blue channel
    difference averaged across all skin pixels.  Warm skin tones (봄웜,
    가을웜) have more red than blue → positive value; cool tones (여름쿨,
    겨울쿨) have higher blue relative to red → negative value.

    Formula::

        color_temperature = (mean_R - mean_B) / 255.0

    Range: ``[-1.0, 1.0]``.

명도 (brightness)
    Perceptual luminance of the skin region using the Rec. 601 luma
    formula — the same formula used by the contrast classifier (Sub-AC
    10.2).

    Formula::

        brightness = (0.299 * mean_R + 0.587 * mean_G + 0.114 * mean_B) / 255.0

    Range: ``[0.0, 1.0]``.

채도 (saturation)
    HSV saturation of the mean skin color — the ratio of chroma to the
    maximum channel value.  A fully-desaturated (grey/white/black) skin
    region returns 0.0; a fully-saturated region returns 1.0.

    Formula::

        max_c = max(mean_R, mean_G, mean_B)
        min_c = min(mean_R, mean_G, mean_B)
        saturation = (max_c - min_c) / max_c   if max_c > 0 else 0.0

    Range: ``[0.0, 1.0]``.

Design constraints (same as the rest of the diagnosis primitive layer)
----------------------------------------------------------------------
* Pure Python only — no numpy, no PIL, no binary extensions.
  Tests run without any heavy dep install.
* Fully rule-based / deterministic: no learned model, no inference call,
  no external vendor.  Satisfies the Seed constraint
  "자체 AI 모델 학습 금지" and the explicit carve-out
  "identity_similarity_score = face-landmark 기반 *rule-based* 유사도
  … → 허용".
* Immutable output (frozen dataclass) — consistent with every other
  dataclass in the diagnosis stack.
* No silent clamping, no permissive coercion.  Bad input raises
  ``TypeError`` or ``ValueError`` at the boundary.
"""

from __future__ import annotations

from dataclasses import dataclass

from personal_color.region_extractor import RGB


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ColorFeatureVector:
    """Immutable three-component color feature vector for skin pixels.

    Attributes
    ----------
    color_temperature:
        Normalized warm/cool signal in ``[-1.0, 1.0]``.  Positive values
        indicate warm skin undertones (more R than B); negative values
        indicate cool undertones.
    brightness:
        Rec. 601 luma of the mean skin color in ``[0.0, 1.0]``.
    saturation:
        HSV saturation of the mean skin color in ``[0.0, 1.0]``.
    """

    color_temperature: float
    brightness: float
    saturation: float


# ---------------------------------------------------------------------------
# Rec. 601 luma coefficients (same as contrast_classifier.py)
# ---------------------------------------------------------------------------

_LUMA_R: float = 0.299
_LUMA_G: float = 0.587
_LUMA_B: float = 0.114


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_warm_cool_score(pixels: tuple[RGB, ...]) -> float:
    """Compute the warm/cool temperature score from a set of skin pixels.

    Returns a positive float for warm-tone pixel sets (high red/yellow) and a
    negative float for cool-tone pixel sets (high blue).

    This is the scalar projection of the full :func:`compute_color_features`
    pipeline onto the single warm/cool axis.  It is exposed as a standalone
    function so callers that only need the warm/cool signal don't pay the cost
    of computing brightness and saturation.

    Formula::

        warm_cool_score = (mean_R - mean_B) / 255.0

    Rationale:
    * Warm undertones (봄웜, 가을웜) are characterised by relatively high red
      and/or yellow (= high R + G, low B) content → ``mean_R > mean_B``
      → positive score.
    * Cool undertones (여름쿨, 겨울쿨) are characterised by elevated blue
      relative to red → ``mean_B > mean_R`` → negative score.
    * Yellow pixels (high R + G, low B) also produce a positive score because
      ``mean_R`` remains well above ``mean_B`` for typical yellow hues.

    Range: ``[-1.0, 1.0]``.

    Parameters
    ----------
    pixels:
        A non-empty tuple (or other Sequence) of ``(r, g, b)`` int-tuples
        whose channel values lie in ``[0, 255]``.  Typically the ``pixels``
        field from :class:`personal_color.skin_extractor.SkinExtractionResult`.

    Returns
    -------
    float
        Warm/cool score in ``[-1.0, 1.0]``.  Positive → warm, negative → cool.

    Raises
    ------
    TypeError:
        If ``pixels`` is not a Sequence, if any element is not a 3-tuple of
        ints, or if any channel value is a bool.
    ValueError:
        If ``pixels`` is empty, or if any channel value is outside ``[0, 255]``.
    """
    _validate_pixels(pixels)

    n = len(pixels)
    mean_r: float = sum(p[0] for p in pixels) / n
    mean_b: float = sum(p[2] for p in pixels) / n

    return (mean_r - mean_b) / 255.0


def compute_color_features(pixels: tuple[RGB, ...]) -> ColorFeatureVector:
    """Compute color temperature, brightness, and saturation from skin pixels.

    Aggregates all pixel values into a single mean RGB color and then
    derives three scalar features using closed-form, rule-based formulas.
    No model inference occurs anywhere on the call path.

    Parameters
    ----------
    pixels:
        A non-empty tuple of ``(r, g, b)`` int-tuples whose channel values
        lie in ``[0, 255]``.  Typically the ``pixels`` field from
        :class:`personal_color.skin_extractor.SkinExtractionResult`.

    Returns
    -------
    ColorFeatureVector
        * ``color_temperature`` — warm/cool signal in ``[-1.0, 1.0]``.
        * ``brightness`` — Rec. 601 luma in ``[0.0, 1.0]``.
        * ``saturation`` — HSV saturation in ``[0.0, 1.0]``.

    Raises
    ------
    TypeError:
        If ``pixels`` is not a tuple (or other Sequence), if any element
        is not a 3-tuple of ints, or if any channel is a bool.
    ValueError:
        If ``pixels`` is empty, or if any channel value is outside
        ``[0, 255]``.
    """
    _validate_pixels(pixels)

    n = len(pixels)
    sum_r = sum(p[0] for p in pixels)
    sum_g = sum(p[1] for p in pixels)
    sum_b = sum(p[2] for p in pixels)

    mean_r: float = sum_r / n
    mean_g: float = sum_g / n
    mean_b: float = sum_b / n

    color_temperature = (mean_r - mean_b) / 255.0
    brightness = (_LUMA_R * mean_r + _LUMA_G * mean_g + _LUMA_B * mean_b) / 255.0

    max_c = max(mean_r, mean_g, mean_b)
    min_c = min(mean_r, mean_g, mean_b)
    saturation = (max_c - min_c) / max_c if max_c > 0.0 else 0.0

    return ColorFeatureVector(
        color_temperature=color_temperature,
        brightness=brightness,
        saturation=saturation,
    )


# ---------------------------------------------------------------------------
# Internal helpers — input validation
# ---------------------------------------------------------------------------


def _validate_pixels(pixels: object) -> None:
    """Validate the pixel array; raise TypeError / ValueError on bad input."""
    from collections.abc import Sequence  # noqa: PLC0415 — local avoids circular

    if isinstance(pixels, (str, bytes)) or not isinstance(pixels, Sequence):
        raise TypeError(
            f"pixels must be a Sequence of RGB tuples, "
            f"got {type(pixels).__name__}",
        )
    if len(pixels) == 0:
        raise ValueError("pixels must not be empty — at least one pixel required")

    for idx, pixel in enumerate(pixels):
        _validate_single_pixel(pixel, idx=idx)


def _validate_single_pixel(pixel: object, *, idx: int) -> None:
    """Validate a single pixel at the given index."""
    if not isinstance(pixel, tuple) or len(pixel) != 3:
        raise TypeError(
            f"pixels[{idx}] must be a 3-tuple (r, g, b), "
            f"got {type(pixel).__name__}",
        )
    for ch_name, ch in zip("rgb", pixel, strict=True):
        if isinstance(ch, bool) or not isinstance(ch, int):
            raise TypeError(
                f"pixels[{idx}] channel '{ch_name}' must be int, "
                f"got {type(ch).__name__}",
            )
        if not 0 <= ch <= 255:
            raise ValueError(
                f"pixels[{idx}] channel '{ch_name}' must be 0-255, "
                f"got {ch}",
            )


# ---------------------------------------------------------------------------
# HSB output type
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HSBColor:
    """Immutable HSB (Hue, Saturation, Brightness) color representation.

    Also known as HSV (Hue, Saturation, Value).  Used by the personal-color
    pipeline to express the mean skin color in a perceptually intuitive
    cylindrical color space.

    Attributes
    ----------
    hue:
        Hue angle in degrees in ``[0.0, 360.0)``.  0° / 360° = red,
        60° = yellow, 120° = green, 180° = cyan, 240° = blue, 300° = magenta.
        For achromatic colors (saturation = 0) hue is defined as 0.0.
    saturation:
        Chroma relative to the maximum channel value, in ``[0.0, 1.0]``.
        0.0 = fully desaturated (grey/white/black); 1.0 = fully saturated.
    brightness:
        Maximum channel value (``max(R, G, B) / 255``), in ``[0.0, 1.0]``.
        0.0 = black; 1.0 = full brightness.
    """

    hue: float
    saturation: float
    brightness: float


# ---------------------------------------------------------------------------
# HSB conversion — public API
# ---------------------------------------------------------------------------


def pixels_to_hsb(pixels: tuple[RGB, ...]) -> HSBColor:
    """Convert a pixel array to HSB by averaging the pixels then converting.

    Aggregates all pixel values into a single mean RGB color (same approach
    as :func:`compute_color_features`) and then applies the standard HSV /
    HSB conversion formula.  No model inference occurs anywhere on the
    call path — the computation is fully deterministic and rule-based.

    The returned hue is 0.0 for achromatic inputs (saturation = 0), matching
    the canonical HSV definition.

    Parameters
    ----------
    pixels:
        A non-empty tuple (or other Sequence) of ``(r, g, b)`` int-tuples
        whose channel values lie in ``[0, 255]``.

    Returns
    -------
    HSBColor
        * ``hue`` — hue angle in ``[0.0, 360.0)`` degrees.
        * ``saturation`` — chroma ratio in ``[0.0, 1.0]``.
        * ``brightness`` — max-channel ratio in ``[0.0, 1.0]``.

    Raises
    ------
    TypeError:
        If ``pixels`` is not a Sequence, if any element is not a 3-tuple of
        ints, or if any channel value is a bool.
    ValueError:
        If ``pixels`` is empty, or if any channel value is outside ``[0, 255]``.
    """
    _validate_pixels(pixels)

    n = len(pixels)
    mean_r: float = sum(p[0] for p in pixels) / n
    mean_g: float = sum(p[1] for p in pixels) / n
    mean_b: float = sum(p[2] for p in pixels) / n

    return _rgb_to_hsb(mean_r, mean_g, mean_b)


# ---------------------------------------------------------------------------
# Internal helper — RGB → HSB conversion
# ---------------------------------------------------------------------------


def _rgb_to_hsb(r: float, g: float, b: float) -> HSBColor:
    """Convert a mean-RGB triplet (0.0–255.0 float range) to HSB.

    Uses the standard HSV algorithm (IEC 61966-2-1).  All arithmetic is
    purely deterministic; no branching depends on external state.
    """
    # Normalize to [0.0, 1.0]
    r_f = r / 255.0
    g_f = g / 255.0
    b_f = b / 255.0

    cmax = max(r_f, g_f, b_f)
    cmin = min(r_f, g_f, b_f)
    delta = cmax - cmin

    # Brightness = V = max channel
    brightness = cmax

    # Saturation
    saturation = delta / cmax if cmax > 0.0 else 0.0

    # Hue
    if delta == 0.0:
        hue = 0.0  # achromatic — undefined, canonically set to 0
    elif cmax == r_f:
        raw = ((g_f - b_f) / delta) % 6.0
        hue = 60.0 * raw
    elif cmax == g_f:
        hue = 60.0 * ((b_f - r_f) / delta + 2.0)
    else:  # cmax == b_f
        hue = 60.0 * ((r_f - g_f) / delta + 4.0)

    # Guard against floating-point drift that pushes hue to exactly 360.0
    if hue >= 360.0:
        hue -= 360.0

    return HSBColor(hue=hue, saturation=saturation, brightness=brightness)


__all__ = [
    "ColorFeatureVector",
    "HSBColor",
    "compute_color_features",
    "compute_warm_cool_score",
    "pixels_to_hsb",
]
