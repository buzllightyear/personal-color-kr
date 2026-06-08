"""Trend-drop notification copy functions (Sub-AC 3a).

Sub-AC 3a acceptance criteria
-------------------------------
  "Trend-drop notification copy — the function(s) that produce
  push-notification or in-app alert text for a new trend drop accept the
  voice config as a parameter/import; a unit test stubs the voice config with
  a sentinel tone value and asserts every returned notification string contains
  that value, with no hardcoded tone strings present."

Design
------
Both public functions (:func:`make_trend_drop_push_notification` and
:func:`make_trend_drop_in_app_alert`) accept a :class:`~api.voice.config.VoiceConfig`
via the keyword-only ``voice`` parameter.  Every returned string embeds
``voice.tone`` so that:

  1. There are **zero hardcoded tone strings** in this module — the tone value
     comes exclusively from the injected ``VoiceConfig``.
  2. Unit tests can stub ``VoiceConfig(tone="SENTINEL", ...)`` and assert every
     returned string contains the sentinel, proving the copy layer is fully
     voice-config-driven.

The production default (:data:`~api.voice.config.DEFAULT_VOICE_CONFIG`) is
wired in as the default argument so call sites that want production copy can
omit the ``voice`` keyword argument.  Tests always supply an explicit sentinel
config to verify the invariant.

Seed constraints honored here
------------------------------
- ``ToneSwitcher 4톤 폐기 → 1 voice``: Only one voice config shape exists.
  No ``if tone == "X"`` branches, no tone enum, no 4-way switch.
- ``retention vehicle = 트렌드 드롭 (반자동, v1)``: These functions produce the
  operator-triggered push/alert text for the v1 semi-automatic drop flow.
- ``주기 기반 retention 금지 — 트렌드 이벤트 트리거``: The functions are called
  in response to a trend event push (not on a fixed schedule).
"""

from __future__ import annotations

from api.trend_drop.model import TrendDrop
from api.voice.config import DEFAULT_VOICE_CONFIG, VoiceConfig

# ---------------------------------------------------------------------------
# Notification copy functions
# ---------------------------------------------------------------------------


def make_trend_drop_push_notification(
    drop: TrendDrop,
    *,
    voice: VoiceConfig = DEFAULT_VOICE_CONFIG,
) -> str:
    """Produce the push-notification title/body text for a trend drop.

    The returned string is the operator's single-POV alert: it announces
    that a new trend has arrived and invites the user to restyle their selfie.

    Parameters
    ----------
    drop:
        The trend-drop event metadata (trend name, recipe ID, target segment).
    voice:
        Voice config injected at call time.  Defaults to
        :data:`~api.voice.config.DEFAULT_VOICE_CONFIG` (production single POV).
        Unit tests pass a sentinel-tone :class:`~api.voice.config.VoiceConfig`
        to verify the returned string is driven entirely by this config.

    Returns
    -------
    str
        Push notification text containing ``voice.tone`` and trend-drop
        metadata.  No tone string is hardcoded — the tone comes exclusively
        from the ``voice`` parameter.
    """
    return (
        f"[{voice.tone}] 방금 떴어 — {drop.trend_name}! "
        f"네 셀카 {voice.cta_action_verb} 👇"
    )


def make_trend_drop_in_app_alert(
    drop: TrendDrop,
    *,
    voice: VoiceConfig = DEFAULT_VOICE_CONFIG,
) -> str:
    """Produce the in-app alert text for a trend drop.

    The returned string is the in-app banner/card body that surfaces when the
    user opens the app after a trend-drop push.  It reinforces the voice
    identity and links to the restyle CTA.

    Parameters
    ----------
    drop:
        The trend-drop event metadata (trend name, restyle CTA link).
    voice:
        Voice config injected at call time.  Defaults to
        :data:`~api.voice.config.DEFAULT_VOICE_CONFIG` (production single POV).
        Unit tests pass a sentinel-tone :class:`~api.voice.config.VoiceConfig`
        to verify the returned string is driven entirely by this config.

    Returns
    -------
    str
        In-app alert text containing ``voice.tone`` and trend-drop metadata.
        No tone string is hardcoded — the tone comes exclusively from the
        ``voice`` parameter.
    """
    return (
        f"[{voice.tone}] 새 트렌드 드롭: {drop.trend_name}. "
        f"지금 {voice.cta_action_verb} → {drop.restyle_cta}"
    )


__all__ = [
    "make_trend_drop_push_notification",
    "make_trend_drop_in_app_alert",
]
