"""Dependency seam for the ``POST /v1/generate`` end-to-end generation runner.

The HTTP handler (``api.routers.generate``) stays free of the fal.ai vendor
seam and the NSFW classifier by depending on :func:`get_generate_runner`,
which returns a callable of shape ``(FalGenerationConfig, GenerationInputs)
-> OrchestrationResult``.

* **Production** (``get_generate_runner``): loads the fal.ai API key via the
  authorised core-python loader, constructs the production
  :class:`~personal_color.generate.rejection.FalNsfwClassifier`, and runs the
  committed :func:`~personal_color.generate.orchestrator.orchestrate_generation`
  generate → reject → retry loop within the 30 s wall-clock budget.
* **Tests**: override ``app.dependency_overrides[get_generate_runner]`` with a
  lambda returning a stub runner — no fal.ai / NSFW HTTP round-trips.

The API key is loaded lazily *inside* the runner (not at import or dependency
construction time) so the module stays importable when the key is absent; a
missing key surfaces as a ``LookupError`` at request time, which the handler
maps to HTTP 503.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Final

from personal_color.generate.fal_client import FalGenerationConfig, GenerationInputs
from personal_color.generate.orchestrator import (
    OrchestrationResult,
    orchestrate_generation,
)
from personal_color.generate.rejection import FalNsfwClassifier

#: A generation runner: turn a recipe-derived config + per-request user images
#: (selfie + optional garment) into an accepted, rejection-passed
#: :class:`OrchestrationResult` (or raise).  Future reference inputs extend
#: :class:`GenerationInputs`, not this signature.
GenerateRunner = Callable[[FalGenerationConfig, GenerationInputs], OrchestrationResult]

#: Total wall-clock budget for the generate → reject → retry loop. Matches the
#: Seed Contract's 30 s end-to-end SLO.
DEFAULT_GENERATION_BUDGET_SECONDS: Final[float] = 30.0


def get_generate_runner() -> GenerateRunner:
    """Return the production generation runner.

    The returned callable is synchronous and CPU/IO-bound; the handler runs it
    via ``asyncio.to_thread`` so the event loop is never blocked.
    """

    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        # Imported here so the module stays importable without core-python's
        # image_edit package installed; a missing key raises LookupError,
        # which the handler maps to HTTP 503.
        from image_edit.fal_ai_api_key import load_fal_api_key

        api_key: str = load_fal_api_key()
        classifier = FalNsfwClassifier(api_key)
        return orchestrate_generation(
            config,
            inputs,
            api_key=api_key,
            nsfw_classifier=classifier,
            total_budget_seconds=DEFAULT_GENERATION_BUDGET_SECONDS,
        )

    return _runner
