"""Selfie-bytes → Image decoder (Phase 0.x runtime boundary).

The diagnosis runtime entry point ``diagnose_personal_color`` accepts raw
PNG / JPEG bytes uploaded by the user. Before any diagnostic primitive can
look at the picture, those bytes must be turned into the rows-first
``Sequence[Sequence[RGB]]`` ``Image`` shape declared by
:mod:`personal_color.region_extractor`.

This module is the **single** place in the production source tree that
imports Pillow / PIL. The boundary is enforced both by convention and by
the Phase 0.x test that greps ``src/`` for ``PIL`` and asserts exactly one
hit (this file). Isolating the binary dep here means:

  * Phase 0.x primitive tests (tone / contrast / season / region /
    orchestrator) continue to run with zero native dependencies installed,
    preserving the cheap-CI invariant.
  * The face-detection module (MediaPipe) can rely on Pillow being available
    *only* via this decoder, never as a transitive concern.
  * Swapping Pillow for another decoder (imageio, opencv) is a single-file
    change with no fan-out into the diagnosis primitive layer.

Error contract:

  * Empty / wrong-type / wrong-format / corrupted bytes raise
    :class:`InvalidSelfieError`, a ``ValueError`` subclass. The Phase 4
    HTTP server maps this to **400 Bad Request** — the user's upload is
    malformed and the same upload will never decode no matter how many
    times it is retried.
  * Error messages are deliberately terse and contain no upload-level PII
    identifiers (per the Phase 0.x PII allow-list policy). The decoder
    never sees request-level identifiers; only raw bytes.

Memory:

  * Bytes are decoded in-memory via :class:`io.BytesIO`. The decoder never
    writes the selfie to disk and never logs the bytes themselves.
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from typing import Final

# Pillow is the single binary image-decoding dependency. Importing it at
# module top-level is intentional: this file is the boundary, so a missing
# Pillow install must surface here (an ``ImportError`` at module import) and
# never leak into the diagnosis primitive call paths. The Phase 0.x base
# test suite does NOT import this module, so uninstalling Pillow continues
# to leave those tests green.
from PIL import Image as _PILImage
from PIL import UnidentifiedImageError

from personal_color.region_extractor import RGB, Image

# ---------------------------------------------------------------------------
# Public error type
# ---------------------------------------------------------------------------


class InvalidSelfieError(ValueError):
    """Raised when selfie bytes cannot be decoded into an :data:`Image`.

    This is a permanent client error: the same input bytes will not become
    valid by retrying. Phase 4's HTTP layer maps this to **400 Bad Request**.

    Concrete trigger conditions (all surface as ``InvalidSelfieError``):

      * Caller passed something other than ``bytes`` / ``bytearray``.
      * The byte string is empty.
      * The byte string does not begin with a PNG or JPEG magic header.
      * Pillow cannot identify the byte string as an image (truncated,
        wrong container, garbage).
      * Pillow identifies the image but fails partway through the actual
        pixel decode (corrupted body, broken JPEG segment, etc.).

    Error messages are intentionally short and never reference upload-level
    PII identifiers — the decoder operates on raw bytes only and has no
    access to user identifiers in the first place.
    """


# ---------------------------------------------------------------------------
# Internal constants
# ---------------------------------------------------------------------------


# PNG: first 8 bytes are the standard signature.
# JPEG: first 3 bytes 0xFF 0xD8 0xFF (start of every JFIF / EXIF stream).
_PNG_MAGIC: Final[bytes] = b"\x89PNG\r\n\x1a\n"
_JPEG_MAGIC: Final[bytes] = b"\xff\xd8\xff"

# Pillow's ``Image.format`` strings for the two formats we accept. Anything
# else (GIF, BMP, WEBP, TIFF, …) is rejected at the policy layer so that
# the diagnosis pipeline only ever sees the two formats the mobile clients
# actually upload.
_ALLOWED_FORMATS: Final[frozenset[str]] = frozenset({"PNG", "JPEG"})


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def decode_image(selfie_bytes: bytes) -> Image:
    """Decode raw PNG/JPEG bytes into the diagnosis-primitive ``Image`` shape.

    Args:
        selfie_bytes: Raw bytes of a PNG or JPEG image as received from the
            mobile client. Decoded entirely in memory; never persisted.

    Returns:
        A rows-first ``Sequence[Sequence[RGB]]`` (concretely, a tuple of
        tuples of ``(r, g, b)`` ints in 0-255) that the
        :mod:`personal_color.region_extractor` and downstream primitives
        consume directly.

    Raises:
        InvalidSelfieError: On any decode failure — wrong type, empty
            bytes, non-PNG/JPEG magic header, Pillow failing to identify
            the format, or Pillow failing during pixel decode.
    """
    # --- type + emptiness gate -------------------------------------------
    if not isinstance(selfie_bytes, (bytes, bytearray)):
        raise InvalidSelfieError(
            f"selfie payload must be bytes, got {type(selfie_bytes).__name__}",
        )
    if len(selfie_bytes) == 0:
        raise InvalidSelfieError("selfie payload is empty")

    # --- magic-header gate (cheap, no Pillow allocation yet) -------------
    # We check before handing to Pillow so the rejection reason ("not a
    # PNG/JPEG") is unambiguous in tests and analytics. Pillow would also
    # reject most of these via UnidentifiedImageError, but it might happily
    # parse, say, a GIF or BMP — which we *do not* want flowing into the
    # diagnosis pipeline.
    payload = bytes(selfie_bytes)
    if not (payload.startswith(_PNG_MAGIC) or payload.startswith(_JPEG_MAGIC)):
        raise InvalidSelfieError(
            "selfie payload is not a PNG or JPEG image",
        )

    # --- Pillow decode ---------------------------------------------------
    try:
        with _PILImage.open(io.BytesIO(payload)) as pil_image:
            # ``Image.open`` is lazy — ``load()`` forces the pixel decode so
            # a truncated body fails *here* with ``InvalidSelfieError`` and
            # not later inside the region extractor.
            pil_image.load()

            # Belt-and-suspenders policy check: if Pillow somehow agreed
            # the bytes were an image whose format is *not* PNG/JPEG (e.g.
            # a payload that happened to start with the JPEG magic but
            # parsed as something else after registration), reject it.
            if pil_image.format not in _ALLOWED_FORMATS:
                raise InvalidSelfieError(
                    "selfie payload is not a PNG or JPEG image",
                )

            # Force RGB so callers never receive RGBA, P, L, or CMYK.
            rgb_image = pil_image.convert("RGB")
            width, height = rgb_image.size
            pixels = rgb_image.tobytes()
    except InvalidSelfieError:
        # Re-raise our own policy rejections untouched so the message is
        # preserved exactly as we wrote it.
        raise
    except UnidentifiedImageError as exc:
        # Pillow could not identify the byte string as an image at all.
        raise InvalidSelfieError(
            "selfie payload could not be decoded as an image",
        ) from exc
    except (OSError, ValueError, SyntaxError) as exc:
        # Pillow surfaces truncated / corrupt files through ``OSError``
        # (e.g. "image file is truncated") and the broader ``ValueError``
        # / ``SyntaxError`` for malformed PNG / JPEG chunks. All three are
        # client-side permanent errors.
        raise InvalidSelfieError(
            "selfie payload could not be decoded as an image",
        ) from exc

    # --- shape into Image -------------------------------------------------
    # tobytes() returns row-major RGB triples. Convert to the immutable
    # tuple-of-tuples shape the region extractor expects. We build the
    # nested tuple once here rather than handing back a numpy / PIL object,
    # so downstream callers never carry a transitive Pillow dependency
    # across the module boundary.
    rows: list[Sequence[RGB]] = []
    stride = width * 3
    for y in range(height):
        row_start = y * stride
        row: list[RGB] = []
        for x in range(width):
            base = row_start + x * 3
            row.append(
                (pixels[base], pixels[base + 1], pixels[base + 2]),
            )
        rows.append(tuple(row))
    return tuple(rows)


__all__ = ["InvalidSelfieError", "decode_image"]
