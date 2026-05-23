"""Unit tests for :meth:`api.db.models.event.Event.__repr__`.

Acceptance criteria covered
---------------------------
* **≥80% coverage on new code** — closes the only uncovered branch in
  ``apps/api/src/api/db/models/event.py`` (lines 197–198 of the
  ``__repr__`` method, which the round-trip integration tests never
  exercise because they assert against ORM attributes, not ``repr``).

Why a dedicated unit test?
--------------------------
The integration tests in ``tests/integration/test_events_model_roundtrip``
prove the model persists and round-trips against real Postgres but never
call ``repr(event)``. Since ``__repr__`` is the only ``Event`` method that
is not a column descriptor, leaving it untested would silently:

    1. Mask a regression that printed the raw ``properties`` payload
       (PII leak risk in logs — see the method docstring).
    2. Hide a ``NoneType is not iterable`` bug if ``properties`` is ever
       ``None`` at ``repr`` time (which can happen when a transient
       :class:`Event` instance is constructed without arguments).

Scope discipline
----------------
* No database I/O — every test constructs a transient :class:`Event`
  in memory and inspects the returned string. Pure unit tier; sub-1ms.
* No mocks — :class:`Event` is a plain :class:`~sqlalchemy.orm.DeclarativeBase`
  subclass; SQLAlchemy lets us instantiate one without a session.
* No assertions about ``properties`` values appearing in the repr —
  the method docstring promises **only the key count** is rendered, so
  the test pins that contract.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from api.db.models.event import Event


@pytest.mark.unit
def test_event_repr_with_dict_properties_renders_key_count_not_values() -> None:
    """``repr(event)`` shows ``properties_keys=<count>``, not raw values.

    Pins the PII-safety contract documented in the method docstring:
    the ``properties`` JSONB bag may contain user-supplied data, so the
    repr must reveal only the key count.
    """
    event = Event(
        id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        anonymous_id="anon-abc",
        event_name="cta_clicked",
        properties={"button": "primary", "page": "/season", "secret": "shh"},
        occurred_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
        server_received_at=datetime(2026, 1, 2, 3, 4, 6, tzinfo=timezone.utc),
    )

    rendered = repr(event)

    # Key count is rendered (3 keys in the properties bag above).
    assert "properties_keys=3" in rendered, rendered
    # The raw values must NOT leak into the repr — PII safety contract.
    assert "primary" not in rendered, rendered
    assert "/season" not in rendered, rendered
    assert "shh" not in rendered, rendered
    # The repr must include the column identities used for debugging.
    assert "anon-abc" in rendered, rendered
    assert "cta_clicked" in rendered, rendered


@pytest.mark.unit
def test_event_repr_with_none_properties_falls_back_to_zero_key_count() -> None:
    """``repr(event)`` survives ``properties is None`` with ``keys=0``.

    Covers the ``else`` branch of the ternary on line 197 of
    ``event.py``. A transient :class:`Event` (constructed without a
    ``properties`` kwarg and never flushed) can have ``properties``
    attribute equal to ``None`` until the SQLAlchemy default fires.
    The repr must not raise ``TypeError: object of type 'NoneType' has
    no len()`` in that window.
    """
    event = Event(
        id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
        anonymous_id="anon-xyz",
        event_name="page_view",
        occurred_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
        server_received_at=datetime(2026, 1, 2, 3, 4, 6, tzinfo=timezone.utc),
    )
    # Bypass the Python-side ``default=dict`` so ``properties`` is None
    # on the in-memory instance (the column default only fires on flush).
    # SQLAlchemy ``Mapped[...]`` is loose at the instance attribute level
    # so assigning ``None`` here does not require a ``type: ignore``.
    event.properties = None

    rendered = repr(event)

    assert "properties_keys=0" in rendered, rendered


@pytest.mark.unit
def test_event_repr_with_empty_dict_properties_renders_zero_key_count() -> None:
    """``repr(event)`` renders ``properties_keys=0`` for the default ``{}``.

    Verifies the ``len()`` branch on line 197 of ``event.py`` returns 0
    when the (column-default) empty dict is in place — the most common
    real-world shape since most ingested events have no extra
    properties.
    """
    event = Event(
        id=uuid.UUID("00000000-0000-0000-0000-000000000003"),
        anonymous_id="anon-empty",
        event_name="ping",
        properties={},
        occurred_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
        server_received_at=datetime(2026, 1, 2, 3, 4, 6, tzinfo=timezone.utc),
    )

    rendered = repr(event)

    assert "properties_keys=0" in rendered, rendered
    assert rendered.startswith("Event(id="), rendered
