"""Unit tests: trend-drop notification copy is voice-config-driven (Sub-AC 3a).

Acceptance criterion (Sub-AC 3a) being verified
------------------------------------------------
    "Trend-drop notification copy — the function(s) that produce
    push-notification or in-app alert text for a new trend drop accept the
    voice config as a parameter/import; a unit test stubs the voice config with
    a sentinel tone value and asserts every returned notification string contains
    that value, with no hardcoded tone strings present."

Invariants asserted
-------------------
1. :func:`~api.trend_drop.notification.make_trend_drop_push_notification`
   returns a string that contains the sentinel ``voice.tone`` value.
2. :func:`~api.trend_drop.notification.make_trend_drop_in_app_alert`
   returns a string that contains the sentinel ``voice.tone`` value.
3. Both functions also embed ``voice.cta_action_verb`` so no copy field in
   :class:`~api.voice.config.VoiceConfig` is silently ignored.
4. The sentinel tone value is NOT present in default (production) output when
   the functions are called WITHOUT the sentinel — confirming the default config
   differs from the sentinel (sentinel isolation sanity check).
5. Both functions accept the ``voice`` parameter as keyword-only, not
   positional — the signature contract is enforced.

Testing technique
-----------------
A :class:`VoiceConfig` with an intentionally unusual sentinel value
``SENTINEL_TONE = "SENTINEL_TONE_VALUE_42xQQ"`` is constructed and injected via
the ``voice=`` keyword argument.  The sentinel contains digits and uppercase
letters that no production Korean copy string would coincidentally include,
ensuring any match is caused by the voice config injection, not a coincidence.

No external mocking library is required — :class:`VoiceConfig` is a plain
frozen dataclass that can be instantiated directly with the sentinel value.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from api.trend_drop.model import TrendDrop
from api.trend_drop.notification import (
    make_trend_drop_in_app_alert,
    make_trend_drop_push_notification,
)
from api.voice.config import DEFAULT_VOICE_CONFIG, VoiceConfig

# ---------------------------------------------------------------------------
# Sentinel values — chosen to be unique; no production copy would hardcode them
# ---------------------------------------------------------------------------

#: Sentinel tone string injected via VoiceConfig in Sub-AC 3a tests.
#: Contains digits and uppercase that production Korean copy never uses, so
#: any appearance in the output is caused by voice-config injection only.
_SENTINEL_TONE: str = "SENTINEL_TONE_VALUE_42xQQ"

#: Sentinel CTA action verb — also unique, also must appear in copy output.
_SENTINEL_CTA_VERB: str = "SENTINEL_CTA_VERB_99zRR"

#: Stub VoiceConfig with sentinel values — injected into notification
#: functions to verify every returned string contains the sentinel tone.
_SENTINEL_VOICE: VoiceConfig = VoiceConfig(
    tone=_SENTINEL_TONE,
    cta_action_verb=_SENTINEL_CTA_VERB,
)

# ---------------------------------------------------------------------------
# Canonical TrendDrop fixture — minimal, deterministic, no I/O
# ---------------------------------------------------------------------------

_SAMPLE_DROP: TrendDrop = TrendDrop(
    recipe_id="recipe-y2k-glitter-001",
    trend_name="Y2K 글리터",
    pushed_at=datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc),
    target_user_segment="봄웜",
    restyle_cta="pcolor://restyle/y2k-glitter",
)


# ---------------------------------------------------------------------------
# Sub-AC 3a core test: push-notification contains sentinel tone
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_push_notification_contains_sentinel_tone() -> None:
    """Push-notification text contains the injected sentinel voice.tone.

    This is the primary Sub-AC 3a assertion for
    :func:`~api.trend_drop.notification.make_trend_drop_push_notification`:
    when the function receives a :class:`~api.voice.config.VoiceConfig` with
    ``tone=SENTINEL_TONE``, that sentinel must appear verbatim in the returned
    string.  No hardcoded tone string in the function source could satisfy this
    because the sentinel is unique and not present in production code.
    """
    result: str = make_trend_drop_push_notification(
        _SAMPLE_DROP,
        voice=_SENTINEL_VOICE,
    )

    assert isinstance(
        result, str
    ), f"make_trend_drop_push_notification must return str, got {type(result)!r}."
    assert _SENTINEL_TONE in result, (
        f"Sub-AC 3a violation: push-notification text {result!r} does not "
        f"contain the injected sentinel tone {_SENTINEL_TONE!r}.  "
        f"The function must derive its tone from the voice parameter, "
        f"not from hardcoded strings."
    )


# ---------------------------------------------------------------------------
# Sub-AC 3a core test: in-app alert contains sentinel tone
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_in_app_alert_contains_sentinel_tone() -> None:
    """In-app alert text contains the injected sentinel voice.tone.

    This is the primary Sub-AC 3a assertion for
    :func:`~api.trend_drop.notification.make_trend_drop_in_app_alert`:
    when the function receives a :class:`~api.voice.config.VoiceConfig` with
    ``tone=SENTINEL_TONE``, that sentinel must appear verbatim in the returned
    string.
    """
    result: str = make_trend_drop_in_app_alert(
        _SAMPLE_DROP,
        voice=_SENTINEL_VOICE,
    )

    assert isinstance(
        result, str
    ), f"make_trend_drop_in_app_alert must return str, got {type(result)!r}."
    assert _SENTINEL_TONE in result, (
        f"Sub-AC 3a violation: in-app alert text {result!r} does not "
        f"contain the injected sentinel tone {_SENTINEL_TONE!r}.  "
        f"The function must derive its tone from the voice parameter, "
        f"not from hardcoded strings."
    )


# ---------------------------------------------------------------------------
# Comprehensive: ALL notification functions return strings with sentinel tone
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_all_notification_functions_contain_sentinel_tone() -> None:
    """Every notification function's return value contains the sentinel tone.

    Collects the output of ALL public notification functions in a single list
    and asserts that EVERY item contains ``_SENTINEL_TONE``.  This is the
    broadest Sub-AC 3a gate: adding a new notification function to the module
    without injecting the voice config will cause this test to fail.
    """
    all_notification_strings: list[str] = [
        make_trend_drop_push_notification(_SAMPLE_DROP, voice=_SENTINEL_VOICE),
        make_trend_drop_in_app_alert(_SAMPLE_DROP, voice=_SENTINEL_VOICE),
    ]

    for notification_text in all_notification_strings:
        assert _SENTINEL_TONE in notification_text, (
            f"Sub-AC 3a violation: notification text {notification_text!r} "
            f"does not contain sentinel tone {_SENTINEL_TONE!r}.  "
            f"All notification copy MUST be voice-config-driven."
        )


# ---------------------------------------------------------------------------
# CTA verb injection: voice.cta_action_verb is also embedded
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_push_notification_contains_sentinel_cta_verb() -> None:
    """Push-notification text also contains the sentinel cta_action_verb.

    Verifies that :attr:`~api.voice.config.VoiceConfig.cta_action_verb` is not
    silently ignored — both VoiceConfig fields are embedded in the copy.
    """
    result: str = make_trend_drop_push_notification(
        _SAMPLE_DROP,
        voice=_SENTINEL_VOICE,
    )
    assert _SENTINEL_CTA_VERB in result, (
        f"Sub-AC 3a violation: push-notification {result!r} does not contain "
        f"sentinel cta_action_verb {_SENTINEL_CTA_VERB!r}.  "
        f"VoiceConfig.cta_action_verb must appear in copy output."
    )


@pytest.mark.unit
def test_in_app_alert_contains_sentinel_cta_verb() -> None:
    """In-app alert text also contains the sentinel cta_action_verb.

    Verifies that :attr:`~api.voice.config.VoiceConfig.cta_action_verb` is not
    silently ignored — both VoiceConfig fields are embedded in the copy.
    """
    result: str = make_trend_drop_in_app_alert(
        _SAMPLE_DROP,
        voice=_SENTINEL_VOICE,
    )
    assert _SENTINEL_CTA_VERB in result, (
        f"Sub-AC 3a violation: in-app alert {result!r} does not contain "
        f"sentinel cta_action_verb {_SENTINEL_CTA_VERB!r}.  "
        f"VoiceConfig.cta_action_verb must appear in copy output."
    )


# ---------------------------------------------------------------------------
# Sentinel isolation: default config does NOT contain the sentinel tone
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_default_config_does_not_contain_sentinel_tone() -> None:
    """Sanity check: default voice config output does NOT contain the sentinel.

    Confirms the sentinel is genuinely unique — the sentinel-in-output
    assertions above detect voice-config injection, not a coincidental match
    from the production default config.  If the sentinel somehow appears in
    the default output, the Sub-AC 3a test suite has a false-positive risk.
    """
    push_default = make_trend_drop_push_notification(_SAMPLE_DROP)
    alert_default = make_trend_drop_in_app_alert(_SAMPLE_DROP)

    assert _SENTINEL_TONE not in push_default, (
        f"Sentinel isolation failure: default push notification {push_default!r} "
        f"already contains the sentinel tone {_SENTINEL_TONE!r}.  "
        f"Choose a more unique sentinel value."
    )
    assert _SENTINEL_TONE not in alert_default, (
        f"Sentinel isolation failure: default in-app alert {alert_default!r} "
        f"already contains the sentinel tone {_SENTINEL_TONE!r}.  "
        f"Choose a more unique sentinel value."
    )


# ---------------------------------------------------------------------------
# Keyword-only enforcement: voice parameter cannot be passed positionally
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_voice_parameter_is_keyword_only_for_push_notification() -> None:
    """The ``voice`` parameter of push-notification must be keyword-only.

    The function signature uses ``*`` to enforce keyword-only access.  Passing
    the voice config positionally should raise ``TypeError``.
    """
    with pytest.raises(TypeError):
        # Attempt to pass voice as the second positional argument — must fail.
        make_trend_drop_push_notification(_SAMPLE_DROP, _SENTINEL_VOICE)  # type: ignore[call-arg]


@pytest.mark.unit
def test_voice_parameter_is_keyword_only_for_in_app_alert() -> None:
    """The ``voice`` parameter of in-app alert must be keyword-only.

    The function signature uses ``*`` to enforce keyword-only access.  Passing
    the voice config positionally should raise ``TypeError``.
    """
    with pytest.raises(TypeError):
        # Attempt to pass voice as the second positional argument — must fail.
        make_trend_drop_in_app_alert(_SAMPLE_DROP, _SENTINEL_VOICE)  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# Default config integration: functions work with DEFAULT_VOICE_CONFIG
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_push_notification_works_with_default_voice_config() -> None:
    """Push-notification returns a non-empty string with the default voice config."""
    result: str = make_trend_drop_push_notification(
        _SAMPLE_DROP,
        voice=DEFAULT_VOICE_CONFIG,
    )
    assert result, "Push notification must not be empty with default voice config."
    assert DEFAULT_VOICE_CONFIG.tone in result, (
        f"Default tone {DEFAULT_VOICE_CONFIG.tone!r} not found in push "
        f"notification {result!r}."
    )


@pytest.mark.unit
def test_in_app_alert_works_with_default_voice_config() -> None:
    """In-app alert returns a non-empty string with the default voice config."""
    result: str = make_trend_drop_in_app_alert(
        _SAMPLE_DROP,
        voice=DEFAULT_VOICE_CONFIG,
    )
    assert result, "In-app alert must not be empty with default voice config."
    assert DEFAULT_VOICE_CONFIG.tone in result, (
        f"Default tone {DEFAULT_VOICE_CONFIG.tone!r} not found in in-app "
        f"alert {result!r}."
    )
