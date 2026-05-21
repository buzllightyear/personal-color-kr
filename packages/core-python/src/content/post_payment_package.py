"""Post-payment ContentPackage dataclass (Sub-AC 5.1).

The Seed ontology defines `content_package` as the bundle the user
unlocks the moment the 12-step Glam Up payment funnel completes:

    diagnosis + edited_image + guides + curations

This module defines the *value object only* — the frozen dataclass plus
construction-time field validation. The assembler that *produces* a
package from a diagnosis-orchestrator result, the image-edit pipeline
output, the guide loader, and the curation loader lives in a separate
Sub-AC (5.2). Splitting the type from the assembly keeps the responsibility
narrow: this file is "what a package looks like, and what makes a
package invalid", nothing else.

Design notes:

  - **Why a frozen dataclass.** Mirrors `guides.Guide`, `curations.FirstCuration`,
    `personal_color.diagnosis_orchestrator.DiagnosisResult`, and
    `image_edit.pipeline.PipelineResult` — every neighbouring value object
    in the project is frozen, and the post-payment package will flow
    through analytics + future preset rendering surfaces where mutation
    by a logger would be catastrophic.

  - **Why validate at construction.** The package is built once, immediately
    after a successful payment, and rendered many times. A bad field
    surfaces immediately at build time rather than as a `KeyError` on the
    unlock screen. Same defence-in-depth posture as `Guide.__post_init__`
    and `FirstCuration.__post_init__`.

  - **Why enforce season consistency.** Shipping a 가을 user a 봄 curation
    package is the worst possible UX in the post-payment surface — the
    user just paid, and the welcome screen is mis-themed. The diagnosis
    season is the single source of truth for the package, so the
    constructor refuses any bundle whose guides or curations target a
    different season. This is the *coherence* invariant the Seed
    ontology calls out (`content_package` concept boundary).

  - **Why imports from neighbouring modules, not re-exports.** Per the
    project Seed constraints we never re-implement existing modules —
    we import them. Anything ContentPackage exposes is a composition
    of types defined elsewhere.
"""

from __future__ import annotations

from dataclasses import dataclass

from content.curations import FirstCuration
from content.guides import Guide
from image_edit.pipeline import PipelineResult
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.season_classifier import Season

# ---------------------------------------------------------------------------
# ContentPackage value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ContentPackage:
    """The post-payment unlock bundle.

    A `ContentPackage` is a fully-realised post-payment welcome surface:
    the user's diagnosis verdict, the vendor-edited selfie that proved
    the verdict, the 4-tile guide grid for the matched season, and the
    season's hand-curated first package.

    Attributes:
        diagnosis: 4-color verdict (`봄/여름/가을/겨울`) + confidence + the
            intermediate tone / contrast signals. The package's season is
            authoritative on `diagnosis.season`; the other fields must
            match it.
        edited_image: End-to-end image-edit pipeline result — carries the
            edited bytes, the vendor name, and the user-perceived
            wall-clock latency.
        guides: Tuple of `Guide` entries to render in the post-diagnosis
            grid. Every entry's `Guide.season` must equal
            `diagnosis.season`. Must be non-empty.
        curations: The single `FirstCuration` package keyed to
            `diagnosis.season`. Its 4 items already carry the
            wording-tone mix invariant validated by `FirstCuration`
            itself.
    """

    diagnosis: DiagnosisResult
    edited_image: PipelineResult
    guides: tuple[Guide, ...]
    curations: FirstCuration

    def __post_init__(self) -> None:
        # ---- per-field type validation ------------------------------------
        if not isinstance(self.diagnosis, DiagnosisResult):
            raise TypeError(
                "diagnosis must be a DiagnosisResult, "
                f"got {type(self.diagnosis).__name__}",
            )
        if not isinstance(self.edited_image, PipelineResult):
            raise TypeError(
                "edited_image must be a PipelineResult, "
                f"got {type(self.edited_image).__name__}",
            )
        if not isinstance(self.guides, tuple):
            raise TypeError(
                "guides must be a tuple (hashable, immutable), "
                f"got {type(self.guides).__name__}",
            )
        if len(self.guides) == 0:
            raise ValueError("guides must contain at least one Guide entry")
        for index, guide in enumerate(self.guides):
            if not isinstance(guide, Guide):
                raise TypeError(
                    f"guides[{index}] must be a Guide, " f"got {type(guide).__name__}",
                )
        if not isinstance(self.curations, FirstCuration):
            raise TypeError(
                "curations must be a FirstCuration, "
                f"got {type(self.curations).__name__}",
            )

        # ---- coherence: season alignment across the bundle ----------------
        # The diagnosis is the authoritative source of truth — any guide
        # or curation targeting a different season would mis-theme the
        # welcome screen, so we refuse the package at construction time.
        target: Season = self.diagnosis.season
        for index, guide in enumerate(self.guides):
            if guide.season is not target:
                raise ValueError(
                    f"guides[{index}].season ({guide.season.name}) does not "
                    f"match diagnosis.season ({target.name})",
                )
        if self.curations.season is not target:
            raise ValueError(
                f"curations.season ({self.curations.season.name}) does not "
                f"match diagnosis.season ({target.name})",
            )
