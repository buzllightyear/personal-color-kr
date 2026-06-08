"""Unit tests: voice_config DELETE — Sub-AC 13c-4.

Acceptance criterion being verified (Sub-AC 13c-4)
----------------------------------------------------
    "in-memory DB 또는 통합 환경에서 voice_config 레코드를 삭제하는
    함수/엔드포인트를 구현하고, 삭제 후 해당 id로 조회 시 not-found 응답이
    반환됨을 검증하는 독립 실행 가능한 테스트 1개 이상 작성 및 통과"

    → Implement a function/endpoint that deletes a voice_config record in
      an in-memory DB or integrated environment, and write at least 1
      independently executable test that verifies that after deletion,
      querying by that id returns a not-found response.

Invariants asserted
-------------------
1. **Primary AC: delete then not-found**: After calling ``delete_voice_config``
   with an existing ``voice_id``, subsequent calls to ``get_voice_config``
   with the same ``voice_id`` return ``None`` (not-found).

2. **Repo method parity**: ``repo.delete`` directly and the service-layer
   ``delete_voice_config`` wrapper both produce the same not-found outcome
   when the record is subsequently queried.

3. **Delete returns True for existing record**: The delete operation signals
   success (returns ``True``) when the targeted record exists.

4. **Delete returns False for absent record**: The delete operation is
   idempotent — deleting a ``voice_id`` that is not in the store returns
   ``False`` without raising an error.

5. **Only the targeted record is removed**: When two records exist, deleting
   one leaves the other intact and still retrievable.

6. **Repo length decrements**: After deleting one record from a repo that
   held two, ``len(repo)`` drops to 1.

7. **Double-delete is idempotent**: Calling delete twice on the same
   ``voice_id`` does not raise; the second call returns ``False``.

8. **Empty-repo delete is safe**: Calling delete on an empty repository
   returns ``False`` and does not raise.

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
    delete_voice_config,
    get_voice_config,
)


# ---------------------------------------------------------------------------
# Shared sample input helper
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
# 1. Primary AC: delete then not-found
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_delete_voice_config_then_get_returns_none() -> None:
    """Sub-AC 13c-4 primary: deleting a record makes it unretrievable.

    Creates one record, deletes it via ``delete_voice_config``, then
    verifies that ``get_voice_config`` returns ``None`` for the same id.
    This is the direct, independently runnable AC assertion.
    """
    repo = InMemoryVoiceConfigRepository()
    created: VoiceConfigRecord = repo.create(_make_input())

    # Pre-condition: record is retrievable before deletion
    assert get_voice_config(created.voice_id, repo=repo) is not None, (
        "Prerequisite: record must be retrievable before deletion."
    )

    delete_voice_config(created.voice_id, repo=repo)

    # Post-condition: same id must now return None (not-found)
    result = get_voice_config(created.voice_id, repo=repo)
    assert result is None, (
        f"Sub-AC 13c-4: get_voice_config must return None after deletion "
        f"of voice_id {created.voice_id!r}; got {result!r} instead."
    )


# ---------------------------------------------------------------------------
# 2. Repo method parity: repo.delete + repo.find_by_id
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_repo_delete_then_find_by_id_returns_none() -> None:
    """repo.delete removes the record; subsequent find_by_id returns None.

    Uses the repository methods directly (not the service wrappers) to
    confirm the underlying storage behaviour independently of the service
    layer.
    """
    repo = InMemoryVoiceConfigRepository()
    created: VoiceConfigRecord = repo.create(_make_input())

    repo.delete(created.voice_id)

    result = repo.find_by_id(created.voice_id)
    assert result is None, (
        f"repo.find_by_id must return None after repo.delete "
        f"for voice_id {created.voice_id!r}; got {result!r}."
    )


# ---------------------------------------------------------------------------
# 3. Delete returns True for existing record
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_delete_voice_config_returns_true_for_existing_record() -> None:
    """delete_voice_config returns True when the targeted record exists."""
    repo = InMemoryVoiceConfigRepository()
    created: VoiceConfigRecord = repo.create(_make_input())

    deleted = delete_voice_config(created.voice_id, repo=repo)

    assert deleted is True, (
        f"delete_voice_config must return True when the record exists; "
        f"got {deleted!r} for voice_id {created.voice_id!r}."
    )


# ---------------------------------------------------------------------------
# 4. Delete returns False for absent record
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_delete_voice_config_returns_false_for_absent_record() -> None:
    """delete_voice_config returns False and does not raise for missing id.

    This confirms the operation is idempotent / safe for unknown ids.
    """
    repo = InMemoryVoiceConfigRepository()
    non_existent_id = uuid.uuid4()

    deleted = delete_voice_config(non_existent_id, repo=repo)

    assert deleted is False, (
        f"delete_voice_config must return False for an id that was never "
        f"created; got {deleted!r} for {non_existent_id!r}."
    )


# ---------------------------------------------------------------------------
# 5. Only the targeted record is removed
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_delete_voice_config_removes_only_targeted_record() -> None:
    """Deleting one record does not affect a sibling record.

    Creates two records; deletes the first; confirms the second remains
    intact and fully retrievable.
    """
    repo = InMemoryVoiceConfigRepository()
    first: VoiceConfigRecord = repo.create(_make_input(suffix="_first"))
    second: VoiceConfigRecord = repo.create(_make_input(suffix="_second"))

    delete_voice_config(first.voice_id, repo=repo)

    # First record must be gone
    assert get_voice_config(first.voice_id, repo=repo) is None, (
        f"First record must be unretrievable after deletion."
    )

    # Second record must still be intact
    remaining = get_voice_config(second.voice_id, repo=repo)
    assert remaining is not None, (
        f"Second record must still be retrievable after first was deleted."
    )
    assert remaining == second, (
        f"Second record must be unchanged after deleting the first:\n"
        f"  expected: {second!r}\n"
        f"  got:      {remaining!r}"
    )


# ---------------------------------------------------------------------------
# 6. Repo length decrements after delete
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_delete_decrements_repo_length() -> None:
    """len(repo) decrements by 1 after a successful delete."""
    repo = InMemoryVoiceConfigRepository()
    first: VoiceConfigRecord = repo.create(_make_input(suffix="_a"))
    second: VoiceConfigRecord = repo.create(_make_input(suffix="_b"))

    assert len(repo) == 2, f"Expected 2 records after two creates, got {len(repo)}."

    delete_voice_config(first.voice_id, repo=repo)

    assert len(repo) == 1, (
        f"Expected len(repo)==1 after one delete, got {len(repo)}."
    )
    # The remaining record must be the second one
    assert repo.find_by_id(second.voice_id) is not None, (
        "The surviving record must be the second one."
    )


# ---------------------------------------------------------------------------
# 7. Double-delete is idempotent
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_double_delete_is_idempotent() -> None:
    """Deleting the same voice_id twice does not raise; second call returns False."""
    repo = InMemoryVoiceConfigRepository()
    created: VoiceConfigRecord = repo.create(_make_input())

    first_delete = delete_voice_config(created.voice_id, repo=repo)
    second_delete = delete_voice_config(created.voice_id, repo=repo)

    assert first_delete is True, (
        f"First delete must return True; got {first_delete!r}."
    )
    assert second_delete is False, (
        f"Second delete (idempotent) must return False; got {second_delete!r}."
    )
    # Record must still be absent after double-delete
    assert get_voice_config(created.voice_id, repo=repo) is None, (
        "Record must remain absent after double-delete."
    )


# ---------------------------------------------------------------------------
# 8. Empty-repo delete is safe
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_delete_on_empty_repo_returns_false_without_error() -> None:
    """Calling delete on an empty repository is safe and returns False."""
    repo = InMemoryVoiceConfigRepository()
    phantom_id = uuid.uuid4()

    result = repo.delete(phantom_id)

    assert result is False, (
        f"Deleting from an empty repo must return False; got {result!r}."
    )
    assert len(repo) == 0, (
        f"Empty repo must remain at length 0 after failed delete; got {len(repo)}."
    )


# ---------------------------------------------------------------------------
# 9. Full service-layer round-trip: create → delete → not-found
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_service_layer_create_delete_get_round_trip() -> None:
    """End-to-end service-layer round-trip for Sub-AC 13c-4.

    Uses all three service functions (create_voice_config, delete_voice_config,
    get_voice_config) to verify the complete create → delete → not-found
    lifecycle without touching the repository methods directly.
    """
    repo = InMemoryVoiceConfigRepository()
    input_ = VoiceConfigCreateInput(
        tone_descriptor="서비스레이어 큐레이터",
        trend_timing_voice="먼저 씁니다",
        photo_sense_voice="조명을 읽습니다",
        cta_templates={"restyle": "restyle해봐"},
    )

    # Step 1: create
    created: VoiceConfigRecord = create_voice_config(input_, repo=repo)
    assert create_voice_config is not None
    assert len(repo) == 1

    # Step 2: confirm it is retrievable
    before_delete = get_voice_config(created.voice_id, repo=repo)
    assert before_delete is not None, (
        "Record must be retrievable immediately after creation."
    )

    # Step 3: delete
    was_deleted = delete_voice_config(created.voice_id, repo=repo)
    assert was_deleted is True, (
        f"delete_voice_config must return True for a record that was just created."
    )
    assert len(repo) == 0, (
        f"repo must be empty after deleting the only record; len={len(repo)}."
    )

    # Step 4: not-found — the AC assertion
    after_delete = get_voice_config(created.voice_id, repo=repo)
    assert after_delete is None, (
        f"Sub-AC 13c-4: get_voice_config must return None after delete; "
        f"got {after_delete!r} for voice_id {created.voice_id!r}."
    )
