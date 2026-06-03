"""Unit tests for ``get_environment`` (Phase 7.2, AC-5).

The runtime environment selector is a *closed enum*, not a free-form
string. These tests pin three branches of the contract:

    * unset / empty ``ENVIRONMENT`` -> ``"development"`` default,
    * each of the four valid values returned verbatim,
    * an unknown non-empty value raises ``ValueError`` (naming the var,
      the offending value, and the allowed set).
"""

from __future__ import annotations

import pytest

from api.config.env import (
    DEFAULT_ENVIRONMENT,
    ENVIRONMENTS,
    get_environment,
)

_VAR = "ENVIRONMENT"


@pytest.mark.unit
def test_default_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(_VAR, raising=False)
    assert get_environment() == "development"
    assert DEFAULT_ENVIRONMENT == "development"


@pytest.mark.unit
def test_default_when_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(_VAR, "")
    assert get_environment() == "development"


@pytest.mark.unit
@pytest.mark.parametrize("value", ["development", "preview", "production", "ci"])
def test_returns_each_valid_value(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv(_VAR, value)
    assert get_environment() == value


@pytest.mark.unit
def test_environments_tuple_is_the_closed_set() -> None:
    assert ENVIRONMENTS == ("development", "preview", "production", "ci")


@pytest.mark.unit
@pytest.mark.parametrize(
    "bad", ["prod", "dev", "staging", "DEVELOPMENT", "Production", "test", " ci"]
)
def test_raises_on_unknown_value(monkeypatch: pytest.MonkeyPatch, bad: str) -> None:
    monkeypatch.setenv(_VAR, bad)
    with pytest.raises(ValueError) as exc_info:
        get_environment()
    message = str(exc_info.value)
    # The message names the var and the offending value, and lists the
    # allowed set so a typo fails loudly with actionable context.
    assert "ENVIRONMENT" in message
    assert repr(bad) in message
    for allowed in ENVIRONMENTS:
        assert allowed in message
