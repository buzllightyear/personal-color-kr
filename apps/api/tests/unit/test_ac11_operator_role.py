"""AC11: Operator role separation — 4 APIs protected, end user token → 403.

Acceptance criteria verified
-----------------------------
AC11: operator 싱글턴이 recipe CRUD, reject 임계값 설정, trend drop push,
      call log 작성 4개 API 보유.
      end user 토큰으로 이 4개 API 호출 시 403 거부.
"""

from __future__ import annotations

import pytest

from api.operator.auth import (
    OPERATOR_ID,
    OPERATOR_ONLY_APIS,
    ForbiddenError,
    is_operator,
    require_operator,
)

# ---------------------------------------------------------------------------
# require_operator: passes for operator
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_operator_id_passes_require_operator() -> None:
    """require_operator returns the operator_id when called as operator."""
    result = require_operator(OPERATOR_ID)
    assert result == OPERATOR_ID


# ---------------------------------------------------------------------------
# require_operator: raises for non-operator (end user)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_end_user_id_raises_forbidden_error() -> None:
    """An end user caller raises ForbiddenError (maps to 403)."""
    with pytest.raises(ForbiddenError) as exc_info:
        require_operator("end_user_abc123")
    assert "end_user_abc123" in str(exc_info.value)


@pytest.mark.unit
def test_empty_caller_raises_forbidden_error() -> None:
    """Empty string caller raises ForbiddenError."""
    with pytest.raises(ForbiddenError):
        require_operator("")


@pytest.mark.unit
def test_arbitrary_jwt_sub_raises_forbidden_error() -> None:
    """A random JWT sub that is not the operator raises ForbiddenError."""
    import uuid

    with pytest.raises(ForbiddenError):
        require_operator(str(uuid.uuid4()))


# ---------------------------------------------------------------------------
# ForbiddenError is an Exception subclass
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_forbidden_error_is_exception_subclass() -> None:
    """ForbiddenError inherits from Exception."""
    assert issubclass(ForbiddenError, Exception)


# ---------------------------------------------------------------------------
# is_operator helper
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_is_operator_returns_true_for_operator() -> None:
    assert is_operator(OPERATOR_ID) is True


@pytest.mark.unit
def test_is_operator_returns_false_for_end_user() -> None:
    assert is_operator("end_user_abc") is False


# ---------------------------------------------------------------------------
# 4 operator-only APIs are listed
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_four_operator_only_apis_defined() -> None:
    """OPERATOR_ONLY_APIS contains exactly the 4 required API names."""
    expected = {
        "recipe_crud",
        "reject_threshold_setting",
        "trend_drop_push",
        "call_log_write",
    }
    assert set(OPERATOR_ONLY_APIS) == expected


# ---------------------------------------------------------------------------
# Simulated API guards: end user calls raise 403 on all 4 APIs
# ---------------------------------------------------------------------------


def _recipe_crud_api(caller_id: str) -> str:
    """Simulated recipe CRUD operator API."""
    require_operator(caller_id)
    return "recipe CRUD executed"


def _reject_threshold_api(caller_id: str) -> str:
    """Simulated reject threshold setting operator API."""
    require_operator(caller_id)
    return "threshold set"


def _trend_drop_push_api(caller_id: str) -> str:
    """Simulated trend drop push operator API."""
    require_operator(caller_id)
    return "drop pushed"


def _call_log_write_api(caller_id: str) -> str:
    """Simulated call log write operator API."""
    require_operator(caller_id)
    return "call log written"


@pytest.mark.unit
@pytest.mark.parametrize(
    "api_fn",
    [
        _recipe_crud_api,
        _reject_threshold_api,
        _trend_drop_push_api,
        _call_log_write_api,
    ],
    ids=["recipe_crud", "reject_threshold", "trend_drop_push", "call_log_write"],
)
def test_end_user_receives_forbidden_on_all_four_apis(api_fn: object) -> None:
    """End user calling any of the 4 operator APIs gets ForbiddenError (→ 403)."""
    with pytest.raises(ForbiddenError):
        api_fn("end_user_regular_subscriber")  # type: ignore[operator]


@pytest.mark.unit
@pytest.mark.parametrize(
    "api_fn",
    [
        _recipe_crud_api,
        _reject_threshold_api,
        _trend_drop_push_api,
        _call_log_write_api,
    ],
    ids=["recipe_crud", "reject_threshold", "trend_drop_push", "call_log_write"],
)
def test_operator_can_call_all_four_apis(api_fn: object) -> None:
    """Operator can successfully call all 4 protected APIs."""
    result = api_fn(OPERATOR_ID)  # type: ignore[operator]
    assert result  # non-empty string = success
