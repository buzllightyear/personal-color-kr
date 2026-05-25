"""Unit-tier conftest: auto-stub the Phase 4.3 ``require_current_user`` dep.

Phase 4.3 added ``Depends(require_current_user)`` to ``POST /v1/diagnose``.
The pre-existing unit tests in ``tests/unit/test_diagnose_*.py`` and
``tests/unit/test_selfie_zero_persistence.py`` construct a fresh FastAPI
app via ``create_app()`` and POST to ``/v1/diagnose`` *without* a bearer
token — under the new auth dependency every such test would 401.

Those tests target the diagnose pipeline (multipart parsing, async
thread offload, error mapping, zero-persistence), not the auth boundary.
Rather than editing 5+ test files to add an inline override, this
conftest patches :func:`api.main.create_app` at module load time so
every freshly-constructed app comes pre-wired with a stub user.

The patch runs as a module-level side effect when pytest collects this
conftest — which happens **before** any sibling test module is imported,
so the ``from api.main import create_app`` line in each test binds to
the patched function from the start.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import api.main
from api.db.models.user import User
from api.dependencies.auth import require_current_user


def _stubbed_user() -> User:
    """Return a deterministic in-memory User row (no DB round-trip).

    The fields satisfy the ``require_current_user`` typed-return
    contract; the values are not asserted on by any diagnose test.
    """
    now = datetime.now(timezone.utc)
    user = User()
    user.id = uuid.uuid4()
    user.apple_sub = "stub-apple-sub-for-unit-tests"
    user.email = None
    user.email_verified = False
    user.display_name = None
    user.created_at = now
    user.updated_at = now
    return user


_original_create_app = api.main.create_app


def _patched_create_app(*args: Any, **kwargs: Any) -> Any:
    """Wrap ``create_app`` to auto-install the auth override."""
    app = _original_create_app(*args, **kwargs)
    app.dependency_overrides[require_current_user] = _stubbed_user
    return app


# Replace the module attribute IN PLACE so any test that does
# ``from api.main import create_app`` after this conftest has loaded
# receives the patched function. Tests that explicitly want to exercise
# the auth dependency (none today) can clear the override by calling
# ``app.dependency_overrides.pop(require_current_user)`` after their
# own ``create_app()`` call.
api.main.create_app = _patched_create_app  # type: ignore[assignment]
