"""Server-side hidden enhancer — de-slop post-processing layer (Sub-AC 1).

The enhancer is the proprietary seam that transforms raw generative-AI
output (Fal.ai / Replicate) into publishable personal-color selfies. It
sits between the commoditised generation call and the user-facing result,
and is the primary quality moat of the product.

Key properties
--------------
- **Deterministic and rule-based**: no trained ML model, no inference call.
  Pure Pillow image-processing operations applied in a fixed order.
- **Server-side only**: the transformation is opaque to the mobile bundle.
  Mobile clients only receive the final enhanced bytes.
- **Non-filtering**: the enhancer applies corrections and *flags* artifacts,
  but never discards images. The ``reject_filter`` module (using
  operator-configured thresholds) owns the discard decision. Separation
  keeps the two taste-seams auditable independently.

De-slop pipeline (applied in order per image)
--------------------------------------------
1. **Sharpness enhancement** (``ImageEnhance.Sharpness``,
   ``_SHARPNESS_FACTOR``): counteracts the typical diffusion-model face blur
   while keeping the boost below halation territory.
2. **Contrast lift** (``ImageEnhance.Contrast``, ``_CONTRAST_FACTOR``):
   restores midtone contrast that diffusion noise flattens.
3. **Saturation normalization** (``ImageEnhance.Color``,
   ``_SATURATION_FACTOR``): mild desaturation to rein in the over-vivid
   skin tones common in FLUX img2img outputs.

Artifact detection flags (non-filtering)
-----------------------------------------
The enhancer computes four lightweight metrics on the *post-enhancement*
image and emits string flags for any thresholds exceeded. Flags are carried
in ``EnhancedImage.artifact_flags`` and consumed downstream by the
``reject_filter`` module:

- ``"low_sharpness"``   — edge std-dev below ``_LOW_SHARPNESS_THRESHOLD``
- ``"high_saturation"`` — per-channel std-dev spread above
                          ``_HIGH_SATURATION_THRESHOLD``
- ``"dark_image"``      — mean luma below ``_DARK_LUMA_THRESHOLD``
- ``"bright_image"``    — mean luma above ``_BRIGHT_LUMA_THRESHOLD``

Operator taste
--------------
The calibration constants below are the upstream taste boundary for the
operator (see Seed: "taste 위치 = 상류 2가지로 한정: (i) 트렌드별 생성
recipe/prompt, (ii) reject 필터 임계값 설정"). Changing these values is the
*only* low-level output-quality lever the operator is expected to touch.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Final

from PIL import Image, ImageEnhance, ImageFilter, ImageStat

# ---------------------------------------------------------------------------
# De-slop calibration parameters
# (operator's upstream taste seam — change here to retune output quality)
# ---------------------------------------------------------------------------

#: Sharpness multiplier applied via PIL ``ImageEnhance.Sharpness``.
#: > 1.0 = sharper. 1.3 provides a visible crisp lift on portrait skin
#: without introducing halation halos at hair / background edges.
_SHARPNESS_FACTOR: Final[float] = 1.3

#: Contrast multiplier applied via PIL ``ImageEnhance.Contrast``.
#: 1.15 = mild lift; restores the midtone contrast that FLUX diffusion
#: flattens without clipping highlights or shadows.
_CONTRAST_FACTOR: Final[float] = 1.15

#: Saturation multiplier applied via PIL ``ImageEnhance.Color``.
#: < 1.0 = slightly desaturated. 0.92 reins in the over-vivid skintones
#: common in FLUX img2img without making the photo look faded.
_SATURATION_FACTOR: Final[float] = 0.92

# ---------------------------------------------------------------------------
# Artifact detection thresholds
# (feed the downstream reject_filter; not used for discard here)
# ---------------------------------------------------------------------------

#: Sharpness score = std-dev of ``ImageFilter.FIND_EDGES`` output on the
#: L-channel. A solid-colour or blurry image scores near 0; a sharp portrait
#: typically scores 15+. Below this floor → ``"low_sharpness"`` flag.
_LOW_SHARPNESS_THRESHOLD: Final[float] = 8.0

#: Mean per-channel pixel std-dev above this → ``"high_saturation"`` flag.
#: Very saturated neon / uncanny images have R/G/B channels whose individual
#: std-devs are all high. Mean(stddev(R), stddev(G), stddev(B)) > 80 is a
#: reliable proxy for runaway saturation without needing an HSV conversion.
_HIGH_SATURATION_THRESHOLD: Final[float] = 80.0

#: Mean luminance of the L-channel below this → ``"dark_image"`` flag.
_DARK_LUMA_THRESHOLD: Final[float] = 30.0

#: Mean luminance of the L-channel above this → ``"bright_image"`` flag.
_BRIGHT_LUMA_THRESHOLD: Final[float] = 225.0


# ---------------------------------------------------------------------------
# Output DTO
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EnhancedImage:
    """De-slopped single image output from the enhancer pipeline.

    Represents one entry in the ``generation_candidate`` array
    (Seed ontology). Carries the processed image bytes plus artifact flags
    detected during post-processing; the ``reject_filter`` module reads
    the flags to decide which candidates to discard before the user pick.

    Attributes
    ----------
    image_bytes:
        JPEG-encoded bytes of the enhanced image. Always non-empty;
        construction raises ``ValueError`` otherwise.
    artifact_flags:
        Tuple of zero or more flag strings. Empty = no issues detected.
        Current possible values: ``"low_sharpness"``, ``"high_saturation"``,
        ``"dark_image"``, ``"bright_image"``.
    """

    image_bytes: bytes
    artifact_flags: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.image_bytes:
            raise ValueError("EnhancedImage.image_bytes must not be empty")
        if not isinstance(self.artifact_flags, tuple):
            raise TypeError(
                "EnhancedImage.artifact_flags must be a tuple, "
                f"got {type(self.artifact_flags).__name__}"
            )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def apply_enhancer(raw_images: list[bytes]) -> list[EnhancedImage]:
    """Apply deterministic de-slop post-processing to raw AI-generated images.

    This is the single entry-point of the hidden server-side enhancer layer.
    Raw generative-AI output (Fal.ai / Replicate) flows *in* here; processed
    ``EnhancedImage`` candidates flow *out*. The mobile client only ever
    receives the processed bytes — the raw output is never surfaced directly
    (Seed constraint: "생짜 AI 출력 금지").

    The pipeline per image:
        1. Decode ``bytes`` → RGB PIL Image.
        2. Sharpness enhancement (``_SHARPNESS_FACTOR``).
        3. Contrast lift (``_CONTRAST_FACTOR``).
        4. Saturation normalization (``_SATURATION_FACTOR``).
        5. Artifact detection → ``artifact_flags``.
        6. Re-encode → JPEG ``bytes``.

    Parameters
    ----------
    raw_images:
        List of raw bytes from the generation AI. Each element must be a
        valid image format Pillow can decode (JPEG, PNG, WebP, …). Empty
        list returns empty list immediately.

    Returns
    -------
    list[EnhancedImage]
        One ``EnhancedImage`` per input image, preserving order. The
        output list has the same length as ``raw_images``.

    Raises
    ------
    ValueError
        If any element of ``raw_images`` is empty bytes or cannot be
        decoded by Pillow. The message names the offending index so the
        caller can correlate back to the generation batch.
    """
    return [_enhance_single(idx, raw) for idx, raw in enumerate(raw_images)]


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _enhance_single(idx: int, image_bytes: bytes) -> EnhancedImage:
    """Process one raw AI image through the full de-slop pipeline.

    Parameters
    ----------
    idx:
        Zero-based position in the input list; used only for error messages.
    image_bytes:
        Raw bytes of one AI-generated image.

    Returns
    -------
    EnhancedImage
        De-slopped result with artifact flags.

    Raises
    ------
    ValueError
        On empty ``image_bytes`` or Pillow decode failure.
    """
    if not image_bytes:
        raise ValueError(f"raw_images[{idx}] must not be empty bytes")

    try:
        img: Image.Image = Image.open(io.BytesIO(image_bytes))
        img.load()  # force full decode; surfaces truncated / corrupt images early
    except Exception as exc:
        raise ValueError(f"raw_images[{idx}] could not be decoded by Pillow") from exc

    # Normalise to RGB: handles RGBA (strip alpha), palette (P), greyscale (L).
    # All downstream Pillow operations and the JPEG re-encoder require RGB.
    img = img.convert("RGB")

    # ── 1. Sharpness enhancement ──────────────────────────────────────────
    img = ImageEnhance.Sharpness(img).enhance(_SHARPNESS_FACTOR)

    # ── 2. Contrast lift ──────────────────────────────────────────────────
    img = ImageEnhance.Contrast(img).enhance(_CONTRAST_FACTOR)

    # ── 3. Saturation normalization ───────────────────────────────────────
    img = ImageEnhance.Color(img).enhance(_SATURATION_FACTOR)

    # ── 4. Artifact detection (flags only, never discard) ─────────────────
    flags: tuple[str, ...] = _detect_artifact_flags(img)

    # ── 5. Re-encode to JPEG ──────────────────────────────────────────────
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95, optimize=True)
    processed_bytes: bytes = buf.getvalue()

    return EnhancedImage(image_bytes=processed_bytes, artifact_flags=flags)


def _detect_artifact_flags(img: Image.Image) -> tuple[str, ...]:
    """Compute artifact flags for the downstream reject_filter.

    Pure function — reads pixel data, emits zero or more flag strings.
    Never mutates the image. Never discards images (that is the
    reject_filter's responsibility with operator-configured thresholds).

    Parameters
    ----------
    img:
        RGB PIL Image after all enhancement steps have been applied.

    Returns
    -------
    tuple[str, ...]
        Sorted tuple of flag strings. Empty = no issues detected.
    """
    flags: list[str] = []

    # ── Sharpness proxy: std-dev of FIND_EDGES on L-channel ───────────────
    # FIND_EDGES is a Sobel-style edge-detection kernel available in Pillow
    # without numpy. The std-dev of the edge-magnitude image is a robust
    # sharpness proxy: blurry images have low edge energy, sharp images high.
    gray: Image.Image = img.convert("L")
    edges: Image.Image = gray.filter(ImageFilter.FIND_EDGES)
    edge_stat = ImageStat.Stat(edges)
    sharpness_score: float = edge_stat.stddev[0]
    if sharpness_score < _LOW_SHARPNESS_THRESHOLD:
        flags.append("low_sharpness")

    # ── Saturation proxy: mean per-channel std-dev ────────────────────────
    # A highly saturated image has large per-channel variance (neon reds,
    # vivid greens, etc.). Mean(stddev(R), stddev(G), stddev(B)) > threshold
    # is an inexpensive proxy that avoids an HSV conversion.
    stat = ImageStat.Stat(img)
    mean_stddev: float = sum(stat.stddev[:3]) / 3.0
    if mean_stddev > _HIGH_SATURATION_THRESHOLD:
        flags.append("high_saturation")

    # ── Luminance: mean of L-channel ──────────────────────────────────────
    luma_stat = ImageStat.Stat(gray)
    mean_luma: float = luma_stat.mean[0]
    if mean_luma < _DARK_LUMA_THRESHOLD:
        flags.append("dark_image")
    elif mean_luma > _BRIGHT_LUMA_THRESHOLD:
        flags.append("bright_image")

    return tuple(sorted(flags))


__all__ = [
    "EnhancedImage",
    "apply_enhancer",
]
