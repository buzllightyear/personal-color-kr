"""Pydantic v2 response models for the apps/api HTTP boundary (Phase 4.1).

This package owns the single response surface for the `/v1/diagnose` endpoint —
``DiagnoseResponse``. The schema mirrors the 9-field
``personal_color.diagnosis_orchestrator.DiagnosisResult`` dataclass and is the
exclusive conversion seam between the Phase 3.2 dataclass and the JSON body
returned by FastAPI.

Boundary invariants (Phase 4.1 Seed):
    - Construction of a ``DiagnoseResponse`` from a ``DiagnosisResult`` goes
      through ``DiagnoseResponse.from_dataclass`` exclusively. Raw
      ``DiagnosisResult`` instances are never returned from a handler.
    - The model rejects extra fields (``model_config = {"extra": "forbid"}``)
      so accidental schema drift surfaces as a 422 in tests, not as a silent
      pass-through.
    - Enum fields (season, tone, contrast) are serialized as their wire-format
      strings — ``Season.slug``, ``Tone.name.lower()``, ``Contrast.name.lower()``.
"""

from api.schemas.diagnose import DiagnoseResponse

__all__ = ["DiagnoseResponse"]
