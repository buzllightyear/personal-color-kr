"""Unit tests for :class:`api.db.models.generation.Generation` (AC4).

Pins the static ORM contract by introspecting the SQLAlchemy ``Table`` metadata
(no database I/O): the seven columns + types + nullability, the ``user_id`` FK
to ``users.id`` with ``ON DELETE CASCADE``, and the two indexes the gallery
query + TTL sweep depend on. The real round-trip is covered by the integration
tier; here we only assert the shape.
"""

from __future__ import annotations

from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID

from api.db.models.generation import (
    FK_GENERATIONS_USER_ID,
    GENERATIONS_TABLE_NAME,
    INDEX_GENERATIONS_EXPIRES_AT,
    INDEX_GENERATIONS_USER_CREATED,
    Generation,
)


def test_tablename_and_constant() -> None:
    assert Generation.__tablename__ == "generations"
    assert GENERATIONS_TABLE_NAME == "generations"


def test_columns_present_with_expected_types() -> None:
    cols = Generation.__table__.columns
    assert {c.name for c in cols} == {
        "id",
        "user_id",
        "recipe_id",
        "result_image_key",
        "retry_count",
        "created_at",
        "expires_at",
    }
    assert isinstance(cols["id"].type, UUID)
    assert isinstance(cols["user_id"].type, UUID)
    assert isinstance(cols["recipe_id"].type, Text)
    assert isinstance(cols["result_image_key"].type, Text)
    assert isinstance(cols["retry_count"].type, Integer)
    assert isinstance(cols["created_at"].type, DateTime)
    assert isinstance(cols["expires_at"].type, DateTime)
    # Timestamps are timezone-aware (TIMESTAMPTZ).
    assert cols["created_at"].type.timezone is True
    assert cols["expires_at"].type.timezone is True


def test_nullability_contract() -> None:
    cols = Generation.__table__.columns
    assert cols["id"].primary_key is True
    for required in (
        "user_id",
        "recipe_id",
        "result_image_key",
        "retry_count",
        "created_at",
        "expires_at",
    ):
        assert cols[required].nullable is False


def test_user_id_fk_cascades_on_user_delete() -> None:
    fk = next(iter(Generation.__table__.columns["user_id"].foreign_keys))
    assert isinstance(fk, ForeignKey)
    assert fk.column.table.name == "users"
    assert fk.column.name == "id"
    assert fk.ondelete == "CASCADE"
    assert fk.constraint is not None
    assert fk.constraint.name == FK_GENERATIONS_USER_ID


def test_indexes_for_gallery_and_sweep() -> None:
    index_names = {ix.name for ix in Generation.__table__.indexes}
    assert INDEX_GENERATIONS_USER_CREATED in index_names
    assert INDEX_GENERATIONS_EXPIRES_AT in index_names
