"""Automatic reject filter for AI-generated image candidates (AC4, AC5, AC22).

Seed constraints honored here
------------------------------
- Three independent dimensions: identity_similarity_score, artifact_score,
  uncanny_score — all number (0.0-1.0), identical comparison operator.
- score >= threshold = PASS; score < threshold = reject.
- Global default config + per-recipe override (no code change needed).
- reject_filter thresholds configurable via config file — code-change-free.
- All 3 scores are permanently stored on the candidate after filter runs
  (AC22: ephemeral 아님, audit trail 보장).
- reject_filter_passed and rejected_dimensions stored for post-hoc audit.

Design
------
:func:`apply_reject_filter` takes a list of scored candidates and a
:class:`RejectConfig` and returns only those that pass all 3 dimensions.

:func:`annotate_candidates` annotates ALL candidates (survivors + rejected)
with reject_filter_passed and rejected_dimensions for audit purposes.

:class:`RejectConfig` resolves per-recipe overrides over global defaults,
so operators can tune thresholds per trend without touching code.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# ---------------------------------------------------------------------------
# Threshold config value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RejectThresholds:
    """Three-dimensional reject-filter thresholds.

    A candidate passes if and only if ALL three dimension scores are
    >= their respective thresholds.

    Attributes
    ----------
    identity_threshold:
        Minimum identity_similarity_score (face-landmark rule-based).
    artifact_threshold:
        Minimum artifact_score (visual artifact quality).
    uncanny_threshold:
        Minimum uncanny_score (uncanny valley detection).
    """

    identity_threshold: float = 0.6
    artifact_threshold: float = 0.6
    uncanny_threshold: float = 0.5


# Default global thresholds — loaded from config or used as fallback.
DEFAULT_THRESHOLDS = RejectThresholds(
    identity_threshold=0.6,
    artifact_threshold=0.6,
    uncanny_threshold=0.5,
)


@dataclass(frozen=True)
class RejectConfig:
    """Resolved reject-filter configuration for a generation run.

    Holds the effective thresholds after merging global defaults with
    any per-recipe overrides.

    Attributes
    ----------
    identity_threshold:
        Effective identity threshold.
    artifact_threshold:
        Effective artifact threshold.
    uncanny_threshold:
        Effective uncanny threshold.
    """

    identity_threshold: float
    artifact_threshold: float
    uncanny_threshold: float

    @classmethod
    def from_defaults(cls) -> "RejectConfig":
        """Create a RejectConfig from the global default thresholds."""
        return cls(
            identity_threshold=DEFAULT_THRESHOLDS.identity_threshold,
            artifact_threshold=DEFAULT_THRESHOLDS.artifact_threshold,
            uncanny_threshold=DEFAULT_THRESHOLDS.uncanny_threshold,
        )

    @classmethod
    def from_override(
        cls,
        global_defaults: RejectThresholds,
        recipe_overrides: dict[str, Any] | None,
    ) -> "RejectConfig":
        """Merge global defaults with per-recipe overrides.

        Override keys: ``identity_threshold``, ``artifact_threshold``,
        ``uncanny_threshold``. Missing keys fall back to global defaults.

        Parameters
        ----------
        global_defaults:
            Global threshold configuration (from config file or code defaults).
        recipe_overrides:
            Per-recipe override dict (from recipe.reject_threshold_overrides).
            ``None`` means no overrides — global defaults apply entirely.

        Returns
        -------
        RejectConfig
            Merged effective configuration.
        """
        if recipe_overrides is None:
            recipe_overrides = {}

        return cls(
            identity_threshold=float(
                recipe_overrides.get(
                    "identity_threshold",
                    global_defaults.identity_threshold,
                )
            ),
            artifact_threshold=float(
                recipe_overrides.get(
                    "artifact_threshold",
                    global_defaults.artifact_threshold,
                )
            ),
            uncanny_threshold=float(
                recipe_overrides.get(
                    "uncanny_threshold",
                    global_defaults.uncanny_threshold,
                )
            ),
        )


# ---------------------------------------------------------------------------
# Scored candidate value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ScoredCandidate:
    """An enhanced image candidate with reject-filter scores.

    All three dimension scores are permanently stored on the candidate after
    reject_filter runs — they are NOT ephemeral. This enables audit trails
    and post-hoc rejection reason lookup (AC22).

    Attributes
    ----------
    candidate_index:
        Zero-based position in the original generation batch.
    enhanced_image_ref:
        Reference to the enhanced image (URL, path, or bytes key).
        Non-null value is the structural proof that the candidate passed
        through the enhancer (AC2). Null means the candidate was NOT
        processed by the enhancer — the output gate must reject null values.
    identity_similarity_score:
        Face-landmark rule-based identity similarity (0.0-1.0). Stored
        permanently on the candidate for audit trail.
    artifact_score:
        Visual artifact quality score (0.0-1.0). Higher = fewer artifacts.
        Stored permanently for audit trail.
    uncanny_score:
        Uncanny valley detection score (0.0-1.0). Higher = less uncanny.
        Stored permanently for audit trail.
    reject_filter_passed:
        True if and only if all three dimension scores passed their
        respective thresholds. Set by annotate_candidates() / apply_reject_filter().
        Default False until filter runs.
    rejected_dimensions:
        Tuple of dimension names that fell below threshold (e.g.
        ("identity_similarity_score",)). Empty tuple means all passed.
        Populated by annotate_candidates() for audit trail (AC22).
    """

    candidate_index: int
    enhanced_image_ref: (
        str | None
    )  # None = not yet enhanced; non-None = structural proof
    identity_similarity_score: float
    artifact_score: float
    uncanny_score: float
    reject_filter_passed: bool = False
    rejected_dimensions: tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# Annotation function (AC22: stores pass/fail + rejected dimensions)
# ---------------------------------------------------------------------------


def annotate_candidates(
    candidates: list[ScoredCandidate],
    config: RejectConfig,
) -> list[ScoredCandidate]:
    """Annotate ALL candidates with reject_filter_passed and rejected_dimensions.

    Unlike apply_reject_filter (which returns only survivors), this function
    returns ALL candidates — both passing and failing — with their pass/fail
    status and rejected dimension names permanently stored.

    This enables post-hoc audit: given any candidate_index, a caller can
    look up which dimensions caused rejection (AC22 requirement).

    Parameters
    ----------
    candidates:
        List of scored candidates after enhancer processing.
    config:
        Effective reject-filter configuration.

    Returns
    -------
    list[ScoredCandidate]
        ALL candidates (survivors + rejected), each annotated with:
        - reject_filter_passed: True iff all 3 dimensions passed
        - rejected_dimensions: tuple of dimension names that failed
    """
    annotated: list[ScoredCandidate] = []
    for candidate in candidates:
        failed: list[str] = []
        if candidate.identity_similarity_score < config.identity_threshold:
            failed.append("identity_similarity_score")
        if candidate.artifact_score < config.artifact_threshold:
            failed.append("artifact_score")
        if candidate.uncanny_score < config.uncanny_threshold:
            failed.append("uncanny_score")

        annotated.append(
            ScoredCandidate(
                candidate_index=candidate.candidate_index,
                enhanced_image_ref=candidate.enhanced_image_ref,
                identity_similarity_score=candidate.identity_similarity_score,
                artifact_score=candidate.artifact_score,
                uncanny_score=candidate.uncanny_score,
                reject_filter_passed=len(failed) == 0,
                rejected_dimensions=tuple(failed),
            )
        )
    return annotated


# ---------------------------------------------------------------------------
# Filter function
# ---------------------------------------------------------------------------


def apply_reject_filter(
    candidates: list[ScoredCandidate],
    config: RejectConfig,
) -> list[ScoredCandidate]:
    """Filter candidates using three independent dimensions.

    A candidate PASSES if and only if:
      - identity_similarity_score >= config.identity_threshold
      - artifact_score           >= config.artifact_threshold
      - uncanny_score            >= config.uncanny_threshold

    All three dimensions use the SAME comparison operator (>=).
    Candidates that fail any single dimension are removed.

    Internally calls annotate_candidates() so that ALL candidates have
    reject_filter_passed and rejected_dimensions set for audit purposes
    (AC22). The function then returns only the survivors.

    Parameters
    ----------
    candidates:
        List of scored candidates after enhancer processing.
    config:
        Effective reject-filter configuration (merged global + per-recipe).

    Returns
    -------
    list[ScoredCandidate]
        Surviving candidates — those that passed all three dimensions.
        May be empty if all candidates are rejected.
        Each survivor has reject_filter_passed=True and rejected_dimensions=().
    """
    annotated = annotate_candidates(candidates, config)
    return [c for c in annotated if c.reject_filter_passed]


# ---------------------------------------------------------------------------
# In-memory candidate store for audit trail (AC22)
# ---------------------------------------------------------------------------


class InMemoryCandidateStore:
    """In-memory store for all scored candidates (survivors + rejected).

    Stores ALL candidates after reject_filter runs so operators can
    audit rejection reasons by candidate_index (AC22 post-hoc lookup).
    """

    def __init__(self) -> None:
        self._store: dict[int, ScoredCandidate] = {}

    def store_all(self, candidates: list[ScoredCandidate]) -> None:
        """Store all candidates keyed by candidate_index."""
        for c in candidates:
            self._store[c.candidate_index] = c

    def get_by_index(self, candidate_index: int) -> ScoredCandidate | None:
        """Retrieve a candidate by its index. Returns None if not found."""
        return self._store.get(candidate_index)

    def get_rejected_dimensions(self, candidate_index: int) -> tuple[str, ...] | None:
        """Return the rejected dimension names for a given candidate.

        Returns None if the candidate is not found.
        Returns an empty tuple if the candidate passed all dimensions.
        Returns a non-empty tuple of dimension names that caused rejection.
        """
        candidate = self._store.get(candidate_index)
        if candidate is None:
            return None
        return candidate.rejected_dimensions

    def all_candidates(self) -> list[ScoredCandidate]:
        """Return all stored candidates (survivors + rejected) in index order."""
        return [self._store[k] for k in sorted(self._store.keys())]


__all__ = [
    "RejectThresholds",
    "RejectConfig",
    "ScoredCandidate",
    "annotate_candidates",
    "apply_reject_filter",
    "InMemoryCandidateStore",
    "DEFAULT_THRESHOLDS",
]
