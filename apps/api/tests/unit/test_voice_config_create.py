"""Unit tests: voice_config CREATE — Sub-AC 13c-1.

Acceptance criterion being verified (Sub-AC 13c-1)
----------------------------------------------------
    "in-memory DB 또는 통합 환경에서 신규 voice_config 레코드를 생성하는
    함수/엔드포인트를 구현하고, 생성 후 반환된 객체(id 포함)가 입력값과
    일치함을 검증하는 독립 실행 가능한 테스트 1개 이상 작성 및 통과"

    → Implement a function/endpoint that creates a new voice_config record
      in an in-memory DB or integrated environment, and verify that the
      returned object (including id) matches the input.

Invariants asserted
-------------------
1. ``create_voice_config`` returns a :class:`VoiceConfigRecord` with a
   non-None ``voice_id`` (UUID4) that was auto-generated (not in the input).
2. All operator-supplied input fields (``tone_descriptor``,
   ``trend_timing_voice``, ``photo_sense_voice``, ``cta_templates``) are
   present in the returned record and match the input values exactly.
3. ``updated_at`` is set to a non-None UTC datetime on the returned record.
4. The record can be retrieved by ``voice_id`` from the same repository
   instance (round-trip persistence check).
5. Creating two records produces two *distinct* ``voice_id`` values (no
   collision).
6. An empty ``cta_templates`` defaults to ``{}`` and is preserved correctly.
7. The ``create_voice_config`` service function (not just the repo's
   ``.create`` method) also satisfies the round-trip contract, verifying
   the service-layer wrapper does not corrupt any field.

Each test constructs its own :class:`InMemoryVoiceConfigRepository` to
avoid inter-test state leakage.  No I/O or database is required — all
assertions run entirely in memory.
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest

from api.voice.repository import (
    InMemoryVoiceConfigRepository,
    VoiceConfigCreateInput,
    VoiceConfigRecord,
    create_voice_config,
)

# ---------------------------------------------------------------------------
# Shared canonical input fixture
# ---------------------------------------------------------------------------

_SAMPLE_INPUT = VoiceConfigCreateInput(
    tone_descriptor="트렌드 타이밍 큐레이터",
    trend_timing_voice="아직 아무도 모를 때 먼저 씁니다",
    photo_sense_voice="빛의 방향 하나로 분위기가 바뀝니다",
    cta_templates={"restyle": "{tone}처럼 restyle해봐", "share": "{tone}의 선택"},
)


# ---------------------------------------------------------------------------
# Primary AC assertion: returned object (with id) matches input
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_create_returns_record_with_id_and_matching_fields() -> None:
    """CREATE returns a VoiceConfigRecord whose fields match the input.

    This is the primary Sub-AC 13c-1 assertion:
      - ``voice_id`` is present (non-None, valid UUID4)
      - All operator-supplied fields are echoed back verbatim.
      - ``updated_at`` is set (non-None UTC datetime).
    """
    repo = InMemoryVoiceConfigRepository()

    record: VoiceConfigRecord = repo.create(_SAMPLE_INPUT)

    # --- id field: present, non-None, valid UUID4 ---
    assert (
        record.voice_id is not None
    ), "Sub-AC 13c-1: returned record must have a non-None voice_id."
    assert isinstance(
        record.voice_id, uuid.UUID
    ), f"Sub-AC 13c-1: voice_id must be a UUID, got {type(record.voice_id)!r}."

    # --- operator-supplied fields echo back verbatim ---
    assert record.tone_descriptor == _SAMPLE_INPUT.tone_descriptor, (
        f"tone_descriptor mismatch: expected {_SAMPLE_INPUT.tone_descriptor!r}, "
        f"got {record.tone_descriptor!r}."
    )
    assert record.trend_timing_voice == _SAMPLE_INPUT.trend_timing_voice, (
        f"trend_timing_voice mismatch: expected {_SAMPLE_INPUT.trend_timing_voice!r}, "
        f"got {record.trend_timing_voice!r}."
    )
    assert record.photo_sense_voice == _SAMPLE_INPUT.photo_sense_voice, (
        f"photo_sense_voice mismatch: expected {_SAMPLE_INPUT.photo_sense_voice!r}, "
        f"got {record.photo_sense_voice!r}."
    )
    assert record.cta_templates == _SAMPLE_INPUT.cta_templates, (
        f"cta_templates mismatch: expected {_SAMPLE_INPUT.cta_templates!r}, "
        f"got {record.cta_templates!r}."
    )

    # --- updated_at: set, timezone-aware UTC ---
    assert (
        record.updated_at is not None
    ), "Sub-AC 13c-1: updated_at must be set on CREATE."
    assert isinstance(
        record.updated_at, datetime
    ), f"updated_at must be a datetime, got {type(record.updated_at)!r}."
    assert (
        record.updated_at.tzinfo is not None
    ), "updated_at must be timezone-aware (UTC)."


# ---------------------------------------------------------------------------
# Round-trip: stored record is retrievable by id
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_create_record_is_retrievable_by_id() -> None:
    """Record stored by CREATE can be retrieved by voice_id.

    Verifies the in-memory repository actually persists the record and
    that ``find_by_id`` returns an object identical to the one returned
    by ``create``.
    """
    repo = InMemoryVoiceConfigRepository()
    created: VoiceConfigRecord = repo.create(_SAMPLE_INPUT)

    fetched = repo.find_by_id(created.voice_id)

    assert fetched is not None, (
        f"find_by_id({created.voice_id!r}) returned None; "
        f"expected the record returned by create()."
    )
    assert fetched == created, (
        f"Retrieved record differs from created record:\n"
        f"  created: {created!r}\n"
        f"  fetched: {fetched!r}"
    )


# ---------------------------------------------------------------------------
# Two creates → two distinct voice_ids
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_two_creates_produce_distinct_voice_ids() -> None:
    """Creating two records produces two distinct voice_id values.

    Ensures the repository does not reuse UUIDs across calls and that
    the ``all()`` list grows to length 2.
    """
    repo = InMemoryVoiceConfigRepository()
    first: VoiceConfigRecord = repo.create(_SAMPLE_INPUT)
    second: VoiceConfigRecord = repo.create(_SAMPLE_INPUT)

    assert first.voice_id != second.voice_id, (
        f"Both records got the same voice_id {first.voice_id!r}; "
        f"each CREATE must produce a unique UUID4."
    )
    assert (
        len(repo) == 2
    ), f"Expected 2 records in repo after two creates, got {len(repo)}."


# ---------------------------------------------------------------------------
# Empty cta_templates default
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_create_with_empty_cta_templates() -> None:
    """CREATE with no cta_templates defaults to an empty dict, preserved correctly."""
    repo = InMemoryVoiceConfigRepository()
    minimal_input = VoiceConfigCreateInput(
        tone_descriptor="미니멀 큐레이터",
        trend_timing_voice="타이밍을 읽습니다",
        photo_sense_voice="빛을 조율합니다",
        # cta_templates omitted → defaults to {}
    )

    record: VoiceConfigRecord = repo.create(minimal_input)

    assert (
        record.cta_templates == {}
    ), f"Expected empty cta_templates, got {record.cta_templates!r}."
    assert record.voice_id is not None
    assert record.tone_descriptor == minimal_input.tone_descriptor


# ---------------------------------------------------------------------------
# Service-layer wrapper: create_voice_config function also satisfies AC
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_create_voice_config_service_function_returns_matching_record() -> None:
    """The ``create_voice_config`` service function satisfies the AC round-trip.

    Sub-AC 13c-1 requires a "function/endpoint" to be implemented. This test
    covers the service-layer function :func:`create_voice_config` (not just
    the repository's ``.create`` method directly) to verify the wrapper
    does not corrupt any field.
    """
    repo = InMemoryVoiceConfigRepository()
    input_ = VoiceConfigCreateInput(
        tone_descriptor="서비스레이어 큐레이터",
        trend_timing_voice="먼저 씁니다",
        photo_sense_voice="조명을 읽습니다",
        cta_templates={"restyle": "restyle해봐"},
    )

    record: VoiceConfigRecord = create_voice_config(input_, repo=repo)

    # id must be present and non-None
    assert (
        record.voice_id is not None
    ), "create_voice_config must return a record with a non-None voice_id."
    assert isinstance(record.voice_id, uuid.UUID)

    # All input fields echoed back verbatim
    assert record.tone_descriptor == input_.tone_descriptor
    assert record.trend_timing_voice == input_.trend_timing_voice
    assert record.photo_sense_voice == input_.photo_sense_voice
    assert record.cta_templates == input_.cta_templates

    # Record is also persisted — len should be 1
    assert (
        len(repo) == 1
    ), f"Expected 1 record in repo after create_voice_config, got {len(repo)}."
    assert (
        repo.find_by_id(record.voice_id) == record
    ), "Record returned by create_voice_config is not retrievable by id."


# ---------------------------------------------------------------------------
# cta_templates dict is not shared with caller (copy semantics)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_cta_templates_is_a_copy_not_shared_reference() -> None:
    """Mutating the input dict after CREATE does not affect the stored record.

    The repository must store a copy of ``cta_templates``, not a reference
    to the caller's dict.  This prevents accidental state corruption in
    test isolation and in production.
    """
    repo = InMemoryVoiceConfigRepository()
    mutable_templates: dict[str, str] = {"restyle": "original"}
    input_ = VoiceConfigCreateInput(
        tone_descriptor="카피 큐레이터",
        trend_timing_voice="타이밍 카피",
        photo_sense_voice="사진 감각 카피",
        cta_templates=mutable_templates,
    )

    record: VoiceConfigRecord = repo.create(input_)

    # Mutate the original dict AFTER create
    mutable_templates["restyle"] = "mutated"
    mutable_templates["extra_key"] = "injected"

    # The stored record must still reflect the original values
    assert record.cta_templates == {"restyle": "original"}, (
        f"Stored cta_templates was mutated through a shared reference: "
        f"{record.cta_templates!r}"
    )
