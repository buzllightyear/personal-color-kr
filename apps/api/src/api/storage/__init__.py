"""Object-storage seam for generated images (Content Generation AC4).

This sub-package owns the storage abstraction the generation + gallery surface
depends on:

    * :mod:`api.storage.object_storage` — the :class:`ObjectStorage` Protocol
      and the in-memory test/dev implementation.
    * :mod:`api.storage.s3_object_storage` — the production S3 / Cloudflare R2
      adapter (SigV4-signed REST over ``httpx``).
    * :mod:`api.storage.sigv4` — the standard-library AWS SigV4 signer.

No ``sqlalchemy*`` imports live here — the storage layer is orthogonal to the
DB import boundary (AC11). Persistence of the *metadata* row lives in
``api.db`` + ``api.routers.gallery``; the *bytes* live here.
"""

from __future__ import annotations

from api.storage.object_storage import (
    InMemoryObjectStorage,
    ObjectNotFoundError,
    ObjectStorage,
    ObjectStorageError,
)

__all__ = [
    "ObjectStorage",
    "ObjectStorageError",
    "ObjectNotFoundError",
    "InMemoryObjectStorage",
]
