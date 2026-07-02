"""``POST /v1/generate`` — end-to-end AI image generation (AC2).

Wires the committed ``personal_color.generate`` backend behind a single
authenticated endpoint:

    selfie + recipe_id
      → load published recipe
      → FalGenerationConfig
      → orchestrate_generation (generate → NSFW/artifact reject → retry, ≤30 s)
      → server-side watermark compositing
      → return the watermarked PNG bytes

Phase invariants honored here:
    - Auth required: ``Depends(require_current_user)`` (Apple Sign In JWT).
    - Zero selfie persistence: bytes live in handler-local memory, passed by
      value to ``asyncio.to_thread``, never logged, never in an error body.
    - Sync-in-async correctness: the CPU/IO-bound generation + watermark calls
      are offloaded via ``asyncio.to_thread`` so the event loop is never blocked.
    - Vendor seam isolation: the fal.ai client + NSFW classifier live behind
      ``Depends(get_generate_runner)`` so tests stub them.
    - Watermark-only egress: the original (pre-watermark) bytes never leave the
      server; only the watermarked PNG is returned.
    - No ``sqlalchemy*`` imports beyond the ``api.db.session`` facade.

Error mapping:
    * unknown / non-published recipe        → 404 ``recipe_not_found``
    * generation budget exhausted (≤30 s)   → 503 ``generation_failed``
    * non-retryable fal.ai vendor error     → 502 ``generation_failed``
    * fal.ai key not configured             → 503 ``generation_unavailable``
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Final

from fastapi import APIRouter, Depends, Form, HTTPException, Response, status

from api.config.env import get_image_ttl_days
from api.db.models.generation import Generation
from api.db.models.recipe import RECIPE_STATUS_PUBLISHED, Recipe
from api.db.models.user import User
from api.db.session import AsyncSession, get_session, select
from api.dependencies.auth import require_current_user
from api.dependencies.garment_validation import validate_optional_garment_upload
from api.dependencies.generate import GenerateRunner, get_generate_runner
from api.dependencies.selfie_validation import validate_selfie_upload
from api.dependencies.storage import get_object_storage
from api.generation.approved_models import is_approved_edit_model, reference_mode_for
from api.generation.personal_color_modifier import strip_unfilled_modifier
from api.observability.generation_metrics import (
    OUTCOME_FAILED,
    OUTCOME_SUCCESS,
    OUTCOME_UNAVAILABLE,
    GenerationMetricsRecorder,
    get_generation_metrics_recorder,
)
from api.storage.object_storage import ObjectStorage
from personal_color.generate.fal_client import (
    FalGenerationConfig,
    FalGenerationError,
    GenerationInputs,
)
from personal_color.generate.orchestrator import GenerationBudgetExhaustedError
from personal_color.generate.watermark import apply_watermark

_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Wire constants
# ---------------------------------------------------------------------------

#: HTTP 404 detail for an unknown recipe id, or a recipe that exists but is not
#: in the ``published`` lifecycle state (hidden / soft-deleted recipes are not
#: generatable). A single opaque detail avoids leaking lifecycle state.
DETAIL_RECIPE_NOT_FOUND: Final[str] = "recipe_not_found"

#: HTTP 503/502 detail for a generation that could not produce a passing
#: candidate within the budget, or a non-retryable vendor failure.
DETAIL_GENERATION_FAILED: Final[str] = "generation_failed"

#: HTTP 503 detail when the fal.ai API key is not configured server-side.
DETAIL_GENERATION_UNAVAILABLE: Final[str] = "generation_unavailable"

#: HTTP 422 detail when a garment photo is sent for a recipe whose model is
#: single-reference (no payload slot for a second image — silently dropping
#: the garment would break the "my garment" product promise, so fail loud).
DETAIL_GARMENT_NOT_SUPPORTED: Final[str] = "garment_not_supported"

#: Response header carrying the number of auto-retries consumed before the
#: accepted candidate (0 = first attempt passed). Useful for client telemetry
#: and the rolling success-rate metric (AC3).
HEADER_RETRY_COUNT: Final[str] = "X-Generation-Retry-Count"

#: Response header carrying the persisted generation id so the client can later
#: fetch the image from the gallery (``GET /v1/gallery/{id}/image``). Absent when
#: persistence failed (the image is still delivered inline).
HEADER_GENERATION_ID: Final[str] = "X-Generation-Id"

router: APIRouter = APIRouter(tags=["generate"])


def _result_image_key(user_id: uuid.UUID, generation_id: uuid.UUID) -> str:
    """Build the object-storage key for a user's watermarked result.

    Keys are composed solely of ``[A-Za-z0-9/.-]`` (UUID hex + ``.png``) so they
    are identity-encoded by the SigV4 canonical-URI rules — see
    :mod:`api.storage.s3_object_storage` for the key-safety invariant.
    """
    return f"generations/{user_id}/{generation_id}.png"


async def _persist_generation(
    *,
    session: AsyncSession,
    storage: ObjectStorage,
    user_id: uuid.UUID,
    recipe_id: str,
    watermarked: bytes,
    retry_count: int,
    now: datetime,
) -> uuid.UUID | None:
    """Store the watermarked bytes + a gallery row. Best-effort.

    The image is *already delivered inline* by the handler, so a storage / DB
    failure here must not fail the request — the gallery simply won't have this
    entry. The failure is logged (never silently swallowed) and ``None`` is
    returned so the handler omits the ``X-Generation-Id`` header.

    Returns
    -------
    uuid.UUID | None
        The new generation id on success, else ``None``.
    """
    generation_id = uuid.uuid4()
    result_key = _result_image_key(user_id, generation_id)
    expires_at = now + timedelta(days=get_image_ttl_days())
    try:
        # ``storage.put`` is synchronous (httpx); offload so the event loop is
        # not blocked on the upload round-trip.
        await asyncio.to_thread(storage.put, result_key, watermarked, "image/png")
        row = Generation()
        row.id = generation_id
        row.user_id = user_id
        row.recipe_id = recipe_id
        row.result_image_key = result_key
        row.retry_count = retry_count
        row.expires_at = expires_at
        session.add(row)
        await session.commit()
    except Exception as exc:  # noqa: BLE001
        # Broad catch on purpose: persistence is best-effort and must never turn
        # a successfully delivered image into a failed request. Storage
        # (:class:`ObjectStorageError`) and DB errors alike are logged + the
        # gallery entry dropped rather than propagated.
        _LOGGER.warning(
            "generation_persist_failed user_id=%s recipe_id=%s error=%s",
            str(user_id),
            recipe_id,
            type(exc).__name__,
        )
        return None
    return generation_id


def _build_config(recipe: Recipe) -> FalGenerationConfig:
    """Project a published :class:`Recipe` onto a fal.ai generation config.

    ``style_reference_key`` is forwarded only when it is already a dereferenceable
    HTTP(S) URL; object-storage key resolution is deferred to AC4.
    """
    style_key = recipe.style_reference_key
    style_url = (
        style_key
        if style_key is not None and style_key.startswith(("http://", "https://"))
        else None
    )
    return FalGenerationConfig(
        model_id=recipe.model_id,
        # Strip the unfilled {personal_color_modifier} slot — diagnosis output is
        # intentionally NOT injected here (see CLAUDE.md), so the literal brace
        # token must not be shipped verbatim to fal where it would pollute the
        # prompt.
        prompt=strip_unfilled_modifier(recipe.prompt_template),
        parameters=dict(recipe.parameters or {}),
        style_reference_url=style_url,
        # Payload key shape (image_url vs image_urls[]) is a model-family
        # property, decided here from the allowlist so the fal client stays
        # model-agnostic.
        reference_mode=reference_mode_for(recipe.model_id),
    )


@router.post(
    "/generate",
    status_code=status.HTTP_200_OK,
    summary="Generate a watermarked AI image from a recipe + selfie",
    responses={
        200: {"content": {"image/png": {}}},
        404: {"description": "Recipe not found or not published"},
        502: {"description": "Non-retryable generation vendor error"},
        503: {"description": "Generation failed within budget / unavailable"},
    },
)
async def generate(
    recipe_id: str = Form(..., description="Published recipe id to generate from"),
    selfie_bytes: bytes = Depends(validate_selfie_upload),
    garment_bytes: bytes | None = Depends(validate_optional_garment_upload),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_current_user),
    runner: GenerateRunner = Depends(get_generate_runner),
    metrics: GenerationMetricsRecorder = Depends(get_generation_metrics_recorder),
    storage: ObjectStorage = Depends(get_object_storage),
) -> Response:
    """Generate a server-side watermarked AI image and return it as PNG bytes."""
    result = await session.execute(select(Recipe).where(Recipe.recipe_id == recipe_id))
    recipe = result.scalar_one_or_none()
    if recipe is None or recipe.status != RECIPE_STATUS_PUBLISHED:
        # Client error (bad recipe id) — not a generation attempt, so it is not
        # counted in the request-level success-rate metric.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=DETAIL_RECIPE_NOT_FOUND
        )

    if not is_approved_edit_model(recipe.model_id):
        # Defense in depth: the admin schema rejects non-edit model ids at write
        # time, but a recipe that predates that guard (or was written straight to
        # the DB) may still carry a text-to-image model id that would silently
        # ignore the selfie and return a stranger. Fail loud instead.
        _LOGGER.error(
            "recipe_misconfigured recipe_id=%s model_id=%s "
            "(not a validated image-edit model; selfie would be ignored)",
            recipe_id,
            recipe.model_id,
        )
        metrics.record_outcome(OUTCOME_UNAVAILABLE, retry_count=0)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=DETAIL_GENERATION_UNAVAILABLE,
        )

    if garment_bytes is not None and reference_mode_for(recipe.model_id) == "single":
        # The single-reference payload has no slot for a second image;
        # silently dropping the garment would break the "my garment" product
        # promise (STRATEGY §10). Fail loud before any fal spend.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=DETAIL_GARMENT_NOT_SUPPORTED,
        )

    config = _build_config(recipe)
    # Garment bytes (like the selfie) are handler-local only: uploaded to
    # fal's short-lived temp storage inside core-python, never our object
    # storage, never logged (docs/INVARIANTS.md #1).
    inputs = GenerationInputs(selfie_bytes=selfie_bytes, garment_bytes=garment_bytes)

    try:
        generation = await asyncio.to_thread(runner, config, inputs)
    except GenerationBudgetExhaustedError as exc:
        metrics.record_outcome(OUTCOME_FAILED, retry_count=exc.retry_count)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=DETAIL_GENERATION_FAILED,
        ) from None
    except FalGenerationError:
        metrics.record_outcome(OUTCOME_FAILED, retry_count=0)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=DETAIL_GENERATION_FAILED,
        ) from None
    except LookupError:
        metrics.record_outcome(OUTCOME_UNAVAILABLE, retry_count=0)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=DETAIL_GENERATION_UNAVAILABLE,
        ) from None

    watermarked = await asyncio.to_thread(apply_watermark, generation.image_bytes)
    metrics.record_outcome(OUTCOME_SUCCESS, retry_count=generation.retry_count)

    # Persist the watermarked result + a gallery row (best-effort: the image is
    # delivered inline regardless). The original selfie is never persisted —
    # only the watermarked output egresses, honoring the zero-PII invariant.
    generation_id = await _persist_generation(
        session=session,
        storage=storage,
        user_id=user.id,
        recipe_id=recipe_id,
        watermarked=watermarked,
        retry_count=generation.retry_count,
        now=datetime.now(timezone.utc),
    )

    headers = {HEADER_RETRY_COUNT: str(generation.retry_count)}
    if generation_id is not None:
        headers[HEADER_GENERATION_ID] = str(generation_id)

    return Response(content=watermarked, media_type="image/png", headers=headers)
