"""Server-side watermark compositing for AI-generated images (Sub-AC 2a-ii).

# Purpose

Applies a branded text watermark to a raw AI-generated image and returns the
watermarked image as PNG bytes.  The original (un-watermarked) image bytes are
never returned to the caller — only the composited output leaves this function.
This satisfies the Seed Contract requirement that "original image never sent to
client".

# Watermark design

A semi-transparent text label is composited into the **bottom-right corner** of
the image.  The text is drawn twice — a dark shadow pass first, then the white
main pass — so the label remains legible on both light and dark backgrounds.

The watermark layer is composited via an RGBA overlay at :data:`_OPACITY`
(default 160 / 255 ≈ 63% opacity) so the underlying image content shows
through the text region while the brand attribution stays visible.

# Output format

The function always encodes the output as **PNG** regardless of the input
format.  This avoids lossy JPEG re-compression of the composited pixels and
ensures the output bytes are deterministic for any given input.

# Dependencies

Only `Pillow` (PIL) is used — no ffmpeg, imagemagick, or external processes.
Pillow is already a runtime dependency listed in ``pyproject.toml``.  No
network I/O is performed.
"""

from __future__ import annotations

import io
import logging
from typing import Final

from PIL import Image as _PILImage
from PIL import ImageDraw as _PILImageDraw
from PIL import ImageFont as _PILImageFont

_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Watermark configuration constants
# ---------------------------------------------------------------------------

#: Default brand label applied to every generated image.
DEFAULT_WATERMARK_TEXT: Final[str] = "© Personal Color"

#: Alpha channel value for the watermark text (0 = fully transparent, 255 = opaque).
#: 160 ≈ 63% opacity — visible but not distracting.
_OPACITY: Final[int] = 160

#: Pixel gap between the watermark text and the image edges.
_PADDING: Final[int] = 12

#: Approximate font size in pixels.  Used when a system truetype font is
#: available; if not, the Pillow default bitmap font is used instead (which
#: ignores this value).
_FONT_SIZE: Final[int] = 18

#: Shadow offset in pixels (horizontal, vertical).
_SHADOW_OFFSET: Final[tuple[int, int]] = (1, 1)

#: Watermark text colour (RGBA) — white at full opacity so ``_OPACITY`` on the
#: overlay controls the final composited transparency.
_TEXT_COLOUR: Final[tuple[int, int, int, int]] = (255, 255, 255, 255)

#: Shadow colour (RGBA) — dark grey, provides contrast on light backgrounds.
_SHADOW_COLOUR: Final[tuple[int, int, int, int]] = (30, 30, 30, 255)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _load_font(size: int) -> _PILImageFont.FreeTypeFont | _PILImageFont.ImageFont:
    """Return a Pillow font at *size* pixels.

    Tries the common system-font paths in order.  Falls back to
    ``PIL.ImageFont.load_default()`` (a small bitmap font) if no
    TrueType font file can be found — guaranteeing the watermark still
    renders without any external font installation.

    Args:
        size: Desired font size in pixels.  Ignored when falling back to the
            default bitmap font.

    Returns:
        A Pillow font object suitable for use with
        :class:`PIL.ImageDraw.Draw`.
    """
    # Common system-font locations on Linux, macOS, and common containers.
    _FONT_CANDIDATES: list[str] = [
        # macOS
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Arial.ttf",
        # Linux (common distros)
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
    ]
    for path in _FONT_CANDIDATES:
        try:
            return _PILImageFont.truetype(path, size)
        except (OSError, IOError):
            continue

    # No system font found — fall back to Pillow's built-in bitmap font.
    _LOGGER.debug("watermark: no system TrueType font found, using Pillow default")
    return _PILImageFont.load_default()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def apply_watermark(
    image_bytes: bytes,
    *,
    text: str = DEFAULT_WATERMARK_TEXT,
) -> bytes:
    """Composite a text watermark onto *image_bytes* and return PNG bytes.

    The watermark is rendered as a semi-transparent text label in the
    bottom-right corner of the image.  Shadow + main passes ensure
    legibility on any background colour.

    The original image bytes are consumed only; they are never returned by
    this function.  The caller must discard ``image_bytes`` after calling
    this function if the Seed Contract's "original never sent to client"
    requirement is to be enforced end-to-end.

    Args:
        image_bytes: Raw bytes of a PIL-decodable image (PNG, JPEG, WebP, …).
            Must be non-empty.  The input format does **not** need to be PNG;
            this function accepts any Pillow-supported format.
        text: Watermark label string.  Defaults to
            :data:`DEFAULT_WATERMARK_TEXT` (``"© Personal Color"``).  Must be
            a non-empty string.

    Returns:
        PNG-encoded bytes of the watermarked image.  The returned image has the
        same pixel dimensions as the input.  Output is always PNG (lossless)
        regardless of the input format.

    Raises:
        ValueError: When ``image_bytes`` is not a non-empty ``bytes``-like
            object, or when ``text`` is empty.
        OSError: When Pillow fails to decode ``image_bytes`` (truncated file,
            unsupported format, etc.).
    """
    if not isinstance(image_bytes, (bytes, bytearray)):
        raise ValueError(
            f"image_bytes must be bytes-like, got {type(image_bytes).__name__}"
        )
    if not image_bytes:
        raise ValueError("image_bytes must not be empty")
    if not text:
        raise ValueError("watermark text must not be empty")

    # --- decode input image -------------------------------------------------
    with _PILImage.open(io.BytesIO(bytes(image_bytes))) as src:
        src.load()
        # Work in RGBA so the overlay alpha compositing is straightforward.
        base = src.convert("RGBA")

    width, height = base.size

    # --- build watermark overlay --------------------------------------------
    # Create a same-size transparent layer, draw the text onto it, then
    # alpha-composite it onto the base so the underlying image shows through.
    overlay = _PILImage.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = _PILImageDraw.Draw(overlay)

    font = _load_font(_FONT_SIZE)

    # Measure text bounding box so we can right-align the label.
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Anchor point: bottom-right, respecting _PADDING.
    x = max(0, width - text_w - _PADDING)
    y = max(0, height - text_h - _PADDING)

    # 1st pass: drop shadow (slightly offset, dark colour).
    shadow_x = x + _SHADOW_OFFSET[0]
    shadow_y = y + _SHADOW_OFFSET[1]
    draw.text((shadow_x, shadow_y), text, font=font, fill=_SHADOW_COLOUR)

    # 2nd pass: main text (white).
    draw.text((x, y), text, font=font, fill=_TEXT_COLOUR)

    # Scale the overlay's alpha channel by _OPACITY so the watermark is
    # semi-transparent rather than fully opaque.
    r, g, b, a = overlay.split()
    a_scaled = a.point(lambda v: (v * _OPACITY) // 255)
    overlay = _PILImage.merge("RGBA", (r, g, b, a_scaled))

    # Composite overlay onto the base image.
    composited = _PILImage.alpha_composite(base, overlay)

    # --- encode as PNG and return ------------------------------------------
    out = io.BytesIO()
    composited.convert("RGB").save(out, format="PNG")
    result_bytes = out.getvalue()

    _LOGGER.debug(
        "watermark: composited watermark input_bytes=%d output_bytes=%d "
        "width=%d height=%d",
        len(image_bytes),
        len(result_bytes),
        width,
        height,
    )
    return result_bytes


__all__ = [
    "DEFAULT_WATERMARK_TEXT",
    "apply_watermark",
]
