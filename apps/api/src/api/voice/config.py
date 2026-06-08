"""Single-voice POV configuration for all operator copy (Sub-AC 3a).

Seed constraints honored here
------------------------------
- ``ToneSwitcher 4톤 폐기 → 1 voice (단일 POV)``:
  There is exactly one voice configuration for the entire product. The old
  four-tone switcher is eliminated. All notification copy (trend-drop push
  alerts, in-app restyle CTAs) derives from the single :class:`VoiceConfig`
  injected at call time — no hardcoded tone strings exist anywhere in the
  copy layer.

- ``voice 정의 = 트렌드 타이밍(언제 갱신) + 사진 감각``:
  The voice identity encodes the operator's single editorial POV: when to
  call a trend and how to talk about selfie photo craft. The ``tone`` field
  carries the voice label that appears in all copy — tests can inject a
  sentinel value to verify every string is voice-config-driven.

Design
------
:class:`VoiceConfig` is an immutable frozen dataclass. It is the *sole* source
of tone identity for all copy functions. Functions that produce
push-notification or in-app alert text MUST accept a ``VoiceConfig`` as a
parameter (not import a module-level constant directly) so unit tests can stub
it with a sentinel and verify the sentinel appears in every returned string.

:data:`DEFAULT_VOICE_CONFIG` is the production singleton. It should be the
default argument in copy functions; tests override it with a sentinel-tone
stub to assert no hardcoded strings exist.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True)
class VoiceConfig:
    """Immutable single-voice identity for all operator copy.

    This is the *only* authoritative tone configuration. All notification copy
    (push alerts, in-app trend-drop CTAs) must derive its tone string from this
    object — no hardcoded tone words are permitted in the copy layer.

    Attributes
    ----------
    tone:
        The single voice/persona label string.  Every notification function
        embeds this value in its returned text so that injecting a sentinel
        value in tests proves the copy layer is voice-config-driven.
        Example (production): ``"트렌드 타이밍 큐레이터"``
    cta_action_verb:
        The Korean action verb used in restyle call-to-action text.
        Derived from the same single POV.
        Example: ``"restyle해봐"``
    """

    tone: str
    cta_action_verb: str


#: Production default voice config (the single editorial POV for the app).
#: Copy functions use this as their default parameter value; unit tests
#: substitute a sentinel-tone VoiceConfig to verify no hardcoded tones exist.
DEFAULT_VOICE_CONFIG: Final[VoiceConfig] = VoiceConfig(
    tone="트렌드 타이밍 큐레이터",
    cta_action_verb="restyle해봐",
)

__all__ = ["VoiceConfig", "DEFAULT_VOICE_CONFIG"]
