/**
 * Unit tests — Personal-colour diagnosis & onboarding copy (Sub-AC 3c).
 *
 * Verifies:
 *   - Each function that produces a user-facing string in the entry-wedge /
 *     diagnosis flow (diagnosis steps, result reveal, CTA text) accepts a
 *     `VoiceConfig` parameter.
 *   - When a stub config is injected ALL returned strings match the stub's
 *     slot values — proving no hardcoded production copy leaks through.
 *   - No legacy ToneSwitcher tone strings (다정 / 에디토리얼 / 유쾌 / 시적)
 *     appear in any returned value.
 *   - Default behaviour (no config arg) falls back to the production
 *     `VOICE_CONFIG` singleton without error.
 *   - `getResultRevealHeadline` substitutes `{{season}}` in the template slot.
 *
 * Stub strategy:
 *   We construct a minimal `VoiceConfig`-shaped object whose diagnosis and
 *   result-reveal slots contain clearly identifiable sentinel strings (all-caps
 *   ASCII) that cannot appear in any Korean production copy. After calling each
 *   function with this stub we assert the output contains the sentinel — if it
 *   doesn't, the function returned a hardcoded string instead of reading from
 *   the config.
 */

import { describe, expect, it } from 'vitest';

import {
  VOICE_CONFIG,
  type VoiceConfig,
  type VoiceId,
} from '../../src/voice/config.js';
import {
  getDiagnosisWedgeCta,
  getDiagnosisWedgeHeadline,
  getDiagnosisWedgeSubhead,
  getResultRevealCta,
  getResultRevealHeadline,
  getResultRevealSubhead,
} from '../../src/generation/diagnosis-copy.js';

// ---------------------------------------------------------------------------
// Stub VoiceConfig
// Non-diagnosis slots keep their production values (irrelevant to these tests).
// Diagnosis/onboarding/result-reveal slots are replaced with ASCII sentinels.
// ---------------------------------------------------------------------------

const STUB_DIAGNOSIS_WEDGE_HEADLINE = 'STUB_WEDGE_HEADLINE';
const STUB_DIAGNOSIS_WEDGE_SUBHEAD = 'STUB_WEDGE_SUBHEAD';
const STUB_DIAGNOSIS_WEDGE_CTA = 'STUB_WEDGE_CTA';
const STUB_RESULT_REVEAL_HEADLINE_TEMPLATE = 'STUB_RESULT_HEADLINE:{{season}}:END';
const STUB_RESULT_REVEAL_SUBHEAD = 'STUB_RESULT_SUBHEAD';
const STUB_RESULT_REVEAL_CTA = 'STUB_RESULT_CTA';

const STUB_CONFIG: VoiceConfig = {
  voiceId: 'trend-editor-kr' as VoiceId,
  description: 'test stub — diagnosis & onboarding copy (Sub-AC 3c)',
  slots: Object.freeze({
    // Non-diagnosis slots — kept at production values (not under test here)
    trend_drop_push_title: VOICE_CONFIG.slots.trend_drop_push_title,
    trend_drop_push_body: VOICE_CONFIG.slots.trend_drop_push_body,
    trend_drop_cta_primary: VOICE_CONFIG.slots.trend_drop_cta_primary,
    generation_candidate_count_label:
      VOICE_CONFIG.slots.generation_candidate_count_label,
    generation_pick_prompt: VOICE_CONFIG.slots.generation_pick_prompt,
    generation_enhancing_label: VOICE_CONFIG.slots.generation_enhancing_label,
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

    // ── Diagnosis / onboarding / result-reveal — replaced with sentinels ──
    diagnosis_wedge_headline: STUB_DIAGNOSIS_WEDGE_HEADLINE,
    diagnosis_wedge_subhead: STUB_DIAGNOSIS_WEDGE_SUBHEAD,
    diagnosis_wedge_cta: STUB_DIAGNOSIS_WEDGE_CTA,
    result_reveal_cta: STUB_RESULT_REVEAL_CTA,
    result_reveal_headline: STUB_RESULT_REVEAL_HEADLINE_TEMPLATE,
    result_reveal_subhead: STUB_RESULT_REVEAL_SUBHEAD,
  }),
};

// ---------------------------------------------------------------------------
// getDiagnosisWedgeHeadline
// ---------------------------------------------------------------------------

describe('getDiagnosisWedgeHeadline — voice-config injection (Sub-AC 3c)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getDiagnosisWedgeHeadline(STUB_CONFIG)).toBe(STUB_DIAGNOSIS_WEDGE_HEADLINE);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getDiagnosisWedgeHeadline(STUB_CONFIG)).not.toBe(
      getDiagnosisWedgeHeadline(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getDiagnosisWedgeHeadline(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getDiagnosisWedgeHeadline()).toBe(
      VOICE_CONFIG.slots.diagnosis_wedge_headline,
    );
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getDiagnosisWedgeHeadline(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDiagnosisWedgeSubhead
// ---------------------------------------------------------------------------

describe('getDiagnosisWedgeSubhead — voice-config injection (Sub-AC 3c)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getDiagnosisWedgeSubhead(STUB_CONFIG)).toBe(STUB_DIAGNOSIS_WEDGE_SUBHEAD);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getDiagnosisWedgeSubhead(STUB_CONFIG)).not.toBe(
      getDiagnosisWedgeSubhead(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getDiagnosisWedgeSubhead(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getDiagnosisWedgeSubhead()).toBe(VOICE_CONFIG.slots.diagnosis_wedge_subhead);
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getDiagnosisWedgeSubhead(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDiagnosisWedgeCta
// ---------------------------------------------------------------------------

describe('getDiagnosisWedgeCta — voice-config injection (Sub-AC 3c)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getDiagnosisWedgeCta(STUB_CONFIG)).toBe(STUB_DIAGNOSIS_WEDGE_CTA);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getDiagnosisWedgeCta(STUB_CONFIG)).not.toBe(
      getDiagnosisWedgeCta(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getDiagnosisWedgeCta(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getDiagnosisWedgeCta()).toBe(VOICE_CONFIG.slots.diagnosis_wedge_cta);
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getDiagnosisWedgeCta(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getResultRevealHeadline
// ---------------------------------------------------------------------------

describe('getResultRevealHeadline — voice-config injection (Sub-AC 3c)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    const result = getResultRevealHeadline('봄', STUB_CONFIG);
    expect(result).toContain('STUB_RESULT_HEADLINE');
  });

  it('substitutes {{season}} with the actual season string', () => {
    expect(getResultRevealHeadline('봄 웜톤', STUB_CONFIG)).toBe(
      'STUB_RESULT_HEADLINE:봄 웜톤:END',
    );
    expect(getResultRevealHeadline('가을', STUB_CONFIG)).toBe(
      'STUB_RESULT_HEADLINE:가을:END',
    );
    expect(getResultRevealHeadline('SPRING', STUB_CONFIG)).toBe(
      'STUB_RESULT_HEADLINE:SPRING:END',
    );
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    const stubResult = getResultRevealHeadline('봄', STUB_CONFIG);
    const prodResult = getResultRevealHeadline('봄', VOICE_CONFIG);
    expect(stubResult).not.toBe(prodResult);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    const expected = VOICE_CONFIG.slots.result_reveal_headline.replace(
      '{{season}}',
      '가을 웜톤',
    );
    expect(getResultRevealHeadline('가을 웜톤')).toBe(expected);
  });

  it('production output contains the substituted season string', () => {
    const result = getResultRevealHeadline('여름 쿨톤');
    expect(result).toContain('여름 쿨톤');
  });

  it('production output does not contain the raw {{season}} placeholder', () => {
    const result = getResultRevealHeadline('봄 웜톤');
    expect(result).not.toContain('{{season}}');
  });
});

// ---------------------------------------------------------------------------
// getResultRevealSubhead
// ---------------------------------------------------------------------------

describe('getResultRevealSubhead — voice-config injection (Sub-AC 3c)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getResultRevealSubhead(STUB_CONFIG)).toBe(STUB_RESULT_REVEAL_SUBHEAD);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getResultRevealSubhead(STUB_CONFIG)).not.toBe(
      getResultRevealSubhead(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getResultRevealSubhead(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getResultRevealSubhead()).toBe(VOICE_CONFIG.slots.result_reveal_subhead);
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getResultRevealSubhead(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getResultRevealCta
// ---------------------------------------------------------------------------

describe('getResultRevealCta — voice-config injection (Sub-AC 3c)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getResultRevealCta(STUB_CONFIG)).toBe(STUB_RESULT_REVEAL_CTA);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getResultRevealCta(STUB_CONFIG)).not.toBe(getResultRevealCta(VOICE_CONFIG));
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getResultRevealCta(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getResultRevealCta()).toBe(VOICE_CONFIG.slots.result_reveal_cta);
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getResultRevealCta(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No-hardcoded-tone-strings guard (ToneSwitcher regression)
// ---------------------------------------------------------------------------

describe('no hardcoded legacy tone strings in any diagnosis/onboarding output', () => {
  // Strings that would indicate hardcoded ToneSwitcher (4-tone) regression
  const LEGACY_TONE_NAMES = ['다정', '에디토리얼', '유쾌', '시적'];

  // All diagnosis/onboarding outputs under the stub config
  const STUB_OUTPUTS = [
    getDiagnosisWedgeHeadline(STUB_CONFIG),
    getDiagnosisWedgeSubhead(STUB_CONFIG),
    getDiagnosisWedgeCta(STUB_CONFIG),
    getResultRevealHeadline('봄', STUB_CONFIG),
    getResultRevealSubhead(STUB_CONFIG),
    getResultRevealCta(STUB_CONFIG),
  ];

  // All diagnosis/onboarding outputs under the production config
  const PROD_OUTPUTS = [
    getDiagnosisWedgeHeadline(VOICE_CONFIG),
    getDiagnosisWedgeSubhead(VOICE_CONFIG),
    getDiagnosisWedgeCta(VOICE_CONFIG),
    getResultRevealHeadline('봄 웜톤', VOICE_CONFIG),
    getResultRevealSubhead(VOICE_CONFIG),
    getResultRevealCta(VOICE_CONFIG),
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

  it('all six stub outputs are unique (no accidental aliasing)', () => {
    const unique = new Set(STUB_OUTPUTS);
    expect(unique.size).toBe(STUB_OUTPUTS.length);
  });
});

// ---------------------------------------------------------------------------
// Core Sub-AC 3c assertion — every diagnosis/onboarding string derives from
// the stubbed voice config (no hardcoded string bypass)
// ---------------------------------------------------------------------------

describe('all diagnosis/onboarding strings reflect the stubbed voice config (Sub-AC 3c)', () => {
  it('getDiagnosisWedgeHeadline returns exactly the stub slot value', () => {
    expect(getDiagnosisWedgeHeadline(STUB_CONFIG)).toBe(STUB_DIAGNOSIS_WEDGE_HEADLINE);
    expect(getDiagnosisWedgeHeadline(STUB_CONFIG)).not.toBe(
      VOICE_CONFIG.slots.diagnosis_wedge_headline,
    );
  });

  it('getDiagnosisWedgeSubhead returns exactly the stub slot value', () => {
    expect(getDiagnosisWedgeSubhead(STUB_CONFIG)).toBe(STUB_DIAGNOSIS_WEDGE_SUBHEAD);
    expect(getDiagnosisWedgeSubhead(STUB_CONFIG)).not.toBe(
      VOICE_CONFIG.slots.diagnosis_wedge_subhead,
    );
  });

  it('getDiagnosisWedgeCta returns exactly the stub slot value', () => {
    expect(getDiagnosisWedgeCta(STUB_CONFIG)).toBe(STUB_DIAGNOSIS_WEDGE_CTA);
    expect(getDiagnosisWedgeCta(STUB_CONFIG)).not.toBe(
      VOICE_CONFIG.slots.diagnosis_wedge_cta,
    );
  });

  it('getResultRevealHeadline returns the stub template sentinel with {{season}} substituted', () => {
    const result = getResultRevealHeadline('가을', STUB_CONFIG);
    expect(result).toBe('STUB_RESULT_HEADLINE:가을:END');
    // Must not contain the raw placeholder token
    expect(result).not.toContain('{{season}}');
  });

  it('getResultRevealSubhead returns exactly the stub slot value', () => {
    expect(getResultRevealSubhead(STUB_CONFIG)).toBe(STUB_RESULT_REVEAL_SUBHEAD);
    expect(getResultRevealSubhead(STUB_CONFIG)).not.toBe(
      VOICE_CONFIG.slots.result_reveal_subhead,
    );
  });

  it('getResultRevealCta returns exactly the stub slot value', () => {
    expect(getResultRevealCta(STUB_CONFIG)).toBe(STUB_RESULT_REVEAL_CTA);
    expect(getResultRevealCta(STUB_CONFIG)).not.toBe(
      VOICE_CONFIG.slots.result_reveal_cta,
    );
  });
});
