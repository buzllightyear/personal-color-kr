"""Output boundary gate — explicit raw-output blocking (Sub-AC 3).

Core invariant
--------------
At the API output boundary, **every** image value must be a
:class:`~api.generation.pipeline.GenerationCandidate` — i.e., it must have
been produced by :func:`~api.generation.pipeline.run_generation_pipeline`,
which *always* routes candidates through the enhancer exactly once.

Any value that is not a :class:`~api.generation.pipeline.GenerationCandidate`
— including raw ``bytes`` straight from the commodity generation API — is
**explicitly rejected** by :func:`require_enhanced_output`.  The rejection is
unconditional: there is no escape hatch, no override flag, and no silent
pass-through for raw output.

Seed constraints honored here
------------------------------
- Sub-AC 3: a guard function at the output boundary rejects non-enhanced
  raw output with an explicit error.
- "생짜 AI 출력 금지" (raw AI output forbidden): enforced here as a
  hard gate at the serialization boundary, not just as a convention.
- The enhancer is *hidden* (server-side); this gate is the observable
  contract that raw output can never reach end users.

Relationship to Sub-AC 2
-------------------------
Sub-AC 2 (``api.generation.pipeline``) ensures that the *pipeline* always
calls the enhancer.  Sub-AC 3 (this module) adds a **second, independent
enforcement point** at the output boundary.  The two layers are
complementary:

  * Sub-AC 2: internal routing — every candidate enters the enhancer.
  * Sub-AC 3: boundary gate — only pipeline-produced candidates exit.

Even if Sub-AC 2 were somehow bypassed (e.g., a future code path that
constructs raw ``bytes`` without going through the pipeline), Sub-AC 3
would still block the raw output from reaching the serialization layer.

Usage
-----
At the HTTP response construction site, wrap each candidate (or the full
list) in the gate before serializing bytes into the response body::

    from api.generation.output_gate import require_enhanced_output
    from api.generation.pipeline import run_generation_pipeline

    candidates = run_generation_pipeline(raw_bytes_list)
    safe_candidate = require_enhanced_output(candidates[user_pick_index])
    # safe_candidate.image_bytes is now confirmed to be enhanced output
    response_bytes = safe_candidate.image_bytes

For convenience :func:`require_enhanced_candidates` gates a whole list::

    from api.generation.output_gate import require_enhanced_candidates

    safe = require_enhanced_candidates(candidates)
    for c in safe:
        ...  # all confirmed to be GenerationCandidate
"""

from __future__ import annotations

from api.generation.pipeline import GenerationCandidate
from api.generation.reject_filter import ScoredCandidate

# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class RawOutputError(Exception):
    """Raised when non-enhanced raw output reaches the output boundary gate.

    This exception signals that the caller attempted to return image data
    that has **not** passed through the generation pipeline and enhancer
    — i.e., the data is a raw ``bytes`` object (directly from the commodity
    generation API) or some other non-pipeline type.

    Catching this error in production would itself be a sign of a routing
    bug: the correct fix is always to route the output through
    :func:`~api.generation.pipeline.run_generation_pipeline` before passing
    it to the output boundary.
    """


# ---------------------------------------------------------------------------
# Guard functions
# ---------------------------------------------------------------------------


def require_enhanced_output(output: object) -> GenerationCandidate:
    """Gate: reject non-enhanced output at the output boundary.

    This is the explicit enforcement point for Sub-AC 3.  Any value that is
    not a :class:`~api.generation.pipeline.GenerationCandidate` — raw
    ``bytes``, ``str``, ``None``, or any other type — raises
    :exc:`RawOutputError` immediately.

    Only a :class:`~api.generation.pipeline.GenerationCandidate` is accepted,
    because that type is **only** produced by
    :func:`~api.generation.pipeline.run_generation_pipeline`, which always
    routes through the enhancer.  The type check is therefore a proxy for
    "this output passed through the enhancer".

    Parameters
    ----------
    output:
        The candidate value to inspect at the output boundary.

    Returns
    -------
    GenerationCandidate
        ``output`` unchanged, confirmed to be a
        :class:`~api.generation.pipeline.GenerationCandidate`.

    Raises
    ------
    RawOutputError
        If ``output`` is **not** a
        :class:`~api.generation.pipeline.GenerationCandidate`.  This
        includes (but is not limited to) raw ``bytes`` from a commodity
        generation API, plain ``str``, ``None``, or any other type that
        did not pass through the pipeline.

    Examples
    --------
    Passing raw bytes raises immediately::

        >>> require_enhanced_output(b"raw fal.ai bytes")
        RawOutputError: Raw output blocked at output boundary gate. ...

    A valid pipeline output passes through::

        >>> from api.generation.pipeline import run_generation_pipeline
        >>> [candidate] = run_generation_pipeline([b"raw"])
        >>> require_enhanced_output(candidate)  # returns candidate unchanged
    """
    if not isinstance(output, GenerationCandidate):
        raise RawOutputError(
            f"Raw output blocked at output boundary gate. "
            f"Expected GenerationCandidate (post-enhancer output from "
            f"run_generation_pipeline), but received "
            f"{type(output).__name__!r}. "
            f"All image output MUST pass through run_generation_pipeline, "
            f"which routes every candidate through the enhancer exactly once. "
            f"Returning raw commodity-AI output (Fal.ai / Replicate bytes) "
            f"directly to end users is forbidden by the Seed moat constraint."
        )
    return output


def require_enhanced_candidates(
    outputs: object,
) -> list[GenerationCandidate]:
    """Gate: reject a list that contains any non-enhanced output.

    Applies :func:`require_enhanced_output` to every item in ``outputs``.
    Useful at the serialization boundary when the full candidate list from
    :func:`~api.generation.pipeline.run_generation_pipeline` is passed to
    the HTTP response builder.

    Parameters
    ----------
    outputs:
        The list of candidates to inspect.  Must be a ``list`` of
        :class:`~api.generation.pipeline.GenerationCandidate` objects.

    Returns
    -------
    list[GenerationCandidate]
        ``outputs`` unchanged, confirmed to contain only
        :class:`~api.generation.pipeline.GenerationCandidate` objects.

    Raises
    ------
    RawOutputError
        If ``outputs`` is not a ``list``, or if any element inside the
        list is not a :class:`~api.generation.pipeline.GenerationCandidate`.

    Examples
    --------
    A list of raw bytes raises immediately::

        >>> require_enhanced_candidates([b"raw", b"bytes"])
        RawOutputError: Raw output blocked at output boundary gate. ...

    A valid pipeline list passes through::

        >>> candidates = run_generation_pipeline([b"a", b"b"])
        >>> require_enhanced_candidates(candidates)  # returns list unchanged
    """
    if not isinstance(outputs, list):
        raise RawOutputError(
            f"Raw output blocked at output boundary gate. "
            f"Expected list[GenerationCandidate] but received "
            f"{type(outputs).__name__!r}. "
            f"The candidate list must come from run_generation_pipeline."
        )
    for item in outputs:
        require_enhanced_output(item)
    return outputs


def require_enhanced_scored_candidate(candidate: object) -> ScoredCandidate:
    """Gate: reject a ScoredCandidate if enhanced_image_ref is null (AC2).

    This gate enforces that enhanced_image_ref EXISTS (is non-null) as
    structural proof that the candidate passed through the enhancer.
    This is NOT a boolean flag — the presence of enhanced_image_ref itself
    is the proof (AC2 constraint: "enhanced_image_ref 존재 자체가 경유 증거").

    Parameters
    ----------
    candidate:
        A ScoredCandidate to inspect.

    Returns
    -------
    ScoredCandidate
        The candidate unchanged, confirmed to have non-null enhanced_image_ref.

    Raises
    ------
    RawOutputError
        If candidate is not a ScoredCandidate, or if enhanced_image_ref is None.
        A null enhanced_image_ref means the candidate was not routed through
        the enhancer — structural proof of enhancement is absent.
    """
    if not isinstance(candidate, ScoredCandidate):
        raise RawOutputError(
            f"Raw output blocked at output boundary gate. "
            f"Expected ScoredCandidate (post-enhancer scored candidate), "
            f"but received {type(candidate).__name__!r}. "
            f"Only ScoredCandidate with non-null enhanced_image_ref is accepted."
        )
    if candidate.enhanced_image_ref is None:
        raise RawOutputError(
            f"Raw output blocked: ScoredCandidate.enhanced_image_ref is None. "
            f"A non-null enhanced_image_ref is the structural proof that the "
            f"candidate passed through the enhancer (AC2 constraint). "
            f"Candidate index={candidate.candidate_index} has no enhancer proof."
        )
    return candidate


__all__ = [
    "RawOutputError",
    "require_enhanced_output",
    "require_enhanced_candidates",
    "require_enhanced_scored_candidate",
]
