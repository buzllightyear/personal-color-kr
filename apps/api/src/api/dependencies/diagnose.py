"""FastAPI ``Depends``-injectable diagnose callable (Sub-AC 5.3).

The Seed pins a single injection seam — ``get_diagnose_fn`` — through which the
``POST /v1/diagnose`` route obtains the Phase 3.2 ``diagnose_personal_color``
entry point. Production callers receive the real pipeline (Pillow decode →
MediaPipe face detection → tone/contrast/season composition); test callers
override the dependency via ``app.dependency_overrides[get_diagnose_fn] =
stub_fn`` to substitute a fixed ``DiagnosisResult`` and therefore avoid loading
MediaPipe / Pillow in the unit tier.

Design notes (Phase 4.1 Seed):
    - The provider returns the *callable*, not the result. The route handler
      composes ``await asyncio.to_thread(diagnose_fn, selfie_bytes)`` itself —
      this keeps the sync-in-async invariant (verified by Sub-AC 5 spy tests)
      observable at the route layer rather than buried in the provider.
    - The function signature is ``() -> Callable[[bytes], DiagnosisResult]``
      so a ``FastAPI.Depends(get_diagnose_fn)`` binding receives the *real*
      ``diagnose_personal_color`` symbol by default, and a test override that
      returns a stub of the same type signature is type-compatible without
      jumping through Protocol gymnastics.
    - The module imports ``diagnose_personal_color`` once at module scope. The
      transitive MediaPipe / Pillow load happens when the unit test suite
      *constructs the FastAPI app without overriding the dependency* — which
      is intentional: tests that need the lightweight path call
      ``app.dependency_overrides[get_diagnose_fn] = lambda: stub_fn`` before
      issuing a request, and the import-time cost of MediaPipe is amortized
      across the integration tier where it is genuinely needed.

Invariants (cross-checked by AC11, AC12):
    - No ``sqlalchemy*`` imports here (DB boundary lives in ``api.db.*``).
    - No Fal.ai vendor-key reference here (deferred to Phase 4.4+).
    - No production branching on ``MOCK`` / ``DRY_RUN`` / ``TEST`` flags — the
      sole stubbing mechanism is ``app.dependency_overrides``.
"""

from __future__ import annotations

from typing import Callable, cast

from personal_color.diagnose_runtime import (
    DiagnosisResult,
    diagnose_personal_color,
)

#: Type alias for the callable shape that ``get_diagnose_fn`` returns. Pinned
#: at module scope so test stubs and the production default can be annotated
#: against the same name.
DiagnoseFn = Callable[[bytes], DiagnosisResult]


def get_diagnose_fn() -> DiagnoseFn:
    """Return the production diagnose callable.

    The default implementation is Phase 3.2's
    :func:`personal_color.diagnose_runtime.diagnose_personal_color` —
    a synchronous, CPU-bound function that decodes the selfie bytes via
    Pillow, runs MediaPipe face detection, and composes the
    ``DiagnosisResult`` dataclass.

    The route handler invokes the returned callable inside
    ``asyncio.to_thread`` so the CPU-bound pipeline never blocks the event
    loop. The unit tier replaces this provider via
    ``app.dependency_overrides[get_diagnose_fn]`` so the real pipeline is
    not exercised when only the HTTP wiring is under test.

    Returns
    -------
    DiagnoseFn
        A callable ``bytes -> DiagnosisResult``.
    """
    # ``personal_color`` ships fully annotated code but no PEP 561 ``py.typed``
    # marker, so apps/api configures mypy with ``follow_imports = "silent"``
    # for that namespace. Under that mode the symbol resolves as ``Any``,
    # which would otherwise force a ``no-any-return`` error here. The cast
    # pins the public boundary at ``DiagnoseFn`` so downstream call sites
    # (``api.routers.diagnose``) receive the precise callable type.
    return cast(DiagnoseFn, diagnose_personal_color)


__all__ = ["DiagnoseFn", "get_diagnose_fn"]
