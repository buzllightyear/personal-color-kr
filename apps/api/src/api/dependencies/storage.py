"""Dependency seam for the generated-image object store (AC4).

``POST /v1/generate`` (write) and ``GET /v1/gallery/{id}/image`` (read) depend
on :func:`get_object_storage`, which returns an
:class:`~api.storage.object_storage.ObjectStorage`:

    * **configured** (all ``S3_*`` env vars present) → a production
      :class:`~api.storage.s3_object_storage.S3ObjectStorage`.
    * **unconfigured** (local dev / CI) → a process-local
      :class:`~api.storage.object_storage.InMemoryObjectStorage` singleton, so
      the generation + gallery flow works end-to-end without cloud creds.

Tests override ``app.dependency_overrides[get_object_storage]`` with a fresh
in-memory store (or a stub) so each case is isolated from the dev singleton.
"""

from __future__ import annotations

from api.config.env import get_object_storage_config
from api.storage.object_storage import InMemoryObjectStorage, ObjectStorage
from api.storage.s3_object_storage import S3ObjectStorage

#: Process-local fallback store, created once. Shared across requests so a
#: ``put`` is visible to a later ``get`` within the same dev/CI process. Never
#: used when the ``S3_*`` env vars are configured.
_IN_MEMORY_FALLBACK: InMemoryObjectStorage = InMemoryObjectStorage()


def get_object_storage() -> ObjectStorage:
    """Return the object store backing generated-image persistence.

    Builds a production :class:`S3ObjectStorage` when the ``S3_*`` env vars are
    fully configured; otherwise returns the shared in-memory fallback so the
    app boots and the flow works without cloud credentials.

    Returns
    -------
    ObjectStorage
        The configured S3/R2 adapter, or the in-memory fallback singleton.
    """
    config = get_object_storage_config()
    if config is None:
        return _IN_MEMORY_FALLBACK
    return S3ObjectStorage(config)


__all__ = ["get_object_storage"]
