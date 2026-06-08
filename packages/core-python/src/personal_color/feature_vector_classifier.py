"""Season classifier that operates on a ColorFeatureVector (Sub-AC 12.2, 3b).

Takes the three-component colour feature vector produced by
:func:`personal_color.color_features.compute_color_features` and maps it
directly to one of the four Korean personal-colour seasons
(봄/여름/가을/겨울) without going through intermediate MediaPipe or
per-pixel primitives.

This is the *feature-space* entry point to the season classifier, sitting
one abstraction level above the raw RGB/HSV primitives in
``tone_classifier.py`` / ``contrast_classifier.py`` and one abstraction
level below the full image-pipeline orchestrator in
``diagnosis_orchestrator.py``.

Input dimensions and their roles
---------------------------------
color_temperature  (warm/cool 언더톤)
    Normalised R−B signal in ``[-1.0, 1.0]``.  Positive → warm undertone
    (봄웜, 가을웜); negative → cool undertone (여름쿨, 겨울쿨); near-zero →
    neutral (caller must resolve before classifying — raises ValueError).

brightness  (light/dark 밸류)
    Rec. 601 luma of the mean skin colour in ``[0.0, 1.0]``.  Values
    above the midpoint map to Contrast.HIGH (봄, 겨울); at-or-below map to
    Contrast.LOW (가을, 여름).

saturation  (채도)
    Informational only.  Not used in the classifier decision but carried
    through so callers can later gate on it (e.g. reject near-greyscale
    skin patches as untrustworthy).

Truth table (mirrors season_classifier._SEASON_TABLE):

  +----------+-------------------+-------------------+
  |          | brightness HIGH   | brightness LOW    |
  +----------+-------------------+-------------------+
  | WARM     | 봄 (SPRING)        | 가을 (AUTUMN)      |
  | COOL     | 겨울 (WINTER)       | 여름 (SUMMER)      |
  +----------+-------------------+-------------------+

Design constraints
-------------------
* **Rule-based only** — no learned model, no inference call.  Satisfies
  the Seed constraint "자체 AI 모델 학습 금지" and its explicit carve-out
  "face-landmark 기반 *rule-based* 유사도 … → 허용".
* **Immutable thresholds** — the ``FeatureVectorThresholds`` dataclass is
  frozen; a caller that wants to calibrate thresholds passes an explicit
  override rather than mutating the default.
* **NEUTRAL raises** — the function refuses to commit a season if
  ``color_temperature`` is in the neutral zone, consistent with the
  ``classify_season`` primitive's semantics for ``Tone.NEUTRAL``.  The
  caller (diagnosis orchestrator or funnel) decides how to handle the
  borderline case (retake prompt, confidence penalty, etc.).
* **Zero dependencies beyond stdlib + package internals** — no Pillow,
  no MediaPipe, no network.  Safe to unit-test without any native dep.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from personal_color.color_features import ColorFeatureVector
from personal_color.contrast_classifier import Contrast
from personal_color.season_classifier import Season, classify_season
from personal_color.tone_classifier import Tone


# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FeatureVectorThresholds:
    """Decision thresholds for classifying a :class:`~personal_color.color_features.ColorFeatureVector`.

    Attributes
    ----------
    warm_threshold:
        Neutral-zone half-width for ``color_temperature``.  Any value in
        ``(-warm_threshold, +warm_threshold)`` (exclusive) is considered
        neutral and raises :exc:`ValueError`.  Default ``0.02`` corresponds
        to an ``|R − B|`` delta of roughly 5 out of 255 — matching the
        spirit of the RGB tone primitive's ``rgb_chroma_floor = 4``.
    brightness_midpoint:
        Contrast decision boundary.  ``brightness > midpoint`` → HIGH
        (봄, 겨울); ``<= midpoint`` → LOW (가을, 여름).  Mirrors
        :attr:`~personal_color.contrast_classifier.ContrastThresholds.lightness_midpoint`.
    """

    warm_threshold: float = 0.02
    brightness_midpoint: float = 0.5


DEFAULT_FEATURE_THRESHOLDS = FeatureVectorThresholds()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def classify_season_from_feature_vector(
    features: ColorFeatureVector,
    *,
    thresholds: FeatureVectorThresholds = DEFAULT_FEATURE_THRESHOLDS,
) -> Season:
    """Map a :class:`~personal_color.color_features.ColorFeatureVector` to a :class:`~personal_color.season_classifier.Season`.

    Interprets ``color_temperature`` as the warm/cool undertone axis and
    ``brightness`` as the light/dark value axis.  Delegates the final
    (Tone, Contrast) → Season lookup to
    :func:`~personal_color.season_classifier.classify_season` so the
    truth table lives in exactly one place.

    Parameters
    ----------
    features:
        A :class:`~personal_color.color_features.ColorFeatureVector` —
        typically the output of
        :func:`~personal_color.color_features.compute_color_features`.
    thresholds:
        Optional override of the neutral-zone half-width and brightness
        midpoint.  Pass an explicit :class:`FeatureVectorThresholds` when
        you need to calibrate the classifier for a specific camera / skin-
        tone range.

    Returns
    -------
    Season
        One of :attr:`~Season.SPRING`, :attr:`~Season.SUMMER`,
        :attr:`~Season.AUTUMN`, or :attr:`~Season.WINTER`.

    Raises
    ------
    TypeError
        If ``features`` is not a :class:`~personal_color.color_features.ColorFeatureVector`
        or ``thresholds`` is not a :class:`FeatureVectorThresholds`.
    ValueError
        If ``color_temperature`` falls in the neutral zone
        ``(-warm_threshold, +warm_threshold)`` — the caller must resolve
        the ambiguity before this function can commit a season.
    """
    if not isinstance(features, ColorFeatureVector):
        raise TypeError(
            f"features must be a ColorFeatureVector, "
            f"got {type(features).__name__}",
        )
    if not isinstance(thresholds, FeatureVectorThresholds):
        raise TypeError(
            f"thresholds must be a FeatureVectorThresholds, "
            f"got {type(thresholds).__name__}",
        )

    # ------------------------------------------------------------------
    # Axis 1: warm/cool undertone (색온도 → Tone)
    # ------------------------------------------------------------------
    ct = features.color_temperature
    if ct > thresholds.warm_threshold:
        tone = Tone.WARM
    elif ct < -thresholds.warm_threshold:
        tone = Tone.COOL
    else:
        raise ValueError(
            f"color_temperature {ct!r} is in the neutral zone "
            f"(|value| <= {thresholds.warm_threshold}); "
            "resolve undertone ambiguity before classifying into a season.",
        )

    # ------------------------------------------------------------------
    # Axis 2: brightness → Contrast (명도 → Contrast)
    # ------------------------------------------------------------------
    if features.brightness > thresholds.brightness_midpoint:
        contrast = Contrast.HIGH
    else:
        contrast = Contrast.LOW

    # ------------------------------------------------------------------
    # Season lookup — single truth table lives in season_classifier
    # ------------------------------------------------------------------
    return classify_season(tone, contrast)


# ---------------------------------------------------------------------------
# Sub-AC 3b — category + confidence result type
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PersonalColorResult:
    """Result of personal-colour classification with confidence.

    Returned by :func:`classify_personal_color`.  Both fields are always
    present; callers do not need to handle a "no result" sentinel.

    Attributes
    ----------
    category:
        Korean personal-colour verdict as a lowercase ASCII slug — one of
        ``"spring" | "summer" | "autumn" | "winter"``.  Identical to
        :attr:`~personal_color.season_classifier.Season.slug` so it is
        safe to persist in DB columns and analytics events without a
        lookup table.
    confidence:
        Classification confidence in ``[0.0, 1.0]``.

        * **0.0** — the feature vector sits exactly on a decision boundary
          (``|color_temperature| == warm_threshold`` *or*
          ``brightness == brightness_midpoint``).  The category is still
          valid but maximally ambiguous on that axis.
        * **1.0** — both axes are at their theoretical extremes
          (``|color_temperature| == 1.0`` *and* ``brightness`` is 0.0 or
          1.0).  The season call is unambiguous.

        Derived as the geometric mean of two axis confidences:

        .. math::

            c_{\\text{tone}} = \\frac{|\\text{ct}| - t_{\\text{warm}}}{1 - t_{\\text{warm}}}

            c_{\\text{bright}} = \\frac{|\\text{br} - t_{\\text{mid}}|}{\\max(t_{\\text{mid}},\\, 1 - t_{\\text{mid}})}

            \\text{confidence} = \\sqrt{c_{\\text{tone}} \\cdot c_{\\text{bright}}}

        Both axis confidences are clamped to ``[0.0, 1.0]`` before the
        geometric mean so out-of-domain feature values never produce a
        score outside the documented range.
    """

    category: str
    confidence: float


# ---------------------------------------------------------------------------
# Sub-AC 3b — public API
# ---------------------------------------------------------------------------


def classify_personal_color(
    features: ColorFeatureVector,
    *,
    thresholds: FeatureVectorThresholds = DEFAULT_FEATURE_THRESHOLDS,
) -> PersonalColorResult:
    """Classify a :class:`~personal_color.color_features.ColorFeatureVector`
    into a personal-colour category with a confidence score.

    This is the Sub-AC 3b entry point.  It delegates season determination to
    :func:`classify_season_from_feature_vector` (so the mapping truth table
    lives in exactly one place) and computes an additional confidence score
    that quantifies how decisively the feature vector points to the returned
    category.

    Confidence formula (geometric mean of per-axis scores):

    * **Tone axis**: ``c_tone = clamp((|ct| − warm_threshold) / (1 − warm_threshold), 0, 1)``
      — reaches 0 at the neutral-zone boundary, 1 at ``|ct| = 1.0``.
    * **Brightness axis**: ``c_bright = clamp(|br − midpoint| / max(midpoint, 1−midpoint), 0, 1)``
      — reaches 0 at ``brightness == midpoint``, 1 when brightness is 0.0 or 1.0.
    * ``confidence = sqrt(c_tone × c_bright)`` — geometric mean keeps
      both axes balanced; a near-zero on either axis drives the combined
      score toward 0.

    Parameters
    ----------
    features:
        A :class:`~personal_color.color_features.ColorFeatureVector` —
        typically the output of
        :func:`~personal_color.color_features.compute_color_features` or
        a mock vector in tests.
    thresholds:
        Optional override of decision thresholds.  The same thresholds
        object governs both the category determination and the confidence
        normalization so the two are always consistent.

    Returns
    -------
    PersonalColorResult
        Frozen dataclass with ``category`` (slug string) and ``confidence``
        (float in ``[0.0, 1.0]``).

    Raises
    ------
    TypeError
        If ``features`` is not a :class:`~personal_color.color_features.ColorFeatureVector`
        or ``thresholds`` is not a :class:`FeatureVectorThresholds` — propagated
        from :func:`classify_season_from_feature_vector`.
    ValueError
        If ``color_temperature`` falls in the neutral zone
        ``(-warm_threshold, +warm_threshold)`` inclusive — propagated from
        :func:`classify_season_from_feature_vector`.  The caller must
        resolve the undertone ambiguity before requesting a season call.
    """
    # Delegate season determination — raises TypeError / ValueError on bad input
    # or neutral undertone, consistent with the Sub-AC 12.2 contract.
    season: Season = classify_season_from_feature_vector(features, thresholds=thresholds)

    # ------------------------------------------------------------------
    # Axis 1 — tone confidence: how far |color_temperature| is from the
    # neutral-zone edge.  Normalise to [0, 1] so the score is independent
    # of the chosen warm_threshold.
    # ------------------------------------------------------------------
    abs_ct = abs(features.color_temperature)
    tone_denom = 1.0 - thresholds.warm_threshold  # width of the decidable band
    if tone_denom <= 0.0:
        # Degenerate threshold (warm_threshold >= 1.0): any decidable ct is
        # at the very boundary — confidence is 0 on this axis.
        tone_conf: float = 0.0
    else:
        tone_conf = max(0.0, min(1.0, (abs_ct - thresholds.warm_threshold) / tone_denom))

    # ------------------------------------------------------------------
    # Axis 2 — brightness confidence: how far brightness is from the
    # decision midpoint.  Normalise by the larger half-range so a
    # non-central midpoint does not produce scores > 1.
    # ------------------------------------------------------------------
    bright_dist = abs(features.brightness - thresholds.brightness_midpoint)
    bright_denom = max(
        thresholds.brightness_midpoint,
        1.0 - thresholds.brightness_midpoint,
    )
    if bright_denom <= 0.0:
        bright_conf: float = 0.0
    else:
        bright_conf = max(0.0, min(1.0, bright_dist / bright_denom))

    # ------------------------------------------------------------------
    # Combine — geometric mean keeps both axes balanced and pushes the
    # score toward 0 whenever either axis is near its decision boundary.
    # ------------------------------------------------------------------
    confidence: float = math.sqrt(tone_conf * bright_conf)

    return PersonalColorResult(category=season.slug, confidence=confidence)


__all__ = [
    "FeatureVectorThresholds",
    "DEFAULT_FEATURE_THRESHOLDS",
    "PersonalColorResult",
    "classify_season_from_feature_vector",
    "classify_personal_color",
]
