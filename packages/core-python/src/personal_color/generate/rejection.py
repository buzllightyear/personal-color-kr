"""NSFW/artifact rejection scorer for AI-generated image candidates (Sub-AC 2b-i).

# Purpose

Provides :func:`score_image`, the single public entry point for evaluating
whether an AI-generated image candidate is safe to deliver to users.
The function accepts a candidate image as raw bytes or an HTTP(S) URL and
returns a :class:`RejectionVerdict` capturing two independent rejection
dimensions:

  * **NSFW** — detected via an injectable :class:`NsfwClassifier`.  The
    production implementation (:class:`FalNsfwClassifier`) calls fal.ai's
    image-analysis endpoint; tests inject :class:`StubNsfwClassifier` to
    avoid real HTTP round-trips (the "fal client stubbed" constraint).
  * **Artifact** — detected locally via PIL heuristics without any external
    API call.  Only *severe* artifacts trigger rejection (severe-only, loose).

# Asymmetric thresholds (Seed constraints)

``DEFAULT_NSFW_THRESHOLD = 0.1`` — near-zero leakage tolerance.  Any image
with nsfw_score >= 0.1 is flagged.  False negatives (NSFW content reaching
users) are treated as safety failures.

``DEFAULT_ARTIFACT_THRESHOLD = 0.9`` — severe artifacts only.  The artifact
scorer uses conservative PIL heuristics so that ~95% of real images pass even
when generation quality is imperfect.  False positives (good images rejected
as artifacts) erode the 95% success-rate target.

# Dependency injection

:func:`score_image` requires an ``nsfw_classifier`` argument so callers
choose their implementation:
  * Production: ``FalNsfwClassifier(api_key=...)``
  * Tests:      ``StubNsfwClassifier(score=0.0)``

No global state; no module-level side effects.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from typing import Final, Protocol, runtime_checkable

import httpx
from PIL import Image as _PILImage

_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Threshold constants
# ---------------------------------------------------------------------------

#: Default NSFW score threshold.  Images with nsfw_score >= this value are
#: flagged as NSFW.  Low value enforces near-zero leakage (Seed constraint).
DEFAULT_NSFW_THRESHOLD: Final[float] = 0.1

#: Default artifact severity threshold.  Images with artifact_score >=
#: this value are flagged.  High value limits rejection to severe cases only
#: to protect the 95% success-rate target (Seed constraint).
DEFAULT_ARTIFACT_THRESHOLD: Final[float] = 0.9

# ---------------------------------------------------------------------------
# PIL-based artifact scorer constants
# ---------------------------------------------------------------------------

#: Minimum pixel-value standard deviation to *not* be considered a near-blank
#: image.  A fully blank or monochrome image has std_dev ≈ 0; reasonable
#: AI-generated content has std_dev >> 5.
_MIN_PIXEL_STD_DEV: Final[float] = 5.0

#: Fraction of (quantised) pixels that must share the most common value for
#: a "single-colour domination" severe artifact to be flagged.  0.95 = 95%.
_DOMINANT_COLOUR_FRACTION: Final[float] = 0.95

# Quantisation step for dominant-colour check: bucket pixel values to
# multiples of this integer so near-identical shades are grouped together.
_COLOUR_BUCKET_SIZE: Final[int] = 16


# ---------------------------------------------------------------------------
# RejectionVerdict — structured result
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RejectionVerdict:
    """Structured rejection verdict for a single AI-generated image candidate.

    All fields are permanently stored for audit trail purposes.

    Attributes
    ----------
    nsfw_flag:
        ``True`` when nsfw_score >= nsfw_threshold.  Near-zero false-negative
        tolerance per Seed constraint (``DEFAULT_NSFW_THRESHOLD = 0.1``).
    artifact_flag:
        ``True`` when artifact_score >= artifact_threshold.  Severe artifacts
        only — false positives are minimised to protect the 95% success rate.
    passed:
        ``True`` iff both nsfw_flag and artifact_flag are ``False``.
        Equivalent to ``not nsfw_flag and not artifact_flag``.
    nsfw_score:
        Continuous NSFW confidence in [0.0, 1.0].  Higher = more likely NSFW.
        Sourced from the injected :class:`NsfwClassifier`.
    artifact_score:
        Continuous artifact severity in [0.0, 1.0].  Higher = more severe.
        Computed locally via PIL heuristics — no external API call.
    reject_reason:
        ``"nsfw"`` when only nsfw_flag is set, ``"artifact"`` when only
        artifact_flag is set, ``"nsfw+artifact"`` when both are set,
        ``None`` when the image passes (both flags are False).
    """

    nsfw_flag: bool
    artifact_flag: bool
    passed: bool
    nsfw_score: float
    artifact_score: float
    reject_reason: str | None


# ---------------------------------------------------------------------------
# NsfwClassifier Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class NsfwClassifier(Protocol):
    """Protocol for injectable NSFW image classifiers.

    Implementations provide a single :meth:`classify` method that accepts
    an image as bytes or a URL string and returns a probability score in
    [0.0, 1.0].

    The production implementation is :class:`FalNsfwClassifier` (calls
    fal.ai).  Tests inject :class:`StubNsfwClassifier` to avoid any HTTP
    round-trips.
    """

    def classify(self, image_input: bytes | str) -> float:
        """Return the NSFW probability for the given image.

        Parameters
        ----------
        image_input:
            Raw image bytes **or** an HTTP(S) URL string.  Bytes inputs are
            uploaded to fal.ai temporary storage (production implementation)
            or ignored entirely (stub implementation).

        Returns
        -------
        float
            NSFW confidence score in [0.0, 1.0].
            0.0 = definitely safe; 1.0 = definitely NSFW.
        """
        ...


# ---------------------------------------------------------------------------
# StubNsfwClassifier — for tests / local development
# ---------------------------------------------------------------------------


class StubNsfwClassifier:
    """Fixed-score NSFW classifier stub.

    Returns a configurable constant score for every :meth:`classify` call
    regardless of image content.  Makes test assertions deterministic without
    any HTTP round-trips.

    Satisfies the :class:`NsfwClassifier` Protocol at runtime
    (``isinstance(stub, NsfwClassifier)`` is ``True``).

    Parameters
    ----------
    score:
        The NSFW score returned for every call.  Must be in [0.0, 1.0].
        Default is ``0.0`` (always safe).
    """

    def __init__(self, score: float = 0.0) -> None:
        if not 0.0 <= score <= 1.0:
            raise ValueError(
                f"StubNsfwClassifier score must be in [0.0, 1.0], got {score!r}"
            )
        self._score = score

    def classify(self, image_input: bytes | str) -> float:  # noqa: ARG002
        """Return the fixed stub score (image content is ignored)."""
        return self._score


# ---------------------------------------------------------------------------
# FalNsfwClassifier — production implementation
# ---------------------------------------------------------------------------


class NsfwClassificationError(Exception):
    """Raised when the NSFW classification call fails.

    Attributes
    ----------
    retryable:
        ``True`` for transient failures (HTTP 429, 5xx, timeout); ``False``
        for permanent failures (HTTP 4xx excluding 429).
    """

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


def _upload_to_fal_storage(
    image_bytes: bytes,
    api_key: str,
    timeout: float,
) -> str:
    """Upload raw image bytes to fal.run storage and return the CDN URL.

    Internal helper used by :class:`FalNsfwClassifier` to convert bytes
    input into a URL the fal.ai NSFW endpoint can dereference.

    Parameters
    ----------
    image_bytes:
        Non-empty raw image bytes.
    api_key:
        fal.ai API key.  Never logged.
    timeout:
        HTTP request timeout in seconds.

    Returns
    -------
    str
        Short-lived fal.run storage URL.

    Raises
    ------
    NsfwClassificationError
        On any HTTP or response-parsing failure.
    """
    headers = {
        "Authorization": f"Key {api_key}",
        "Accept": "application/json",
    }
    files = {"file": ("image", image_bytes, "application/octet-stream")}

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(
                "https://fal.run/storage/upload",
                headers=headers,
                files=files,
            )
    except httpx.TimeoutException:
        raise NsfwClassificationError(
            "fal storage upload: request timed out", retryable=True
        ) from None
    except httpx.HTTPError as exc:
        raise NsfwClassificationError(
            f"fal storage upload: transport error ({type(exc).__name__})",
            retryable=True,
        ) from None

    if response.status_code == 429 or 500 <= response.status_code < 600:
        raise NsfwClassificationError(
            f"fal storage upload: transient HTTP {response.status_code}",
            retryable=True,
        )
    if not (200 <= response.status_code < 300):
        raise NsfwClassificationError(
            f"fal storage upload: HTTP {response.status_code}",
            retryable=False,
        )

    try:
        body = response.json()
    except ValueError as exc:
        raise NsfwClassificationError(
            "fal storage upload: response was not valid JSON"
        ) from exc

    url = body.get("url") if isinstance(body, dict) else None
    if not isinstance(url, str) or not url:
        raise NsfwClassificationError(
            "fal storage upload: response missing 'url' string field"
        )
    return url


def _parse_nsfw_response(body: object) -> float:
    """Extract the NSFW probability from a fal.ai NSFW classifier response.

    Pure function — no I/O.  Accepts any JSON-decoded value and validates
    the structure before returning the numeric score.

    The fal.ai ``fal-ai/imageutils/nsfw`` endpoint returns::

        {"nsfw_probability": 0.034, "is_safe": true}

    Parameters
    ----------
    body:
        Decoded JSON body.  Typed as ``object`` to force explicit checks.

    Returns
    -------
    float
        ``nsfw_probability`` clamped to [0.0, 1.0].

    Raises
    ------
    NsfwClassificationError
        On structural violations.
    """
    if not isinstance(body, dict):
        raise NsfwClassificationError(
            "fal NSFW response: expected JSON object, got "
            f"{type(body).__name__}"
        )

    prob = body.get("nsfw_probability")
    if prob is None:
        raise NsfwClassificationError(
            "fal NSFW response: missing 'nsfw_probability' field"
        )
    if not isinstance(prob, (int, float)):
        raise NsfwClassificationError(
            f"fal NSFW response: 'nsfw_probability' must be numeric, got {type(prob).__name__}"
        )

    return float(max(0.0, min(1.0, prob)))


class FalNsfwClassifier:
    """Production NSFW classifier that calls fal.ai's NSFW detection endpoint.

    Calls ``https://fal.run/fal-ai/imageutils/nsfw`` synchronously and
    returns the ``nsfw_probability`` field from the response.

    The api_key is passed as a constructor parameter, never read from the
    environment here, and never emitted in logs or exception messages.

    Parameters
    ----------
    api_key:
        fal.ai API key in ``<key_id>:<key_secret>`` format.
    timeout:
        Per-request HTTP timeout in seconds (default 10.0).
    """

    _ENDPOINT: Final[str] = "https://fal.run/fal-ai/imageutils/nsfw"

    def __init__(self, api_key: str, *, timeout: float = 10.0) -> None:
        self._api_key = api_key
        self._timeout = timeout

    def classify(self, image_input: bytes | str) -> float:
        """Return the NSFW probability for the given image.

        Parameters
        ----------
        image_input:
            Raw image bytes **or** an HTTP(S) URL string.  When bytes are
            provided they are first uploaded to fal.run temporary storage.

        Returns
        -------
        float
            NSFW probability in [0.0, 1.0].

        Raises
        ------
        NsfwClassificationError
            On HTTP errors or response-parsing failures.
        """
        if isinstance(image_input, (bytes, bytearray)):
            image_url = _upload_to_fal_storage(
                bytes(image_input), self._api_key, self._timeout
            )
        else:
            image_url = image_input

        headers = {
            "Authorization": f"Key {self._api_key}",
            "Accept": "application/json",
        }
        payload = {"image_url": image_url}

        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.post(
                    self._ENDPOINT, headers=headers, json=payload
                )
        except httpx.TimeoutException:
            raise NsfwClassificationError(
                "fal NSFW classifier: request timed out", retryable=True
            ) from None
        except httpx.HTTPError as exc:
            raise NsfwClassificationError(
                f"fal NSFW classifier: transport error ({type(exc).__name__})",
                retryable=True,
            ) from None

        if response.status_code == 429 or 500 <= response.status_code < 600:
            raise NsfwClassificationError(
                f"fal NSFW classifier: transient HTTP {response.status_code}",
                retryable=True,
            )
        if not (200 <= response.status_code < 300):
            raise NsfwClassificationError(
                f"fal NSFW classifier: HTTP {response.status_code}",
                retryable=False,
            )

        try:
            body: object = response.json()
        except ValueError as exc:
            raise NsfwClassificationError(
                "fal NSFW classifier: response was not valid JSON"
            ) from exc

        score = _parse_nsfw_response(body)
        _LOGGER.debug("fal NSFW classify: score=%.4f", score)
        return score


# ---------------------------------------------------------------------------
# Artifact scorer — local PIL heuristics (no external API)
# ---------------------------------------------------------------------------


def _compute_artifact_score(image_input: bytes | str) -> float:
    """Compute a local PIL-based artifact severity score in [0.0, 1.0].

    Uses two conservative heuristics to detect *severe* generation failures
    only — both chosen to minimise false positives:

    1. **Near-blank detection** — images with very low pixel-value standard
       deviation (std_dev < :data:`_MIN_PIXEL_STD_DEV`) score 1.0.  A real
       AI-generated portrait has std_dev >> 5; nearly-blank images indicate
       a complete generation failure.

    2. **Dominant-colour domination** — when :data:`_DOMINANT_COLOUR_FRACTION`
       (95%) or more of pixels share the same quantised colour bucket, score
       1.0.  This catches single-colour generation failures that produce a
       non-blank but still useless monochrome output.

    If neither severe artifact is detected the function returns 0.0, keeping
    false-positive rate near zero for valid AI-generated content.

    Parameters
    ----------
    image_input:
        Raw image bytes or an HTTP(S) URL string.  URL inputs are fetched
        with a short timeout (5 s) before PIL decoding.

    Returns
    -------
    float
        0.0 when no severe artifact detected; 1.0 when severe artifact detected.
        Intermediate values are not currently produced (binary heuristic).
    """
    # ------------------------------------------------------------------
    # Resolve bytes
    # ------------------------------------------------------------------
    if isinstance(image_input, str):
        raw_bytes = _fetch_url_bytes(image_input)
    elif isinstance(image_input, (bytes, bytearray)):
        raw_bytes = bytes(image_input)
    else:
        raise TypeError(
            f"image_input must be bytes or str, got {type(image_input).__name__}"
        )

    if not raw_bytes:
        # Empty bytes are a severe artifact (generation produced nothing).
        return 1.0

    # ------------------------------------------------------------------
    # Decode image
    # ------------------------------------------------------------------
    try:
        with _PILImage.open(io.BytesIO(raw_bytes)) as img:
            img.load()
            # Work in grayscale for variance; convert to RGB for colour check.
            gray = img.convert("L")
            rgb = img.convert("RGB")
    except Exception:
        # Decode failure → treat as severe artifact (can't use the image).
        _LOGGER.debug("artifact scorer: PIL decode failed — scoring 1.0")
        return 1.0

    width, height = gray.size
    pixel_count = width * height
    if pixel_count == 0:
        return 1.0

    # ------------------------------------------------------------------
    # Heuristic 1: near-blank (very low std dev in grayscale)
    # ------------------------------------------------------------------
    gray_pixels = list(gray.getdata())
    n = len(gray_pixels)
    mean_val = sum(gray_pixels) / n
    variance = sum((p - mean_val) ** 2 for p in gray_pixels) / n
    std_dev = variance**0.5

    if std_dev < _MIN_PIXEL_STD_DEV:
        _LOGGER.debug(
            "artifact scorer: near-blank image std_dev=%.2f < %.1f → score=1.0",
            std_dev,
            _MIN_PIXEL_STD_DEV,
        )
        return 1.0

    # ------------------------------------------------------------------
    # Heuristic 2: dominant-colour domination (single-colour generation failure)
    # ------------------------------------------------------------------
    rgb_pixels = list(rgb.getdata())
    # Quantise each channel to nearest bucket so near-identical shades group.
    bucket = _COLOUR_BUCKET_SIZE
    buckets: dict[tuple[int, int, int], int] = {}
    for r, g, b in rgb_pixels:
        key = (
            (r // bucket) * bucket,
            (g // bucket) * bucket,
            (b // bucket) * bucket,
        )
        buckets[key] = buckets.get(key, 0) + 1

    max_count = max(buckets.values()) if buckets else 0
    dominant_fraction = max_count / pixel_count if pixel_count else 0.0

    if dominant_fraction >= _DOMINANT_COLOUR_FRACTION:
        _LOGGER.debug(
            "artifact scorer: dominant colour covers %.1f%% of pixels → score=1.0",
            dominant_fraction * 100,
        )
        return 1.0

    return 0.0


def _fetch_url_bytes(url: str, timeout: float = 5.0) -> bytes:
    """Fetch image bytes from an HTTP(S) URL with a short timeout.

    Internal helper for :func:`_compute_artifact_score` when the caller
    provides a URL instead of raw bytes.

    Parameters
    ----------
    url:
        HTTP(S) URL to fetch.
    timeout:
        Request timeout in seconds.

    Returns
    -------
    bytes
        Response body bytes.

    Raises
    ------
    NsfwClassificationError
        On HTTP or transport failures.
    """
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(url, headers={"Accept": "*/*"})
    except httpx.TimeoutException:
        raise NsfwClassificationError(
            f"artifact scorer: URL fetch timed out: {url}", retryable=True
        ) from None
    except httpx.HTTPError as exc:
        raise NsfwClassificationError(
            f"artifact scorer: URL fetch transport error ({type(exc).__name__})",
            retryable=True,
        ) from None

    if not (200 <= response.status_code < 300):
        raise NsfwClassificationError(
            f"artifact scorer: URL fetch HTTP {response.status_code}",
            retryable=response.status_code == 429 or response.status_code >= 500,
        )

    return response.content


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def score_image(
    image_input: bytes | str,
    *,
    nsfw_classifier: NsfwClassifier,
    nsfw_threshold: float = DEFAULT_NSFW_THRESHOLD,
    artifact_threshold: float = DEFAULT_ARTIFACT_THRESHOLD,
) -> RejectionVerdict:
    """Score a candidate image for NSFW content and severe visual artifacts.

    This is the single public entry point for the rejection scorer.

    Two independent rejection dimensions are evaluated:

    * **NSFW** — delegated to the injected ``nsfw_classifier``.  The
      production implementation calls fal.ai; tests use a stub.
    * **Artifact** — computed locally via PIL heuristics (no external call).
      Only severe artifacts (near-blank, single-colour domination) trigger
      rejection to minimise false positives.

    Parameters
    ----------
    image_input:
        Candidate image as raw ``bytes`` (PNG, JPEG, WebP, …) **or** as an
        HTTP(S) URL ``str`` that resolves to the image.
    nsfw_classifier:
        Injectable NSFW classifier.  Must satisfy the :class:`NsfwClassifier`
        Protocol.  Use :class:`FalNsfwClassifier` in production and
        :class:`StubNsfwClassifier` in tests.
    nsfw_threshold:
        Minimum NSFW score to flag the image.  Default 0.1 (near-zero
        leakage tolerance per Seed constraint).  Lower = more sensitive.
    artifact_threshold:
        Minimum artifact score to flag the image.  Default 0.9 (severe
        artifacts only per Seed constraint).  Higher = less sensitive.

    Returns
    -------
    RejectionVerdict
        Frozen dataclass with nsfw_flag, artifact_flag, passed, nsfw_score,
        artifact_score, and reject_reason.  The ``passed`` field is the
        primary gate: ``True`` means the image is safe to deliver.

    Raises
    ------
    TypeError:
        When ``image_input`` is neither ``bytes``/``bytearray`` nor ``str``.
    ValueError:
        When ``image_input`` is an empty bytes object.
    NsfwClassificationError:
        On NSFW classification failures (wraps HTTP/transport errors from
        the ``nsfw_classifier`` or from the URL fetch in the artifact scorer).
    """
    if not isinstance(image_input, (bytes, bytearray, str)):
        raise TypeError(
            f"image_input must be bytes or str, got {type(image_input).__name__}"
        )
    if isinstance(image_input, (bytes, bytearray)) and not image_input:
        raise ValueError("image_input bytes must not be empty")

    # --- NSFW scoring (injected classifier) --------------------------------
    nsfw_score = nsfw_classifier.classify(image_input)
    nsfw_flag = nsfw_score >= nsfw_threshold

    # --- Artifact scoring (local PIL) --------------------------------------
    artifact_score = _compute_artifact_score(image_input)
    artifact_flag = artifact_score >= artifact_threshold

    # --- Aggregate verdict -------------------------------------------------
    passed = not nsfw_flag and not artifact_flag

    if nsfw_flag and artifact_flag:
        reject_reason: str | None = "nsfw+artifact"
    elif nsfw_flag:
        reject_reason = "nsfw"
    elif artifact_flag:
        reject_reason = "artifact"
    else:
        reject_reason = None

    verdict = RejectionVerdict(
        nsfw_flag=nsfw_flag,
        artifact_flag=artifact_flag,
        passed=passed,
        nsfw_score=nsfw_score,
        artifact_score=artifact_score,
        reject_reason=reject_reason,
    )

    _LOGGER.debug(
        "rejection scorer: nsfw_score=%.4f nsfw_flag=%s "
        "artifact_score=%.4f artifact_flag=%s passed=%s reject_reason=%s",
        nsfw_score,
        nsfw_flag,
        artifact_score,
        artifact_flag,
        passed,
        reject_reason,
    )

    return verdict


__all__ = [
    "DEFAULT_NSFW_THRESHOLD",
    "DEFAULT_ARTIFACT_THRESHOLD",
    "RejectionVerdict",
    "NsfwClassifier",
    "StubNsfwClassifier",
    "FalNsfwClassifier",
    "NsfwClassificationError",
    "score_image",
]
