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
from typing import Final

from fastapi import APIRouter, Depends, Form, HTTPException, Response, status

from api.db.models.recipe import RECIPE_STATUS_PUBLISHED, Recipe
from api.db.models.user import User
from api.db.session import AsyncSession, get_session, select
from api.dependencies.auth import require_current_user
from api.dependencies.generate import GenerateRunner, get_generate_runner
from api.dependencies.selfie_validation import validate_selfie_upload
from personal_color.generate.fal_client import FalGenerationConfig, FalGenerationError
from personal_color.generate.orchestrator import GenerationBudgetExhaustedError
from personal_color.generate.watermark import apply_watermark

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

#: Response header carrying the number of auto-retries consumed before the
#: accepted candidate (0 = first attempt passed). Useful for client telemetry
#: and the rolling success-rate metric (AC3).
HEADER_RETRY_COUNT: Final[str] = "X-Generation-Retry-Count"

router: APIRouter = APIRouter(tags=["generate"])


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
        prompt=recipe.prompt_template,
        parameters=dict(recipe.parameters or {}),
        style_reference_url=style_url,
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
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_current_user),
    runner: GenerateRunner = Depends(get_generate_runner),
) -> Response:
    """Generate a server-side watermarked AI image and return it as PNG bytes."""
    result = await session.execute(select(Recipe).where(Recipe.recipe_id == recipe_id))
    recipe = result.scalar_one_or_none()
    if recipe is None or recipe.status != RECIPE_STATUS_PUBLISHED:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=DETAIL_RECIPE_NOT_FOUND
        )

    config = _build_config(recipe)

    try:
        generation = await asyncio.to_thread(runner, config, selfie_bytes)
    except GenerationBudgetExhaustedError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=DETAIL_GENERATION_FAILED,
        ) from None
    except FalGenerationError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=DETAIL_GENERATION_FAILED,
        ) from None
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=DETAIL_GENERATION_UNAVAILABLE,
        ) from None

    watermarked = await asyncio.to_thread(apply_watermark, generation.image_bytes)

    return Response(
        content=watermarked,
        media_type="image/png",
        headers={HEADER_RETRY_COUNT: str(generation.retry_count)},
    )
