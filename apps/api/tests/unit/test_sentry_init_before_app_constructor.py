"""AC-17: ``init_sentry_for_environment`` runs before the FastAPI constructor.

# What AC-17 pins

> ``api.main.create_app`` calls
> :func:`api.observability.sentry.init_sentry_for_environment` **before** it
> constructs the ``FastAPI(...)`` application object.

This ordering is a *boot-readiness* invariant, not a stylistic one. The Sentry
SDK installs **process-global** error hooks (``sys.excepthook`` integration, the
logging integration, the global hub). Those hooks must be armed *before* the
ASGI app — and every router and middleware mounted on it — comes into being, so
that a failure during the rest of ``create_app`` (router import, middleware
wiring) is still captured. Initializing Sentry *after* the constructor would
leave a window where the app exists but error capture does not.

The established ``create_app`` prologue (locked by the Level-3 governed merge) is:

    configure_json_logging()        # 1. structured JSON logging armed first
    init_sentry_for_environment()   # 2. Sentry init lifecycle logs route through it
    app = FastAPI(...)              # 3. only now is the app constructed

``configure_json_logging`` is ordered *before* ``init_sentry_for_environment``
on purpose: the init lifecycle records (``sentry_init_completed`` /
``sentry_init_skipped``) must emit through the configured JSON stream. Both run
before the ``FastAPI`` constructor.

# How this module verifies it (two independent tiers)

    1. **Runtime call-order tier** — patches ``configure_json_logging``,
       ``init_sentry_for_environment``, and ``FastAPI`` (as seen by
       ``api.main``) with recorders that append to a shared sequence list, then
       drives ``create_app()`` and asserts the observed call order. This proves
       the *behavior* at construction time.

    2. **Source-structure tier** — parses ``api/main.py`` with :mod:`ast` and
       asserts that, inside the ``create_app`` body, the
       ``init_sentry_for_environment()`` call statement lexically precedes the
       ``FastAPI(...)`` constructor call. This is a defense-in-depth guard that
       catches a reorder even if a future refactor changes how the runtime
       wiring is mocked.

# Test isolation

No test contacts Sentry.io: ``init_sentry_for_environment`` is replaced with a
recorder, so ``sentry_sdk.init`` is never reached. ``FastAPI`` is likewise
replaced with a stub returning a ``MagicMock``, so no real ASGI app, router, or
middleware is constructed — the tests observe *ordering only*.
"""

from __future__ import annotations

import ast
import inspect
from typing import Any
from unittest.mock import MagicMock

import pytest

import api.main as main_module

pytestmark = pytest.mark.unit

# Sentinels recorded into the shared call-order list by the patched callables.
_LOGGING = "configure_json_logging"
_SENTRY_INIT = "init_sentry_for_environment"
_FASTAPI_CTOR = "FastAPI.__init__"


@pytest.fixture()
def call_order(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Patch the create_app prologue callables to record their invocation order.

    Returns the shared list that ``create_app`` populates, in call order. Each
    patched callable appends its sentinel before doing its (mocked) work, so the
    list reflects the exact sequence ``create_app`` invoked them in.

    ``FastAPI`` is replaced with a stub that returns a ``MagicMock`` so the
    downstream ``app.state`` / ``add_middleware`` / ``include_router`` calls in
    ``create_app`` are absorbed harmlessly — no real app is built.
    """
    order: list[str] = []

    def _record_logging() -> None:
        order.append(_LOGGING)

    def _record_sentry_init() -> bool:
        order.append(_SENTRY_INIT)
        return False  # mirror the fail-open no-op return; value is unused here

    def _record_fastapi(*_args: Any, **_kwargs: Any) -> MagicMock:
        order.append(_FASTAPI_CTOR)
        # A MagicMock absorbs every subsequent attribute/item access that
        # create_app performs on the app object (state, add_middleware,
        # include_router, dependency_overrides[...] from the conftest wrapper).
        return MagicMock(name="FastAPIAppStub")

    monkeypatch.setattr(main_module, "configure_json_logging", _record_logging)
    monkeypatch.setattr(main_module, "init_sentry_for_environment", _record_sentry_init)
    monkeypatch.setattr(main_module, "FastAPI", _record_fastapi)
    return order


# ---------------------------------------------------------------------------
# Runtime call-order tier — observe the real create_app prologue executing.
# ---------------------------------------------------------------------------


def test_sentry_init_recorded_before_fastapi_constructor(
    call_order: list[str],
) -> None:
    """The headline AC-17 behavior: init runs before the FastAPI constructor."""
    main_module.create_app()

    assert _SENTRY_INIT in call_order, "init_sentry_for_environment was never called"
    assert _FASTAPI_CTOR in call_order, "FastAPI constructor was never called"
    assert call_order.index(_SENTRY_INIT) < call_order.index(_FASTAPI_CTOR)


def test_sentry_init_called_exactly_once(call_order: list[str]) -> None:
    """create_app arms Sentry exactly once — no duplicate init per construction."""
    main_module.create_app()
    assert call_order.count(_SENTRY_INIT) == 1


def test_fastapi_constructed_exactly_once(call_order: list[str]) -> None:
    """Sanity: a single app object is constructed per create_app call."""
    main_module.create_app()
    assert call_order.count(_FASTAPI_CTOR) == 1


def test_logging_configured_before_sentry_init(call_order: list[str]) -> None:
    """JSON logging is armed before Sentry init so lifecycle logs route through it."""
    main_module.create_app()
    assert call_order.index(_LOGGING) < call_order.index(_SENTRY_INIT)


def test_full_prologue_order_is_logging_then_sentry_then_fastapi(
    call_order: list[str],
) -> None:
    """The first three recorded calls are, in order: logging, sentry, FastAPI."""
    main_module.create_app()
    assert call_order[:3] == [_LOGGING, _SENTRY_INIT, _FASTAPI_CTOR]


def test_sentry_init_precedes_fastapi_across_repeated_constructions(
    call_order: list[str],
) -> None:
    """The invariant holds per call — a second create_app re-arms before its app."""
    main_module.create_app()
    main_module.create_app()

    # Two inits and two constructors, strictly interleaved init→ctor, init→ctor.
    init_positions = [i for i, c in enumerate(call_order) if c == _SENTRY_INIT]
    ctor_positions = [i for i, c in enumerate(call_order) if c == _FASTAPI_CTOR]
    assert len(init_positions) == 2
    assert len(ctor_positions) == 2
    for init_pos, ctor_pos in zip(init_positions, ctor_positions):
        assert init_pos < ctor_pos


# ---------------------------------------------------------------------------
# Source-structure tier — lexical guard on api/main.py via the AST.
# ---------------------------------------------------------------------------


def _create_app_ast() -> ast.FunctionDef:
    """Return the parsed ``create_app`` FunctionDef node from ``api.main``."""
    source = inspect.getsource(main_module)
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "create_app":
            return node
    raise AssertionError("create_app function not found in api.main source")


def _first_call_line(func: ast.FunctionDef, callee_name: str) -> int:
    """Return the line number of the first call to ``callee_name`` in ``func``.

    Matches both bare-name calls (``init_sentry_for_environment()``) and the
    ``FastAPI(...)`` constructor (also a bare ``Name`` callee in api.main).
    """
    for node in ast.walk(func):
        if isinstance(node, ast.Call):
            callee = node.func
            if isinstance(callee, ast.Name) and callee.id == callee_name:
                return node.lineno
    raise AssertionError(f"No call to {callee_name}() found inside create_app")


def test_source_init_call_precedes_fastapi_constructor() -> None:
    """AST guard: the init call statement lexically precedes ``FastAPI(...)``."""
    func = _create_app_ast()
    init_line = _first_call_line(func, "init_sentry_for_environment")
    fastapi_line = _first_call_line(func, "FastAPI")
    assert init_line < fastapi_line, (
        "init_sentry_for_environment() must appear before the FastAPI(...) "
        "constructor inside create_app"
    )


def test_source_logging_call_precedes_init_call() -> None:
    """AST guard: configure_json_logging() precedes init_sentry_for_environment()."""
    func = _create_app_ast()
    logging_line = _first_call_line(func, "configure_json_logging")
    init_line = _first_call_line(func, "init_sentry_for_environment")
    assert logging_line < init_line


def test_source_create_app_calls_init_exactly_once() -> None:
    """AST guard: exactly one init call site lives inside create_app."""
    func = _create_app_ast()
    init_calls = [
        node
        for node in ast.walk(func)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "init_sentry_for_environment"
    ]
    assert len(init_calls) == 1


def test_source_init_is_imported_into_main() -> None:
    """AC-17 wiring: api.main binds the init symbol it is required to call."""
    assert hasattr(main_module, "init_sentry_for_environment")
    # The bound symbol is the real observability entry point (not shadowed).
    from api.observability.sentry import (
        init_sentry_for_environment as real_init,
    )

    assert main_module.init_sentry_for_environment is real_init
