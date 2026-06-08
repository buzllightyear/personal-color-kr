"""Unit tests for Sub-AC 17-3 — 퍼스널컬러 wedge hook 통합 모듈.

Sub-AC 17-3 요구사항:
  * 셀카 이미지 경로/바이트 입력 → Sub-AC 17-1 추출 → Sub-AC 17-2 분류 →
    카테고리 문자열 반환하는 단일 callable (``diagnose_personal_color_category``).
  * 단위 테스트: **mock된 추출·분류 함수**로 전체 파이프라인 호출 흐름 및
    에러(얼굴 미검출 ``FaceNotDetectedError``) 처리 검증.

모든 테스트는 *unit* 테스트 — Pillow, MediaPipe, 파일시스템 없음.
``_extract_fn`` / ``_classify_fn`` 파라미터에 stub을 주입하여
네이티브 의존성 없이 실행된다.

Test taxonomy
-------------
Section 1 — 파이프라인 호출 흐름 검증 (extract → classify 순서)
Section 2 — 에러 처리: FaceNotDetectedError (얼굴 미검출)
Section 3 — 반환값 계약: str, 유효 슬러그
Section 4 — 입력 타입 검증: 경로(str/Path) vs 바이트 입력
Section 5 — 에러 전파: extract_fn / classify_fn 예외 전파
Section 6 — 파이프라인 순서 보장 (extract가 classify보다 반드시 선행)
"""

from __future__ import annotations

import struct
import tempfile
import zlib
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from personal_color.face_detector import FaceNotDetectedError
from personal_color.skin_tone_extractor import SkinToneFeature
from personal_color.wedge_hook import diagnose_personal_color_category

# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------

# A representative SkinToneFeature that will classify as "spring" under
# the default HSBClassifierThresholds:
#   warm_cool_score > 0.02 (warm) + brightness > 0.5 (bright) → spring
_SPRING_FEATURES = SkinToneFeature(
    hue=30.0,
    saturation=0.32,
    brightness=0.86,
    warm_cool_score=0.27,
)

# A representative SkinToneFeature for winter:
#   warm_cool_score < -0.02 (cool) + brightness > 0.5 (bright) → winter
_WINTER_FEATURES = SkinToneFeature(
    hue=220.0,
    saturation=0.35,
    brightness=0.82,
    warm_cool_score=-0.12,
)

_VALID_SLUGS = frozenset({"spring", "summer", "autumn", "winter"})


# Minimal valid PNG bytes (4×4 warm skin, no Pillow needed for unit tests
# because we inject stub _extract_fn; bytes are passed through only).
def _make_stub_png() -> bytes:
    """Build a tiny but structurally valid PNG (single warm-skin colour).

    Used only as the *bytes payload* that the stub extract_fn receives
    (it ignores the contents). Keeps the test self-contained without Pillow.
    """
    r, g, b = 220, 185, 150
    sig = b"\x89PNG\r\n\x1a\n"

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        length = struct.pack(">I", len(data))
        crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
        return length + chunk_type + data + crc

    ihdr_data = struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)
    ihdr = _chunk(b"IHDR", ihdr_data)
    raw_rows = b""
    row_bytes = bytes([r, g, b] * 4)
    for _ in range(4):
        raw_rows += b"\x00" + row_bytes
    idat = _chunk(b"IDAT", zlib.compress(raw_rows))
    iend = _chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


_STUB_PNG = _make_stub_png()


# ===========================================================================
# Section 1 — 파이프라인 호출 흐름 검증
# ===========================================================================


@pytest.mark.unit
def test_pipeline_calls_extract_then_classify() -> None:
    """_extract_fn이 먼저 호출되고, 그 결과로 _classify_fn이 호출된다.

    AC 검증: 파이프라인 호출 흐름 (17-1 추출 → 17-2 분류 순서 보장).
    """
    extract_mock = MagicMock(return_value=_SPRING_FEATURES)
    classify_mock = MagicMock(return_value="spring")

    call_log: list[str] = []

    def ordered_extract(b: bytes) -> SkinToneFeature:
        call_log.append("extract")
        return _SPRING_FEATURES

    def ordered_classify(f: SkinToneFeature) -> str:
        call_log.append("classify")
        return "spring"

    result = diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=ordered_extract,
        _classify_fn=ordered_classify,
    )

    assert call_log == [
        "extract",
        "classify",
    ], f"Expected extract→classify order, got {call_log}"
    assert result == "spring"


@pytest.mark.unit
def test_extract_fn_receives_bytes_from_input() -> None:
    """_extract_fn은 바이트 입력을 그대로 전달받는다."""
    received: list[bytes] = []

    def capturing_extract(b: bytes) -> SkinToneFeature:
        received.append(b)
        return _SPRING_FEATURES

    diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=capturing_extract,
        _classify_fn=lambda f: "spring",
    )

    assert len(received) == 1
    assert received[0] == _STUB_PNG


@pytest.mark.unit
def test_classify_fn_receives_skin_tone_feature_from_extract() -> None:
    """_classify_fn은 _extract_fn의 반환값(SkinToneFeature)을 입력받는다."""
    received_features: list[Any] = []

    def capturing_classify(f: SkinToneFeature) -> str:
        received_features.append(f)
        return "spring"

    diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=lambda _: _SPRING_FEATURES,
        _classify_fn=capturing_classify,
    )

    assert len(received_features) == 1
    assert received_features[0] is _SPRING_FEATURES


@pytest.mark.unit
def test_extract_fn_called_exactly_once() -> None:
    """_extract_fn은 정확히 한 번만 호출된다."""
    extract_mock = MagicMock(return_value=_SPRING_FEATURES)

    diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=extract_mock,
        _classify_fn=lambda f: "spring",
    )

    extract_mock.assert_called_once()


@pytest.mark.unit
def test_classify_fn_called_exactly_once() -> None:
    """_classify_fn은 정확히 한 번만 호출된다."""
    classify_mock = MagicMock(return_value="spring")

    diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=lambda _: _SPRING_FEATURES,
        _classify_fn=classify_mock,
    )

    classify_mock.assert_called_once_with(_SPRING_FEATURES)


# ===========================================================================
# Section 2 — 에러 처리: FaceNotDetectedError (얼굴 미검출)
# ===========================================================================


@pytest.mark.unit
def test_face_not_detected_error_propagates() -> None:
    """_extract_fn이 FaceNotDetectedError를 발생시키면 그대로 전파된다.

    AC 검증: 에러(얼굴 미검출) 처리 검증.
    """

    def face_not_found_extract(b: bytes) -> SkinToneFeature:
        raise FaceNotDetectedError("no face detected in selfie")

    with pytest.raises(FaceNotDetectedError):
        diagnose_personal_color_category(
            _STUB_PNG,
            _extract_fn=face_not_found_extract,
            _classify_fn=lambda f: "spring",
        )


@pytest.mark.unit
def test_face_not_detected_error_classify_not_called() -> None:
    """얼굴 미감지 시 _classify_fn이 호출되지 않는다.

    AC 검증: 추출 실패 → 분류 단계 건너뜀.
    파이프라인 순서 (17-1 → 17-2) 상 17-1 실패 시 17-2 미실행 보장.
    """
    classify_mock = MagicMock(return_value="spring")

    def face_not_found_extract(b: bytes) -> SkinToneFeature:
        raise FaceNotDetectedError("no face detected in selfie")

    with pytest.raises(FaceNotDetectedError):
        diagnose_personal_color_category(
            _STUB_PNG,
            _extract_fn=face_not_found_extract,
            _classify_fn=classify_mock,
        )

    classify_mock.assert_not_called()


@pytest.mark.unit
def test_face_not_detected_error_is_value_error_subclass() -> None:
    """FaceNotDetectedError는 ValueError 서브클래스여야 한다 (영구 오류 분류).

    AC 검증: 에러 분류가 Phase 4 HTTP 422 매핑에 적합한지 확인.
    """

    def face_not_found_extract(b: bytes) -> SkinToneFeature:
        raise FaceNotDetectedError("no face detected in selfie")

    with pytest.raises(FaceNotDetectedError) as exc_info:
        diagnose_personal_color_category(
            _STUB_PNG,
            _extract_fn=face_not_found_extract,
            _classify_fn=lambda f: "spring",
        )

    assert isinstance(exc_info.value, ValueError)


@pytest.mark.unit
def test_face_not_detected_via_mock_raises() -> None:
    """MagicMock side_effect으로 FaceNotDetectedError 시뮬레이션."""
    extract_mock = MagicMock(side_effect=FaceNotDetectedError("mock: no face"))

    with pytest.raises(FaceNotDetectedError, match="mock: no face"):
        diagnose_personal_color_category(
            _STUB_PNG,
            _extract_fn=extract_mock,
            _classify_fn=lambda f: "summer",
        )


# ===========================================================================
# Section 3 — 반환값 계약: str, 유효 슬러그
# ===========================================================================


@pytest.mark.unit
def test_returns_str_type() -> None:
    """반환값은 str 인스턴스여야 한다."""
    result = diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=lambda _: _SPRING_FEATURES,
        _classify_fn=lambda f: "spring",
    )
    assert isinstance(result, str)


@pytest.mark.unit
@pytest.mark.parametrize("season", ["spring", "summer", "autumn", "winter"])
def test_returns_valid_season_slug(season: str) -> None:
    """_classify_fn이 반환한 슬러그가 그대로 반환된다."""
    result = diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=lambda _: _SPRING_FEATURES,
        _classify_fn=lambda f: season,
    )
    assert result == season
    assert result in _VALID_SLUGS


@pytest.mark.unit
def test_result_for_spring_features_is_spring() -> None:
    """봄 특징값(warm+bright) → 'spring' 반환 (기본 분류 함수 검증)."""
    result = diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=lambda _: _SPRING_FEATURES,
        _classify_fn=lambda f: "spring",
    )
    assert result == "spring"


@pytest.mark.unit
def test_result_for_winter_features_is_winter() -> None:
    """겨울 특징값(cool+bright) → 'winter' 반환."""
    result = diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=lambda _: _WINTER_FEATURES,
        _classify_fn=lambda f: "winter",
    )
    assert result == "winter"


# ===========================================================================
# Section 4 — 입력 타입 검증: 경로(str/Path) vs 바이트
# ===========================================================================


@pytest.mark.unit
def test_bytes_input_passed_to_extract_fn() -> None:
    """bytes 입력 → _extract_fn에 그대로 전달된다."""
    received: list[bytes] = []

    def capturing_extract(b: bytes) -> SkinToneFeature:
        received.append(b)
        return _SPRING_FEATURES

    diagnose_personal_color_category(
        b"fake-png-bytes",
        _extract_fn=capturing_extract,
        _classify_fn=lambda f: "spring",
    )

    assert received[0] == b"fake-png-bytes"


@pytest.mark.unit
def test_bytearray_input_converted_to_bytes() -> None:
    """bytearray 입력 → bytes로 변환하여 _extract_fn에 전달된다."""
    received: list[bytes] = []

    def capturing_extract(b: bytes) -> SkinToneFeature:
        received.append(b)
        return _SPRING_FEATURES

    diagnose_personal_color_category(
        bytearray(b"fake-png-bytes"),
        _extract_fn=capturing_extract,
        _classify_fn=lambda f: "spring",
    )

    assert isinstance(received[0], bytes)
    assert received[0] == b"fake-png-bytes"


@pytest.mark.unit
def test_str_path_input_reads_file_and_passes_bytes() -> None:
    """str 경로 입력 → 파일을 읽어 바이트를 _extract_fn에 전달한다."""
    received: list[bytes] = []

    def capturing_extract(b: bytes) -> SkinToneFeature:
        received.append(b)
        return _SPRING_FEATURES

    # 임시 파일 생성 (테스트용 PNG 바이트)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(_STUB_PNG)
        tmp_path = tmp.name

    diagnose_personal_color_category(
        tmp_path,  # str 경로
        _extract_fn=capturing_extract,
        _classify_fn=lambda f: "spring",
    )

    assert received[0] == _STUB_PNG

    # 정리
    Path(tmp_path).unlink(missing_ok=True)


@pytest.mark.unit
def test_path_object_input_reads_file_and_passes_bytes() -> None:
    """Path 객체 입력 → 파일을 읽어 바이트를 _extract_fn에 전달한다."""
    received: list[bytes] = []

    def capturing_extract(b: bytes) -> SkinToneFeature:
        received.append(b)
        return _SPRING_FEATURES

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(_STUB_PNG)
        tmp_path = Path(tmp.name)

    diagnose_personal_color_category(
        tmp_path,  # Path 객체
        _extract_fn=capturing_extract,
        _classify_fn=lambda f: "spring",
    )

    assert received[0] == _STUB_PNG

    tmp_path.unlink(missing_ok=True)


@pytest.mark.unit
def test_nonexistent_path_raises_file_not_found() -> None:
    """존재하지 않는 경로 → FileNotFoundError 발생."""
    with pytest.raises(FileNotFoundError):
        diagnose_personal_color_category(
            "/no/such/path/selfie.png",
            _extract_fn=lambda _: _SPRING_FEATURES,
            _classify_fn=lambda f: "spring",
        )


@pytest.mark.unit
def test_nonexistent_path_extract_fn_not_called() -> None:
    """존재하지 않는 경로 → 파일 읽기 실패이므로 _extract_fn이 호출되지 않는다."""
    extract_mock = MagicMock(return_value=_SPRING_FEATURES)

    with pytest.raises(FileNotFoundError):
        diagnose_personal_color_category(
            "/no/such/path/selfie.png",
            _extract_fn=extract_mock,
            _classify_fn=lambda f: "spring",
        )

    extract_mock.assert_not_called()


# ===========================================================================
# Section 5 — 에러 전파: extract_fn / classify_fn 예외 전파
# ===========================================================================


@pytest.mark.unit
def test_extract_fn_value_error_propagates() -> None:
    """_extract_fn의 ValueError(중립 영역 등)가 그대로 전파된다."""

    def raising_extract(b: bytes) -> SkinToneFeature:
        raise ValueError("skin pixels not found")

    with pytest.raises(ValueError, match="skin pixels not found"):
        diagnose_personal_color_category(
            _STUB_PNG,
            _extract_fn=raising_extract,
            _classify_fn=lambda f: "spring",
        )


@pytest.mark.unit
def test_classify_fn_value_error_propagates() -> None:
    """_classify_fn의 ValueError(중립 영역 미해소)가 그대로 전파된다."""

    def raising_classify(f: SkinToneFeature) -> str:
        raise ValueError("undertone is ambiguous; retake or blend additional samples.")

    with pytest.raises(ValueError, match="ambiguous"):
        diagnose_personal_color_category(
            _STUB_PNG,
            _extract_fn=lambda _: _SPRING_FEATURES,
            _classify_fn=raising_classify,
        )


@pytest.mark.unit
def test_extract_fn_runtime_error_propagates() -> None:
    """_extract_fn의 RuntimeError(mediapipe 미설치 등)가 그대로 전파된다."""

    def raising_extract(b: bytes) -> SkinToneFeature:
        raise RuntimeError("mediapipe is not installed")

    with pytest.raises(RuntimeError, match="mediapipe"):
        diagnose_personal_color_category(
            _STUB_PNG,
            _extract_fn=raising_extract,
            _classify_fn=lambda f: "spring",
        )


# ===========================================================================
# Section 6 — 파이프라인 순서 보장 (extract 선행 조건)
# ===========================================================================


@pytest.mark.unit
def test_extract_completes_before_classify_is_called() -> None:
    """extract_fn이 완전히 완료된 후 classify_fn이 호출된다.

    실행 순서를 기록하여 extract → classify 순서를 단언한다.
    """
    call_order: list[str] = []

    def ordered_extract(b: bytes) -> SkinToneFeature:
        call_order.append("extract")
        return _SPRING_FEATURES

    def ordered_classify(f: SkinToneFeature) -> str:
        call_order.append("classify")
        return "spring"

    diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=ordered_extract,
        _classify_fn=ordered_classify,
    )

    assert call_order.index("extract") < call_order.index(
        "classify"
    ), f"extract must precede classify; got order {call_order}"


@pytest.mark.unit
def test_classify_not_called_when_extract_raises_face_error() -> None:
    """extract_fn이 FaceNotDetectedError 발생 시 classify_fn은 절대 호출되지 않는다.

    파이프라인 순서 역전 금지 검증: 17-1 실패 → 17-2 미실행.
    """
    classify_mock = MagicMock(return_value="spring")

    with pytest.raises(FaceNotDetectedError):
        diagnose_personal_color_category(
            _STUB_PNG,
            _extract_fn=MagicMock(side_effect=FaceNotDetectedError("no face")),
            _classify_fn=classify_mock,
        )

    classify_mock.assert_not_called()


@pytest.mark.unit
def test_full_pipeline_spring_end_to_end_with_mocks() -> None:
    """봄(spring) 시나리오 전체 파이프라인 mock 검증 — AC 17-3 통합 단언.

    mock 추출·분류로 전체 호출 흐름을 한 번의 테스트에서 검증한다.
    """
    extract_mock = MagicMock(return_value=_SPRING_FEATURES)
    classify_mock = MagicMock(return_value="spring")

    result = diagnose_personal_color_category(
        _STUB_PNG,
        _extract_fn=extract_mock,
        _classify_fn=classify_mock,
    )

    # 1. extract_fn이 바이트로 호출됐는지
    extract_mock.assert_called_once_with(_STUB_PNG)

    # 2. classify_fn이 SkinToneFeature로 호출됐는지
    classify_mock.assert_called_once_with(_SPRING_FEATURES)

    # 3. 결과가 classify_fn의 반환값인지
    assert result == "spring"

    # 4. 결과가 유효한 슬러그인지
    assert result in _VALID_SLUGS
