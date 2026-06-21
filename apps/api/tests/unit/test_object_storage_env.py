"""Unit tests for the AC4 storage env accessors.

Covers two contracts:
  * ``get_object_storage_config`` — returns a frozen config only when all
    required ``S3_*`` vars are present; ``None`` otherwise (fall back to the
    in-memory store). The region defaults to ``auto`` (R2 convention).
  * ``get_image_ttl_days`` — sensible-default (30) knob, never fail-fast.
"""

from __future__ import annotations

import pytest

from api.config.env import (
    DEFAULT_IMAGE_TTL_DAYS,
    DEFAULT_S3_REGION,
    get_image_ttl_days,
    get_object_storage_config,
)

_S3_VARS = (
    "S3_ENDPOINT_URL",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_REGION",
)


def _clear_s3(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in _S3_VARS:
        monkeypatch.delenv(var, raising=False)


def _set_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("S3_ENDPOINT_URL", "https://acc.r2.cloudflarestorage.com/")
    monkeypatch.setenv("S3_BUCKET", "images")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "AKID")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "SECRET")


@pytest.mark.unit
def test_config_none_when_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_s3(monkeypatch)
    assert get_object_storage_config() is None


@pytest.mark.unit
def test_config_none_when_partially_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_s3(monkeypatch)
    monkeypatch.setenv("S3_ENDPOINT_URL", "https://acc.r2.cloudflarestorage.com")
    monkeypatch.setenv("S3_BUCKET", "images")
    # access key + secret missing → not fully configured.
    assert get_object_storage_config() is None


@pytest.mark.unit
def test_config_resolves_and_strips_trailing_slash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_s3(monkeypatch)
    _set_required(monkeypatch)
    config = get_object_storage_config()
    assert config is not None
    assert config.endpoint_url == "https://acc.r2.cloudflarestorage.com"  # no slash
    assert config.bucket == "images"
    assert config.access_key_id == "AKID"
    assert config.secret_access_key == "SECRET"
    assert config.region == DEFAULT_S3_REGION == "auto"


@pytest.mark.unit
def test_config_honours_explicit_region(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_s3(monkeypatch)
    _set_required(monkeypatch)
    monkeypatch.setenv("S3_REGION", "us-east-1")
    config = get_object_storage_config()
    assert config is not None
    assert config.region == "us-east-1"


@pytest.mark.unit
def test_ttl_default_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("IMAGE_TTL_DAYS", raising=False)
    assert get_image_ttl_days() == 30
    assert DEFAULT_IMAGE_TTL_DAYS == 30


@pytest.mark.unit
def test_ttl_parses_positive_int(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("IMAGE_TTL_DAYS", "7")
    assert get_image_ttl_days() == 7


@pytest.mark.unit
@pytest.mark.parametrize("bad", ["", "abc", "0", "-5", "3.5"])
def test_ttl_default_on_invalid(monkeypatch: pytest.MonkeyPatch, bad: str) -> None:
    monkeypatch.setenv("IMAGE_TTL_DAYS", bad)
    assert get_image_ttl_days() == 30
