"""``DiagnoseResponse`` — Pydantic v2 response model for ``POST /v1/diagnose``.

This module is the *single* response surface that converts the Phase 3.2
``DiagnosisResult`` dataclass into a JSON body returned by FastAPI. The Seed
contract pins the response shape to exactly nine fields — the same nine the
dataclass exposes — and pins the enum wire-format to lowercase ASCII slugs.

Design notes (Phase 4.1 Seed):
    - The model is declared with ``extra="forbid"`` so any drift between the
      dataclass and this schema (an added field on either side) surfaces as
      a validation error in the unit tier instead of silently round-tripping.
    - ``DiagnoseResponse.from_dataclass`` is the *only* documented surface for
      constructing the response. Handlers must not construct ``DiagnoseResponse``
      with raw keyword arguments derived from a ``DiagnosisResult`` — they
      always go through the classmethod so the enum-to-wire mapping lives in
      one place.
    - ``season`` uses ``Season.slug`` (e.g. ``"spring"``) — never the Korean
      label. The Korean label is a mobile-side concern (Phase 3.3 contracts).
    - ``tone`` uses ``Tone.name.lower()``: WARM → ``"warm"``, COOL → ``"cool"``.
      ``DiagnosisResult.tone`` is committed to WARM or COOL by the orchestrator
      so NEUTRAL never reaches this boundary.
    - ``contrast`` uses ``Contrast.name.lower()``: HIGH → ``"high"``,
      LOW → ``"low"``.

The module imports the dataclass and enums lazily at module scope so a static
type check (``mypy --strict``) verifies the field types against the upstream
Phase 3.2 contract at build time.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from personal_color.diagnosis_orchestrator import DiagnosisResult


class DiagnoseResponse(BaseModel):
    """JSON response body for ``POST /v1/diagnose``.

    Mirrors the nine fields of
    ``personal_color.diagnosis_orchestrator.DiagnosisResult`` with enum
    members projected onto their wire-format string slugs.

    Attributes
    ----------
    season:
        The 4-category Korean personal-color verdict serialized via
        ``Season.slug`` — one of ``"spring" | "summer" | "autumn" | "winter"``.
    confidence:
        Overall confidence in ``season`` in ``[0.0, 1.0]``.
    tone:
        Warm/cool undertone serialized via ``Tone.name.lower()`` — one of
        ``"warm" | "cool"``. NEUTRAL is never surfaced by the orchestrator.
    contrast:
        Contrast verdict serialized via ``Contrast.name.lower()`` — one of
        ``"high" | "low"``.
    tone_confidence:
        Per-axis tone confidence in ``[0.0, 1.0]``.
    contrast_confidence:
        Per-axis contrast confidence in ``[0.0, 1.0]``.
    skin_luma:
        Rec. 601 luma of the skin region color in ``[0.0, 1.0]``.
    hair_luma:
        Rec. 601 luma of the hair region color in ``[0.0, 1.0]``.
    eyes_luma:
        Rec. 601 luma of the eyes region color in ``[0.0, 1.0]``.
    """

    # ``extra="forbid"`` makes accidental drift between the dataclass and this
    # schema a hard validation error rather than a silent pass-through. The
    # explicit forbiddance is what the Seed AC asserts in the unit tests.
    model_config = ConfigDict(extra="forbid")

    season: str
    confidence: float
    tone: str
    contrast: str
    tone_confidence: float
    contrast_confidence: float
    skin_luma: float
    hair_luma: float
    eyes_luma: float

    @classmethod
    def from_dataclass(cls, result: DiagnosisResult) -> DiagnoseResponse:
        """Project a ``DiagnosisResult`` onto a ``DiagnoseResponse``.

        This is the *only* documented construction surface for the response
        model. Handlers always call this method; raw keyword construction is
        reserved for tests that need to assert validation behavior.

        Parameters
        ----------
        result:
            The Phase 3.2 ``DiagnosisResult`` dataclass instance produced by
            ``diagnose_personal_color``.

        Returns
        -------
        DiagnoseResponse
            A validated response model with all nine fields populated.
        """
        return cls(
            season=result.season.slug,
            confidence=result.confidence,
            tone=result.tone.name.lower(),
            contrast=result.contrast.name.lower(),
            tone_confidence=result.tone_confidence,
            contrast_confidence=result.contrast_confidence,
            skin_luma=result.skin_luma,
            hair_luma=result.hair_luma,
            eyes_luma=result.eyes_luma,
        )
