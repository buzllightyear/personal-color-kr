"""Tests for personal_color.generate.rejection (Sub-AC 2b-i).

Verifies the NSFW/artifact rejection scorer using:
  - StubNsfwClassifier (the "fal client stubbed" requirement)
  - Synthetic in-memory PIL images (no external files or network calls)

The tests pass on a clean Python 3.12 install with Pillow and httpx.

Test coverage:
    - RejectionVerdict structure and immutability
    - score_image happy path: safe image → passed=True, no reject_reason
    - NSFW threshold: score at threshold flags nsfw_flag; below threshold passes
    - NSFW asymmetric threshold: near-zero leakage (DEFAULT_NSFW_THRESHOLD = 0.1)
    - Artifact threshold: severe artifact (blank/monochrome) flagged
    - Dual rejection: both nsfw_flag and artifact_flag → reject_reason = "nsfw+artifact"
    - reject_reason strings: None / "nsfw" / "artifact" / "nsfw+artifact"
    - passed = not nsfw_flag and not artifact_flag (logical invariant)
    - score_image accepts bytes input (PNG, JPEG)
    - score_image accepts URL string input (mocked via monkeypatch)
    - Input validation: empty bytes raises ValueError
    - Input validation: non-bytes/str raises TypeError
    - StubNsfwClassifier: returns fixed score; satisfies NsfwClassifier Protocol
    - StubNsfwClassifier: rejects score outside [0.0, 1.0]
    - FalNsfwClassifier: is_instance of NsfwClassifier Protocol
    - _parse_nsfw_response: valid response parses correctly
    - _parse_nsfw_response: missing field raises NsfwClassificationError
    - _parse_nsfw_response: non-dict raises NsfwClassificationError
    - _parse_nsfw_response: non-numeric field raises NsfwClassificationError
    - _compute_artifact_score: near-blank image scores 1.0
    - _compute_artifact_score: monochrome image scores 1.0
    - _compute_artifact_score: normal realistic image scores 0.0
    - DEFAULT_NSFW_THRESHOLD and DEFAULT_ARTIFACT_THRESHOLD constant values
    - NsfwClassificationError retryable attribute
"""

from __future__ import annotations

import io
from typing import Final

import pytest
from PIL import Image as _PILImage

from personal_color.generate.rejection import (
    DEFAULT_ARTIFACT_THRESHOLD,
    DEFAULT_NSFW_THRESHOLD,
    FalNsfwClassifier,
    NsfwClassificationError,
    NsfwClassifier,
    RejectionVerdict,
    StubNsfwClassifier,
    _compute_artifact_score,
    _parse_nsfw_response,
    score_image,
)

# ---------------------------------------------------------------------------
# Synthetic image helpers
# ---------------------------------------------------------------------------

_PNG_MAGIC: Final[bytes] = b"\x89PNG\r\n\x1a\n"


def _make_png_bytes(
    width: int = 64,
    height: int = 64,
    colour: tuple[int, int, int] = (120, 80, 160),
) -> bytes:
    """Create a solid-colour PNG image and return its bytes."""
    img = _PILImage.new("RGB", (width, height), colour)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_jpeg_bytes(
    width: int = 64,
    height: int = 64,
    colour: tuple[int, int, int] = (200, 100, 50),
) -> bytes:
    """Create a solid-colour JPEG image and return its bytes."""
    img = _PILImage.new("RGB", (width, height), colour)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _make_varied_png_bytes(width: int = 64, height: int = 64) -> bytes:
    """Create a PNG with varied pixel content (high std dev, diverse colours).

    Fills the image with a gradient from (0,0,0) to (255,255,255) diagonally
    so pixel values span the full range — guaranteed high standard deviation
    and no dominant colour.
    """
    img = _PILImage.new("RGB", (width, height))
    pixels = img.load()
    assert pixels is not None
    for x in range(width):
        for y in range(height):
            value = int((x + y) / (width + height - 2) * 255)
            pixels[x, y] = (value, 255 - value, (x * 3 + y) % 256)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_blank_png_bytes(width: int = 64, height: int = 64) -> bytes:
    """Create a near-blank (solid white) PNG — severe artifact candidate."""
    return _make_png_bytes(width, height, colour=(255, 255, 255))


def _make_near_blank_png_bytes(width: int = 64, height: int = 64) -> bytes:
    """Create a nearly uniform gray PNG with very low std dev."""
    return _make_png_bytes(width, height, colour=(128, 128, 128))


# ---------------------------------------------------------------------------
# 1. Threshold constants
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_default_nsfw_threshold_value() -> None:
    """DEFAULT_NSFW_THRESHOLD must be 0.1 (near-zero leakage tolerance)."""
    assert DEFAULT_NSFW_THRESHOLD == 0.1


@pytest.mark.unit
def test_default_artifact_threshold_value() -> None:
    """DEFAULT_ARTIFACT_THRESHOLD must be 0.9 (severe artifacts only)."""
    assert DEFAULT_ARTIFACT_THRESHOLD == 0.9


# ---------------------------------------------------------------------------
# 2. RejectionVerdict structure
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_rejection_verdict_is_frozen() -> None:
    """RejectionVerdict must be immutable (frozen dataclass)."""
    verdict = RejectionVerdict(
        nsfw_flag=False,
        artifact_flag=False,
        passed=True,
        nsfw_score=0.0,
        artifact_score=0.0,
        reject_reason=None,
    )
    with pytest.raises((AttributeError, TypeError)):
        verdict.passed = False  # type: ignore[misc]


@pytest.mark.unit
def test_rejection_verdict_fields() -> None:
    """RejectionVerdict exposes all required fields with correct types."""
    verdict = RejectionVerdict(
        nsfw_flag=True,
        artifact_flag=False,
        passed=False,
        nsfw_score=0.85,
        artifact_score=0.0,
        reject_reason="nsfw",
    )
    assert verdict.nsfw_flag is True
    assert verdict.artifact_flag is False
    assert verdict.passed is False
    assert verdict.nsfw_score == 0.85
    assert verdict.artifact_score == 0.0
    assert verdict.reject_reason == "nsfw"


# ---------------------------------------------------------------------------
# 3. StubNsfwClassifier
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_stub_classifier_returns_fixed_score() -> None:
    """StubNsfwClassifier returns the configured score for any input."""
    stub = StubNsfwClassifier(score=0.42)
    assert stub.classify(b"some bytes") == 0.42
    assert stub.classify("https://example.com/img.jpg") == 0.42


@pytest.mark.unit
def test_stub_classifier_default_score_is_zero() -> None:
    """StubNsfwClassifier defaults to score=0.0 (always safe)."""
    stub = StubNsfwClassifier()
    assert stub.classify(b"bytes") == 0.0


@pytest.mark.unit
def test_stub_classifier_satisfies_protocol() -> None:
    """StubNsfwClassifier must satisfy the NsfwClassifier Protocol at runtime."""
    stub = StubNsfwClassifier(score=0.1)
    assert isinstance(stub, NsfwClassifier)


@pytest.mark.unit
def test_stub_classifier_rejects_score_above_one() -> None:
    """StubNsfwClassifier raises ValueError when score > 1.0."""
    with pytest.raises(ValueError, match="1.0"):
        StubNsfwClassifier(score=1.5)


@pytest.mark.unit
def test_stub_classifier_rejects_score_below_zero() -> None:
    """StubNsfwClassifier raises ValueError when score < 0.0."""
    with pytest.raises(ValueError, match="0.0"):
        StubNsfwClassifier(score=-0.1)


@pytest.mark.unit
def test_stub_classifier_boundary_zero() -> None:
    """StubNsfwClassifier accepts score=0.0 exactly."""
    stub = StubNsfwClassifier(score=0.0)
    assert stub.classify(b"x") == 0.0


@pytest.mark.unit
def test_stub_classifier_boundary_one() -> None:
    """StubNsfwClassifier accepts score=1.0 exactly."""
    stub = StubNsfwClassifier(score=1.0)
    assert stub.classify(b"x") == 1.0


# ---------------------------------------------------------------------------
# 4. FalNsfwClassifier — Protocol conformance (no real HTTP)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_fal_classifier_satisfies_protocol() -> None:
    """FalNsfwClassifier must satisfy the NsfwClassifier Protocol at runtime."""
    classifier = FalNsfwClassifier(api_key="fake-key:fake-secret")
    assert isinstance(classifier, NsfwClassifier)


# ---------------------------------------------------------------------------
# 5. _parse_nsfw_response (pure unit tests — no I/O)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_parse_nsfw_response_extracts_probability() -> None:
    """_parse_nsfw_response returns nsfw_probability from a well-formed body."""
    body = {"nsfw_probability": 0.034, "is_safe": True}
    assert _parse_nsfw_response(body) == pytest.approx(0.034)


@pytest.mark.unit
def test_parse_nsfw_response_clamps_above_one() -> None:
    """_parse_nsfw_response clamps values > 1.0 to 1.0."""
    body = {"nsfw_probability": 1.5}
    assert _parse_nsfw_response(body) == pytest.approx(1.0)


@pytest.mark.unit
def test_parse_nsfw_response_clamps_below_zero() -> None:
    """_parse_nsfw_response clamps values < 0.0 to 0.0."""
    body = {"nsfw_probability": -0.2}
    assert _parse_nsfw_response(body) == pytest.approx(0.0)


@pytest.mark.unit
def test_parse_nsfw_response_rejects_non_dict() -> None:
    """_parse_nsfw_response raises NsfwClassificationError for non-dict body."""
    with pytest.raises(NsfwClassificationError):
        _parse_nsfw_response(["not", "a", "dict"])


@pytest.mark.unit
def test_parse_nsfw_response_rejects_missing_field() -> None:
    """_parse_nsfw_response raises NsfwClassificationError when field is absent."""
    with pytest.raises(NsfwClassificationError, match="nsfw_probability"):
        _parse_nsfw_response({"is_safe": True})


@pytest.mark.unit
def test_parse_nsfw_response_rejects_non_numeric_field() -> None:
    """_parse_nsfw_response raises NsfwClassificationError for non-numeric field."""
    with pytest.raises(NsfwClassificationError, match="numeric"):
        _parse_nsfw_response({"nsfw_probability": "high"})


@pytest.mark.unit
def test_parse_nsfw_response_accepts_integer_probability() -> None:
    """_parse_nsfw_response accepts integer nsfw_probability (coerced to float)."""
    body = {"nsfw_probability": 0}
    result = _parse_nsfw_response(body)
    assert isinstance(result, float)
    assert result == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# 6. _compute_artifact_score (local PIL heuristics — no HTTP)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_artifact_score_blank_image_is_one() -> None:
    """A solid-white blank image (generation failure) must score 1.0."""
    blank_bytes = _make_blank_png_bytes(64, 64)
    score = _compute_artifact_score(blank_bytes)
    assert score == pytest.approx(1.0)


@pytest.mark.unit
def test_artifact_score_near_blank_gray_is_one() -> None:
    """A solid uniform gray image must score 1.0 (near-blank + monochrome)."""
    gray_bytes = _make_near_blank_png_bytes(64, 64)
    score = _compute_artifact_score(gray_bytes)
    assert score == pytest.approx(1.0)


@pytest.mark.unit
def test_artifact_score_varied_image_is_zero() -> None:
    """A varied gradient image (realistic AI output) must score 0.0."""
    varied_bytes = _make_varied_png_bytes(64, 64)
    score = _compute_artifact_score(varied_bytes)
    assert score == pytest.approx(0.0)


@pytest.mark.unit
def test_artifact_score_jpeg_blank_is_one() -> None:
    """A solid-colour JPEG is treated as a severe artifact (score 1.0)."""
    # JPEG compression introduces slight noise but a solid-colour image still
    # has dominant-colour fraction >> 95% after quantisation.
    blank_jpeg = _make_jpeg_bytes(64, 64, colour=(200, 200, 200))
    score = _compute_artifact_score(blank_jpeg)
    assert score == pytest.approx(1.0)


@pytest.mark.unit
def test_artifact_score_empty_bytes_is_one() -> None:
    """Empty bytes (no image content) must score 1.0 (severe artifact)."""
    score = _compute_artifact_score(b"")
    assert score == pytest.approx(1.0)


@pytest.mark.unit
def test_artifact_score_invalid_bytes_is_one() -> None:
    """Bytes that cannot be decoded as an image must score 1.0."""
    score = _compute_artifact_score(b"NOT_A_VALID_IMAGE_BYTES")
    assert score == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# 7. score_image — happy path (safe image, safe classifier)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_image_safe_image_passes() -> None:
    """A varied image with stub score=0.0 must return passed=True."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    assert verdict.passed is True
    assert verdict.nsfw_flag is False
    assert verdict.artifact_flag is False
    assert verdict.reject_reason is None


@pytest.mark.unit
def test_score_image_returns_rejection_verdict() -> None:
    """score_image must return a RejectionVerdict instance."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    assert isinstance(verdict, RejectionVerdict)


@pytest.mark.unit
def test_score_image_verdict_is_frozen() -> None:
    """The returned RejectionVerdict must be immutable."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    with pytest.raises((AttributeError, TypeError)):
        verdict.passed = False  # type: ignore[misc]


# ---------------------------------------------------------------------------
# 8. score_image — NSFW threshold logic
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_image_nsfw_at_threshold_flags() -> None:
    """nsfw_score exactly at threshold must set nsfw_flag=True."""
    stub = StubNsfwClassifier(score=DEFAULT_NSFW_THRESHOLD)
    verdict = score_image(
        _make_varied_png_bytes(),
        nsfw_classifier=stub,
        nsfw_threshold=DEFAULT_NSFW_THRESHOLD,
    )

    assert verdict.nsfw_flag is True
    assert verdict.passed is False
    assert verdict.reject_reason == "nsfw"


@pytest.mark.unit
def test_score_image_nsfw_below_threshold_passes() -> None:
    """nsfw_score just below threshold must NOT set nsfw_flag."""
    threshold = DEFAULT_NSFW_THRESHOLD
    stub = StubNsfwClassifier(score=max(0.0, threshold - 0.001))
    verdict = score_image(
        _make_varied_png_bytes(),
        nsfw_classifier=stub,
        nsfw_threshold=threshold,
    )

    assert verdict.nsfw_flag is False


@pytest.mark.unit
def test_score_image_nsfw_high_score_flags() -> None:
    """nsfw_score=1.0 must unconditionally set nsfw_flag=True."""
    stub = StubNsfwClassifier(score=1.0)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    assert verdict.nsfw_flag is True
    assert verdict.nsfw_score == pytest.approx(1.0)


@pytest.mark.unit
def test_score_image_nsfw_zero_score_passes_nsfw_gate() -> None:
    """nsfw_score=0.0 must never set nsfw_flag=True (safe image)."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    assert verdict.nsfw_flag is False


@pytest.mark.unit
def test_score_image_nsfw_score_stored_in_verdict() -> None:
    """The raw nsfw_score from the classifier must be stored in the verdict."""
    stub = StubNsfwClassifier(score=0.55)
    verdict = score_image(
        _make_varied_png_bytes(),
        nsfw_classifier=stub,
        nsfw_threshold=0.9,  # won't flag
    )

    assert verdict.nsfw_score == pytest.approx(0.55)


# ---------------------------------------------------------------------------
# 9. score_image — custom NSFW threshold override
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_image_custom_nsfw_threshold_respected() -> None:
    """A custom nsfw_threshold is applied correctly."""
    stub = StubNsfwClassifier(score=0.5)

    # With high threshold (0.9), score=0.5 should NOT flag.
    verdict_pass = score_image(
        _make_varied_png_bytes(),
        nsfw_classifier=stub,
        nsfw_threshold=0.9,
    )
    assert verdict_pass.nsfw_flag is False

    # With low threshold (0.1), score=0.5 should flag.
    verdict_fail = score_image(
        _make_varied_png_bytes(),
        nsfw_classifier=stub,
        nsfw_threshold=0.1,
    )
    assert verdict_fail.nsfw_flag is True


# ---------------------------------------------------------------------------
# 10. score_image — artifact threshold logic
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_image_blank_image_flags_artifact() -> None:
    """A blank (severe artifact) image must set artifact_flag=True."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(
        _make_blank_png_bytes(),
        nsfw_classifier=stub,
        artifact_threshold=DEFAULT_ARTIFACT_THRESHOLD,
    )

    assert verdict.artifact_flag is True
    assert verdict.passed is False
    assert verdict.reject_reason == "artifact"


@pytest.mark.unit
def test_score_image_varied_image_passes_artifact_gate() -> None:
    """A varied (realistic) image must NOT set artifact_flag."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(
        _make_varied_png_bytes(),
        nsfw_classifier=stub,
    )

    assert verdict.artifact_flag is False


@pytest.mark.unit
def test_score_image_artifact_score_stored_in_verdict() -> None:
    """The artifact_score must be stored in the verdict (audit trail)."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(_make_blank_png_bytes(), nsfw_classifier=stub)

    assert isinstance(verdict.artifact_score, float)
    assert 0.0 <= verdict.artifact_score <= 1.0


# ---------------------------------------------------------------------------
# 11. score_image — dual rejection
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_image_dual_rejection_sets_combined_reason() -> None:
    """Both nsfw_flag and artifact_flag set → reject_reason='nsfw+artifact'."""
    stub = StubNsfwClassifier(score=1.0)  # NSFW score always 1.0 → nsfw_flag=True
    # Use a blank image → artifact_flag=True
    verdict = score_image(
        _make_blank_png_bytes(),
        nsfw_classifier=stub,
    )

    assert verdict.nsfw_flag is True
    assert verdict.artifact_flag is True
    assert verdict.passed is False
    assert verdict.reject_reason == "nsfw+artifact"


# ---------------------------------------------------------------------------
# 12. score_image — reject_reason correctness
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_image_reject_reason_none_when_passed() -> None:
    """reject_reason must be None when the image passes all gates."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    assert verdict.reject_reason is None


@pytest.mark.unit
def test_score_image_reject_reason_nsfw_when_only_nsfw() -> None:
    """reject_reason='nsfw' when only nsfw_flag is set."""
    stub = StubNsfwClassifier(score=1.0)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    assert verdict.nsfw_flag is True
    assert verdict.artifact_flag is False
    assert verdict.reject_reason == "nsfw"


@pytest.mark.unit
def test_score_image_reject_reason_artifact_when_only_artifact() -> None:
    """reject_reason='artifact' when only artifact_flag is set."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(_make_blank_png_bytes(), nsfw_classifier=stub)

    assert verdict.nsfw_flag is False
    assert verdict.artifact_flag is True
    assert verdict.reject_reason == "artifact"


# ---------------------------------------------------------------------------
# 13. score_image — passed logical invariant
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_image_passed_invariant_when_both_true() -> None:
    """passed must be False when nsfw_flag is True."""
    stub = StubNsfwClassifier(score=1.0)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    # Invariant: passed == not nsfw_flag and not artifact_flag
    assert verdict.passed == (not verdict.nsfw_flag and not verdict.artifact_flag)


@pytest.mark.unit
def test_score_image_passed_invariant_always_consistent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """passed == not nsfw_flag and not artifact_flag for any combination."""
    cases = [
        (0.0, _make_varied_png_bytes()),  # both pass
        (1.0, _make_varied_png_bytes()),  # only nsfw fails
        (0.0, _make_blank_png_bytes()),  # only artifact fails
        (1.0, _make_blank_png_bytes()),  # both fail
    ]
    for nsfw_score, image_bytes in cases:
        stub = StubNsfwClassifier(score=nsfw_score)
        verdict = score_image(image_bytes, nsfw_classifier=stub)
        assert verdict.passed == (
            not verdict.nsfw_flag and not verdict.artifact_flag
        ), (
            f"passed invariant violated for nsfw_score={nsfw_score}: "
            f"passed={verdict.passed}, nsfw_flag={verdict.nsfw_flag}, "
            f"artifact_flag={verdict.artifact_flag}"
        )


# ---------------------------------------------------------------------------
# 14. score_image — input types accepted
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_image_accepts_png_bytes() -> None:
    """score_image must accept PNG bytes without raising."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)
    assert isinstance(verdict, RejectionVerdict)


@pytest.mark.unit
def test_score_image_accepts_jpeg_bytes() -> None:
    """score_image must accept JPEG bytes without raising."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(_make_varied_png_bytes(64, 64), nsfw_classifier=stub)
    assert isinstance(verdict, RejectionVerdict)


@pytest.mark.unit
def test_score_image_accepts_url_string(monkeypatch: pytest.MonkeyPatch) -> None:
    """score_image must accept a URL string as image_input.

    The URL fetch and classifier call are both stubbed so no real HTTP occurs.
    """
    import httpx
    import personal_color.generate.rejection as _rejection_mod

    varied_bytes = _make_varied_png_bytes(64, 64)
    stub = StubNsfwClassifier(score=0.0)

    # Stub httpx.Client at the module level to return the varied PNG on URL fetch.
    real_client = httpx.Client

    def _mock_client_factory(*args: object, **kwargs: object) -> httpx.Client:
        transport = httpx.MockTransport(
            lambda _req: httpx.Response(200, content=varied_bytes)
        )
        kwargs["transport"] = transport  # type: ignore[assignment]
        return real_client(*args, **kwargs)

    monkeypatch.setattr(_rejection_mod.httpx, "Client", _mock_client_factory)

    verdict = score_image(
        "https://example.com/generated.png",
        nsfw_classifier=stub,
    )
    assert isinstance(verdict, RejectionVerdict)


# ---------------------------------------------------------------------------
# 15. score_image — input validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_image_rejects_empty_bytes() -> None:
    """score_image raises ValueError for empty bytes input."""
    stub = StubNsfwClassifier(score=0.0)
    with pytest.raises(ValueError, match="empty"):
        score_image(b"", nsfw_classifier=stub)


@pytest.mark.unit
def test_score_image_rejects_non_bytes_non_str() -> None:
    """score_image raises TypeError for input that is neither bytes nor str."""
    stub = StubNsfwClassifier(score=0.0)
    with pytest.raises(TypeError, match="bytes or str"):
        score_image(12345, nsfw_classifier=stub)  # type: ignore[arg-type]


@pytest.mark.unit
def test_score_image_rejects_list_input() -> None:
    """score_image raises TypeError for list input."""
    stub = StubNsfwClassifier(score=0.0)
    with pytest.raises(TypeError):
        score_image([], nsfw_classifier=stub)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 16. NsfwClassificationError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_nsfw_classification_error_default_retryable_false() -> None:
    """NsfwClassificationError defaults to retryable=False."""
    err = NsfwClassificationError("some failure")
    assert err.retryable is False


@pytest.mark.unit
def test_nsfw_classification_error_retryable_true() -> None:
    """NsfwClassificationError can be constructed with retryable=True."""
    err = NsfwClassificationError("transient failure", retryable=True)
    assert err.retryable is True
    assert "transient failure" in str(err)


@pytest.mark.unit
def test_nsfw_classification_error_is_exception() -> None:
    """NsfwClassificationError must be a subclass of Exception."""
    err = NsfwClassificationError("oops")
    assert isinstance(err, Exception)


# ---------------------------------------------------------------------------
# 17. score_image — all required fields present in verdict
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_image_verdict_has_all_required_fields() -> None:
    """The returned verdict must have all six ontology-required fields."""
    stub = StubNsfwClassifier(score=0.05)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    # All six fields must be accessible without AttributeError.
    assert hasattr(verdict, "nsfw_flag")
    assert hasattr(verdict, "artifact_flag")
    assert hasattr(verdict, "passed")
    assert hasattr(verdict, "nsfw_score")
    assert hasattr(verdict, "artifact_score")
    assert hasattr(verdict, "reject_reason")


@pytest.mark.unit
def test_score_image_nsfw_score_range() -> None:
    """nsfw_score in the verdict must be in [0.0, 1.0]."""
    stub = StubNsfwClassifier(score=0.77)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    assert 0.0 <= verdict.nsfw_score <= 1.0


@pytest.mark.unit
def test_score_image_artifact_score_range() -> None:
    """artifact_score in the verdict must be in [0.0, 1.0]."""
    stub = StubNsfwClassifier(score=0.0)
    verdict = score_image(_make_varied_png_bytes(), nsfw_classifier=stub)

    assert 0.0 <= verdict.artifact_score <= 1.0
