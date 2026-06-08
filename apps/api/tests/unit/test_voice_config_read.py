"""Unit tests: voice_config READ — Sub-AC 13c-2.

Acceptance criterion being verified (Sub-AC 13c-2)
----------------------------------------------------
    "in-memory DB 또는 통합 환경에서 기존 voice_config 레코드를 id로 조회하는
    함수/엔드포인트를 구현하고, 존재하는 id 조회 시 정확한 데이터 반환 및
    존재하지 않는 id 조회 시 적절한 not-found 응답을 검증하는 독립 실행 가능한
    테스트 1개 이상 작성 및 통과"

    → Implement a function/endpoint to look up existing voice_config records
      by id.  For an existing id lookup, return accurate data.  For a
      non-existing id lookup, return appropriate not-found response.  Write
      and pass at least 1 independently executable test.

Invariants asserted
-------------------
1. **Found — exact data return**: ``get_voice_config`` with an existing
   ``voice_id`` returns the exact ``VoiceConfigRecord`` that was created —
   all fields match without modification.

2. **Found — repo method parity**: ``repo.find_by_id`` and the service-layer
   ``get_voice_config`` return identical results for the same ``voice_id``,
   confirming the service wrapper does not corrupt any field.

3. **Not found — None response**: ``get_voice_config`` (and ``repo.find_by_id``)
   returns ``None`` for a ``voice_id`` that was never stored.

4. **Not found — fresh UUID**: Generating a random UUID that was never passed
   to ``create()`` always returns ``None`` (no phantom record).

5. **Isolation — empty repo**: A freshly constructed
   ``InMemoryVoiceConfigRepository`` returns ``None`` for any lookup, confirming
   there is no cross-test state leakage.

6. **Multi-record isolation**: After creating two records, looking up either
   id returns the *correct* record (not the other one).

Each test constructs its own :class:`InMemoryVoiceConfigRepository` to
avoid inter-test state leakage.  No I/O or database is required — all
assertions run entirely in memory.
"""

from __future__ import annotations

import uuid

import pytest

from api.voice.repository import (
    InMemoryVoiceConfigRepository,
    VoiceConfigCreateInput,
    VoiceConfigRecord,
    create_voice_config,
    get_voice_config,
)

# ---------------------------------------------------------------------------
# Shared sample input helpers
# ---------------------------------------------------------------------------


def _make_input(suffix: str = "") -> VoiceConfigCreateInput:
    """Return a minimal valid VoiceConfigCreateInput (optionally suffixed)."""
    return VoiceConfigCreateInput(
        tone_descriptor=f"트렌드 타이밍 큐레이터{suffix}",
        trend_timing_voice=f"아직 아무도 모를 때 먼저 씁니다{suffix}",
        photo_sense_voice=f"빛의 방향 하나로 분위기가 바뀝니다{suffix}",
        cta_templates={"restyle": "{tone}처럼 restyle해봐"},
    )


# ---------------------------------------------------------------------------
# 1. Found — exact data return
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_voice_config_returns_exact_record_when_found() -> None:
    """Sub-AC 13c-2 primary: existing id lookup returns exact data.

    Creates one record, then retrieves it via ``get_voice_config`` and
    verifies every field on the returned object matches the created record.
    """
    repo = InMemoryVoiceConfigRepository()
    created: VoiceConfigRecord = repo.create(_make_input())

    result = get_voice_config(created.voice_id, repo=repo)

    assert result is not None, (
        f"Sub-AC 13c-2: get_voice_config returned None for existing id "
        f"{created.voice_id!r}; expected a VoiceConfigRecord."
    )
    assert isinstance(
        result, VoiceConfigRecord
    ), f"Sub-AC 13c-2: expected VoiceConfigRecord, got {type(result)!r}."
    # All fields must match exactly — no field corruption in the service wrapper.
    assert (
        result.voice_id == created.voice_id
    ), f"voice_id mismatch: expected {created.voice_id!r}, got {result.voice_id!r}."
    assert result.tone_descriptor == created.tone_descriptor, (
        f"tone_descriptor mismatch: expected {created.tone_descriptor!r}, "
        f"got {result.tone_descriptor!r}."
    )
    assert (
        result.trend_timing_voice == created.trend_timing_voice
    ), "trend_timing_voice mismatch."
    assert (
        result.photo_sense_voice == created.photo_sense_voice
    ), "photo_sense_voice mismatch."
    assert result.cta_templates == created.cta_templates, (
        f"cta_templates mismatch: expected {created.cta_templates!r}, "
        f"got {result.cta_templates!r}."
    )
    assert result.updated_at == created.updated_at, "updated_at mismatch."


# ---------------------------------------------------------------------------
# 2. Found — repo method parity with service-layer wrapper
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_voice_config_service_function_and_repo_method_return_same_record() -> None:
    """Service-layer ``get_voice_config`` and ``repo.find_by_id`` are identical.

    Confirms the ``get_voice_config`` wrapper does not introduce any
    transformation of the stored record.
    """
    repo = InMemoryVoiceConfigRepository()
    created: VoiceConfigRecord = repo.create(_make_input())

    via_service = get_voice_config(created.voice_id, repo=repo)
    via_repo = repo.find_by_id(created.voice_id)

    assert via_service == via_repo, (
        f"get_voice_config result differs from repo.find_by_id result:\n"
        f"  service: {via_service!r}\n"
        f"  repo:    {via_repo!r}"
    )


# ---------------------------------------------------------------------------
# 3. Not found — None response for unknown id
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_voice_config_returns_none_for_unknown_id() -> None:
    """Sub-AC 13c-2 not-found: non-existing id lookup returns None.

    Creates one record, then queries with a *different* UUID that was never
    stored, and asserts that the result is ``None``.
    """
    repo = InMemoryVoiceConfigRepository()
    repo.create(_make_input())  # ensure at least one record exists

    unknown_id = uuid.uuid4()  # brand-new UUID, not in repo

    result = get_voice_config(unknown_id, repo=repo)

    assert result is None, (
        f"Sub-AC 13c-2: get_voice_config must return None for an unknown id "
        f"({unknown_id!r}); got {result!r} instead."
    )


# ---------------------------------------------------------------------------
# 4. Not found — fresh UUID always returns None
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_repo_find_by_id_returns_none_for_random_uuid_never_stored() -> None:
    """``repo.find_by_id`` returns None for a UUID that was never stored.

    This test uses the repository method directly (not the service wrapper)
    to verify the underlying storage behaviour independently of the service
    layer.
    """
    repo = InMemoryVoiceConfigRepository()
    phantom_id = uuid.uuid4()

    result = repo.find_by_id(phantom_id)

    assert result is None, (
        f"repo.find_by_id must return None for a UUID never passed to create(); "
        f"got {result!r} for {phantom_id!r}."
    )


# ---------------------------------------------------------------------------
# 5. Isolation — empty repo returns None for any lookup
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_voice_config_returns_none_on_empty_repository() -> None:
    """An empty repository returns None regardless of the queried UUID.

    Confirms there is no cross-test state leakage or phantom record from
    the module-level ``voice_config_repo`` singleton.
    """
    repo = InMemoryVoiceConfigRepository()  # fresh, empty

    result = get_voice_config(uuid.uuid4(), repo=repo)

    assert (
        result is None
    ), f"Empty repository must return None for any lookup; got {result!r}."
    assert len(repo) == 0, f"Empty repository must have 0 records; got {len(repo)}."


# ---------------------------------------------------------------------------
# 6. Multi-record isolation — correct record returned per id
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_get_voice_config_returns_correct_record_among_multiple() -> None:
    """With two records, each id lookup returns the correct (distinct) record.

    Creates two voice_config records with distinguishable ``tone_descriptor``
    values, then verifies that looking up each ``voice_id`` independently
    returns the matching record (not the other one).
    """
    repo = InMemoryVoiceConfigRepository()
    first: VoiceConfigRecord = repo.create(_make_input(suffix="_first"))
    second: VoiceConfigRecord = repo.create(_make_input(suffix="_second"))

    assert (
        first.voice_id != second.voice_id
    ), "Prerequisite: the two created records must have distinct voice_ids."

    fetched_first = get_voice_config(first.voice_id, repo=repo)
    fetched_second = get_voice_config(second.voice_id, repo=repo)

    assert (
        fetched_first is not None
    ), f"get_voice_config returned None for first.voice_id {first.voice_id!r}."
    assert (
        fetched_second is not None
    ), f"get_voice_config returned None for second.voice_id {second.voice_id!r}."

    assert fetched_first.tone_descriptor == first.tone_descriptor, (
        f"Expected tone_descriptor {first.tone_descriptor!r} for first record, "
        f"got {fetched_first.tone_descriptor!r}."
    )
    assert fetched_second.tone_descriptor == second.tone_descriptor, (
        f"Expected tone_descriptor {second.tone_descriptor!r} for second record, "
        f"got {fetched_second.tone_descriptor!r}."
    )
    # Cross-check: first id should NOT return second record
    assert (
        fetched_first != fetched_second
    ), "Fetching first.voice_id and second.voice_id must return distinct records."


# ---------------------------------------------------------------------------
# 7. create_voice_config service + get_voice_config service: end-to-end
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_create_then_get_via_service_functions_round_trip() -> None:
    """Full service-layer round-trip: create_voice_config → get_voice_config.

    Verifies that using both service-layer functions (not the repo methods
    directly) satisfies the Sub-AC 13c-2 contract end-to-end: create
    produces a persisted record, and get retrieves it by id without
    field corruption.
    """
    repo = InMemoryVoiceConfigRepository()
    input_ = VoiceConfigCreateInput(
        tone_descriptor="서비스레이어 큐레이터",
        trend_timing_voice="먼저 씁니다",
        photo_sense_voice="조명을 읽습니다",
        cta_templates={"restyle": "restyle해봐"},
    )

    created: VoiceConfigRecord = create_voice_config(input_, repo=repo)
    retrieved = get_voice_config(created.voice_id, repo=repo)

    assert (
        retrieved is not None
    ), "get_voice_config must return a record for the just-created voice_id."
    assert (
        retrieved == created
    ), f"Round-trip mismatch:\n  created:   {created!r}\n  retrieved: {retrieved!r}"
    # Confirm not-found still works for a different UUID after create
    phantom = uuid.uuid4()
    assert (
        get_voice_config(phantom, repo=repo) is None
    ), "get_voice_config must still return None for an id that was never created."
