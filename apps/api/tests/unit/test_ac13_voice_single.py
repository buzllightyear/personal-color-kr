"""AC13: Voice unification — ToneSwitcher removed, single voice_config CRUD.

Acceptance criteria verified
-----------------------------
AC13: ToneSwitcher enum/분기 코드 제거(grep 0건).
      단일 voice_config entity CRUD.
      voice_config 필드는 카피/텍스트 톤만 포함.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from api.voice.repository import (
    InMemoryVoiceConfigRepository,
    VoiceConfigCreateInput,
    create_voice_config,
    delete_voice_config,
    get_voice_config,
)

# ---------------------------------------------------------------------------
# AC13: ToneSwitcher grep = 0 (code-level assertion)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_no_tone_switcher_enum_or_branch_code() -> None:
    """No ToneSwitcher class definition or call-site usage in api source tree.

    Note: The text "ToneSwitcher" may appear in docstring comments explaining
    that it was removed. The AC requires zero *code* usage (class defs, enum
    values, if/switch branches). We check for `class ToneSwitcher` and
    `ToneSwitcher.` (call-site usage) patterns.
    """
    src_dir = Path(__file__).parent.parent.parent / "src"

    # Check for class definition
    class_result = subprocess.run(
        ["grep", "-rn", "class ToneSwitcher", str(src_dir), "--include=*.py"],
        capture_output=True,
        text=True,
    )
    # Check for usage as an enum/object reference (e.g. ToneSwitcher.FORMAL)
    usage_result = subprocess.run(
        ["grep", "-rn", r"ToneSwitcher\.", str(src_dir), "--include=*.py"],
        capture_output=True,
        text=True,
    )

    class_matches = class_result.stdout.strip()
    usage_matches = usage_result.stdout.strip()

    assert (
        class_matches == ""
    ), f"ToneSwitcher class definition found (AC13 violation):\n{class_matches}"
    assert (
        usage_matches == ""
    ), f"ToneSwitcher usage (.attribute) found (AC13 violation):\n{usage_matches}"


# ---------------------------------------------------------------------------
# AC13: single voice_config CRUD
# ---------------------------------------------------------------------------


_SAMPLE_INPUT = VoiceConfigCreateInput(
    tone_descriptor="트렌드 타이밍 큐레이터",
    trend_timing_voice="아직 아무도 모를 때 먼저 씁니다",
    photo_sense_voice="빛의 방향 하나로 분위기가 바뀝니다",
    cta_templates={"restyle": "{tone}처럼 restyle해봐"},
)


@pytest.mark.unit
def test_voice_config_create() -> None:
    """CREATE voice_config returns record with auto-generated id."""
    repo = InMemoryVoiceConfigRepository()
    record = create_voice_config(_SAMPLE_INPUT, repo=repo)

    assert record.voice_id is not None
    assert record.tone_descriptor == "트렌드 타이밍 큐레이터"


@pytest.mark.unit
def test_voice_config_read() -> None:
    """READ voice_config by id returns the created record."""
    repo = InMemoryVoiceConfigRepository()
    created = create_voice_config(_SAMPLE_INPUT, repo=repo)

    fetched = get_voice_config(created.voice_id, repo=repo)

    assert fetched is not None
    assert fetched == created


@pytest.mark.unit
def test_voice_config_delete() -> None:
    """DELETE voice_config removes it; subsequent read returns None."""
    repo = InMemoryVoiceConfigRepository()
    created = create_voice_config(_SAMPLE_INPUT, repo=repo)

    deleted = delete_voice_config(created.voice_id, repo=repo)

    assert deleted is True
    assert get_voice_config(created.voice_id, repo=repo) is None


# ---------------------------------------------------------------------------
# AC13: voice_config fields are text-tone only (no technical params)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_voice_config_fields_are_copy_text_tone_only() -> None:
    """VoiceConfigRecord fields are copy/text-tone fields only.

    No composition parameters, no sharpening values, no color grading
    numbers — those belong to recipe.style_params and enhancer.per_recipe_params.
    """
    repo = InMemoryVoiceConfigRepository()
    record = create_voice_config(_SAMPLE_INPUT, repo=repo)

    # Fields that should exist (text/copy tone)
    assert hasattr(record, "tone_descriptor")
    assert hasattr(record, "trend_timing_voice")
    assert hasattr(record, "photo_sense_voice")
    assert hasattr(record, "cta_templates")

    # Fields that must NOT exist (technical parameters)
    assert not hasattr(
        record, "sharpness_factor"
    ), "voice_config must not contain technical sharpness parameter"
    assert not hasattr(
        record, "color_balance"
    ), "voice_config must not contain color balance parameter"
    assert not hasattr(
        record, "composition_angle"
    ), "voice_config must not contain composition angle parameter"
