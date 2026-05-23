"""``POST /v1/diagnose`` route handler (Sub-AC 5.3).

This module owns the single HTTP entry point for the personal-color diagnosis
pipeline. The handler composes three independently testable seams that were
added in earlier sub-ACs:

    1. ``api.dependencies.selfie_validation.validate_selfie_upload`` (Sub-AC 5.2)
       — multipart parsing + content-type + size validation. Runs before
       any pipeline call; rejects unsupported MIME types (HTTP 415) and
       oversize bodies (HTTP 413).
    2. ``api.dependencies.diagnose.get_diagnose_fn`` (Sub-AC 5.3) — the
       Depends-injectable diagnose callable. Defaults to Phase 3.2's
       ``diagnose_personal_color``; unit tests override it via
       ``app.dependency_overrides[get_diagnose_fn] = lambda: stub_fn``.
    3. ``api.schemas.diagnose.DiagnoseResponse.from_dataclass`` (Sub-AC 5.1)
       — the *only* documented surface for projecting the 9-field
       ``DiagnosisResult`` dataclass onto the wire-format Pydantic v2
       response model.

Phase 4.1 invariants honored here:
    - Zero PII persistence: the selfie bytes live in handler-local memory
      only, are passed by value to ``asyncio.to_thread``, never written to
      disk, never logged, never embedded in any exception detail.
    - Sync-in-async correctness: the CPU-bound pipeline call is offloaded to
      a worker thread via ``await asyncio.to_thread(diagnose_fn, bytes)`` so
      the event loop is never blocked. The handler MUST NOT call ``diagnose_fn``
      directly on the event-loop thread.
    - Single response surface: the route declares
      ``response_model=DiagnoseResponse`` and constructs the model through
      ``DiagnoseResponse.from_dataclass``. Raw ``DiagnosisResult`` is never
      returned from a handler and never embedded in a ``JSONResponse``.
    - Error mapping (Phase 3.2 docstring contract honored verbatim):
        * ``InvalidSelfieError`` → HTTP 400 ``{"detail": "invalid_selfie"}``
        * ``FaceNotDetectedError`` → HTTP 422 ``{"detail": "face_not_detected"}``
        * Any other exception → HTTP 500 ``{"detail": "internal_error"}``
          with no traceback leakage.
    - No ``sqlalchemy*`` imports here (DB boundary lives in ``api.db.*``).
    - No Fal.ai vendor-key reference here (deferred to Phase 4.4+).
    - No authentication dependencies (Apple Sign In deferred to Phase 4.3).
"""

from __future__ import annotations

import asyncio
from typing import Final

from fastapi import APIRouter, Depends, HTTPException, status

from api.dependencies.diagnose import DiagnoseFn, get_diagnose_fn
from api.dependencies.selfie_validation import validate_selfie_upload
from api.schemas.diagnose import DiagnoseResponse
from personal_color.face_detector import FaceNotDetectedError
from personal_color.image_decoder import InvalidSelfieError

# ---------------------------------------------------------------------------
# Wire constants — error detail strings (Seed-pinned)
# ---------------------------------------------------------------------------

#: HTTP 400 detail for an invalid (un-decodable, truncated, empty, wrong-type)
#: selfie payload. The constant is exported so error-mapping tests can compare
#: against the same identifier the handler raises with.
DETAIL_INVALID_SELFIE: Final[str] = "invalid_selfie"

#: HTTP 422 detail for a valid image where no face was detected. Maps the
#: Phase 3.2 ``FaceNotDetectedError`` to its documented HTTP code.
DETAIL_FACE_NOT_DETECTED: Final[str] = "face_not_detected"

#: HTTP 500 detail for any other unexpected exception. Stays a stable wire
#: constant so the response body never leaks driver names, tracebacks, or
#: PII derived from the request payload.
DETAIL_INTERNAL_ERROR: Final[str] = "internal_error"


# ---------------------------------------------------------------------------
# Router definition
# ---------------------------------------------------------------------------

#: Router that hosts the ``POST /v1/diagnose`` endpoint. The prefix is applied
#: by ``api.main.create_app`` (``app.include_router(router, prefix="/v1")``)
#: so this module is decoupled from the version namespace.
router: APIRouter = APIRouter(tags=["diagnose"])


@router.post(
    "/diagnose",
    response_model=DiagnoseResponse,
    status_code=status.HTTP_200_OK,
    summary="Run personal-color diagnosis on a selfie",
    description=(
        "Accepts a single multipart-form ``selfie`` field (JPEG or PNG, "
        "≤ 10 MiB) and returns the 9-field ``DiagnosisResult`` projected "
        "onto the wire-format ``DiagnoseResponse`` schema. The CPU-bound "
        "diagnosis pipeline runs inside ``asyncio.to_thread`` so the event "
        "loop is never blocked."
    ),
)
async def post_diagnose(
    selfie_bytes: bytes = Depends(validate_selfie_upload),
    diagnose_fn: DiagnoseFn = Depends(get_diagnose_fn),
) -> DiagnoseResponse:
    """Diagnose a selfie payload and return the 9-field result.

    The handler offloads the synchronous, CPU-bound pipeline call to a
    worker thread via ``asyncio.to_thread`` and projects the returned
    ``DiagnosisResult`` dataclass onto a Pydantic v2 ``DiagnoseResponse``
    through the single documented conversion seam
    (``DiagnoseResponse.from_dataclass``).

    Parameters
    ----------
    selfie_bytes:
        Validated selfie bytes from ``validate_selfie_upload`` (multipart
        parse + content-type + size check already enforced).
    diagnose_fn:
        Diagnosis callable obtained from the Depends-injectable provider
        ``get_diagnose_fn``. Default is Phase 3.2's
        ``diagnose_personal_color``; unit tests substitute a stub via
        ``app.dependency_overrides``.

    Returns
    -------
    DiagnoseResponse
        The HTTP 200 body — a Pydantic v2 model serializing all nine
        fields of the ``DiagnosisResult`` dataclass with enum members
        projected onto wire-format string slugs.

    Raises
    ------
    HTTPException
        * 400 ``{"detail": "invalid_selfie"}`` — the pipeline raised
          :class:`InvalidSelfieError` (un-decodable bytes).
        * 422 ``{"detail": "face_not_detected"}`` — the pipeline raised
          :class:`FaceNotDetectedError`.
        * 500 ``{"detail": "internal_error"}`` — any other exception.
    """
    # Run the CPU-bound pipeline in a worker thread. ``asyncio.to_thread``
    # accepts positional args and forwards them by reference, so the bytes
    # object is shared (not copied) between the handler's stack frame and
    # the worker. The worker call is awaited so the event loop is free to
    # service other requests while MediaPipe / Pillow do their work.
    try:
        result = await asyncio.to_thread(diagnose_fn, selfie_bytes)
    except InvalidSelfieError as exc:
        # Phase 3.2 docstring: "Phase 4 maps to HTTP 400". The detail is a
        # stable wire constant — never the exception message, never the
        # selfie bytes.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=DETAIL_INVALID_SELFIE,
        ) from exc
    except FaceNotDetectedError as exc:
        # Phase 3.2 docstring: "Phase 4 maps to HTTP 422".
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=DETAIL_FACE_NOT_DETECTED,
        ) from exc
    except Exception as exc:
        # Catch-all that converts unexpected exceptions to a stable HTTP
        # 500 response. The detail is a stable wire constant — no
        # exception message, no traceback, no driver string. This matches
        # the Seed's "no traceback leakage" invariant.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=DETAIL_INTERNAL_ERROR,
        ) from exc

    # Project the dataclass onto the Pydantic v2 response model through
    # the single documented conversion seam. ``response_model`` on the
    # decorator enforces the wire shape via Pydantic validation; the
    # ``from_dataclass`` call centralizes the enum-to-slug mapping.
    return DiagnoseResponse.from_dataclass(result)
