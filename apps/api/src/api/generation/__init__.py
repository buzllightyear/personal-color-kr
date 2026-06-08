"""Image generation sub-package (moat: enhancer de-slop pipeline).

Public surface
--------------
- ``enhancer`` — server-side hidden de-slop enhancer (``apply_enhancer``).
- ``pipeline`` — generation pipeline that *always* routes candidates through
  the enhancer (``run_generation_pipeline``).
- ``output_gate`` — output boundary gate that rejects non-enhanced raw output
  (``require_enhanced_output``, ``require_enhanced_candidates``,
  ``RawOutputError``).

Design constraint (Seed)
------------------------
Raw commodity-AI output (Fal.ai / Replicate) MUST NOT reach end users.
Every image candidate is passed through :func:`api.generation.enhancer.apply_enhancer`
exactly once inside :func:`api.generation.pipeline.run_generation_pipeline`.
The enhancer is a server-side rule/deterministic post-processing layer;
it is NOT a separately trained ML model.

The output boundary gate (``output_gate``) provides a second, independent
enforcement point: at the HTTP response serialization boundary, only
:class:`~api.generation.pipeline.GenerationCandidate` objects (post-enhancer
pipeline output) are accepted. Raw bytes are explicitly rejected.
"""
