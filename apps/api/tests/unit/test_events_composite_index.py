"""Unit tests for the Phase 4.2 composite ``(event_name, occurred_at)`` index.

Acceptance criterion covered
----------------------------
Phase 4.2 dispatch AC: "Composite index on (event_name, occurred_at) for
cohort time-window queries."

The existing migration / DDL introspection tests assert that an index
**named** ``ix_events_event_name_occurred_at`` exists, but a name alone
does not satisfy the cohort-query AC — a single-column index that happens
to share the name would silently pass those checks. The cohort
time-window query pattern

    WHERE event_name = :name AND occurred_at BETWEEN :start AND :end

requires:

    1. Both ``event_name`` and ``occurred_at`` to participate in the
       index.
    2. ``event_name`` to be the *leading* column (the equality predicate
       must come first so Postgres can use the index for both the
       equality and the range scan).

This module verifies both conditions at the model-definition layer
(unit-tier, no DB needed) by inspecting the :class:`Event` model's
``__table_args__`` directly. The integration-tier counterpart in
``tests/integration/test_events_composite_index_columns.py`` re-asserts
the same column-order invariant against the live ``pg_index`` system
catalog after ``alembic upgrade head``, so the AC is evidenced at both
the source-definition and the live-DDL layers.

Why a dedicated unit test instead of folding into the existing tests?
--------------------------------------------------------------------
The composite-shape assertion is conceptually orthogonal to the
"index exists by name" assertion already present in
``test_events_migration.py``. Keeping them in separate tests means a
regression in column order produces a focused failure pointing at *this*
test (and thus the cohort-query AC) rather than a generic "index drifted"
message that conflates two distinct guarantees.
"""

from __future__ import annotations

import pytest
from sqlalchemy import Index

from api.db.models.event import (
    INDEX_EVENT_NAME_OCCURRED_AT,
    Event,
)

# Pinned column-order tuple — the leading column MUST be ``event_name``
# (equality predicate) so Postgres uses the index for both the equality
# match and the ``occurred_at`` range scan. Reversing the order would
# silently degrade the cohort query plan to a sequential scan + filter.
_EXPECTED_COMPOSITE_COLUMNS: tuple[str, ...] = ("event_name", "occurred_at")


def _find_composite_index() -> Index:
    """Locate the composite index by name on the ``Event`` model.

    Searches ``Event.__table_args__`` for the first :class:`Index`
    whose ``name`` matches the pinned constant ``INDEX_EVENT_NAME_OCCURRED_AT``.
    Raises an :class:`AssertionError` with a descriptive message if the
    index is missing, so callers do not have to repeat the lookup
    boilerplate.

    Returns
    -------
    Index
        The :class:`sqlalchemy.Index` instance from ``Event.__table_args__``.
    """
    table_args = Event.__table_args__
    # ``__table_args__`` is typed as a tuple in the Event model; iterate
    # and pick the first Index whose ``name`` matches. Filtering by class
    # AND name is intentional — a future ``CheckConstraint`` or
    # ``UniqueConstraint`` sharing tuple position must not confuse the
    # lookup.
    for arg in table_args:
        if isinstance(arg, Index) and arg.name == INDEX_EVENT_NAME_OCCURRED_AT:
            return arg
    raise AssertionError(
        f"Event.__table_args__ must contain an Index named "
        f"{INDEX_EVENT_NAME_OCCURRED_AT!r}; found args: {table_args!r}. "
        "The composite (event_name, occurred_at) index is required by "
        "the Phase 4.2 cohort time-window query AC."
    )


@pytest.mark.unit
def test_composite_index_exists_on_event_model() -> None:
    """``Event.__table_args__`` declares the composite index by name.

    A sanity check that the index registration is present at all — the
    column-order assertions below would fail with a confusing
    ``AssertionError`` from the helper if the index were missing
    entirely. Asserting existence first produces a clearer failure
    signal in that scenario.
    """
    # The helper raises AssertionError if the index is missing; calling
    # it here is the assertion itself. Storing the returned Index in a
    # named variable so the test reads as a deliberate check rather
    # than an unused-call lint warning.
    composite_index = _find_composite_index()
    assert composite_index.name == INDEX_EVENT_NAME_OCCURRED_AT


@pytest.mark.unit
def test_composite_index_has_two_columns_in_pinned_order() -> None:
    """The composite index covers exactly ``(event_name, occurred_at)``.

    Cohort time-window queries take the shape::

        WHERE event_name = :name AND occurred_at BETWEEN :start AND :end

    For Postgres to satisfy that query via an index-only scan, the
    index must include BOTH columns with ``event_name`` as the leading
    column. This test reads the column list directly from the
    SQLAlchemy :class:`Index` object (no DB connection, no migration
    run) so the AC is enforced on every fast-path CI run.
    """
    composite_index = _find_composite_index()

    # ``Index.columns`` is a ``ColumnCollection`` — iterating yields
    # ``Column`` objects in declaration order, which is the same order
    # alembic emits in the ``CREATE INDEX`` DDL. Extracting ``.name``
    # off each column gives us the comparable tuple.
    actual_columns: tuple[str, ...] = tuple(col.name for col in composite_index.columns)

    assert actual_columns == _EXPECTED_COMPOSITE_COLUMNS, (
        f"Phase 4.2 cohort-query AC violated: composite index "
        f"{INDEX_EVENT_NAME_OCCURRED_AT!r} must cover columns "
        f"{_EXPECTED_COMPOSITE_COLUMNS!r} in that exact order "
        f"(leading column ``event_name`` for the equality predicate, "
        f"trailing column ``occurred_at`` for the range scan); got "
        f"{actual_columns!r}. Reordering the columns silently degrades "
        f"the cohort time-window query plan to a sequential scan."
    )


@pytest.mark.unit
def test_composite_index_is_not_marked_unique() -> None:
    """The composite index is a regular b-tree index, not a UNIQUE index.

    Cohort queries read many rows per ``(event_name, occurred_at)`` pair
    (e.g. multiple anonymous users firing the same event in the same
    time window). Marking the index UNIQUE would (a) reject legitimate
    duplicate inserts and (b) imply a constraint that contradicts the
    append-only ingest model. The Seed pins this index as a
    non-unique b-tree; this test guards against an accidental
    ``unique=True`` slipping into the model definition.
    """
    composite_index = _find_composite_index()
    # ``Index.unique`` is a bool; ``False`` is the SQLAlchemy default
    # when the kwarg is omitted, which is the shape we want.
    assert composite_index.unique is False, (
        f"Composite index {INDEX_EVENT_NAME_OCCURRED_AT!r} must NOT be "
        f"UNIQUE — cohort queries return many rows per "
        f"(event_name, occurred_at) pair, and a UNIQUE constraint would "
        f"reject legitimate duplicate event ingests. Got unique="
        f"{composite_index.unique!r}."
    )
