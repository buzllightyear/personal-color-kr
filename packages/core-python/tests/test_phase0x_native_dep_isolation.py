"""Regression-baseline guard: Phase 0.x sources must stay native-dep-free.

This file locks in the invariant behind AC 7 of the Phase 0.x runtime
wiring work:

    *All existing Phase 0.x tests must keep passing without `mediapipe`
    or `Pillow` installed.*

The invariant has two enforceable parts:

  1. **Static surface**: the five existing Phase 0.x source files
     (``tone_classifier.py``, ``contrast_classifier.py``,
     ``region_extractor.py``, ``season_classifier.py``,
     ``diagnosis_orchestrator.py``) must contain zero ``import PIL`` /
     ``from PIL`` / ``import mediapipe`` / ``from mediapipe`` lines.
     A grep at test runtime is the cheapest way to catch a leak the
     moment a future commit introduces one.

  2. **Runtime surface**: importing any of those five modules — or the
     new ``face_detector`` lazy-boundary — must not pull ``PIL`` or
     ``mediapipe`` into ``sys.modules``. The face-detector contract is
     deliberately lazy-load: the binary is only loaded on the first
     ``detect_face_regions`` call. We sentinel ``sys.modules`` to prove
     it.

Both checks are dependency-free (``pathlib`` + ``importlib`` only) and
intentionally markerless, so this file runs in **every** lane — the
base no-deps Phase 0.x lane as well as the full integration lane.

If a future refactor accidentally lifts ``mediapipe`` to a module-level
import in ``face_detector.py`` (breaking the lazy contract), or adds a
``PIL`` import to one of the five primitive sources, this file fails
loudly and points to the exact file. That preserves the regression
baseline without relying on a brittle "the test count must equal N"
assertion.
"""

from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Allowlists.
# ---------------------------------------------------------------------------

# The five existing Phase 0.x source files. These pre-date the Phase 0.x
# runtime-wiring work and must stay native-dep-free under any future edit.
_PHASE_0X_EXISTING_SOURCES: tuple[str, ...] = (
    "tone_classifier.py",
    "contrast_classifier.py",
    "region_extractor.py",
    "season_classifier.py",
    "diagnosis_orchestrator.py",
)

# Native dependencies that, by Phase 0.x contract, must NOT appear in any
# of the five primitive sources above. Each entry is a tuple of (regex,
# human-readable name) so the failure message stays useful.
_FORBIDDEN_IMPORTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^\s*(?:from\s+PIL\b|import\s+PIL\b)"), "PIL / Pillow"),
    (re.compile(r"^\s*(?:from\s+mediapipe\b|import\s+mediapipe\b)"), "mediapipe"),
)


def _personal_color_src_dir() -> Path:
    """Resolve ``packages/core-python/src/personal_color/`` from this file."""
    # tests/test_phase0x_native_dep_isolation.py
    #   -> tests/  -> packages/core-python/  -> src/personal_color/
    here = Path(__file__).resolve()
    src = here.parent.parent / "src" / "personal_color"
    assert src.is_dir(), f"personal_color src directory missing at {src}"
    return src


# ---------------------------------------------------------------------------
# Static-surface checks.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("filename", _PHASE_0X_EXISTING_SOURCES)
def test_existing_phase0x_source_has_no_native_dep_imports(filename: str) -> None:
    """The five primitive sources contain zero PIL / mediapipe imports."""
    src_path = _personal_color_src_dir() / filename
    text = src_path.read_text(encoding="utf-8")

    for line_no, raw_line in enumerate(text.splitlines(), start=1):
        # Ignore comments and docstrings — only real top-of-line imports
        # (or indented re-imports inside functions) trigger the guard.
        # The regex anchors ``^\s*from`` / ``^\s*import``, so prose
        # mentioning "import PIL" inside a docstring won't match.
        stripped = raw_line.lstrip()
        if stripped.startswith("#"):
            continue
        for pattern, label in _FORBIDDEN_IMPORTS:
            if pattern.match(raw_line):
                pytest.fail(
                    f"{filename}:{line_no} imports {label}, which breaks the "
                    f"Phase 0.x regression baseline (these sources must "
                    f"remain runnable with native deps uninstalled). "
                    f"Offending line: {raw_line.rstrip()!r}"
                )


# ---------------------------------------------------------------------------
# Runtime-surface checks.
# ---------------------------------------------------------------------------


def _purge_native_modules() -> None:
    """Drop any cached PIL / mediapipe entries from ``sys.modules``.

    Other tests in the suite (e.g. ``test_image_decoder.py``) may have
    loaded Pillow before this file runs. To get a meaningful "did this
    import leak a native dep" signal we wipe the cache first, then
    re-import the target module fresh. Any post-import re-appearance of
    ``PIL`` or ``mediapipe`` in ``sys.modules`` is then attributable to
    the module under test.
    """
    for mod_name in list(sys.modules):
        if mod_name == "PIL" or mod_name.startswith("PIL."):
            del sys.modules[mod_name]
        elif mod_name == "mediapipe" or mod_name.startswith("mediapipe."):
            del sys.modules[mod_name]


@pytest.mark.parametrize("filename", _PHASE_0X_EXISTING_SOURCES)
def test_existing_phase0x_module_import_does_not_load_native_deps(
    filename: str,
) -> None:
    """Importing any primitive source must not touch PIL / mediapipe."""
    module_name = f"personal_color.{filename.removesuffix('.py')}"

    _purge_native_modules()
    # Force a fresh import so the side-effect of module load is observable.
    sys.modules.pop(module_name, None)
    importlib.import_module(module_name)

    leaked = sorted(
        m
        for m in sys.modules
        if m == "PIL"
        or m.startswith("PIL.")
        or m == "mediapipe"
        or m.startswith("mediapipe.")
    )
    assert not leaked, (
        f"Importing {module_name} leaked native dep(s) into sys.modules: "
        f"{leaked}. The Phase 0.x primitive sources must remain "
        f"importable in a no-PIL / no-mediapipe environment."
    )


def test_face_detector_module_import_is_lazy_for_mediapipe() -> None:
    """The MediaPipe boundary file must not eager-load mediapipe at import.

    This is the lazy-load contract documented in
    ``face_detector.py`` (and required by Phase 0.x AC 7): merely
    importing the module — for type-only references, factory wiring, or
    DI in ``diagnose_personal_color`` — must not trigger the native
    binary load. The binary may only be loaded on the first
    ``detect_face_regions`` call.
    """
    _purge_native_modules()
    sys.modules.pop("personal_color.face_detector", None)
    importlib.import_module("personal_color.face_detector")

    leaked = sorted(
        m for m in sys.modules if m == "mediapipe" or m.startswith("mediapipe.")
    )
    assert not leaked, (
        "Importing personal_color.face_detector pulled mediapipe into "
        f"sys.modules: {leaked}. The boundary file must lazy-load the "
        "binary on first detect call, not at module import."
    )
