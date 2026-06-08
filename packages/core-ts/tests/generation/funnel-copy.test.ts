/**
 * Unit tests — Generation funnel copy (Sub-AC 3b).
 *
 * Verifies:
 *   - Each function that produces a user-facing string in the AI generation
 *     flow (candidate count labels, selection prompt, enhancer status message)
 *     accepts a `VoiceConfig` parameter.
 *   - When a stub config is injected all returned strings match the stub's
 *     slot values — proving no hardcoded production copy leaks through.
 *   - No legacy ToneSwitcher tone strings appear in any returned value.
 *   - Default behaviour (no config arg) falls back to the production
 *     `VOICE_CONFIG` singleton without error.
 *   - `getCandidateCountLabel` substitutes `{{count}}` in the template slot.
 *
 * Stub strategy:
 *   We construct a minimal `VoiceConfig`-shaped object whose generation-funnel
 *   slots contain clearly identifiable sentinel strings (all-caps ASCII) that
 *   cannot appear in any Korean production copy.  After calling the function
 *   with this stub we assert the output contains the sentinel — if it doesn't,
 *   the function returned a hardcoded string instead of reading from the config.
 */

import { describe, expect, it } from 'vitest';

import {
  VOICE_CONFIG,
  type VoiceConfig,
  type VoiceId,
} from '../../src/voice/config.js';
import {
  getCandidateCountLabel,
  getEnhancerStatusMessage,
  getSelectionPrompt,
} from '../../src/generation/funnel-copy.js';

// ---------------------------------------------------------------------------
// Stub VoiceConfig
// Slots for non-generation surfaces keep their production values (irrelevant
// to these tests).  Generation-funnel slots are replaced with ASCII sentinels.
// ---------------------------------------------------------------------------

const STUB_CANDIDATE_COUNT_LABEL_TEMPLATE = 'STUB_CANDIDATE:{{count}}:END';
const STUB_PICK_PROMPT = 'STUB_SELECTION_PROMPT';
const STUB_ENHANCING_LABEL = 'STUB_ENHANCER_STATUS';

const STUB_CONFIG: VoiceConfig = {
  voiceId: 'trend-editor-kr' as VoiceId,
  description: 'test stub — generation funnel copy',
  slots: Object.freeze({
    trend_drop_push_title: VOICE_CONFIG.slots.trend_drop_push_title,
    trend_drop_push_body: VOICE_CONFIG.slots.trend_drop_push_body,
    trend_drop_cta_primary: VOICE_CONFIG.slots.trend_drop_cta_primary,
    // Entry wedge slots — kept at production values (not under test here)
    diagnosis_wedge_headline: VOICE_CONFIG.slots.diagnosis_wedge_headline,
    diagnosis_wedge_subhead: VOICE_CONFIG.slots.diagnosis_wedge_subhead,
    diagnosis_wedge_cta: VOICE_CONFIG.slots.diagnosis_wedge_cta,
    result_reveal_cta: VOICE_CONFIG.slots.result_reveal_cta,
    result_reveal_headline: VOICE_CONFIG.slots.result_reveal_headline,
    result_reveal_subhead: VOICE_CONFIG.slots.result_reveal_subhead,
    // ── Generation funnel — replaced with sentinels ──────────────────────
    generation_candidate_count_label: STUB_CANDIDATE_COUNT_LABEL_TEMPLATE,
    generation_pick_prompt: STUB_PICK_PROMPT,
    generation_enhancing_label: STUB_ENHANCING_LABEL,
    // ────────────────────────────────────────────────────────────────────
    // Payment funnel slots — kept at production values (not under test here)
    payment_value_prop: VOICE_CONFIG.slots.payment_value_prop,
    payment_step_headline: VOICE_CONFIG.slots.payment_step_headline,
    payment_step_subhead: VOICE_CONFIG.slots.payment_step_subhead,
    payment_step_body: VOICE_CONFIG.slots.payment_step_body,
    payment_annual_plan_cta: VOICE_CONFIG.slots.payment_annual_plan_cta,
    payment_monthly_plan_cta: VOICE_CONFIG.slots.payment_monthly_plan_cta,
    payment_upsell_prompt: VOICE_CONFIG.slots.payment_upsell_prompt,
    payment_confirmed_headline: VOICE_CONFIG.slots.payment_confirmed_headline,
    payment_confirmed_subhead: VOICE_CONFIG.slots.payment_confirmed_subhead,
    free_trial_emphasis: VOICE_CONFIG.slots.free_trial_emphasis,
  }),
};

// ---------------------------------------------------------------------------
// getCandidateCountLabel
// ---------------------------------------------------------------------------

describe('getCandidateCountLabel — voice-config injection (Sub-AC 3b)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    const result = getCandidateCountLabel(4, STUB_CONFIG);
    expect(result).toContain('STUB_CANDIDATE');
  });

  it('substitutes {{count}} with the actual count integer', () => {
    expect(getCandidateCountLabel(3, STUB_CONFIG)).toBe('STUB_CANDIDATE:3:END');
    expect(getCandidateCountLabel(6, STUB_CONFIG)).toBe('STUB_CANDIDATE:6:END');
    expect(getCandidateCountLabel(1, STUB_CONFIG)).toBe('STUB_CANDIDATE:1:END');
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    const stubResult = getCandidateCountLabel(4, STUB_CONFIG);
    const prodResult = getCandidateCountLabel(4, VOICE_CONFIG);
    expect(stubResult).not.toBe(prodResult);
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    const result = getCandidateCountLabel(4, STUB_CONFIG);
    // Korean syllables range: U+AC00–U+D7A3
    expect(/[가-힣]/.test(result)).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    const expected = VOICE_CONFIG.slots.generation_candidate_count_label.replace(
      '{{count}}',
      '4',
    );
    expect(getCandidateCountLabel(4)).toBe(expected);
  });

  it('production output contains the substituted count', () => {
    expect(getCandidateCountLabel(7)).toContain('7');
  });
});

// ---------------------------------------------------------------------------
// getSelectionPrompt
// ---------------------------------------------------------------------------

describe('getSelectionPrompt — voice-config injection (Sub-AC 3b)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getSelectionPrompt(STUB_CONFIG)).toBe(STUB_PICK_PROMPT);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getSelectionPrompt(STUB_CONFIG)).not.toBe(getSelectionPrompt(VOICE_CONFIG));
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getSelectionPrompt(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getSelectionPrompt()).toBe(VOICE_CONFIG.slots.generation_pick_prompt);
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getSelectionPrompt(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getEnhancerStatusMessage
// ---------------------------------------------------------------------------

describe('getEnhancerStatusMessage — voice-config injection (Sub-AC 3b)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getEnhancerStatusMessage(STUB_CONFIG)).toBe(STUB_ENHANCING_LABEL);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getEnhancerStatusMessage(STUB_CONFIG)).not.toBe(
      getEnhancerStatusMessage(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getEnhancerStatusMessage(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getEnhancerStatusMessage()).toBe(
      VOICE_CONFIG.slots.generation_enhancing_label,
    );
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getEnhancerStatusMessage(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No-hardcoded-tone-strings guard (ToneSwitcher regression)
// ---------------------------------------------------------------------------

describe('no hardcoded legacy tone strings in any generation funnel output', () => {
  // Strings that would indicate hardcoded ToneSwitcher (4-tone) regression
  const LEGACY_TONE_NAMES = ['다정', '에디토리얼', '유쾌', '시적'];

  // All generation funnel outputs under the stub config
  const STUB_OUTPUTS = [
    getCandidateCountLabel(4, STUB_CONFIG),
    getSelectionPrompt(STUB_CONFIG),
    getEnhancerStatusMessage(STUB_CONFIG),
  ];

  // All generation funnel outputs under the production config
  const PROD_OUTPUTS = [
    getCandidateCountLabel(4, VOICE_CONFIG),
    getSelectionPrompt(VOICE_CONFIG),
    getEnhancerStatusMessage(VOICE_CONFIG),
  ];

  it('stub outputs contain no legacy tone names', () => {
    for (const output of STUB_OUTPUTS) {
      for (const tone of LEGACY_TONE_NAMES) {
        expect(
          output.includes(tone),
          `stub output "${output}" must not contain legacy tone "${tone}"`,
        ).toBe(false);
      }
    }
  });

  it('production outputs contain no legacy tone names', () => {
    for (const output of PROD_OUTPUTS) {
      for (const tone of LEGACY_TONE_NAMES) {
        expect(
          output.includes(tone),
          `prod output "${output}" must not contain legacy tone "${tone}"`,
        ).toBe(false);
      }
    }
  });

  it('all three stub outputs are unique (no accidental aliasing)', () => {
    const [countLabel, selectionPrompt, enhancerStatus] = STUB_OUTPUTS;
    expect(countLabel).not.toBe(selectionPrompt);
    expect(selectionPrompt).not.toBe(enhancerStatus);
    expect(countLabel).not.toBe(enhancerStatus);
  });
});

// ---------------------------------------------------------------------------
// Full stub coverage — every string returned reflects the stub's values
// ---------------------------------------------------------------------------

describe('all returned strings reflect the stubbed voice config (core Sub-AC 3b assertion)', () => {
  it('getCandidateCountLabel returns a string containing the stub template sentinel', () => {
    // The stub template is 'STUB_CANDIDATE:{{count}}:END'
    // After substitution with count=5: 'STUB_CANDIDATE:5:END'
    const result = getCandidateCountLabel(5, STUB_CONFIG);
    expect(result).toBe('STUB_CANDIDATE:5:END');
  });

  it('getSelectionPrompt returns exactly the stub generation_pick_prompt value', () => {
    expect(getSelectionPrompt(STUB_CONFIG)).toBe(STUB_PICK_PROMPT);
    expect(getSelectionPrompt(STUB_CONFIG)).not.toBe(
      VOICE_CONFIG.slots.generation_pick_prompt,
    );
  });

  it('getEnhancerStatusMessage returns exactly the stub generation_enhancing_label value', () => {
    expect(getEnhancerStatusMessage(STUB_CONFIG)).toBe(STUB_ENHANCING_LABEL);
    expect(getEnhancerStatusMessage(STUB_CONFIG)).not.toBe(
      VOICE_CONFIG.slots.generation_enhancing_label,
    );
  });
});
