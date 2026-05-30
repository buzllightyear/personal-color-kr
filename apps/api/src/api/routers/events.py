"""``POST /v1/events`` route handler (Phase 4.4).

Authenticated single-event ingest. The handler:

    1. Requires a valid backend JWT via ``Depends(require_current_user)``
       — there is no anonymous ingest path.
    2. Validates the JSON body via :class:`EventIngestRequest` (Pydantic
       v2): ``event_name`` must match ``^[a-z_]+$``.
    3. Forces ``user_id`` from ``current_user.id`` — any client-supplied
       ``user_id`` in the body is ignored (Pydantic drops the unknown
       key), so a caller can never attribute an event to another user.
    4. Inserts exactly one row through
       :func:`api.db.repositories.events_repository.insert_event` (the
       sole SQL access boundary for the ``events`` table), commits, and
       returns HTTP 201 with the server-authoritative fields.

Scope (intentional deferrals — NOT implemented here):
    * No batch payload — exactly one event per request.
    * No dedup / idempotency key.
    * No rate limiting.
    * No anonymous→user backfill.

No ``sqlalchemy*`` import here: all DB access flows through the
repository, which lives inside the ``api.db`` import boundary.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from api.db.models.user import User
from api.db.repositories.events_repository import insert_event
from api.db.session import AsyncSession, get_session
from api.dependencies.auth import require_current_user
from api.schemas.events import EventIngestRequest, EventIngestResponse

#: Router hosting ``POST /v1/events``. The ``/v1`` prefix is applied by
#: ``api.main.create_app``.
router: APIRouter = APIRouter(tags=["events"])


@router.post(
    "/events",
    response_model=EventIngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest a single authenticated analytics event",
    description=(
        "Persists a single analytics event for the authenticated user. "
        "The ``user_id`` is always taken from the bearer token — any "
        "``user_id`` in the request body is ignored. Requires a valid "
        "backend JWT (no anonymous ingest)."
    ),
)
async def post_event(
    payload: EventIngestRequest,
    current_user: User = Depends(require_current_user),
    session: AsyncSession = Depends(get_session),
) -> EventIngestResponse:
    """Insert one analytics event and return the persisted row's fields.

    Parameters
    ----------
    payload:
        Validated ingest body (``anonymous_id``, ``event_name``,
        ``occurred_at``, ``properties``).
    current_user:
        The authenticated user from ``require_current_user``. Its ``id``
        is forced onto the row as ``user_id``.
    session:
        Per-request :class:`AsyncSession`.

    Returns
    -------
    EventIngestResponse
        HTTP 201 body echoing ``event_id``, the forced ``user_id``,
        ``event_name``, ``occurred_at``, and ``server_received_at``.
    """
    event = await insert_event(
        session,
        anonymous_id=payload.anonymous_id,
        event_name=payload.event_name,
        occurred_at=payload.occurred_at,
        properties=payload.properties,
        # ``user_id`` is forced from the authenticated user — the request
        # schema never exposes a ``user_id`` field, so client input cannot
        # influence attribution.
        user_id=current_user.id,
    )
    await session.commit()

    return EventIngestResponse(
        event_id=event.id,
        user_id=current_user.id,
        event_name=event.event_name,
        occurred_at=event.occurred_at,
        server_received_at=event.server_received_at,
    )


__all__ = ["router"]
