"""Expired-generation TTL sweep (Content Generation AC4).

The gallery already *hides* expired generations at read time (``expires_at >
now``). This module is the out-of-band reclaimer that actually **deletes** the
expired rows and their object-storage blobs so storage cost stays bounded.

Two layers:

    * :func:`delete_expired_generations` — the pure, testable core: take a
      session + storage + ``now``, delete every row whose ``expires_at <= now``
      along with its stored object, and return the count. Object deletes are
      best-effort per blob (a missing/failed object never blocks the row
      delete, since storage delete is idempotent).
    * :func:`run_sweep` — a thin production entrypoint that builds a session
      from the app sessionmaker + the configured object storage and runs the
      core once. Intended for an out-of-band scheduler.

Recommended scheduling (no in-app scheduler is shipped — Phase 1 has no cron
infra): run this on a daily cadence from the deployment platform, e.g.::

    # Fly.io scheduled machine / cron / CI nightly job:
    python -c "import asyncio; from api.services.generation_sweep import run_sweep; \
        print(asyncio.run(run_sweep()))"

Until that is wired, the read-time filter guarantees expired images are never
served; the sweep only reclaims storage.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Final

from api.db.models.generation import Generation
from api.db.session import AsyncSession, select, session_scope
from api.dependencies.storage import get_object_storage
from api.storage.object_storage import ObjectStorage, ObjectStorageError

_LOGGER: Final[logging.Logger] = logging.getLogger(__name__)


async def delete_expired_generations(
    session: AsyncSession,
    storage: ObjectStorage,
    now: datetime,
) -> int:
    """Delete every generation past its expiry + its stored object.

    Parameters
    ----------
    session:
        The DB session. Expired rows are loaded, their objects deleted, then
        the rows deleted and the transaction committed.
    storage:
        The object store the watermarked blobs live in. Per-object deletes are
        best-effort: a failure is logged and the row is still removed (an
        orphaned blob is cheaper to tolerate than a stuck sweep).
    now:
        The reference instant — rows with ``expires_at <= now`` are swept.

    Returns
    -------
    int
        The number of generation rows deleted.
    """
    stmt = select(Generation).where(Generation.expires_at <= now)
    result = await session.execute(stmt)
    rows = list(result.scalars().all())

    deleted = 0
    for row in rows:
        try:
            storage.delete(row.result_image_key)
        except ObjectStorageError as exc:
            _LOGGER.warning(
                "generation_sweep_object_delete_failed key=%s error=%s",
                row.result_image_key,
                type(exc).__name__,
            )
        await session.delete(row)
        deleted += 1

    if deleted:
        await session.commit()
    _LOGGER.info("generation_sweep_completed deleted=%d", deleted)
    return deleted


async def run_sweep() -> int:
    """Production entrypoint: sweep expired generations once.

    Builds a fresh :class:`AsyncSession` from the app engine + the configured
    object storage, runs :func:`delete_expired_generations` for ``now`` in UTC,
    and returns the number of rows deleted. Intended to be invoked by an
    out-of-band scheduler (see module docstring).
    """
    storage = get_object_storage()
    async with session_scope() as session:
        return await delete_expired_generations(
            session, storage, datetime.now(timezone.utc)
        )


__all__ = ["delete_expired_generations", "run_sweep"]
