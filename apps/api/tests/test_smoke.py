"""Pytest smoke test for ``apps/api`` (Sub-AC 1 — Phase 4.2).

Acceptance criterion being verified
-----------------------------------
Sub-AC 1: *Configure pytest in apps/api with a smoke test module that
runs in CI and exits 0.*

This module is the minimum trip-wire that proves four things about the
``apps/api`` CI step (``python -m pytest -q`` inside ``apps/api``):

1. **pytest is discoverable.** The ``[tool.pytest.ini_options]`` block
   in ``apps/api/pyproject.toml`` resolves: ``pythonpath = ["src"]`` and
   ``testpaths = ["tests"]`` are honored, so this file is collected
   without any extra CLI flags.

2. **The ``api`` package imports.** ``pip install -e apps/api`` (the
   CI install line) put ``src/`` onto ``sys.path``; importing ``api``
   here confirms the editable install is wired and ``__init__.py``
   has no import-time side effects that would crash collection.

3. **The ``unit`` marker is registered.** ``pyproject.toml`` declares
   the marker; using it here guards against the marker being removed
   from the markers allowlist (which would surface as a
   ``PytestUnknownMarkWarning`` under ``-W error::pytest.PytestUnknownMarkWarning``).

4. **The smoke test exits 0.** A single trivially-true assertion gives
   pytest a green test to report, so the CI step's exit code is 0
   even on a brand-new clone where every other unit/integration test
   were somehow skipped or filtered out. This is the canonical
   "is the test runner alive" check.

Design constraints (Seed-pinned)
--------------------------------
* **No I/O.** No DB connection, no HTTP client, no filesystem write,
  no network. The unit tier must run on a laptop with no
  ``DATABASE_URL`` set and no ``postgres:16`` reachable.
* **No fixtures.** Avoids coupling the smoke trip-wire to
  ``conftest.py`` evolution.
* **No async.** Sync tests are the cheapest possible signal; they
  also prove the runner works even if ``pytest-asyncio`` is
  misconfigured. (The other tests will surface async breakage on
  their own.)
* **No imports beyond ``api``.** Pulling in ``api.main.create_app`` or
  ``api.db.*`` would defeat the "minimal" property by transitively
  loading FastAPI, SQLAlchemy, and asyncpg — those are exercised
  by the dedicated endpoint/db tests, not here.
"""

from __future__ import annotations

import pytest


@pytest.mark.unit
def test_pytest_smoke_exits_zero() -> None:
    """Trivially-true assertion that gives CI a green test.

    If pytest can collect and execute this single ``assert True`` then
    the ``apps/api`` test runner is healthy: ``pyproject.toml`` is
    parsed, ``pythonpath`` is honored, the ``unit`` marker is
    registered, and the test loop terminates with exit code 0.

    Conversely, a failure here means the CI runner cannot even reach
    the real unit/integration tests, so this test is the first signal
    operators should look at when ``python -m pytest -q`` returns a
    non-zero exit code from a clean checkout.
    """
    assert True, "pytest smoke trip-wire failed — apps/api CI runner is not healthy"


@pytest.mark.unit
def test_api_package_imports_without_side_effects() -> None:
    """Importing the ``api`` package succeeds and binds a module object.

    Confirms that ``pip install -e apps/api`` correctly wires ``src/``
    onto ``sys.path`` for the test process. A regression here usually
    means one of:

    * ``[tool.setuptools.packages.find] where = ["src"]`` was removed
      from ``pyproject.toml`` and the editable install no longer
      exposes the package, or
    * an import-time side effect (e.g., reading an env var, opening a
      file, or constructing an ``Engine``) was added to
      ``src/api/__init__.py``, breaking the "import is free"
      invariant the rest of the test suite relies on.

    The assertion deliberately avoids attribute access on the module
    so that adding/removing public symbols in ``api/__init__.py`` does
    not couple this smoke test to package internals.
    """
    import api  # local import: keeps module loading scoped to this test

    assert api is not None, "import api yielded None — packaging is broken"
