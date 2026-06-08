"""VoiceConfig — Pydantic schema for the single-POV operator voice (Sub-AC 13b-1).

Domain context
--------------
``VoiceConfig`` is the *single* operator voice entity that replaces the
deprecated ToneSwitcher 4-tone system.  Every copy string, CTA, and result
wording in the app is derived from exactly one ``VoiceConfig`` instance — the
singleton that the operator authors and updates over time.

Seed ontology (voice_config)
----------------------------
Fields defined by the ontology:

  voice_id            unique voice identifier
  tone_descriptor     overall tone label (e.g. "감성적 친근", "쿨 에디터")
  trend_timing_voice  카피 톤 for trend-timing communications (e.g. "지금 이 트렌드")
  photo_sense_voice   카피 톤 for photo-aesthetic language (구도·빛·보정)
  cta_templates       dict mapping CTA keys to template strings
  updated_at          UTC ISO-8601 timestamp string of last update

Additional fields (per AC 13b-1)
---------------------------------
The acceptance criterion explicitly names ``tone``, ``persona``, ``platform``,
and ``language`` as required fields.  These are incorporated as:

  persona             personality description used to frame the voice POV
                      (e.g. "독립 큐레이터 1인칭 시점")
  platform            primary distribution platform for this voice config
                      (e.g. "ios", "android", "web"). Validates non-empty.
  language            BCP 47 / ISO 639 language code (e.g. "ko", "en").
                      Validates non-empty.

Design decisions
----------------
- Pydantic v2 ``BaseModel`` with ``ConfigDict(frozen=True)`` is used for the
  same reasons as ``RecipeModel`` — type coercion + ``ValidationError`` on bad
  input, and ``FrozenInstanceError`` on mutation.
- ``cta_templates`` is ``dict[str, str]`` so operators can extend CTAs without
  a schema migration.  Empty dict is valid (app falls back to hardcoded
  defaults).
- ``updated_at`` is a plain UTC ISO-8601 string for the same reason as
  ``RecipeModel.created_at`` — avoids timezone-aware vs naive datetime friction.
- All string fields have ``min_length=1`` to prevent accidental empty strings
  from silently propagating into copy rendering.

Pipeline relevance
------------------
``VoiceConfig`` sits *above* the generation pipeline — it shapes the wording
that frames the result to the user but does not alter the raw→enhancer→filter
order.  The operator updates it to keep the single-POV voice coherent across
trend drops.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

__all__ = [
    "VoiceConfig",
    "validate_voice_config",
    "ValidationError",
]


class VoiceConfig(BaseModel):
    """Single-POV operator voice configuration.

    Required fields
    ---------------
    voice_id:
        Unique identifier for this voice configuration instance.
        Convention: ``"voice_v{n}"`` (e.g. ``"voice_v1"``).
    tone_descriptor:
        Short label describing the overall tone (e.g. ``"감성적 친근"``).
        Drives the emotional register of all generated copy.
    persona:
        First-person personality framing for the operator voice
        (e.g. ``"독립 큐레이터 1인칭 시점"``).  Used when wording copy as if
        the operator is speaking directly to the user.
    platform:
        Primary distribution platform this voice is authored for.
        Must be one of the app's distribution surfaces (e.g. ``"ios"``,
        ``"android"``, ``"web"``).  Non-empty string; the app is free to
        handle unknown platforms gracefully, but the field must be set.
    language:
        BCP 47 / ISO 639-1 language code for the copy (e.g. ``"ko"``).
        Non-empty string; controls localisation decisions downstream.
    trend_timing_voice:
        Copy-tone description for trend-timing communications
        (e.g. ``"지금 이 트렌드 — 선점 감성"``).  Guides how trend-drop
        notifications and in-app trend intros are worded.
    photo_sense_voice:
        Copy-tone description for photo-aesthetic language
        (e.g. ``"구도·빛·보정 감각 — 정제된 눈"``).  Guides result-screen
        captions and enhancer-related copy.
    cta_templates:
        Mapping from CTA key to template string
        (e.g. ``{"trend_drop": "지금 바로 생성하기", "subscribe": "구독하기"}``).
        Empty dict is valid; the app falls back to hardcoded defaults.
    updated_at:
        UTC ISO-8601 timestamp string of last operator update
        (e.g. ``"2026-06-01T09:00:00Z"``).
    """

    model_config = ConfigDict(frozen=True)

    voice_id: str = Field(
        ...,
        min_length=1,
        description="Unique voice configuration identifier.",
    )
    tone_descriptor: str = Field(
        ...,
        min_length=1,
        description=(
            "Short label describing the overall emotional tone "
            "(e.g. '감성적 친근', '쿨 에디터')."
        ),
    )
    persona: str = Field(
        ...,
        min_length=1,
        description=(
            "First-person personality framing "
            "(e.g. '독립 큐레이터 1인칭 시점')."
        ),
    )
    platform: str = Field(
        ...,
        min_length=1,
        description="Primary distribution platform (e.g. 'ios', 'android', 'web').",
    )
    language: str = Field(
        ...,
        min_length=1,
        description="BCP 47 language code (e.g. 'ko', 'en').",
    )
    trend_timing_voice: str = Field(
        ...,
        min_length=1,
        description="Copy-tone description for trend-timing communications.",
    )
    photo_sense_voice: str = Field(
        ...,
        min_length=1,
        description=(
            "Copy-tone description for photo-aesthetic language "
            "(구도·빛·보정 감각)."
        ),
    )
    cta_templates: dict[str, str] = Field(
        ...,
        description=(
            "Mapping from CTA key to template string. "
            "Empty dict is valid — app falls back to hardcoded defaults."
        ),
    )
    updated_at: str = Field(
        ...,
        min_length=1,
        description="UTC ISO-8601 timestamp string of last operator update.",
    )


def validate_voice_config(data: dict[str, Any]) -> VoiceConfig:
    """Validate a raw dictionary and return a ``VoiceConfig`` if valid.

    This is the public entry point for operator tooling that ingests voice
    config payloads from YAML / JSON / API responses.  It wraps the Pydantic
    constructor to give callers a single function contract without exposing
    Pydantic's ``model_validate`` directly.

    Parameters
    ----------
    data:
        Raw dictionary of voice-config fields.

    Returns
    -------
    VoiceConfig
        An immutable, fully-validated voice-config instance.

    Raises
    ------
    pydantic.ValidationError
        If any required field is missing, has the wrong type, or violates a
        constraint (e.g. empty string for a ``min_length=1`` field).

    Examples
    --------
    >>> vc = validate_voice_config({
    ...     "voice_id": "voice_v1",
    ...     "tone_descriptor": "감성적 친근",
    ...     "persona": "독립 큐레이터 1인칭 시점",
    ...     "platform": "ios",
    ...     "language": "ko",
    ...     "trend_timing_voice": "지금 이 트렌드 — 선점 감성",
    ...     "photo_sense_voice": "구도·빛·보정 감각 — 정제된 눈",
    ...     "cta_templates": {"trend_drop": "지금 바로 생성하기"},
    ...     "updated_at": "2026-06-01T09:00:00Z",
    ... })
    >>> vc.voice_id
    'voice_v1'
    >>> vc.language
    'ko'
    """
    return VoiceConfig.model_validate(data)
