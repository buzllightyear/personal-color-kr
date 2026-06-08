"""Unit tests: output boundary gate rejects non-enhanced raw output (Sub-AC 3).

Acceptance criterion (Sub-AC 3) being verified
-----------------------------------------------
    생짜 경로 차단 게이트 — 출력 경계에서 enhancer를 통과하지 않은 raw 출력 반환을
    명시적으로 거부하는 가드 함수/미들웨어.
    테스트: enhancer 미경유 출력을 게이트에 전달하면 오류(또는 거부 응답)가 발생함을 검증.

    English: Raw output blocking gate — a guard function/middleware that
    explicitly rejects returning raw output that hasn't passed through the
    enhancer at the output boundary.
    Test: verify that passing non-enhanced output to the gate results in an
    error (or rejection response).

Invariants asserted
-------------------
1. ``require_enhanced_output(raw_bytes)`` raises ``RawOutputError`` — this
   is the canonical Sub-AC 3 assertion.
2. ``require_enhanced_output(GenerationCandidate(...))`` passes — valid
   pipeline output is not rejected.
3. Other non-enhanced types (``str``, ``None``, ``int``, ``dict``) also
   raise ``RawOutputError``.
4. ``require_enhanced_candidates([raw_bytes])`` raises ``RawOutputError``.
5. ``require_enhanced_candidates([GenerationCandidate(...)])`` passes.
6. ``require_enhanced_candidates`` raises ``RawOutputError`` for a list
   containing a mix of valid candidates and a raw bytes item.
7. ``require_enhanced_candidates`` raises ``RawOutputError`` when given
   a non-list type (e.g. a single ``GenerationCandidate``).
8. The ``RawOutputError`` message names the received type so callers can
   diagnose routing bugs quickly.
9. ``RawOutputError`` is a subclass of ``Exception`` (can be caught
   generically in FastAPI exception handlers).

Testing technique
-----------------
Tests use :func:`api.generation.pipeline.run_generation_pipeline` with a
trivial spy enhancer to produce valid :class:`GenerationCandidate` objects
for the "passes" cases.  No real image bytes, no Fal.ai, no Pillow needed.
"""

from __future__ import annotations

import pytest

from api.generation.output_gate import (
    RawOutputError,
    require_enhanced_candidates,
    require_enhanced_output,
)
from api.generation.pipeline import GenerationCandidate, run_generation_pipeline

# ---------------------------------------------------------------------------
# Helpers — build valid GenerationCandidate via the pipeline
# ---------------------------------------------------------------------------

_RAW_BYTES: bytes = b"\x10\x20\x30\x40"
_RAW_BYTES_B: bytes = b"\xaa\xbb\xcc\xdd"


def _make_candidate(raw: bytes = _RAW_BYTES) -> GenerationCandidate:
    """Return a valid GenerationCandidate (produced by the pipeline)."""
    candidates = run_generation_pipeline([raw])
    return candidates[0]


def _make_candidates(raws: list[bytes]) -> list[GenerationCandidate]:
    """Return a list of GenerationCandidates from the pipeline."""
    return run_generation_pipeline(raws)


# ---------------------------------------------------------------------------
# Sub-AC 3 core test: raw bytes → RawOutputError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_raw_bytes_raises_raw_output_error() -> None:
    """Passing raw ``bytes`` to require_enhanced_output raises RawOutputError.

    This is the canonical Sub-AC 3 assertion:
        "enhancer 미경유 출력을 게이트에 전달하면 오류가 발생함을 검증"
        (verify that passing non-enhanced output to the gate results in an error)

    Raw bytes represent the commodity AI output (Fal.ai / Replicate) that has
    NOT gone through the enhancer pipeline. The gate must reject them
    unconditionally.
    """
    with pytest.raises(RawOutputError):
        require_enhanced_output(_RAW_BYTES)


# ---------------------------------------------------------------------------
# Gate passes for valid pipeline output
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_generation_candidate_passes_gate() -> None:
    """A valid GenerationCandidate produced by run_generation_pipeline passes.

    Only pipeline-produced candidates (which always route through the
    enhancer) are accepted. The gate must not reject valid output.
    """
    candidate = _make_candidate()
    result = require_enhanced_output(candidate)
    assert result is candidate, (
        "require_enhanced_output must return the same GenerationCandidate "
        "unchanged when the input is valid."
    )


# ---------------------------------------------------------------------------
# Other non-enhanced types are also rejected
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "non_enhanced_value",
    [
        b"raw fal.ai output bytes",  # bytes — the primary forbidden type
        b"",  # empty bytes — still raw
        "raw string output",  # str — wrong type
        None,  # None — wrong type
        42,  # int — wrong type
        {"image": b"raw"},  # dict — wrong type
        [],  # empty list — wrong type for single-item gate
        object(),  # arbitrary object — wrong type
    ],
    ids=[
        "bytes_non_empty",
        "bytes_empty",
        "str",
        "None",
        "int",
        "dict",
        "empty_list",
        "arbitrary_object",
    ],
)
def test_non_enhanced_types_raise_raw_output_error(
    non_enhanced_value: object,
) -> None:
    """Any non-GenerationCandidate value raises RawOutputError.

    The gate is a strict type check: only GenerationCandidate (which can
    only be produced by run_generation_pipeline → enhancer) is accepted.
    All other types are rejected to prevent any raw output bypass.
    """
    with pytest.raises(RawOutputError):
        require_enhanced_output(non_enhanced_value)


# ---------------------------------------------------------------------------
# Error message contains type information for routing diagnostics
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_error_message_contains_type_name() -> None:
    """RawOutputError message names the received type for diagnosis.

    When a routing bug causes raw bytes to hit the gate, the error message
    must name the received type so developers can trace the bypass quickly.
    """
    with pytest.raises(RawOutputError, match="bytes"):
        require_enhanced_output(_RAW_BYTES)


@pytest.mark.unit
def test_error_message_mentions_generation_candidate() -> None:
    """RawOutputError message mentions GenerationCandidate as the expected type."""
    with pytest.raises(RawOutputError, match="GenerationCandidate"):
        require_enhanced_output(_RAW_BYTES)


# ---------------------------------------------------------------------------
# RawOutputError is a proper Exception subclass
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_raw_output_error_is_exception_subclass() -> None:
    """RawOutputError inherits from Exception for standard error handling."""
    assert issubclass(RawOutputError, Exception), (
        "RawOutputError must be a subclass of Exception so it can be caught "
        "in FastAPI exception handlers and standard error-handling middleware."
    )


# ---------------------------------------------------------------------------
# require_enhanced_candidates — list-level gate
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_list_of_raw_bytes_raises_raw_output_error() -> None:
    """require_enhanced_candidates rejects a list containing raw bytes.

    The list-level gate must apply the same enforcement as the single-item
    gate: raw bytes inside the list are caught and rejected.
    """
    with pytest.raises(RawOutputError):
        require_enhanced_candidates([_RAW_BYTES])


@pytest.mark.unit
def test_list_of_candidates_passes_gate() -> None:
    """A list of valid GenerationCandidates passes require_enhanced_candidates.

    When the full pipeline output is gated as a list, valid candidates from
    run_generation_pipeline must not be rejected.
    """
    candidates = _make_candidates([_RAW_BYTES, _RAW_BYTES_B])
    result = require_enhanced_candidates(candidates)
    assert result is candidates, (
        "require_enhanced_candidates must return the same list unchanged "
        "when all items are valid GenerationCandidates."
    )
    assert len(result) == 2


@pytest.mark.unit
def test_mixed_list_raises_on_raw_bytes_item() -> None:
    """A list with one valid candidate and one raw bytes item raises.

    The gate must inspect every item; a single non-enhanced item in the
    list triggers RawOutputError even if other items are valid candidates.
    """
    valid_candidate = _make_candidate()
    mixed_list: list[object] = [valid_candidate, _RAW_BYTES_B]

    with pytest.raises(RawOutputError):
        require_enhanced_candidates(mixed_list)  # type: ignore[arg-type]


@pytest.mark.unit
def test_non_list_raises_raw_output_error_in_candidates_gate() -> None:
    """require_enhanced_candidates rejects non-list inputs.

    Passing a single GenerationCandidate directly (instead of a list) must
    raise RawOutputError — the list gate requires a list.
    """
    candidate = _make_candidate()

    with pytest.raises(RawOutputError):
        require_enhanced_candidates(candidate)  # type: ignore[arg-type]


@pytest.mark.unit
def test_empty_list_passes_candidates_gate() -> None:
    """An empty list passes require_enhanced_candidates (zero items to check).

    The gate must not fabricate errors when there are no candidates.
    """
    result = require_enhanced_candidates([])
    assert result == []


# ---------------------------------------------------------------------------
# Single-item gate returns the candidate unchanged (identity)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_require_enhanced_output_returns_same_candidate_object() -> None:
    """require_enhanced_output returns the exact same object, not a copy.

    The gate is a pass-through for valid input — it must not wrap, copy,
    or transform the GenerationCandidate.
    """
    candidate = _make_candidate()
    returned = require_enhanced_output(candidate)
    assert returned is candidate
