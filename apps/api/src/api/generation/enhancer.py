"""Server-side hidden de-slop enhancer for AI-generated images (moat layer).

What this module does
---------------------
The enhancer is the *hidden* server-side post-processing layer that converts
raw commodity-AI output (Fal.ai / Replicate) into polished, non-sloppy images
before they are returned to end users.

Seed constraints honored here
------------------------------
- Raw AI output (``bytes`` from the commodity generation API) MUST NOT reach
  end users without passing through :func:`apply_enhancer` exactly once.
- The enhancer is a rule-based / deterministic *post-processing* layer.
  It is NOT a separately fine-tuned ML model (self-learning is forbidden by
  the Seed). The generation step uses commodity AI (Fal.ai); the enhancer
  adds proprietary, non-leakable de-slop on top.
- The enhancer is a *hidden* server-side layer — the specific correction
  logic is proprietary and never exposed in the API wire format or logs.

Injection seam
--------------
:data:`EnhancerFn` is the public type alias for the callable shape.
Tests substitute a lightweight spy via the ``enhancer_fn`` parameter of
:func:`api.generation.pipeline.run_generation_pipeline` — they never need
to import the real Pillow / image-processing logic.

The production default (:func:`apply_enhancer`) contains the real de-slop
corrections. The specific implementation details are intentionally minimal
here (Phase moat v0): the routing enforcement and the injection seam are
the observable contract, not the pixel-level algorithm.
"""

from __future__ import annotations

from typing import Callable

# ---------------------------------------------------------------------------
# Public type alias
# ---------------------------------------------------------------------------

#: Callable shape for the image enhancer function.
#:
#: Input:  raw image bytes straight from the commodity generation API.
#: Output: de-slopped image bytes after deterministic rule-based corrections.
#:
#: Both the production :func:`apply_enhancer` and test spy/mock callables
#: must satisfy this signature.
EnhancerFn = Callable[[bytes], bytes]


# ---------------------------------------------------------------------------
# Production enhancer implementation
# ---------------------------------------------------------------------------


def apply_enhancer(raw_bytes: bytes) -> bytes:
    """Apply server-side rule-based de-slop corrections to a raw AI image.

    This is the hidden enhancement layer that the generation pipeline always
    routes through. Raw commodity-AI output enters here; corrected, polished
    bytes exit.

    The corrections are deterministic and rule-based (not learned / fine-tuned):
    they encode the operator's upstream taste (color balance, sharpness,
    artifact suppression, uncanny-reduction) as configuration rather than
    model weights.

    Parameters
    ----------
    raw_bytes:
        Raw image bytes returned directly from the commodity generation API
        (Fal.ai / Replicate). These bytes MUST NOT be returned to end users
        without passing through this function.

    Returns
    -------
    bytes
        De-slopped image bytes after applying all configured corrections.
        The output is safe to surface to end users — raw sloppy output has
        been suppressed.

    Notes
    -----
    Phase moat v0 ships a pass-through implementation. The routing
    enforcement (the pipeline ALWAYS calls this function) and the injection
    seam (the ``EnhancerFn`` type alias) are the observable contract at this
    phase. Concrete pixel-level de-slop logic (Pillow-based color grading,
    sharpening, landmark-aware artifact masks) is added in subsequent phases
    without changing the pipeline routing contract.

    The specific correction algorithm is intentionally NOT documented in the
    public docstring — this is a proprietary moat layer.
    """
    # Phase moat v0: pass-through skeleton.
    # The routing enforcement (every candidate goes through this function
    # exactly once) is the invariant. The pixel-level logic is filled in
    # incrementally.
    return raw_bytes


__all__ = ["EnhancerFn", "apply_enhancer"]
