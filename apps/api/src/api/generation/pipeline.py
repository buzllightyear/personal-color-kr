"""Image generation pipeline with enforced enhancer routing (Sub-AC 2).

Core invariant
--------------
Every raw image candidate produced by the commodity generation AI (Fal.ai /
Replicate) MUST pass through :func:`~api.generation.enhancer.apply_enhancer`
**exactly once** before being returned.

There is NO code path inside :func:`run_generation_pipeline` that bypasses
the enhancer. The ``enhancer_fn`` parameter defaults to the production
:func:`~api.generation.enhancer.apply_enhancer` and cannot be ``None``.

Design
------
The pipeline takes a sequence of *raw* candidate bytes (AI output), applies
the enhancer to each one, and returns a list of
:class:`GenerationCandidate` objects ready for the downstream reject-filter
and user-pick stages.

The enhancer function is injected via the ``enhancer_fn`` parameter.
Unit tests substitute a lightweight spy to verify the call count without
executing the real enhancement logic.

Seed constraints honored here
------------------------------
- Raw commodity-AI output MUST NOT be returned to users.
- The enhancer is called exactly once per candidate (no double-processing,
  no skip).
- The pipeline itself does not own taste decisions — it is a pure
  routing function. Taste lives upstream in the generation recipe and the
  reject-filter thresholds.
- No SQLAlchemy imports here (DB boundary lives in ``api.db.*``).
- No Fal.ai vendor-key references here (commodity API is called by a
  separate vendor-caller surface; this module receives raw bytes only).
"""

from __future__ import annotations

from dataclasses import dataclass

from api.generation.enhancer import EnhancerFn, apply_enhancer

# ---------------------------------------------------------------------------
# Domain value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GenerationCandidate:
    """A single AI-generated image candidate after de-slop enhancement.

    Attributes
    ----------
    image_bytes:
        De-slopped image bytes produced by passing raw AI output through
        the enhancer exactly once.
    candidate_index:
        Zero-based position of this candidate in the original raw-output
        sequence. Preserved so downstream stages (reject filter, user pick)
        can correlate candidates back to their generation order.
    """

    image_bytes: bytes
    candidate_index: int


# ---------------------------------------------------------------------------
# Pipeline entry point
# ---------------------------------------------------------------------------


def run_generation_pipeline(
    raw_candidates: list[bytes],
    *,
    enhancer_fn: EnhancerFn = apply_enhancer,
) -> list[GenerationCandidate]:
    """Route every raw AI candidate through the enhancer and return results.

    This function is the **single enforced routing point** for the generation
    pipeline. The enhancer is called exactly once per candidate — there is
    no code path that skips it.

    Parameters
    ----------
    raw_candidates:
        Raw image bytes as returned by the commodity generation API
        (Fal.ai / Replicate). These are *unsanitised* AI outputs and MUST
        NOT be exposed to end users without going through ``enhancer_fn``.
    enhancer_fn:
        The de-slop enhancer callable.  Defaults to
        :func:`api.generation.enhancer.apply_enhancer` (the production
        server-side correction layer). Unit tests pass a spy/mock here to
        verify the call count without running the real enhancement logic.
        The parameter is keyword-only to prevent accidental positional
        misuse.

    Returns
    -------
    list[GenerationCandidate]
        Enhanced candidates in the same order as ``raw_candidates``.
        Each ``GenerationCandidate.image_bytes`` has been processed by
        ``enhancer_fn`` exactly once.

    Raises
    ------
    TypeError
        If ``enhancer_fn`` is ``None``.  The pipeline refuses to run
        without an enhancer — there is no "raw passthrough" mode.

    Notes
    -----
    *Routing invariant*: ``len(result) == len(raw_candidates)`` and
    for every index *i* it holds that
    ``result[i].image_bytes == enhancer_fn(raw_candidates[i])``.
    The index is preserved in ``GenerationCandidate.candidate_index``.

    The function is intentionally synchronous. Async offloading (to avoid
    blocking the event loop during heavyweight enhancement) is the
    caller's responsibility — exactly mirroring the ``asyncio.to_thread``
    pattern used by ``POST /v1/diagnose``.
    """
    if enhancer_fn is None:
        raise TypeError(
            "enhancer_fn must not be None. "
            "The generation pipeline requires an enhancer — there is no "
            "raw-passthrough mode. Pass a callable that satisfies "
            "EnhancerFn (bytes -> bytes)."
        )

    # ---------------------------------------------------------------------------
    # Enforced routing: apply_enhancer (or the injected spy) is called for
    # EVERY candidate, exactly once.
    # ---------------------------------------------------------------------------
    enhanced: list[GenerationCandidate] = []
    for idx, raw_bytes in enumerate(raw_candidates):
        # This is the single routing call site. There is no conditional, no
        # early-return, and no alternate branch that could skip enhancer_fn.
        enhanced_bytes: bytes = enhancer_fn(raw_bytes)
        enhanced.append(
            GenerationCandidate(
                image_bytes=enhanced_bytes,
                candidate_index=idx,
            )
        )
    return enhanced


__all__ = ["GenerationCandidate", "run_generation_pipeline"]
