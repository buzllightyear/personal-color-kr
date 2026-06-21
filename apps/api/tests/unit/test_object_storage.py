"""Unit tests for the object-storage seam (AC4).

Two layers:
  1. :class:`InMemoryObjectStorage` — round-trip + idempotent-delete + miss.
  2. :class:`S3ObjectStorage` — driven by an :class:`httpx.MockTransport` that
     captures the signed request shape and simulates responses, so put/get/
     delete + the 404→ObjectNotFoundError mapping are verified without a live
     bucket or credentials.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest

from api.config.env import ObjectStorageConfig
from api.storage.object_storage import (
    InMemoryObjectStorage,
    ObjectNotFoundError,
    ObjectStorage,
    ObjectStorageError,
)
from api.storage.s3_object_storage import S3ObjectStorage

# ---------------------------------------------------------------------------
# InMemoryObjectStorage
# ---------------------------------------------------------------------------


def test_in_memory_is_an_object_storage() -> None:
    assert isinstance(InMemoryObjectStorage(), ObjectStorage)


def test_in_memory_put_get_round_trip() -> None:
    store = InMemoryObjectStorage()
    store.put("k/1.png", b"\x89PNG-bytes", "image/png")
    assert store.get("k/1.png") == b"\x89PNG-bytes"


def test_in_memory_get_missing_raises() -> None:
    store = InMemoryObjectStorage()
    with pytest.raises(ObjectNotFoundError):
        store.get("absent")


def test_in_memory_delete_is_idempotent() -> None:
    store = InMemoryObjectStorage()
    store.put("k", b"x", "image/png")
    store.delete("k")
    store.delete("k")  # second delete must not raise
    with pytest.raises(ObjectNotFoundError):
        store.get("k")


# ---------------------------------------------------------------------------
# S3ObjectStorage (httpx.MockTransport)
# ---------------------------------------------------------------------------

_CONFIG = ObjectStorageConfig(
    endpoint_url="https://acc.r2.cloudflarestorage.com",
    bucket="images",
    access_key_id="AKID",
    secret_access_key="SECRET",
    region="auto",
)
_FIXED_NOW = datetime(2026, 6, 22, 0, 0, 0, tzinfo=timezone.utc)


def _adapter(handler: object) -> S3ObjectStorage:
    transport = httpx.MockTransport(handler)  # type: ignore[arg-type]
    return S3ObjectStorage(_CONFIG, transport=transport, now=lambda: _FIXED_NOW)


def test_s3_put_signs_and_targets_object_url() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("Authorization")
        captured["amz_date"] = request.headers.get("x-amz-date")
        captured["content_type"] = request.headers.get("Content-Type")
        captured["body"] = request.content
        return httpx.Response(200)

    _adapter(handler).put("generations/u/abc.png", b"PNGDATA", "image/png")

    assert captured["method"] == "PUT"
    assert (
        captured["url"]
        == "https://acc.r2.cloudflarestorage.com/images/generations/u/abc.png"
    )
    assert captured["amz_date"] == "20260622T000000Z"
    assert captured["content_type"] == "image/png"
    assert captured["body"] == b"PNGDATA"
    auth = captured["auth"]
    assert isinstance(auth, str) and auth.startswith("AWS4-HMAC-SHA256 ")


def test_s3_put_non_2xx_raises_storage_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    with pytest.raises(ObjectStorageError):
        _adapter(handler).put("k.png", b"x", "image/png")


def test_s3_get_returns_bytes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(200, content=b"STORED")

    assert _adapter(handler).get("k.png") == b"STORED"


def test_s3_get_404_maps_to_not_found() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    with pytest.raises(ObjectNotFoundError):
        _adapter(handler).get("missing.png")


def test_s3_delete_accepts_204_and_404() -> None:
    def handler_204(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        return httpx.Response(204)

    _adapter(handler_204).delete("k.png")  # must not raise

    def handler_404(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    _adapter(handler_404).delete("k.png")  # idempotent — must not raise


def test_s3_get_transport_error_maps_to_storage_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    with pytest.raises(ObjectStorageError):
        _adapter(handler).get("k.png")
