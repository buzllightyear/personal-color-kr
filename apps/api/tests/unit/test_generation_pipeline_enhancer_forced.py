"""Unit tests: generation pipeline must always route through apply_enhancer (Sub-AC 2).

Acceptance criterion (Sub-AC 2) being verified
-----------------------------------------------
    이미지 생성 파이프라인 모듈이 항상 apply_enhancer를 거치도록 라우팅하는 로직.
    테스트: enhancer를 mock으로 대체한 뒤 파이프라인 실행 시 enhancer가 정확히 1회
    호출됨을 검증.

    English: The image generation pipeline module must always route through
    apply_enhancer. Test: Replace the enhancer with a mock, then verify that
    when the pipeline runs, the enhancer is called exactly 1 time.

Invariants asserted
-------------------
1. For a single raw candidate, the enhancer is called **exactly once**.
2. For N raw candidates, the enhancer is called **exactly N times** (one per
   candidate — no batching, no skipping, no double-processing).
3. The enhancer receives the **verbatim raw bytes** it was given.
4. The output ``GenerationCandidate.image_bytes`` is the **verbatim return
   value** of the enhancer (not the raw input, not a copy of raw input).
5. ``run_generation_pipeline`` raises ``TypeError`` when ``enhancer_fn=None``
   is passed — there is no raw-passthrough escape hatch.
6. The pipeline output list length equals the input list length (no drops,
   no duplicates from the routing logic itself).
7. ``candidate_index`` values match the input order.

Testing technique
-----------------
A lightweight ``_EnhancerSpy`` class (no external mocking library needed)
records every call.  The spy is injected via the ``enhancer_fn`` keyword
argument of :func:`api.generation.pipeline.run_generation_pipeline`.
No real image bytes are required — the spy returns arbitrary bytes so the
test never touches Pillow / Fal.ai / MediaPipe.
"""

from __future__ import annotations

import pytest

from api.generation.pipeline import GenerationCandidate, run_generation_pipeline

# ---------------------------------------------------------------------------
# Test spy — records invocations without external mocking libs
# ---------------------------------------------------------------------------


class _EnhancerSpy:
    """An enhancer callable that records every invocation.

    The spy appends the received bytes to :attr:`received` for each call and
    returns a deterministic *enhanced* bytes value (the original bytes XOR'd
    with 0x01 per byte) so the test can distinguish the enhanced output from
    the raw input.

    Attributes
    ----------
    received:
        All raw-bytes arguments passed to this spy, in call order.
    call_count:
        Number of times the spy was invoked (``len(received)``).
    """

    def __init__(self) -> None:
        self.received: list[bytes] = []

    @property
    def call_count(self) -> int:
        """Return the number of times the spy was called."""
        return len(self.received)

    def __call__(self, raw_bytes: bytes) -> bytes:
        """Record the call and return deterministically-transformed bytes."""
        self.received.append(raw_bytes)
        # Return transformed bytes so tests can distinguish raw vs enhanced.
        # XOR every byte with 0x01 — reversible, cheap, distinct from raw.
        return bytes(b ^ 0x01 for b in raw_bytes)


# ---------------------------------------------------------------------------
# Canonical raw candidate bytes — small, distinct, no real image content
# ---------------------------------------------------------------------------

_RAW_A: bytes = b"\x10\x20\x30\x40"
_RAW_B: bytes = b"\xaa\xbb\xcc\xdd"
_RAW_C: bytes = b"\xff\x00\xff\x00"


def _expected_enhanced(raw: bytes) -> bytes:
    """Return the deterministic output that _EnhancerSpy produces for raw."""
    return bytes(b ^ 0x01 for b in raw)


# ---------------------------------------------------------------------------
# Sub-AC 2 core test: enhancer called exactly 1 time for a single candidate
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_enhancer_called_exactly_once_for_single_candidate() -> None:
    """For one raw candidate, the enhancer is called **exactly 1 time**.

    This is the canonical Sub-AC 2 assertion:
        "파이프라인 실행 시 enhancer가 정확히 1회 호출됨을 검증"
        (verify that when the pipeline runs, the enhancer is called exactly
        1 time).

    The spy replaces the production :func:`api.generation.enhancer.apply_enhancer`
    via the ``enhancer_fn`` keyword argument so the pipeline never touches
    real image processing.
    """
    spy = _EnhancerSpy()

    candidates = run_generation_pipeline(
        raw_candidates=[_RAW_A],
        enhancer_fn=spy,
    )

    assert spy.call_count == 1, (
        f"Sub-AC 2 violation: expected the enhancer to be called exactly "
        f"1 time for a single raw candidate, but it was called "
        f"{spy.call_count} time(s)."
    )

    assert len(candidates) == 1
    assert isinstance(candidates[0], GenerationCandidate)


# ---------------------------------------------------------------------------
# Routing correctness: raw bytes reach the enhancer verbatim
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_enhancer_receives_verbatim_raw_bytes() -> None:
    """The enhancer receives the *exact* raw bytes from the pipeline input.

    Ensures the pipeline does not accidentally copy, truncate, or transform
    the bytes before handing them to the enhancer.
    """
    spy = _EnhancerSpy()

    run_generation_pipeline(
        raw_candidates=[_RAW_A],
        enhancer_fn=spy,
    )

    assert spy.received[0] == _RAW_A, (
        f"The enhancer received {spy.received[0]!r} but expected the "
        f"verbatim raw input {_RAW_A!r}. The pipeline must not mutate "
        f"bytes before passing them to the enhancer."
    )


# ---------------------------------------------------------------------------
# Output correctness: GenerationCandidate.image_bytes == enhancer return value
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_candidate_image_bytes_equal_enhancer_output() -> None:
    """``GenerationCandidate.image_bytes`` is the *enhancer's return value*.

    The pipeline must not substitute the raw bytes or any other value.
    The end-user-facing candidate bytes must come exclusively from the
    enhancer — raw AI output is suppressed.
    """
    spy = _EnhancerSpy()

    candidates = run_generation_pipeline(
        raw_candidates=[_RAW_A],
        enhancer_fn=spy,
    )

    expected_bytes = _expected_enhanced(_RAW_A)
    assert candidates[0].image_bytes == expected_bytes, (
        f"Expected GenerationCandidate.image_bytes == {expected_bytes!r} "
        f"(the enhancer's output), got {candidates[0].image_bytes!r}. "
        f"The pipeline must not return raw AI bytes to the caller."
    )

    # Paranoia: also confirm the raw bytes are *not* the output.
    assert candidates[0].image_bytes != _RAW_A, (
        "GenerationCandidate.image_bytes equals the raw input — raw AI "
        "output is leaking past the enhancer. The pipeline must always "
        "return the enhancer's output, not the raw bytes."
    )


# ---------------------------------------------------------------------------
# N-candidate routing: enhancer called exactly N times
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_enhancer_called_n_times_for_n_candidates() -> None:
    """For N raw candidates, the enhancer is called exactly N times.

    Confirms that the routing loop processes every candidate individually —
    no batching that could call the enhancer fewer than N times, no accidental
    double-processing that calls it more than N times.
    """
    raw_inputs = [_RAW_A, _RAW_B, _RAW_C]
    spy = _EnhancerSpy()

    candidates = run_generation_pipeline(
        raw_candidates=raw_inputs,
        enhancer_fn=spy,
    )

    assert spy.call_count == 3, (
        f"Expected enhancer to be called 3 times (once per candidate), "
        f"got {spy.call_count} call(s)."
    )
    assert len(candidates) == 3


# ---------------------------------------------------------------------------
# Per-candidate routing: each raw bytes value reaches the enhancer
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_enhancer_called_with_each_raw_bytes_in_order() -> None:
    """Each candidate's raw bytes are passed to the enhancer in input order.

    The spy records all calls; this test verifies that the i-th call received
    the i-th raw input verbatim and in order.
    """
    raw_inputs = [_RAW_A, _RAW_B, _RAW_C]
    spy = _EnhancerSpy()

    run_generation_pipeline(
        raw_candidates=raw_inputs,
        enhancer_fn=spy,
    )

    assert spy.received == raw_inputs, (
        f"Expected enhancer calls in order {raw_inputs!r}, " f"got {spy.received!r}."
    )


# ---------------------------------------------------------------------------
# Output order: GenerationCandidate list mirrors input order
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_candidate_index_matches_input_order() -> None:
    """``GenerationCandidate.candidate_index`` equals the input position.

    Downstream stages (reject filter, user pick) rely on the index to
    correlate candidates back to their generation order.
    """
    raw_inputs = [_RAW_A, _RAW_B, _RAW_C]
    spy = _EnhancerSpy()

    candidates = run_generation_pipeline(
        raw_candidates=raw_inputs,
        enhancer_fn=spy,
    )

    for expected_idx, candidate in enumerate(candidates):
        assert candidate.candidate_index == expected_idx, (
            f"Expected candidate_index={expected_idx}, "
            f"got {candidate.candidate_index}."
        )


# ---------------------------------------------------------------------------
# No raw-passthrough escape hatch: enhancer_fn=None raises TypeError
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_pipeline_raises_type_error_when_enhancer_fn_is_none() -> None:
    """Passing ``enhancer_fn=None`` raises ``TypeError`` immediately.

    There is no "raw-passthrough" mode. The pipeline enforces that the
    enhancer is always a callable; a ``None`` value is rejected at the
    entry point so raw AI output can never bypass the enhancer through
    accidental ``None`` injection.
    """
    with pytest.raises(TypeError):
        run_generation_pipeline(
            raw_candidates=[_RAW_A],
            enhancer_fn=None,  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# Empty input: zero candidates → enhancer not called, empty list returned
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_empty_input_produces_empty_output_and_no_enhancer_call() -> None:
    """Zero raw candidates → enhancer is never called, empty list returned.

    The pipeline must not call the enhancer with synthetic data when the
    input is empty.
    """
    spy = _EnhancerSpy()

    candidates = run_generation_pipeline(
        raw_candidates=[],
        enhancer_fn=spy,
    )

    assert spy.call_count == 0, (
        f"Enhancer was called {spy.call_count} time(s) for an empty input; "
        f"expected 0 calls."
    )
    assert candidates == [], f"Expected empty list for empty input, got {candidates!r}."
