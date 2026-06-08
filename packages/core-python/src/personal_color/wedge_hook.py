"""퍼스널컬러 wedge hook 통합 모듈 (Sub-AC 17-3).

셀카 이미지 경로/바이트 입력 → Sub-AC 17-1 추출 → Sub-AC 17-2 분류 →
카테고리 문자열을 반환하는 단일 callable.

이 모듈은 퍼스널컬러 진단의 *wedge/hook* 진입점이다 — 사용자가 셀카를 올리면
결과(봄/여름/가을/겨울 슬러그 문자열)만 반환하고, 내부 파이프라인은 완전히
숨긴다. "진단 전문앱" 형태가 아닌 트렌드 기반 사진 생성 앱의 wedge/hook이므로
결과는 단순 문자열로 충분하다 (Seed 제약: "퍼스널컬러 진단 = wedge/hook only").

파이프라인
----------
1. **로드** — 경로(`str` / :class:`~pathlib.Path`)가 입력되면 파일 바이트를
   읽는다. 바이트가 직접 입력되면 그대로 사용한다.
2. **추출** (Sub-AC 17-1) — 기본 구현은 ``_default_extract_fn``이며
   다음 세 단계를 순서대로 실행한다:
   a. PNG/JPEG 바이트 → :data:`~personal_color.region_extractor.Image` 디코드
   b. 얼굴 감지 (``detect_face_regions``) — 얼굴 없으면
      :class:`~personal_color.face_detector.FaceNotDetectedError` 발생
   c. 피부색 특징 추출 (``extract_skin_tone_features``) →
      :class:`~personal_color.skin_tone_extractor.SkinToneFeature`
3. **분류** (Sub-AC 17-2) — 기본 구현은 ``_default_classify_fn``이며
   ``classify_season_from_hsb_features``를 호출하고 카테고리 슬러그를 반환한다.
4. **반환** — 카테고리 슬러그 문자열
   (``"spring" | "summer" | "autumn" | "winter"``)

injectable seam (테스트 주입 지점)
-----------------------------------
``_extract_fn`` 과 ``_classify_fn`` 을 주입하면 Pillow, MediaPipe 등의
네이티브 의존성 없이도 전체 파이프라인 호출 흐름을 단위 테스트할 수 있다.

설계 제약
----------
* **Rule-based only.** 학습된 모델 없음. Seed 제약 "자체 AI 모델 학습 금지" 준수.
* **단일 callable.** AC가 "단일 callable"을 명시하므로 공개 함수는 하나.
* **에러 전파.** Sub-AC 17-1/17-2에서 발생하는 예외는 그대로 상위로 전파.
  특히 ``FaceNotDetectedError`` (얼굴 미검출)는 swallow하지 않는다.
* **wedge/hook only.** 반환 타입은 str. 신뢰도(confidence) 미반환.
  상세 진단 기능은 이 모듈의 책임이 아니다.

예시
----
>>> from personal_color.wedge_hook import diagnose_personal_color_category
>>> category = diagnose_personal_color_category("selfie.jpg")
>>> category  # "spring" | "summer" | "autumn" | "winter"
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Union

from personal_color.face_detector import FaceNotDetectedError, detect_face_regions
from personal_color.hsb_season_classifier import classify_season_from_hsb_features
from personal_color.image_decoder import decode_image
from personal_color.skin_tone_extractor import SkinToneFeature, extract_skin_tone_features


# ---------------------------------------------------------------------------
# Public type aliases
# ---------------------------------------------------------------------------

#: Accepted input types for the wedge hook function.
SelfieInput = Union[str, Path, bytes, bytearray]

#: Type of the injectable extraction function (Sub-AC 17-1 seam).
#: Accepts raw image bytes; returns a :class:`~personal_color.skin_tone_extractor.SkinToneFeature`.
#: Must raise :class:`~personal_color.face_detector.FaceNotDetectedError`
#: when no face is found in the image.
ExtractFn = Callable[[bytes], SkinToneFeature]

#: Type of the injectable classification function (Sub-AC 17-2 seam).
#: Accepts a :class:`~personal_color.skin_tone_extractor.SkinToneFeature`;
#: returns a season slug string (``"spring" | "summer" | "autumn" | "winter"``).
ClassifyFn = Callable[[SkinToneFeature], str]


# ---------------------------------------------------------------------------
# Default implementations (production path — injectable in tests)
# ---------------------------------------------------------------------------


def _default_extract_fn(selfie_bytes: bytes) -> SkinToneFeature:
    """Production Sub-AC 17-1 extraction: bytes → SkinToneFeature.

    Pipeline:
    1. Decode PNG/JPEG bytes to Image (Pillow boundary in image_decoder).
    2. Detect face via MediaPipe (raises FaceNotDetectedError if no face).
    3. Extract skin-tone features (rule-based YCbCr + HSB arithmetic).

    Raises
    ------
    FaceNotDetectedError
        MediaPipe ran but found no face in the decoded image.
        Permanent input failure — callers should surface as HTTP 422.
    InvalidSelfieError
        Propagated from decode_image when bytes are not valid PNG/JPEG.
        Permanent input failure — callers should surface as HTTP 400.
    NoSkinPixelsError
        Propagated from extract_skin_tone_features when no skin pixels
        survive YCbCr thresholding. Permanent input failure — HTTP 422.
    RuntimeError
        MediaPipe is not installed in the current environment.
    """
    image = decode_image(selfie_bytes)
    # Face-detection gate — raises FaceNotDetectedError if zero faces found.
    detect_face_regions(image)
    return extract_skin_tone_features(image)


def _default_classify_fn(features: SkinToneFeature) -> str:
    """Production Sub-AC 17-2 classification: SkinToneFeature → season slug.

    Delegates to ``classify_season_from_hsb_features`` using the four scalar
    fields from ``features``. The truth table lives in exactly one place
    (hsb_season_classifier).

    Returns
    -------
    str
        One of ``"spring"``, ``"summer"``, ``"autumn"``, ``"winter"``.

    Raises
    ------
    ValueError
        If ``features.warm_cool_score`` is in the neutral zone and the
        hue tiebreaker also cannot resolve the undertone. Caller should
        prompt the user to retake the selfie.
    """
    return classify_season_from_hsb_features(
        hue=features.hue,
        saturation=features.saturation,
        brightness=features.brightness,
        warm_cool_score=features.warm_cool_score,
    )


# ---------------------------------------------------------------------------
# Public API — single callable (AC 17-3)
# ---------------------------------------------------------------------------


def diagnose_personal_color_category(
    selfie_input: SelfieInput,
    *,
    _extract_fn: ExtractFn = _default_extract_fn,
    _classify_fn: ClassifyFn = _default_classify_fn,
) -> str:
    """퍼스널컬러 wedge hook — 셀카 입력 → 카테고리 문자열 반환.

    Sub-AC 17-3의 단일 public callable. 셀카 이미지(경로 또는 바이트)를 받아
    Sub-AC 17-1(추출) → Sub-AC 17-2(분류) 순서로 파이프라인을 실행하고
    카테고리 슬러그 문자열을 반환한다.

    Parameters
    ----------
    selfie_input:
        PNG 또는 JPEG 셀카 이미지. ``str`` / :class:`~pathlib.Path` 파일 경로,
        또는 raw bytes / bytearray 를 모두 지원한다. 경로가 주어지면 바이너리
        모드로 파일을 읽는다; 바이트는 디스크에 쓰지 않는다.
    _extract_fn:
        injectable Sub-AC 17-1 추출 함수. 기본값은 ``_default_extract_fn``
        (Pillow 디코드 + MediaPipe 얼굴 감지 + 피부색 추출).
        단위 테스트에서는 모킹하여 네이티브 의존성 없이 파이프라인을 검증한다.
    _classify_fn:
        injectable Sub-AC 17-2 분류 함수. 기본값은 ``_default_classify_fn``
        (HSB 특징 → 시즌 슬러그). 단위 테스트에서 모킹 가능.

    Returns
    -------
    str
        퍼스널컬러 시즌 슬러그: ``"spring"`` (봄) | ``"summer"`` (여름) |
        ``"autumn"`` (가을) | ``"winter"`` (겨울).

    Raises
    ------
    FileNotFoundError
        제공된 경로가 디스크에 존재하지 않는 경우.
    OSError
        경로가 존재하지만 읽을 수 없는 경우 (권한 오류, I/O 오류 등).
    FaceNotDetectedError
        ``_extract_fn``에서 얼굴이 감지되지 않은 경우.
        Sub-AC 17-1 기본 구현 기준 HTTP 422 매핑.
    InvalidSelfieError
        ``_extract_fn``에서 바이트가 유효한 PNG/JPEG가 아닌 경우.
        Sub-AC 17-1 기본 구현 기준 HTTP 400 매핑.
    NoSkinPixelsError
        ``_extract_fn``에서 YCbCr 임계값 필터 후 피부 픽셀이 없는 경우.
        Sub-AC 17-1 기본 구현 기준 HTTP 422 매핑.
    ValueError
        ``_classify_fn``에서 특징 벡터가 중립 영역에 있어 시즌을 결정할 수 없는 경우.
        사용자에게 셀카 재촬영을 안내해야 한다.
    """
    # Step 1 — 경로이면 바이트 읽기.
    if isinstance(selfie_input, (str, Path)):
        selfie_bytes: bytes = Path(selfie_input).read_bytes()
    else:
        selfie_bytes = bytes(selfie_input)

    # Step 2 — Sub-AC 17-1: bytes → SkinToneFeature.
    # 기본 구현은 decode → face_detect(→ FaceNotDetectedError) → skin_extract.
    features: SkinToneFeature = _extract_fn(selfie_bytes)

    # Step 3 — Sub-AC 17-2: SkinToneFeature → category string.
    return _classify_fn(features)


__all__ = [
    "SelfieInput",
    "ExtractFn",
    "ClassifyFn",
    "FaceNotDetectedError",
    "diagnose_personal_color_category",
]
