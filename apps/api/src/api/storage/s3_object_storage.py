"""Production S3 / Cloudflare R2 object-storage adapter (AC4).

Implements :class:`api.storage.object_storage.ObjectStorage` against an
S3-compatible REST API using SigV4-signed ``httpx`` requests — no ``boto3``
dependency. Reads its connection parameters from
:class:`api.config.env.ObjectStorageConfig`.

Operations map 1:1 to S3 object verbs:

    put(key, data, content_type)  ->  PUT  /<bucket>/<key>
    get(key)                      ->  GET  /<bucket>/<key>
    delete(key)                   ->  DELETE /<bucket>/<key>

All transport-level failures are normalised to
:class:`~api.storage.object_storage.ObjectStorageError` (a ``404`` on ``get``
becomes :class:`~api.storage.object_storage.ObjectNotFoundError`) so callers
never see a raw ``httpx`` exception.

Testability
-----------
Both the ``httpx`` transport and the clock are injectable. The unit test drives
the adapter with an :class:`httpx.MockTransport` (asserting the signed request
shape and simulating responses) and a fixed ``now`` — no live bucket, no creds.

Key-safety invariant
---------------------
The signed canonical URI must byte-for-byte match the path ``httpx`` sends.
The generation key builder emits keys composed solely of ``[A-Za-z0-9/_.-]``
(UUID path segments + ``.png``), which are identity-encoded by both SigV4's
``UriEncode`` and ``httpx``'s URL handling, so no mismatch can arise.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Final
from urllib.parse import urlsplit

import httpx

from api.config.env import ObjectStorageConfig
from api.storage.object_storage import ObjectNotFoundError, ObjectStorageError
from api.storage.sigv4 import EMPTY_PAYLOAD_SHA256, sha256_hex, sign_request

#: SigV4 service name for the S3 REST API (R2 also signs as ``s3``).
_SERVICE: Final[str] = "s3"

#: Per-operation HTTP timeout (seconds). Object puts/gets of a single
#: watermarked PNG are small; a generous-but-bounded timeout avoids a hung
#: request blocking the generation response.
_TIMEOUT_SECONDS: Final[float] = 15.0


def _utcnow() -> datetime:
    """Return the current UTC time. Injection point for deterministic tests."""
    return datetime.now(timezone.utc)


class S3ObjectStorage:
    """SigV4-signed S3 / R2 adapter implementing :class:`ObjectStorage`."""

    def __init__(
        self,
        config: ObjectStorageConfig,
        *,
        transport: httpx.BaseTransport | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        """Build the adapter.

        Parameters
        ----------
        config:
            Resolved connection parameters (endpoint / bucket / creds / region).
        transport:
            Optional ``httpx`` transport — the unit test injects an
            :class:`httpx.MockTransport`; production leaves it ``None`` so the
            default network transport is used.
        now:
            Optional clock returning an aware UTC ``datetime`` — injected by the
            test for a deterministic ``x-amz-date``; defaults to :func:`_utcnow`.
        """
        self._config = config
        self._transport = transport
        self._now = now or _utcnow
        self._host = urlsplit(config.endpoint_url).netloc

    def _object_url(self, key: str) -> str:
        """Return the absolute object URL ``<endpoint>/<bucket>/<key>``."""
        return f"{self._config.endpoint_url}/{self._config.bucket}/{key}"

    def _object_path(self, key: str) -> str:
        """Return the request path ``/<bucket>/<key>`` used for signing."""
        return f"/{self._config.bucket}/{key}"

    def _signed_headers(
        self, method: str, key: str, payload_hash: str, content_type: str | None
    ) -> dict[str, str]:
        """Sign the request and return the headers to attach (minus ``host``).

        ``host`` is part of the SigV4 signed-headers set but is stripped from
        the returned dict because ``httpx`` sets the ``Host`` header itself from
        the request URL (which targets the same host that was signed).
        """
        cfg = self._config
        now = self._now()
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        datestamp = now.strftime("%Y%m%d")
        extra = {"content-type": content_type} if content_type is not None else None
        signed = sign_request(
            method=method,
            host=self._host,
            path=self._object_path(key),
            region=cfg.region,
            service=_SERVICE,
            access_key_id=cfg.access_key_id,
            secret_access_key=cfg.secret_access_key,
            amz_date=amz_date,
            datestamp=datestamp,
            payload_hash=payload_hash,
            extra_signed_headers=extra,
        )
        headers = signed.headers
        headers.pop("host", None)
        return headers

    def _client(self) -> httpx.Client:
        """Construct a per-operation ``httpx.Client`` (honouring the test transport)."""
        if self._transport is not None:
            return httpx.Client(timeout=_TIMEOUT_SECONDS, transport=self._transport)
        return httpx.Client(timeout=_TIMEOUT_SECONDS)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        # ``content_type`` is folded into the signed headers as the lowercase
        # ``content-type`` key, so it is both signed and sent — no separate
        # re-attach (which would duplicate the header).
        headers = self._signed_headers("PUT", key, sha256_hex(data), content_type)
        try:
            with self._client() as client:
                response = client.put(
                    self._object_url(key), content=data, headers=headers
                )
        except httpx.HTTPError as exc:
            raise ObjectStorageError(f"PUT failed for key {key!r}") from exc
        if response.status_code not in (200, 201, 204):
            raise ObjectStorageError(
                f"PUT for key {key!r} returned HTTP {response.status_code}"
            )

    def get(self, key: str) -> bytes:
        headers = self._signed_headers("GET", key, EMPTY_PAYLOAD_SHA256, None)
        try:
            with self._client() as client:
                response = client.get(self._object_url(key), headers=headers)
        except httpx.HTTPError as exc:
            raise ObjectStorageError(f"GET failed for key {key!r}") from exc
        if response.status_code == 404:
            raise ObjectNotFoundError(key)
        if response.status_code != 200:
            raise ObjectStorageError(
                f"GET for key {key!r} returned HTTP {response.status_code}"
            )
        return response.content

    def delete(self, key: str) -> None:
        headers = self._signed_headers("DELETE", key, EMPTY_PAYLOAD_SHA256, None)
        try:
            with self._client() as client:
                response = client.delete(self._object_url(key), headers=headers)
        except httpx.HTTPError as exc:
            raise ObjectStorageError(f"DELETE failed for key {key!r}") from exc
        # S3 returns 204 on delete; a 404 is also success (idempotent delete).
        if response.status_code not in (200, 204, 404):
            raise ObjectStorageError(
                f"DELETE for key {key!r} returned HTTP {response.status_code}"
            )


__all__ = ["S3ObjectStorage"]
