"""Tests for ``personal_color.image_decoder``.

These tests cover Phase 0.x AC 3 — ``InvalidSelfieError`` must be raised
for every flavour of un-decodable selfie input:

  * empty bytes
  * wrong type (str, None)
  * bytes that do not start with the PNG or JPEG magic header
  * Pillow failing to identify the bytes as an image at all
  * Pillow failing to decode the pixel body of an otherwise-valid header

They also lock in:

  * ``InvalidSelfieError`` is a ``ValueError`` subclass (so Phase 4 can
    treat it as a permanent client error → HTTP 400).
  * The decoder is the only production module that imports Pillow / PIL.
  * Happy-path PNG / JPEG round-trip produces the diagnosis-primitive
    ``Sequence[Sequence[RGB]]`` shape.
  * Error messages do not leak PII identifiers.

Marked ``integration`` because the module imports Pillow at the top level
and therefore cannot run in the base Phase 0.x test suite that
deliberately leaves native deps uninstalled.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest

# Skip the entire module cleanly when Pillow is not installed — this lets
# the Phase 0.x base test suite continue to run with native deps absent.
pytest.importorskip("PIL", reason="Pillow required for image_decoder tests")

from PIL import Image as _PILImage  # noqa: E402

from personal_color.image_decoder import (  # noqa: E402
    InvalidSelfieError,
    decode_image,
)

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers — build minimal valid PNG / JPEG byte payloads in-memory so the
# tests never touch disk and have no external fixture dependencies.
# ---------------------------------------------------------------------------


def _make_png_bytes(width: int = 4, height: int = 3) -> bytes:
    """Render a tiny RGB PNG to bytes."""
    buf = io.BytesIO()
    img = _PILImage.new("RGB", (width, height), color=(120, 80, 40))
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_jpeg_bytes(width: int = 4, height: int = 3) -> bytes:
    """Render a tiny RGB JPEG to bytes."""
    buf = io.BytesIO()
    img = _PILImage.new("RGB", (width, height), color=(200, 140, 80))
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _make_gif_bytes() -> bytes:
    """A real GIF (different format) — must be rejected by policy."""
    buf = io.BytesIO()
    img = _PILImage.new("RGB", (4, 3), color=(50, 50, 50))
    img.save(buf, format="GIF")
    return buf.getvalue()


def _make_bmp_bytes() -> bytes:
    """A real BMP (different format) — must also be rejected by policy."""
    buf = io.BytesIO()
    img = _PILImage.new("RGB", (4, 3), color=(60, 60, 60))
    img.save(buf, format="BMP")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# AC 3 — InvalidSelfieError surface
# ---------------------------------------------------------------------------


class TestInvalidSelfieErrorIsValueError:
    """Phase 4 maps InvalidSelfieError → HTTP 400 via isinstance(ValueError)."""

    def test_invalid_selfie_error_subclasses_value_error(self) -> None:
        assert issubclass(InvalidSelfieError, ValueError)

    def test_instance_is_caught_as_value_error(self) -> None:
        with pytest.raises(ValueError):
            raise InvalidSelfieError("boom")


class TestEmptyBytesRejected:
    def test_empty_bytes_raises_invalid_selfie(self) -> None:
        with pytest.raises(InvalidSelfieError):
            decode_image(b"")

    def test_empty_bytearray_raises_invalid_selfie(self) -> None:
        with pytest.raises(InvalidSelfieError):
            decode_image(bytearray())


class TestWrongTypeRejected:
    @pytest.mark.parametrize(
        "bad_input",
        [
            None,
            "not bytes",
            12345,
            [0x89, 0x50, 0x4E, 0x47],
            object(),
        ],
    )
    def test_non_bytes_raises_invalid_selfie(self, bad_input: object) -> None:
        with pytest.raises(InvalidSelfieError):
            decode_image(bad_input)  # type: ignore[arg-type]


class TestNonPngOrJpegRejected:
    """Bytes whose magic header is neither PNG nor JPEG are rejected.

    Both random garbage *and* real-but-disallowed formats (GIF, BMP) must
    raise — the policy is a closed allow-list, not an extension check.
    """

    def test_random_garbage_rejected(self) -> None:
        with pytest.raises(InvalidSelfieError):
            decode_image(b"this is definitely not an image at all")

    def test_short_garbage_rejected(self) -> None:
        with pytest.raises(InvalidSelfieError):
            decode_image(b"\x00\x01\x02\x03")

    def test_real_gif_rejected(self) -> None:
        with pytest.raises(InvalidSelfieError):
            decode_image(_make_gif_bytes())

    def test_real_bmp_rejected(self) -> None:
        with pytest.raises(InvalidSelfieError):
            decode_image(_make_bmp_bytes())

    def test_almost_png_header_rejected(self) -> None:
        # Off-by-one in the PNG signature — must NOT slip through.
        with pytest.raises(InvalidSelfieError):
            decode_image(b"\x89PNG\r\n\x1a\x00" + b"\x00" * 100)


class TestDecodeFailureRejected:
    """Bytes that pass the magic-header gate but cannot actually decode."""

    def test_truncated_png_raises_invalid_selfie(self) -> None:
        png = _make_png_bytes(width=16, height=16)
        # Keep the magic header (so we get past the cheap gate) but lop off
        # the bulk of the payload to guarantee a Pillow decode failure.
        truncated = png[:12] + b"\x00" * 4
        with pytest.raises(InvalidSelfieError):
            decode_image(truncated)

    def test_png_magic_with_garbage_body_raises(self) -> None:
        # Just the PNG signature followed by random noise. Pillow will
        # either fail to identify or fail during load — both must surface
        # as InvalidSelfieError.
        with pytest.raises(InvalidSelfieError):
            decode_image(b"\x89PNG\r\n\x1a\n" + b"GARBAGE" * 16)

    def test_jpeg_magic_with_garbage_body_raises(self) -> None:
        with pytest.raises(InvalidSelfieError):
            decode_image(b"\xff\xd8\xff" + b"GARBAGE" * 16)


# ---------------------------------------------------------------------------
# PII safety — error messages must not echo upload-level identifiers
# ---------------------------------------------------------------------------


_PII_TOKENS = (
    "distinct_id",
    "transaction_id",
    "receipt_token",
    "customer_email",
    "selfieUri",
)


class TestErrorMessagesArePIISafe:
    """No InvalidSelfieError message must contain forbidden PII identifiers."""

    @pytest.mark.parametrize(
        "bad_input",
        [
            b"",
            b"\x00\x01\x02",
            "string-not-bytes",
            None,
        ],
    )
    def test_error_message_has_no_pii(self, bad_input: object) -> None:
        with pytest.raises(InvalidSelfieError) as excinfo:
            decode_image(bad_input)  # type: ignore[arg-type]
        message = str(excinfo.value)
        for token in _PII_TOKENS:
            assert token not in message, (
                f"InvalidSelfieError message leaked forbidden token "
                f"{token!r}: {message!r}"
            )


# ---------------------------------------------------------------------------
# Happy paths — PNG / JPEG produce the diagnosis-primitive Image shape
# ---------------------------------------------------------------------------


class TestHappyPath:
    def test_decode_png_returns_rows_first_rgb(self) -> None:
        png = _make_png_bytes(width=4, height=3)
        image = decode_image(png)

        # rows-first: outer length == height, inner length == width.
        assert len(image) == 3
        for row in image:
            assert len(row) == 4
            for px in row:
                assert isinstance(px, tuple)
                assert len(px) == 3
                r, g, b = px
                assert 0 <= r <= 255
                assert 0 <= g <= 255
                assert 0 <= b <= 255

    def test_decode_jpeg_returns_rows_first_rgb(self) -> None:
        jpeg = _make_jpeg_bytes(width=5, height=2)
        image = decode_image(jpeg)
        assert len(image) == 2
        for row in image:
            assert len(row) == 5
            for px in row:
                assert isinstance(px, tuple)
                assert len(px) == 3

    def test_decode_accepts_bytearray_input(self) -> None:
        png_ba = bytearray(_make_png_bytes())
        # Should not raise; bytearray is accepted by the type gate.
        image = decode_image(png_ba)
        assert len(image) > 0


# ---------------------------------------------------------------------------
# Boundary isolation — only image_decoder.py may import Pillow / PIL.
# ---------------------------------------------------------------------------


class TestPillowBoundaryIsolated:
    """Phase 0.x invariant: Pillow imports live only in audited boundary files.

    Four production modules are permitted to import Pillow directly, each an
    explicit, audited PIL surface:

    - ``personal_color/image_decoder.py`` — selfie decode boundary.
    - ``image_edit/enhancer.py`` — server-side de-slop enhancement boundary
      (moat v0.3.0 generation funnel).
    - ``personal_color/generate/watermark.py`` — server-side watermark
      compositing for AI-generated images (Sub-AC 2a-ii).
    - ``personal_color/generate/rejection.py`` — PIL-based artifact severity
      heuristics for the NSFW/artifact rejection scorer (Sub-AC 2b-i).

    No other production module may import Pillow.
    """

    def test_only_image_decoder_imports_pillow(self) -> None:
        src_root = Path(__file__).resolve().parents[1] / "src"
        # Audited PIL boundary modules (paths relative to ``src``). Pillow
        # imports are permitted ONLY here; every other production module must
        # stay Pillow-free.
        allowed = {
            Path("personal_color/image_decoder.py"),
            Path("image_edit/enhancer.py"),
            # Content generation additions (Sub-AC 2a-ii, 2b-i):
            Path("personal_color/generate/watermark.py"),
            Path("personal_color/generate/rejection.py"),
        }
        offenders: list[Path] = []
        for path in src_root.rglob("*.py"):
            if path.relative_to(src_root) in allowed:
                continue
            text = path.read_text(encoding="utf-8")
            # Match production imports of PIL / Pillow. Comments and strings
            # are permitted (the test files / docstrings reference the dep
            # by name for documentation purposes).
            for line in text.splitlines():
                stripped = line.lstrip()
                if stripped.startswith("#"):
                    continue
                if stripped.startswith("from PIL") or stripped.startswith(
                    "import PIL",
                ):
                    offenders.append(path)
                    break
                if stripped.startswith("from Pillow") or stripped.startswith(
                    "import Pillow",
                ):
                    offenders.append(path)
                    break
        assert offenders == [], (
            "PIL/Pillow must be imported only from the audited boundary "
            "modules (personal_color/image_decoder.py, image_edit/enhancer.py, "
            "personal_color/generate/watermark.py, "
            "personal_color/generate/rejection.py); found in: "
            f"{[str(p) for p in offenders]}"
        )
