"""컬러 특징 → 퍼스널컬러 시즌 분류 함수 (Sub-AC 17-2).

Takes four colour-feature scalars extracted from a selfie's skin region and
returns one of the four Korean personal-colour season strings:
``'spring' | 'summer' | 'autumn' | 'winter'``.

Parameters
----------
hue : float
    HSB hue angle of the mean skin colour in ``[0.0, 360.0)``.
    Used as a secondary warm/cool signal when ``warm_cool_score`` is inside
    the neutral zone.
saturation : float
    HSB saturation of the mean skin colour in ``[0.0, 1.0]``.
    Used to detect achromatic (near-grey) inputs where hue becomes unreliable.
brightness : float
    HSB brightness (= HSV value) of the mean skin colour in ``[0.0, 1.0]``.
    Determines the light/dark axis: values above the midpoint → bright seasons
    (봄·겨울); at-or-below → dark seasons (가을·여름).
warm_cool_score : float
    Normalised warm/cool signal in ``[-1.0, 1.0]``.
    Positive → warm undertone; negative → cool.  Typically the output of
    :func:`personal_color.color_features.compute_warm_cool_score`,
    i.e. ``(mean_R − mean_B) / 255.0``.

Classification rules
--------------------
**Axis 1 — warm/cool undertone** (ordered priority):

1. ``warm_cool_score > +warm_threshold`` → *warm*
2. ``warm_cool_score < −warm_threshold`` → *cool*
3. Neutral zone (|score| ≤ threshold): fall back to hue:

   * ``saturation < saturation_floor`` → :exc:`ValueError` (achromatic;
     hue is undefined / unreliable, cannot resolve undertone).
   * Hue in warm band ``[0°, warm_upper_hue]`` or ``(warm_lower_wrap_hue°, 360°]``
     → *warm*.
   * Hue in cool band ``[cool_lower_hue°, cool_upper_hue°]`` → *cool*.
   * Otherwise → :exc:`ValueError` (ambiguous undertone; caller must
     retake or blend additional samples).

**Axis 2 — light/dark value** (brightness):

* ``brightness > brightness_midpoint`` → *high* (bright)
* ``brightness ≤ brightness_midpoint`` → *low* (dark)

**Season truth table**::

    +-----------+-------------------+-------------------+
    |           | brightness HIGH   | brightness LOW    |
    |           | (> 0.5 default)   | (<= 0.5 default)  |
    +-----------+-------------------+-------------------+
    | warm tone | 'spring' (봄)     | 'autumn' (가을)    |
    | cool tone | 'winter' (겨울)   | 'summer' (여름)    |
    +-----------+-------------------+-------------------+

Design constraints
------------------
* **Rule-based only** — no learned model, no inference call.  Satisfies the
  Seed constraint "자체 AI 모델 학습 금지" and its explicit carve-out
  "face-landmark 기반 *rule-based* 유사도 … → 허용".
* **Immutable thresholds** — :class:`HSBClassifierThresholds` is a frozen
  dataclass; callers pass an explicit override rather than mutating the
  default singleton.
* **String output** — returns a plain lowercase ASCII slug so the calling
  layer can persist to DB columns or emit analytics events without a lookup
  table.  The slug matches :attr:`~personal_color.season_classifier.Season.slug`
  for backward-compatibility with the existing Season enum.
* **Zero dependencies beyond stdlib + package internals** — no Pillow, no
  MediaPipe, no network.  Safe to unit-test without any native dep.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

SeasonSlug = Literal["spring", "summer", "autumn", "winter"]

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HSBClassifierThresholds:
    """Decision thresholds for :func:`classify_season_from_hsb_features`.

    Attributes
    ----------
    warm_threshold:
        Neutral-zone half-width for ``warm_cool_score``.  Any value in
        ``[−warm_threshold, +warm_threshold]`` (inclusive) is treated as
        ambiguous; the hue tiebreaker is used instead.  Default ``0.02``
        corresponds to ``|mean_R − mean_B| ≈ 5 / 255`` — chosen to match
        the RGB tone primitive's ``rgb_chroma_floor = 4``.
    brightness_midpoint:
        Brightness decision boundary.  ``brightness > midpoint`` → high
        (봄/겨울); ``<= midpoint`` → low (가을/여름).  Mirrors
        :attr:`~personal_color.contrast_classifier.ContrastThresholds.lightness_midpoint`.
    saturation_floor:
        Minimum saturation required to trust the hue tiebreaker in the
        neutral zone.  Below this value the pixel region is effectively
        achromatic and the hue angle is dominated by sensor noise.
    warm_upper_hue:
        Upper boundary (inclusive) of the primary warm hue band in degrees.
        Hues in ``[0°, warm_upper_hue]`` are classified as warm.
    warm_lower_wrap_hue:
        Lower boundary (exclusive) of the wrap-around warm hue band.  Hues
        in ``(warm_lower_wrap_hue°, 360°]`` are warm (pink/magenta range).
    cool_lower_hue:
        Lower boundary (inclusive) of the cool hue band.
    cool_upper_hue:
        Upper boundary (inclusive) of the cool hue band.
        Hues in ``[cool_lower_hue°, cool_upper_hue°]`` are cool.
    """

    warm_threshold: float = 0.02
    brightness_midpoint: float = 0.5
    saturation_floor: float = 0.08
    warm_upper_hue: float = 60.0
    warm_lower_wrap_hue: float = 300.0
    cool_lower_hue: float = 180.0
    cool_upper_hue: float = 270.0


DEFAULT_HSB_THRESHOLDS = HSBClassifierThresholds()

# ---------------------------------------------------------------------------
# Internal sentinel — used only inside this module
# ---------------------------------------------------------------------------

_WARM = "warm"
_COOL = "cool"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def classify_season_from_hsb_features(
    hue: float,
    saturation: float,
    brightness: float,
    warm_cool_score: float,
    *,
    thresholds: HSBClassifierThresholds = DEFAULT_HSB_THRESHOLDS,
) -> SeasonSlug:
    """Map (hue, saturation, brightness, warm_cool_score) to a season slug.

    This is the Sub-AC 17-2 entry point.  It accepts the four scalar colour
    features extracted from a selfie's skin region and returns one of the four
    Korean personal-colour season strings.

    Parameters
    ----------
    hue:
        HSB hue angle in ``[0.0, 360.0)``.  Values outside this range raise
        :exc:`ValueError`.
    saturation:
        HSB saturation in ``[0.0, 1.0]``.  Values outside this range raise
        :exc:`ValueError`.
    brightness:
        HSB brightness in ``[0.0, 1.0]``.  Values outside this range raise
        :exc:`ValueError`.
    warm_cool_score:
        Warm/cool signal in ``[-1.0, 1.0]``.  Values outside this range
        raise :exc:`ValueError`.
    thresholds:
        Optional :class:`HSBClassifierThresholds` override.  Pass an
        explicit instance when calibrating for a specific camera or
        skin-tone range.

    Returns
    -------
    SeasonSlug
        One of ``'spring'``, ``'summer'``, ``'autumn'``, ``'winter'``.

    Raises
    ------
    TypeError
        If any argument has the wrong Python type (non-float/int for the
        scalars, non-:class:`HSBClassifierThresholds` for *thresholds*).
    ValueError
        If any scalar is outside its documented range, or if
        ``warm_cool_score`` falls in the neutral zone **and** the hue
        tiebreaker also cannot resolve the undertone (either the saturation
        is below the floor, or the hue falls in a mid-range band).
    """
    _validate_inputs(hue, saturation, brightness, warm_cool_score, thresholds)

    # ------------------------------------------------------------------
    # Axis 1 — warm/cool undertone
    # ------------------------------------------------------------------
    undertone = _resolve_undertone(hue, saturation, warm_cool_score, thresholds)

    # ------------------------------------------------------------------
    # Axis 2 — light/dark (brightness → high / low)
    # ------------------------------------------------------------------
    is_bright = brightness > thresholds.brightness_midpoint

    # ------------------------------------------------------------------
    # Season lookup (truth table)
    # ------------------------------------------------------------------
    if undertone == _WARM:
        return "spring" if is_bright else "autumn"
    else:  # _COOL
        return "winter" if is_bright else "summer"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolve_undertone(
    hue: float,
    saturation: float,
    warm_cool_score: float,
    thresholds: HSBClassifierThresholds,
) -> str:
    """Return '_WARM' or '_COOL', or raise ValueError if ambiguous."""
    # Primary signal: warm_cool_score (normalised R−B)
    if warm_cool_score > thresholds.warm_threshold:
        return _WARM
    if warm_cool_score < -thresholds.warm_threshold:
        return _COOL

    # Neutral zone: fall back to hue
    if saturation < thresholds.saturation_floor:
        raise ValueError(
            f"warm_cool_score {warm_cool_score!r} is in the neutral zone and "
            f"saturation {saturation!r} is below the floor "
            f"({thresholds.saturation_floor}) — cannot resolve undertone for "
            "achromatic input.",
        )

    # Warm hue band: 0°..warm_upper_hue and (warm_lower_wrap_hue..360°]
    if hue <= thresholds.warm_upper_hue or hue > thresholds.warm_lower_wrap_hue:
        return _WARM

    # Cool hue band: [cool_lower_hue..cool_upper_hue]
    if thresholds.cool_lower_hue <= hue <= thresholds.cool_upper_hue:
        return _COOL

    # Mid-range (yellow-green 60–180, purple 270–300): ambiguous
    raise ValueError(
        f"warm_cool_score {warm_cool_score!r} is in the neutral zone and "
        f"hue {hue!r}° does not fall in a warm or cool band — "
        "undertone is ambiguous; retake or blend additional samples.",
    )


def _validate_inputs(
    hue: float,
    saturation: float,
    brightness: float,
    warm_cool_score: float,
    thresholds: object,
) -> None:
    """Validate all inputs; raise TypeError or ValueError on bad data."""
    if not isinstance(thresholds, HSBClassifierThresholds):
        raise TypeError(
            f"thresholds must be HSBClassifierThresholds, "
            f"got {type(thresholds).__name__}",
        )

    _validate_float("hue", hue, lo=0.0, hi=360.0)
    _validate_float("saturation", saturation, lo=0.0, hi=1.0)
    _validate_float("brightness", brightness, lo=0.0, hi=1.0)
    _validate_float("warm_cool_score", warm_cool_score, lo=-1.0, hi=1.0)


def _validate_float(name: str, value: object, *, lo: float, hi: float) -> None:
    """Raise TypeError if not numeric; ValueError if out of [lo, hi]."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(
            f"{name} must be a float (or int), got {type(value).__name__}",
        )
    if not lo <= float(value) <= hi:
        raise ValueError(
            f"{name} must be in [{lo}, {hi}], got {value!r}",
        )


__all__ = [
    "HSBClassifierThresholds",
    "DEFAULT_HSB_THRESHOLDS",
    "SeasonSlug",
    "classify_season_from_hsb_features",
]
