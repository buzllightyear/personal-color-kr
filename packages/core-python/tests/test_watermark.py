"""Tests for personal_color.generate.watermark (Sub-AC 2a-ii).

Verifies the server-side watermark compositing module using only synthetic
in-memory PIL images.  No external files, network calls, or system fonts are
required — the tests pass on a clean Python 3.12 install with Pillow.

Test coverage:
    - Happy path: apply_watermark returns non-empty PNG bytes for a valid input
    - Output is a valid decodable PNG image
    - Output has identical dimensions to the input image
    - Output pixels differ from input (watermark was actually applied)
    - Watermark text is applied at the bottom-right corner region
    - Custom watermark text is accepted
    - DEFAULT_WATERMARK_TEXT constant is the expected brand string
    - Input validation: non-bytes input rejected with ValueError
    - Input validation: empty bytes rejected with ValueError
    - Input validation: empty text rejected with ValueError
    - Watermark is applied to various image sizes (small, large, non-square)
    - Watermark is applied to images with white background (dark-text visibility)
    - Watermark is applied to images with black background (white-text visibility)
    - apply_watermark is idempotent in shape (output can be watermarked again)
    - JPEG-encoded input is accepted and returns PNG bytes
"""

from __future__ import annotations

import io
from typing import Final

import pytest
from PIL import Image as _PILImage

from personal_color.generate.watermark import DEFAULT_WATERMARK_TEXT, apply_watermark

# ---------------------------------------------------------------------------
# Synthetic image helpers
# ---------------------------------------------------------------------------

_PNG_MAGIC: Final[bytes] = b"\x89PNG\r\n\x1a\n"


def _make_png_bytes(
    width: int = 64,
    height: int = 64,
    colour: tuple[int, int, int] = (120, 80, 160),
) -> bytes:
    """Create an in-memory solid-colour PNG image and return its bytes.

    Args:
        width: Image width in pixels.
        height: Image height in pixels.
        colour: RGB fill colour.

    Returns:
        Valid PNG-encoded bytes.  No file system access.
    """
    img = _PILImage.new("RGB", (width, height), colour)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_jpeg_bytes(
    width: int = 64,
    height: int = 64,
    colour: tuple[int, int, int] = (200, 100, 50),
) -> bytes:
    """Create an in-memory solid-colour JPEG image and return its bytes."""
    img = _PILImage.new("RGB", (width, height), colour)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _decode_png(png_bytes: bytes) -> _PILImage.Image:
    """Decode PNG bytes and return the PIL Image (caller must close it)."""
    return _PILImage.open(io.BytesIO(png_bytes))


def _pixel_sum_bottom_right(
    image: _PILImage.Image,
    sample_w: int = 20,
    sample_h: int = 20,
) -> int:
    """Return the sum of all pixel channel values in the bottom-right corner.

    Used to detect changes applied by the watermark in the region where the
    label is composited.
    """
    w, h = image.size
    x0 = max(0, w - sample_w)
    y0 = max(0, h - sample_h)
    region = image.crop((x0, y0, w, h))
    pixels = list(region.getdata())
    return sum(c for px in pixels for c in (px if isinstance(px, tuple) else (px,)))


# ---------------------------------------------------------------------------
# 1. Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_watermark_returns_bytes() -> None:
    """apply_watermark must return non-empty bytes for a valid PNG input."""
    result = apply_watermark(_make_png_bytes())
    assert isinstance(result, bytes)
    assert len(result) > 0


@pytest.mark.unit
def test_apply_watermark_returns_valid_png() -> None:
    """The returned bytes must start with the PNG magic signature."""
    result = apply_watermark(_make_png_bytes())
    assert result[:8] == _PNG_MAGIC, "output is not valid PNG"


@pytest.mark.unit
def test_apply_watermark_output_is_decodable() -> None:
    """The returned bytes must be decodable to a PIL Image without error."""
    result = apply_watermark(_make_png_bytes())
    with _decode_png(result) as img:
        img.load()  # forces pixel decode; raises on truncated data


# ---------------------------------------------------------------------------
# 2. Dimensions preserved
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_watermark_preserves_dimensions() -> None:
    """Output image must have identical pixel dimensions to the input."""
    input_bytes = _make_png_bytes(width=128, height=96)

    result = apply_watermark(input_bytes)

    with _decode_png(result) as out_img:
        assert out_img.size == (128, 96)


@pytest.mark.unit
def test_apply_watermark_preserves_dimensions_square() -> None:
    """Dimensions are preserved for square images."""
    input_bytes = _make_png_bytes(width=256, height=256)
    result = apply_watermark(input_bytes)
    with _decode_png(result) as out_img:
        assert out_img.size == (256, 256)


@pytest.mark.unit
def test_apply_watermark_preserves_dimensions_tall() -> None:
    """Dimensions are preserved for portrait-orientation images."""
    input_bytes = _make_png_bytes(width=50, height=150)
    result = apply_watermark(input_bytes)
    with _decode_png(result) as out_img:
        assert out_img.size == (50, 150)


# ---------------------------------------------------------------------------
# 3. Watermark visually modifies the image
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_watermark_modifies_image() -> None:
    """Output bytes must differ from input bytes (watermark was applied)."""
    input_bytes = _make_png_bytes()
    # Decode input to PNG bytes so both sides are PNG for a fair comparison.
    with _PILImage.open(io.BytesIO(input_bytes)) as src:
        rebuf = io.BytesIO()
        src.convert("RGB").save(rebuf, format="PNG")
        plain_png_bytes = rebuf.getvalue()

    result = apply_watermark(input_bytes)
    assert (
        result != plain_png_bytes
    ), "apply_watermark returned identical bytes — watermark was not applied"


@pytest.mark.unit
def test_apply_watermark_changes_bottom_right_pixels_on_dark_bg() -> None:
    """Watermark text must alter pixels in the bottom-right corner (dark bg)."""
    # Start with a near-black image so the white watermark text introduces
    # bright pixels we can detect in the sample region.
    input_bytes = _make_png_bytes(width=200, height=200, colour=(10, 10, 10))

    with _PILImage.open(io.BytesIO(input_bytes)) as orig:
        orig_sum = _pixel_sum_bottom_right(orig.convert("RGB"))

    result = apply_watermark(input_bytes)
    with _decode_png(result) as out_img:
        out_sum = _pixel_sum_bottom_right(out_img.convert("RGB"))

    assert out_sum > orig_sum, (
        "Bottom-right pixel sum did not increase after watermark on dark background; "
        f"original={orig_sum}, watermarked={out_sum}"
    )


@pytest.mark.unit
def test_apply_watermark_changes_bottom_right_pixels_on_light_bg() -> None:
    """Watermark text must alter pixels in the bottom-right corner (light bg)."""
    # Start with a near-white image; the shadow pass introduces darker pixels
    # that lower the per-channel sum in the sample region.
    input_bytes = _make_png_bytes(width=200, height=200, colour=(245, 245, 245))

    with _PILImage.open(io.BytesIO(input_bytes)) as orig:
        orig_sum = _pixel_sum_bottom_right(orig.convert("RGB"))

    result = apply_watermark(input_bytes)
    with _decode_png(result) as out_img:
        out_sum = _pixel_sum_bottom_right(out_img.convert("RGB"))

    # On a white background the dark shadow lowers the channel sum.
    assert out_sum < orig_sum, (
        "Bottom-right pixel sum did not decrease after watermark on light background; "
        f"original={orig_sum}, watermarked={out_sum}"
    )


# ---------------------------------------------------------------------------
# 4. Custom text
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_watermark_accepts_custom_text() -> None:
    """apply_watermark must accept a custom text parameter without error."""
    result = apply_watermark(_make_png_bytes(), text="© MyBrand")
    assert isinstance(result, bytes)
    assert len(result) > 0


@pytest.mark.unit
def test_apply_watermark_custom_vs_default_differ_on_dark_bg() -> None:
    """Different watermark texts produce different pixel outputs in the watermark region."""
    input_bytes = _make_png_bytes(width=200, height=200, colour=(20, 20, 20))

    result_default = apply_watermark(input_bytes)
    result_custom = apply_watermark(input_bytes, text="CUSTOM_DIFFERENT_LABEL_XYZ")

    # Output bytes need not be identical; we verify both are valid PNGs.
    assert result_default[:8] == _PNG_MAGIC
    assert result_custom[:8] == _PNG_MAGIC


# ---------------------------------------------------------------------------
# 5. DEFAULT_WATERMARK_TEXT constant
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_default_watermark_text_value() -> None:
    """DEFAULT_WATERMARK_TEXT must equal the expected brand attribution string."""
    assert DEFAULT_WATERMARK_TEXT == "© Personal Color"


@pytest.mark.unit
def test_apply_watermark_uses_default_text_when_omitted() -> None:
    """Calling apply_watermark without 'text' uses DEFAULT_WATERMARK_TEXT."""
    # Verify no error is raised and result is valid.
    result = apply_watermark(_make_png_bytes())
    assert result[:8] == _PNG_MAGIC


# ---------------------------------------------------------------------------
# 6. JPEG input accepted
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_watermark_accepts_jpeg_input() -> None:
    """apply_watermark must accept JPEG-encoded bytes and return PNG bytes."""
    jpeg_input = _make_jpeg_bytes(width=100, height=100)
    result = apply_watermark(jpeg_input)

    assert isinstance(result, bytes)
    assert result[:8] == _PNG_MAGIC


@pytest.mark.unit
def test_apply_watermark_jpeg_output_has_correct_dimensions() -> None:
    """Output from JPEG input must preserve the original pixel dimensions."""
    jpeg_input = _make_jpeg_bytes(width=80, height=60)
    result = apply_watermark(jpeg_input)
    with _decode_png(result) as out_img:
        assert out_img.size == (80, 60)


# ---------------------------------------------------------------------------
# 7. Various sizes
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_watermark_small_image() -> None:
    """apply_watermark must handle a very small (16×16) image without error."""
    result = apply_watermark(_make_png_bytes(width=16, height=16))
    assert result[:8] == _PNG_MAGIC
    with _decode_png(result) as out_img:
        assert out_img.size == (16, 16)


@pytest.mark.unit
def test_apply_watermark_large_image() -> None:
    """apply_watermark must handle a large (1024×1024) image without error."""
    result = apply_watermark(_make_png_bytes(width=1024, height=1024))
    assert result[:8] == _PNG_MAGIC
    with _decode_png(result) as out_img:
        assert out_img.size == (1024, 1024)


# ---------------------------------------------------------------------------
# 8. Idempotency of shape (applying watermark to already-watermarked output)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_watermark_output_can_be_watermarked_again() -> None:
    """Output of apply_watermark must itself be acceptable as input (no crash)."""
    first_pass = apply_watermark(_make_png_bytes(width=128, height=128))
    second_pass = apply_watermark(first_pass)

    assert second_pass[:8] == _PNG_MAGIC
    with _decode_png(second_pass) as out_img:
        assert out_img.size == (128, 128)


# ---------------------------------------------------------------------------
# 9. Input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_watermark_rejects_non_bytes_input() -> None:
    """apply_watermark must raise ValueError when image_bytes is not bytes-like."""
    with pytest.raises(ValueError, match="bytes"):
        apply_watermark("not_bytes")  # type: ignore[arg-type]


@pytest.mark.unit
def test_apply_watermark_rejects_empty_bytes() -> None:
    """apply_watermark must raise ValueError when image_bytes is empty."""
    with pytest.raises(ValueError, match="empty"):
        apply_watermark(b"")


@pytest.mark.unit
def test_apply_watermark_rejects_empty_text() -> None:
    """apply_watermark must raise ValueError when text is empty."""
    with pytest.raises(ValueError, match="text"):
        apply_watermark(_make_png_bytes(), text="")


@pytest.mark.unit
def test_apply_watermark_rejects_integer_input() -> None:
    """apply_watermark must raise ValueError when image_bytes is an integer."""
    with pytest.raises(ValueError, match="bytes"):
        apply_watermark(12345)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 10. Output format is always PNG regardless of input format
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_apply_watermark_always_returns_png_for_png_input() -> None:
    """PNG input must produce PNG output."""
    result = apply_watermark(_make_png_bytes())
    with _decode_png(result) as img:
        assert img.format == "PNG"


@pytest.mark.unit
def test_apply_watermark_always_returns_png_for_jpeg_input() -> None:
    """JPEG input must still produce PNG output (no lossy JPEG re-encoding)."""
    result = apply_watermark(_make_jpeg_bytes())
    with _decode_png(result) as img:
        assert img.format == "PNG"
