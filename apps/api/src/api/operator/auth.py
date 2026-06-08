"""Operator singleton role enforcement — AC11.

Seed constraints honored here
------------------------------
- operator = system-level singleton actor. Exactly one operator exists.
- End users MUST NOT access operator APIs (recipe CRUD, reject threshold
  setting, trend drop push, call log writing).
- End user token → 403 Forbidden on operator APIs.

Design
------
:func:`require_operator` is a dependency/guard that checks whether the
caller is the operator singleton. If not, raises :class:`ForbiddenError`
(maps to HTTP 403).

The operator is identified by ``OPERATOR_ID`` constant (singleton).
In tests, inject a mock identity to simulate both operator and user calls.

The 4 protected operator APIs:
1. recipe CRUD
2. reject threshold setting
3. trend drop push
4. call log writing
"""

from __future__ import annotations

from typing import Final

# ---------------------------------------------------------------------------
# Operator singleton identity
# ---------------------------------------------------------------------------

#: The one and only operator ID (singleton). This constant is the canonical
#: identity for the operator; it cannot be changed without a code deploy.
OPERATOR_ID: Final[str] = "operator_singleton"


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class ForbiddenError(Exception):
    """Raised when a non-operator identity attempts an operator-only API.

    Maps to HTTP 403 Forbidden in the API layer.
    """

    def __init__(self, caller_id: str) -> None:
        super().__init__(
            f"Access denied: caller {caller_id!r} is not the operator singleton. "
            f"Recipe CRUD, reject threshold setting, trend drop push, and call "
            f"log writing are restricted to the operator singleton only."
        )
        self.caller_id = caller_id


# ---------------------------------------------------------------------------
# Role guard
# ---------------------------------------------------------------------------


def require_operator(caller_id: str) -> str:
    """Assert that caller_id is the operator singleton.

    Parameters
    ----------
    caller_id:
        The identity of the API caller (from JWT sub or equivalent).

    Returns
    -------
    str
        The operator ID (unchanged), for chaining.

    Raises
    ------
    ForbiddenError
        If caller_id is not the operator singleton.
    """
    if caller_id != OPERATOR_ID:
        raise ForbiddenError(caller_id)
    return caller_id


def is_operator(caller_id: str) -> bool:
    """Return True if caller_id is the operator singleton."""
    return caller_id == OPERATOR_ID


# ---------------------------------------------------------------------------
# Operator-only API names (for documentation / error messages)
# ---------------------------------------------------------------------------

OPERATOR_ONLY_APIS: Final[list[str]] = [
    "recipe_crud",
    "reject_threshold_setting",
    "trend_drop_push",
    "call_log_write",
]

__all__ = [
    "OPERATOR_ID",
    "ForbiddenError",
    "require_operator",
    "is_operator",
    "OPERATOR_ONLY_APIS",
]
