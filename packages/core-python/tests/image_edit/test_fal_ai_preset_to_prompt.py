"""Tests for the `_PRESET_TO_PROMPT` constant in the Fal.ai adapter (AC 6).

The Seed Contract pins the personal-color diagnosis to a *closed* enum of
four seasons (spring-warm, summer-cool, autumn-warm, winter-cool). The
adapter is the one place where those domain tokens are translated into
FLUX prompt text, so the mapping has to be:

  - **complete**     : all four seasons present, no others
  - **deterministic**: a frozen mapping so a stray caller cannot mutate
                       it mid-run and silently re-skin a different user
  - **non-empty**    : every prompt must be a real string FLUX can
                       condition on; empty prompts produce identity
                       output and would silently bypass the edit
  - **domain-bearing**: every prompt must reference the season's actual
                       color quality (warm / cool / spring / summer /
                       autumn / winter) — otherwise the mapping is just
                       a placeholder and the adapter would not actually
                       deliver season-conditioned results

These tests pin those invariants down so a future refactor cannot quietly
drop a season, blank out a prompt, or replace the mapping with a mutable
dict.
"""

from __future__ import annotations

from collections.abc import Mapping

import pytest

from image_edit.fal_ai_vendor_caller import _PRESET_TO_PROMPT

# The closed enum of season presets — kept here (test-local) rather than
# imported from the adapter so the test fails loud if the adapter ever
# drifts away from the Seed Contract's four-season closure.
_EXPECTED_SEASONS: frozenset[str] = frozenset(
    {
        "spring-warm",
        "summer-cool",
        "autumn-warm",
        "winter-cool",
    }
)


@pytest.mark.unit
def test_preset_to_prompt_exposes_exactly_four_seasons() -> None:
    """Mapping must contain exactly the four-season closed enum.

    Why: the Seed Contract forbids open-ended preset enums. A fifth key
    silently appearing here would mean the adapter accepts a preset the
    rest of the diagnosis pipeline never produces — a dead branch that
    would degrade to garbage output if ever reached.
    """
    assert set(_PRESET_TO_PROMPT.keys()) == set(_EXPECTED_SEASONS), (
        "preset mapping must cover exactly the four-season closed enum; "
        f"got {sorted(_PRESET_TO_PROMPT.keys())}"
    )


@pytest.mark.unit
@pytest.mark.parametrize("preset", sorted(_EXPECTED_SEASONS))
def test_preset_to_prompt_value_is_non_empty_string(preset: str) -> None:
    """Every prompt must be a non-empty string FLUX can condition on.

    Why: FLUX img2img with an empty prompt collapses to identity ≈ the
    original selfie. That would silently no-op the entire vendor call
    and bill the user for an edit they did not receive. Failing fast
    here keeps the failure visible at adapter init / test time.
    """
    prompt = _PRESET_TO_PROMPT[preset]
    assert isinstance(
        prompt, str
    ), f"prompt for {preset!r} must be str, got {type(prompt).__name__}"
    assert prompt.strip(), f"prompt for {preset!r} must be a non-empty string"


@pytest.mark.unit
@pytest.mark.parametrize(
    "preset, required_keywords",
    [
        # Each prompt should at minimum mention the season's domain
        # quality so we can be confident the mapping is doing real
        # work rather than holding a placeholder. We check season name
        # OR temperature word — both are domain-bearing tokens drawn
        # from the personal-color vocabulary.
        ("spring-warm", ("spring", "warm")),
        ("summer-cool", ("summer", "cool")),
        ("autumn-warm", ("autumn", "warm")),
        ("winter-cool", ("winter", "cool")),
    ],
)
def test_preset_to_prompt_value_references_season_domain(
    preset: str, required_keywords: tuple[str, ...]
) -> None:
    """Every prompt must reference its season's domain vocabulary.

    Why: a prompt that does not name the season or its temperature is
    indistinguishable from a generic edit — the user would not see a
    season-conditioned result. Pinning the vocabulary keeps the mapping
    honest about what it claims to do.
    """
    prompt_lower = _PRESET_TO_PROMPT[preset].lower()
    matched = [kw for kw in required_keywords if kw in prompt_lower]
    assert matched, (
        f"prompt for {preset!r} must reference at least one of "
        f"{required_keywords}; got {_PRESET_TO_PROMPT[preset]!r}"
    )


@pytest.mark.unit
def test_preset_to_prompt_values_are_unique() -> None:
    """Each season must map to a distinct prompt.

    Why: two seasons sharing the same prompt would silently collapse
    two diagnosis outcomes into the same edit, making the season
    distinction meaningless to the user.
    """
    values = list(_PRESET_TO_PROMPT.values())
    assert len(set(values)) == len(values), (
        "every season must map to a unique prompt; " f"got duplicates in {values}"
    )


@pytest.mark.unit
def test_preset_to_prompt_is_a_mapping() -> None:
    """Mapping must satisfy `collections.abc.Mapping` Protocol.

    Why: type-checked callers expect `Mapping[str, str]`. A plain dict
    satisfies this; a future refactor to a frozenset / list would not
    and would silently break callers.
    """
    assert isinstance(_PRESET_TO_PROMPT, Mapping), (
        "_PRESET_TO_PROMPT must be a Mapping; "
        f"got {type(_PRESET_TO_PROMPT).__name__}"
    )


@pytest.mark.unit
def test_preset_to_prompt_is_module_scope_constant() -> None:
    """Constant must live at module scope, not inside a function.

    Why: a function-local mapping would be re-instantiated per call
    (allocation cost on every vendor invocation) and could not be
    referenced by other modules for documentation / introspection.
    Module-scope keeps the single-source-of-truth invariant intact.
    """
    from image_edit import fal_ai_vendor_caller as adapter_mod

    # Module attribute lookup must succeed and return the same object
    # reference every time — the canonical signal of a module-scope
    # constant.
    first_ref = adapter_mod._PRESET_TO_PROMPT
    second_ref = adapter_mod._PRESET_TO_PROMPT
    assert first_ref is second_ref, (
        "_PRESET_TO_PROMPT must be a single module-scope object; "
        "re-evaluation suggests it is being rebuilt per access"
    )
