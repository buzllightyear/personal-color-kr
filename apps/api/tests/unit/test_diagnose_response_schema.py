"""Unit tests for ``api.schemas.diagnose.DiagnoseResponse`` (Sub-AC 5.1).

The schema is the *single* response surface for ``POST /v1/diagnose`` and must:

1. Expose **exactly** the nine fields that ``DiagnosisResult`` exposes:
   ``season, confidence, tone, contrast, tone_confidence, contrast_confidence,
   skin_luma, hair_luma, eyes_luma``.
2. Accept a well-formed payload that matches the wire-format slugs.
3. **Reject missing fields** — any of the nine omitted → ``ValidationError``.
4. **Reject extra fields** — the model is configured with ``extra="forbid"``.
5. Round-trip ``DiagnosisResult`` → ``DiagnoseResponse`` correctly via the
   single ``DiagnoseResponse.from_dataclass`` construction seam, projecting
   enums onto wire-format strings (``Season.slug``, ``Tone.name.lower()``,
   ``Contrast.name.lower()``).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.schemas.diagnose import DiagnoseResponse
from personal_color.contrast_classifier import Contrast
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.season_classifier import Season
from personal_color.tone_classifier import Tone

# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


# The canonical nine-field payload used across the "happy path" assertions.
# Field order matches ``DiagnosisResult`` field order for ease of reading.
VALID_PAYLOAD: dict[str, object] = {
    "season": "spring",
    "confidence": 0.82,
    "tone": "warm",
    "contrast": "high",
    "tone_confidence": 0.9,
    "contrast_confidence": 0.75,
    "skin_luma": 0.7,
    "hair_luma": 0.15,
    "eyes_luma": 0.2,
}


def _make_diagnosis_result(
    *,
    season: Season = Season.SPRING,
    tone: Tone = Tone.WARM,
    contrast: Contrast = Contrast.HIGH,
) -> DiagnosisResult:
    """Build a ``DiagnosisResult`` instance with deterministic float fields.

    The float fields are arbitrary but distinct so a swap (e.g. ``skin_luma``
    accidentally aliased to ``hair_luma``) is caught by the round-trip test.
    """
    return DiagnosisResult(
        season=season,
        confidence=0.82,
        tone=tone,
        contrast=contrast,
        tone_confidence=0.9,
        contrast_confidence=0.75,
        skin_luma=0.7,
        hair_luma=0.15,
        eyes_luma=0.2,
    )


# ---------------------------------------------------------------------------
# Field exhaustiveness
# ---------------------------------------------------------------------------


class TestFieldExhaustiveness:
    """The schema must define exactly the nine DiagnosisResult fields."""

    EXPECTED_FIELDS: frozenset[str] = frozenset(
        {
            "season",
            "confidence",
            "tone",
            "contrast",
            "tone_confidence",
            "contrast_confidence",
            "skin_luma",
            "hair_luma",
            "eyes_luma",
        },
    )

    def test_model_fields_exactly_match_expected_set(self) -> None:
        """``model_fields`` keys must equal the canonical nine-field set."""
        actual_fields = frozenset(DiagnoseResponse.model_fields.keys())
        assert actual_fields == self.EXPECTED_FIELDS, (
            f"DiagnoseResponse.model_fields drift: "
            f"unexpected={actual_fields - self.EXPECTED_FIELDS}, "
            f"missing={self.EXPECTED_FIELDS - actual_fields}"
        )

    def test_model_has_exactly_nine_fields(self) -> None:
        """Field count = 9 (paranoia check independent of name set)."""
        assert len(DiagnoseResponse.model_fields) == 9

    @pytest.mark.parametrize(
        ("field_name", "expected_annotation"),
        [
            ("season", str),
            ("confidence", float),
            ("tone", str),
            ("contrast", str),
            ("tone_confidence", float),
            ("contrast_confidence", float),
            ("skin_luma", float),
            ("hair_luma", float),
            ("eyes_luma", float),
        ],
    )
    def test_field_annotation(
        self,
        field_name: str,
        expected_annotation: type,
    ) -> None:
        """Each field's declared annotation matches the Seed contract."""
        assert (
            DiagnoseResponse.model_fields[field_name].annotation is expected_annotation
        )


# ---------------------------------------------------------------------------
# Validation: accept valid payload
# ---------------------------------------------------------------------------


class TestAcceptsValidPayload:
    """A complete, well-typed payload validates and survives serialization."""

    def test_valid_payload_constructs_successfully(self) -> None:
        response = DiagnoseResponse(**VALID_PAYLOAD)  # type: ignore[arg-type]

        assert response.season == "spring"
        assert response.confidence == pytest.approx(0.82)
        assert response.tone == "warm"
        assert response.contrast == "high"
        assert response.tone_confidence == pytest.approx(0.9)
        assert response.contrast_confidence == pytest.approx(0.75)
        assert response.skin_luma == pytest.approx(0.7)
        assert response.hair_luma == pytest.approx(0.15)
        assert response.eyes_luma == pytest.approx(0.2)

    def test_model_dump_round_trips_to_original_payload(self) -> None:
        """``model_dump()`` returns a dict equal to the input payload."""
        response = DiagnoseResponse(**VALID_PAYLOAD)  # type: ignore[arg-type]
        dumped = response.model_dump()
        assert dumped == VALID_PAYLOAD


# ---------------------------------------------------------------------------
# Validation: reject missing fields
# ---------------------------------------------------------------------------


class TestRejectsMissingFields:
    """Each of the nine fields is required — omitting any → ValidationError."""

    @pytest.mark.parametrize(
        "missing_field",
        [
            "season",
            "confidence",
            "tone",
            "contrast",
            "tone_confidence",
            "contrast_confidence",
            "skin_luma",
            "hair_luma",
            "eyes_luma",
        ],
    )
    def test_missing_field_raises_validation_error(
        self,
        missing_field: str,
    ) -> None:
        """Removing ``missing_field`` from a valid payload must fail."""
        payload = {k: v for k, v in VALID_PAYLOAD.items() if k != missing_field}

        with pytest.raises(ValidationError) as exc_info:
            DiagnoseResponse(**payload)  # type: ignore[arg-type]

        # The missing field's name appears in at least one error location.
        error_locations = {
            loc for err in exc_info.value.errors() for loc in err.get("loc", ())
        }
        assert missing_field in error_locations


# ---------------------------------------------------------------------------
# Validation: reject extra fields
# ---------------------------------------------------------------------------


class TestRejectsExtraFields:
    """``model_config = {"extra": "forbid"}`` makes drift loud, not silent."""

    def test_single_extra_field_raises_validation_error(self) -> None:
        payload = {**VALID_PAYLOAD, "future_field": "leakage"}

        with pytest.raises(ValidationError) as exc_info:
            DiagnoseResponse(**payload)  # type: ignore[arg-type]

        # The Pydantic v2 error type for forbidden extras is "extra_forbidden".
        error_types = {err["type"] for err in exc_info.value.errors()}
        assert "extra_forbidden" in error_types

    def test_multiple_extra_fields_raise_validation_error(self) -> None:
        payload = {
            **VALID_PAYLOAD,
            "extra_one": 1,
            "extra_two": "value",
        }

        with pytest.raises(ValidationError) as exc_info:
            DiagnoseResponse(**payload)  # type: ignore[arg-type]

        error_locations = {
            loc for err in exc_info.value.errors() for loc in err.get("loc", ())
        }
        assert "extra_one" in error_locations
        assert "extra_two" in error_locations

    def test_raw_korean_label_field_is_rejected(self) -> None:
        """Mobile-side ``koreanLabel`` must never leak into the server response."""
        payload = {**VALID_PAYLOAD, "koreanLabel": "봄"}

        with pytest.raises(ValidationError):
            DiagnoseResponse(**payload)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# from_dataclass: the single construction surface
# ---------------------------------------------------------------------------


class TestFromDataclassRoundTrip:
    """``DiagnoseResponse.from_dataclass`` is the only documented conversion."""

    def test_round_trip_preserves_all_nine_fields(self) -> None:
        """All nine fields land on the response with the expected projections."""
        result = _make_diagnosis_result()
        response = DiagnoseResponse.from_dataclass(result)

        assert response.season == "spring"
        assert response.confidence == pytest.approx(result.confidence)
        assert response.tone == "warm"
        assert response.contrast == "high"
        assert response.tone_confidence == pytest.approx(result.tone_confidence)
        assert response.contrast_confidence == pytest.approx(
            result.contrast_confidence,
        )
        assert response.skin_luma == pytest.approx(result.skin_luma)
        assert response.hair_luma == pytest.approx(result.hair_luma)
        assert response.eyes_luma == pytest.approx(result.eyes_luma)

    def test_returns_diagnose_response_instance(self) -> None:
        result = _make_diagnosis_result()
        response = DiagnoseResponse.from_dataclass(result)
        assert isinstance(response, DiagnoseResponse)

    @pytest.mark.parametrize(
        ("season", "expected_slug"),
        [
            (Season.SPRING, "spring"),
            (Season.SUMMER, "summer"),
            (Season.AUTUMN, "autumn"),
            (Season.WINTER, "winter"),
        ],
    )
    def test_season_serializes_via_slug_for_each_member(
        self,
        season: Season,
        expected_slug: str,
    ) -> None:
        """Season → slug projection (never the Korean label)."""
        result = _make_diagnosis_result(season=season)
        response = DiagnoseResponse.from_dataclass(result)
        assert response.season == expected_slug
        # Defense in depth: the Korean label must not appear in the response.
        assert response.season != season.korean

    @pytest.mark.parametrize(
        ("tone", "expected_wire"),
        [
            (Tone.WARM, "warm"),
            (Tone.COOL, "cool"),
        ],
    )
    def test_tone_serializes_via_name_lowercased(
        self,
        tone: Tone,
        expected_wire: str,
    ) -> None:
        result = _make_diagnosis_result(tone=tone)
        response = DiagnoseResponse.from_dataclass(result)
        assert response.tone == expected_wire

    @pytest.mark.parametrize(
        ("contrast", "expected_wire"),
        [
            (Contrast.HIGH, "high"),
            (Contrast.LOW, "low"),
        ],
    )
    def test_contrast_serializes_via_name_lowercased(
        self,
        contrast: Contrast,
        expected_wire: str,
    ) -> None:
        result = _make_diagnosis_result(contrast=contrast)
        response = DiagnoseResponse.from_dataclass(result)
        assert response.contrast == expected_wire

    def test_model_dump_after_from_dataclass_has_exactly_nine_keys(
        self,
    ) -> None:
        """The serialized JSON body has exactly the nine canonical keys."""
        result = _make_diagnosis_result()
        response = DiagnoseResponse.from_dataclass(result)
        dumped = response.model_dump()

        assert set(dumped.keys()) == {
            "season",
            "confidence",
            "tone",
            "contrast",
            "tone_confidence",
            "contrast_confidence",
            "skin_luma",
            "hair_luma",
            "eyes_luma",
        }
        assert len(dumped) == 9

    def test_field_values_are_not_swapped(self) -> None:
        """Distinct float fields land on the correct attributes (no aliasing)."""
        # The fixture uses distinct floats so any cross-wiring (e.g.
        # ``skin_luma`` written to ``hair_luma``) is detectable.
        result = DiagnosisResult(
            season=Season.WINTER,
            confidence=0.11,
            tone=Tone.COOL,
            contrast=Contrast.HIGH,
            tone_confidence=0.22,
            contrast_confidence=0.33,
            skin_luma=0.44,
            hair_luma=0.55,
            eyes_luma=0.66,
        )

        response = DiagnoseResponse.from_dataclass(result)

        assert response.confidence == pytest.approx(0.11)
        assert response.tone_confidence == pytest.approx(0.22)
        assert response.contrast_confidence == pytest.approx(0.33)
        assert response.skin_luma == pytest.approx(0.44)
        assert response.hair_luma == pytest.approx(0.55)
        assert response.eyes_luma == pytest.approx(0.66)
