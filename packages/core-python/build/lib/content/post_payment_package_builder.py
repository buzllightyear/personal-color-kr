"""Post-payment ContentPackage assembler (Sub-AC 5.2).

This module is the *composer* that runs after a user clears the 12-step
Glam Up payment funnel. It threads four already-built primitives into
one immutable bundle the unlock screen can render:

    region colors → diagnose_from_region_colors → DiagnosisResult
    selfie bytes  → run_edit_pipeline           → PipelineResult
    diagnosis.season → load_guides_for_season       → tuple[Guide, ...]
    diagnosis.season → load_first_curation_for_season → FirstCuration

The output `ContentPackage` (defined in `post_payment_package.py`) is the
value object Sub-AC 5.1 already validates — this module is responsible
only for choosing the right inputs and composing them in the right order.

Design notes:

  - **Composition only, no re-implementation.** Per the Seed Contract
    constraints, every step delegates to an already-shipped primitive:
    `diagnose_from_region_colors`, `run_edit_pipeline`,
    `load_guides_for_season`, `load_first_curation_for_season`. The
    assembler adds no business logic of its own beyond the "season is the
    pivot" choice.

  - **Diagnosis runs first.** It is in-process, deterministic, and
    cheap — running it before the vendor RPC means a malformed
    `RegionColors` bundle fails fast without burning a Nano Banana call.
    The diagnosis also produces the `Season` we need to pick the correct
    guides and curation, so the order is also a data dependency, not just
    a perf hint.

  - **Pipeline retry/timeout knobs are pass-through.** The Seed Contract
    pins the p95 latency SLO on `run_edit_pipeline`, not on us — we forward
    `timeout_seconds`, `max_retries`, `backoff_base_seconds`, `sleep`,
    and `clock` verbatim so callers (and tests) keep one place to tune
    them. Defaults match the pipeline's defaults so the common call site
    `build_post_payment_package(selfie_bytes=..., region_colors=...,
    vendor_caller=...)` works without ceremony.

  - **Vendor injection.** `vendor_caller` is the only required
    integration-side input. Production wires the real HTTP adapter
    (Nano Banana / Replicate / etc. per the Seed Contract); the
    integration test wires a deterministic stub so the suite runs
    instantly and never burns a real RPC.

  - **Coherence is enforced downstream.** `ContentPackage.__post_init__`
    refuses any bundle whose guides or curations don't match the
    diagnosis season. Because we route the loaders through
    `diagnosis.season`, the only way coherence can fail is if a content
    rewrite drops or mislabels a row — which is exactly when we want a
    loud failure rather than a mis-themed welcome screen.

  - **Returning a frozen bundle.** `ContentPackage` is frozen and
    hashable; analytics and future preset-rendering can pass it around
    without mutation risk. This module never inspects or copies its
    fields after construction.
"""

from __future__ import annotations

import time
from typing import Callable, Mapping

from content.curations import load_first_curation_for_season
from content.guides import load_guides_for_season
from content.post_payment_package import ContentPackage
from image_edit.latency_tracker import LatencyTracker
from image_edit.pipeline import run_edit_pipeline
from image_edit.vendor_client import (
    DEFAULT_BACKOFF_BASE_SECONDS,
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT_SECONDS,
    VendorCaller,
)
from personal_color.diagnosis_orchestrator import (
    DEFAULT_CONFIDENCE_SCALES,
    ConfidenceScales,
    diagnose_from_region_colors,
)
from personal_color.contrast_classifier import (
    DEFAULT_CONTRAST_THRESHOLDS,
    ContrastThresholds,
)
from personal_color.region_extractor import RegionColors
from personal_color.tone_classifier import (
    DEFAULT_THRESHOLDS,
    ToneThresholds,
)

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_post_payment_package(
    *,
    selfie_bytes: bytes,
    region_colors: RegionColors,
    vendor_caller: VendorCaller,
    params: Mapping[str, object] | None = None,
    vendor: str = "nano_banana",
    tracker: LatencyTracker | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff_base_seconds: float = DEFAULT_BACKOFF_BASE_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    tone_thresholds: ToneThresholds = DEFAULT_THRESHOLDS,
    contrast_thresholds: ContrastThresholds = DEFAULT_CONTRAST_THRESHOLDS,
    confidence_scales: ConfidenceScales = DEFAULT_CONFIDENCE_SCALES,
) -> ContentPackage:
    """Compose the post-payment unlock bundle.

    Runs the four already-shipped primitives — diagnosis orchestrator,
    image-edit pipeline, guides loader, curations loader — and packages
    their outputs into the immutable `ContentPackage` the welcome screen
    renders.

    The diagnosis season is the pivot: whichever 봄/여름/가을/겨울 the
    orchestrator returns determines which guides and which curation
    package end up in the bundle.

    Args:
        selfie_bytes: Raw image payload (PNG / JPEG) the vendor will
            edit. Non-empty bytes-like; eagerly validated by
            `run_edit_pipeline`.
        region_colors: Skin / eyes / hair representative RGB tuples
            (from the region extractor, Sub-AC 10.4). Drives the
            diagnosis verdict.
        vendor_caller: Concrete adapter satisfying `VendorCaller`. The
            integration test wires a deterministic stub; production
            wires the real HTTP client.
        params: Vendor-agnostic editing parameters forwarded to
            `run_edit_pipeline`. Defaults to an empty mapping.
        vendor: Hint echoed back in `PipelineResult.vendor` for log
            attribution. Defaults to ``"nano_banana"``.
        tracker: Destination latency accumulator. Production passes a
            shared tracker so the SLO snapshot stays meaningful; tests
            and one-shot callers can leave it as `None`.
        timeout_seconds / max_retries / backoff_base_seconds / sleep /
        clock: Forwarded verbatim to `run_edit_pipeline`. Tests wire
            deterministic stubs so the suite runs instantly.
        tone_thresholds / contrast_thresholds / confidence_scales:
            Forwarded verbatim to `diagnose_from_region_colors`. Callers
            calibrating the diagnosis can override these without
            touching the assembler.

    Returns:
        A fully-coherent `ContentPackage` for the season the diagnosis
        produced.

    Raises:
        TypeError / ValueError: propagated unchanged from the underlying
            primitives (diagnosis orchestrator, image-edit pipeline,
            ContentPackage constructor). Each failure mode is already
            covered by the primitive's own test suite.
        VendorError / VendorTimeoutError: propagated from
            `run_edit_pipeline` after retries are exhausted. The
            application layer is expected to catch and surface a user-
            facing "편집을 다시 시도해주세요".
        KeyError: propagated from `load_first_curation_for_season` if
            the catalogue is missing a season. This is a hard contract
            violation — the catalogue is supposed to be exhaustive.
    """
    # 1) Diagnosis — cheap, deterministic, in-process. Run first so a
    #    malformed RegionColors fails fast without burning a vendor RPC.
    diagnosis = diagnose_from_region_colors(
        region_colors,
        tone_thresholds=tone_thresholds,
        contrast_thresholds=contrast_thresholds,
        confidence_scales=confidence_scales,
    )

    # 2) Image-edit pipeline — vendor RPC behind retry + timeout. Latency
    #    is recorded into `tracker` even on failure (see pipeline
    #    docstring).
    edited_image = run_edit_pipeline(
        selfie_bytes,
        vendor_caller=vendor_caller,
        params=params,
        vendor=vendor,
        tracker=tracker,
        timeout_seconds=timeout_seconds,
        max_retries=max_retries,
        backoff_base_seconds=backoff_base_seconds,
        sleep=sleep,
        clock=clock,
    )

    # 3) Content lookups — both keyed by the diagnosis season so the
    #    welcome screen is themed by the verdict, not by a hard-coded
    #    default. Returned tuples / dataclasses are the immutable
    #    constants from the catalogues; no copy needed.
    season = diagnosis.season
    guides = load_guides_for_season(season)
    curation = load_first_curation_for_season(season)

    # 4) Assemble. ContentPackage.__post_init__ enforces the coherence
    #    invariant — any drift between diagnosis season and guide /
    #    curation season raises here, which is the loud-failure mode we
    #    want.
    return ContentPackage(
        diagnosis=diagnosis,
        edited_image=edited_image,
        guides=guides,
        curations=curation,
    )
