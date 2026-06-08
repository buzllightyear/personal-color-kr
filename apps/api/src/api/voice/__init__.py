"""Voice identity package — single-POV copy configuration (Sub-AC 3a).

Seed constraint honored here
------------------------------
ToneSwitcher 4톤 폐기 → 1 voice (단일 POV).
All copy derived from :class:`~api.voice.config.VoiceConfig` — no hardcoded
tone strings anywhere in the notification or copy layers.

Sub-AC 13c-1 — voice_config CREATE surface
--------------------------------------------
:class:`~api.voice.repository.VoiceConfigRecord` is the full persisted
record shape (ontology fields: voice_id, tone_descriptor, trend_timing_voice,
photo_sense_voice, cta_templates, updated_at).
:class:`~api.voice.repository.InMemoryVoiceConfigRepository` provides the
in-memory CREATE / lookup surface. :func:`~api.voice.repository.create_voice_config`
is the service-layer entry point.
"""

from api.voice.config import VoiceConfig, DEFAULT_VOICE_CONFIG
from api.voice.repository import (
    VoiceConfigCreateInput,
    VoiceConfigRecord,
    InMemoryVoiceConfigRepository,
    create_voice_config,
    get_voice_config,
    voice_config_repo,
)

__all__ = [
    "VoiceConfig",
    "DEFAULT_VOICE_CONFIG",
    "VoiceConfigCreateInput",
    "VoiceConfigRecord",
    "InMemoryVoiceConfigRepository",
    "create_voice_config",
    "get_voice_config",
    "voice_config_repo",
]
