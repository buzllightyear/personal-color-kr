"""Object-storage abstraction + in-memory implementation (AC4).

The generation pipeline writes the *watermarked* result image to durable
object storage and the gallery reads it back. Both depend only on the
:class:`ObjectStorage` Protocol below, so:

    * production wires the S3 / R2 adapter
      (:class:`api.storage.s3_object_storage.S3ObjectStorage`), and
    * tests + local dev wire :class:`InMemoryObjectStorage` — a dict-backed
      store with identical semantics and zero network I/O.

Contract (three operations, intentionally minimal):

    put(key, data, content_type)   persist bytes under a key (overwrite-ok)
    get(key) -> bytes              read bytes back, or raise ObjectNotFoundError
    delete(key)                    remove a key (idempotent — no error if absent)

Keys are opaque ``str`` paths (e.g. ``generations/<user>/<id>.png``). The
abstraction deliberately omits presigned-URL minting: the gallery streams
images through an authenticated API endpoint, so no public time-boxed URL is
ever created and the original selfie never egresses.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


class ObjectStorageError(Exception):
    """Base error for object-storage operations.

    The production adapter raises this (never the underlying ``httpx`` /
    transport error) so callers can map storage failures to a single HTTP
    status without depending on the transport library.
    """


class ObjectNotFoundError(ObjectStorageError):
    """Raised by :meth:`ObjectStorage.get` when a key does not exist."""

    def __init__(self, key: str) -> None:
        # The key is an internal storage path (not user PII), so it is safe to
        # include in the message for debuggability.
        super().__init__(f"object not found: {key}")
        self.key = key


@runtime_checkable
class ObjectStorage(Protocol):
    """Minimal blob store: put / get / delete by opaque string key."""

    def put(self, key: str, data: bytes, content_type: str) -> None:
        """Persist *data* under *key* with the given *content_type* (overwrite)."""
        ...

    def get(self, key: str) -> bytes:
        """Return the bytes stored under *key*.

        Raises
        ------
        ObjectNotFoundError
            When no object exists at *key*.
        """
        ...

    def delete(self, key: str) -> None:
        """Remove *key*. Idempotent — a missing key is not an error."""
        ...


class InMemoryObjectStorage:
    """Dict-backed :class:`ObjectStorage` for tests and local development.

    State lives in a per-instance dict, so a single shared instance behaves
    like a process-local bucket: a ``put`` during ``POST /v1/generate`` is
    visible to a later ``get`` during ``GET /v1/gallery/{id}/image`` within the
    same process. Not durable across restarts — production uses the S3 adapter.
    """

    def __init__(self) -> None:
        # Maps key -> (bytes, content_type). The content_type is retained so a
        # streaming read-back can echo the stored media type if needed.
        self._objects: dict[str, tuple[bytes, str]] = {}

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._objects[key] = (bytes(data), content_type)

    def get(self, key: str) -> bytes:
        entry = self._objects.get(key)
        if entry is None:
            raise ObjectNotFoundError(key)
        return entry[0]

    def delete(self, key: str) -> None:
        # ``pop`` with a default keeps delete idempotent (no KeyError on miss).
        self._objects.pop(key, None)


__all__ = [
    "ObjectStorage",
    "ObjectStorageError",
    "ObjectNotFoundError",
    "InMemoryObjectStorage",
]
