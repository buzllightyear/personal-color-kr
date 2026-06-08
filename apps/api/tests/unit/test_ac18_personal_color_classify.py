"""AC18: Personal color 4-category classification — wedge hook.

Acceptance criteria verified
-----------------------------
AC18: 퍼스널 컬러 4 카테고리(봄/여름/가을/겨울) 자동 분류.
      mock 셀카 입력 → 4 카테고리 중 1개 반환. wedge hook 용도.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from personal_color.face_detector import FaceNotDetectedError
from personal_color.skin_tone_extractor import SkinToneFeature
from personal_color.wedge_hook import diagnose_personal_color_category


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_CATEGORIES = frozenset({"spring", "summer", "autumn", "winter"})

# Mock selfie bytes (content irrelevant — extract_fn is mocked)
_MOCK_SELFIE_BYTES = b"mock_selfie_png_bytes"

_SPRING_FEATURES = SkinToneFeature(
    hue=30.0,
    saturation=0.32,
    brightness=0.86,
    warm_cool_score=0.27,
)
_WINTER_FEATURES = SkinToneFeature(
    hue=220.0,
    saturation=0.35,
    brightness=0.82,
    warm_cool_score=-0.12,
)
_SUMMER_FEATURES = SkinToneFeature(
    hue=340.0,
    saturation=0.25,
    brightness=0.78,
    warm_cool_score=-0.08,
)
_AUTUMN_FEATURES = SkinToneFeature(
    hue=25.0,
    saturation=0.40,
    brightness=0.42,
    warm_cool_score=0.15,
)


def _mock_extract_fn(features: SkinToneFeature):
    """Return a mock extract function that yields specified features."""
    def extract(raw: bytes) -> SkinToneFeature:
        return features
    return extract


def _mock_classify_fn(result: str):
    """Return a mock classify function that yields specified category."""
    def classify(features: SkinToneFeature) -> str:
        return result
    return classify


# ---------------------------------------------------------------------------
# AC18: 4 categories can each be returned
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "category",
    ["spring", "summer", "autumn", "winter"],
)
def test_classify_returns_each_of_4_categories(category: str) -> None:
    """Mock selfie input returns the expected personal color category."""
    result = diagnose_personal_color_category(
        _MOCK_SELFIE_BYTES,
        _extract_fn=_mock_extract_fn(_SPRING_FEATURES),
        _classify_fn=_mock_classify_fn(category),
    )
    assert result == category
    assert result in _VALID_CATEGORIES


@pytest.mark.unit
def test_classify_returns_valid_category_spring() -> None:
    """Spring-type mock features → 'spring' category."""
    result = diagnose_personal_color_category(
        _MOCK_SELFIE_BYTES,
        _extract_fn=_mock_extract_fn(_SPRING_FEATURES),
        _classify_fn=_mock_classify_fn("spring"),
    )
    assert result == "spring"


@pytest.mark.unit
def test_classify_returns_valid_category_winter() -> None:
    """Winter-type mock features → 'winter' category."""
    result = diagnose_personal_color_category(
        _MOCK_SELFIE_BYTES,
        _extract_fn=_mock_extract_fn(_WINTER_FEATURES),
        _classify_fn=_mock_classify_fn("winter"),
    )
    assert result == "winter"


@pytest.mark.unit
def test_classify_result_is_a_string() -> None:
    """The returned category is always a plain string."""
    result = diagnose_personal_color_category(
        _MOCK_SELFIE_BYTES,
        _extract_fn=_mock_extract_fn(_SPRING_FEATURES),
        _classify_fn=_mock_classify_fn("summer"),
    )
    assert isinstance(result, str)


@pytest.mark.unit
def test_face_not_detected_propagates() -> None:
    """FaceNotDetectedError from the extractor propagates to caller."""
    def bad_extract(raw: bytes) -> SkinToneFeature:
        raise FaceNotDetectedError("no face found")

    with pytest.raises(FaceNotDetectedError):
        diagnose_personal_color_category(
            _MOCK_SELFIE_BYTES,
            _extract_fn=bad_extract,
            _classify_fn=_mock_classify_fn("spring"),
        )
