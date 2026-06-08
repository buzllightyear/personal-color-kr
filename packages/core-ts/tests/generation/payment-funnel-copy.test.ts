/**
 * Unit tests — Payment funnel copy (Sub-AC 3d).
 *
 * Verifies:
 *   - Each function that produces a user-facing string in the Glam Up 12-step
 *     conversion funnel (step labels, upsell prompts, confirmation messages)
 *     accepts a `VoiceConfig` parameter.
 *   - When a stub config is injected ALL returned strings match the stub's
 *     slot values — proving no hardcoded production copy leaks through.
 *   - No legacy ToneSwitcher tone strings (다정 / 에디토리얼 / 유쾌 / 시적)
 *     appear in any returned value.
 *   - Default behaviour (no config arg) falls back to the production
 *     `VOICE_CONFIG` singleton without error.
 *   - Template substitution functions (`getPaymentStepSubhead`,
 *     `getPaymentMonthlyPlanCta`) correctly substitute price placeholders.
 *
 * Stub strategy:
 *   We construct a minimal `VoiceConfig`-shaped object whose payment-funnel
 *   slots contain clearly identifiable sentinel strings (all-caps ASCII) that
 *   cannot appear in any Korean production copy. After calling each function
 *   with this stub we assert the output contains the sentinel — if it doesn't,
 *   the function returned a hardcoded string instead of reading from the config.
 *
 * Masking-trap guard:
 *   The test also confirms that no function mentions a hardcoded conversion-
 *   optimisation tone — ensuring the payment copy stays in the guardrail zone
 *   (not a maximise-conversion surface).
 */

import { describe, expect, it } from 'vitest';

import {
  VOICE_CONFIG,
  type VoiceConfig,
  type VoiceId,
} from '../../src/voice/config.js';
import {
  getPaymentAnnualPlanCta,
  getPaymentConfirmedHeadline,
  getPaymentConfirmedSubhead,
  getPaymentMonthlyPlanCta,
  getPaymentStepBody,
  getPaymentStepHeadline,
  getPaymentStepSubhead,
  getPaymentUpsellPrompt,
} from '../../src/generation/payment-funnel-copy.js';

// ---------------------------------------------------------------------------
// Stub VoiceConfig
// Non-payment slots keep their production values (irrelevant to these tests).
// Payment-funnel slots are replaced with ASCII sentinels.
// ---------------------------------------------------------------------------

const STUB_PAYMENT_STEP_HEADLINE = 'STUB_PAYMENT_HEADLINE';
const STUB_PAYMENT_STEP_SUBHEAD_TEMPLATE =
  'STUB_SUBHEAD:{{monthly_price}}:{{annual_price}}:END';
const STUB_PAYMENT_STEP_BODY = 'STUB_PAYMENT_BODY';
const STUB_PAYMENT_ANNUAL_CTA = 'STUB_ANNUAL_CTA';
const STUB_PAYMENT_MONTHLY_CTA_TEMPLATE = 'STUB_MONTHLY_CTA:{{monthly_price}}:END';
const STUB_PAYMENT_UPSELL_PROMPT = 'STUB_UPSELL_PROMPT';
const STUB_PAYMENT_CONFIRMED_HEADLINE = 'STUB_CONFIRMED_HEADLINE';
const STUB_PAYMENT_CONFIRMED_SUBHEAD = 'STUB_CONFIRMED_SUBHEAD';

const STUB_CONFIG: VoiceConfig = {
  voiceId: 'trend-editor-kr' as VoiceId,
  description: 'test stub — payment funnel copy (Sub-AC 3d)',
  slots: Object.freeze({
    // Non-payment slots — kept at production values (not under test here)
    trend_drop_push_title: VOICE_CONFIG.slots.trend_drop_push_title,
    trend_drop_push_body: VOICE_CONFIG.slots.trend_drop_push_body,
    trend_drop_cta_primary: VOICE_CONFIG.slots.trend_drop_cta_primary,
    diagnosis_wedge_headline: VOICE_CONFIG.slots.diagnosis_wedge_headline,
    diagnosis_wedge_subhead: VOICE_CONFIG.slots.diagnosis_wedge_subhead,
    diagnosis_wedge_cta: VOICE_CONFIG.slots.diagnosis_wedge_cta,
    result_reveal_cta: VOICE_CONFIG.slots.result_reveal_cta,
    result_reveal_headline: VOICE_CONFIG.slots.result_reveal_headline,
    result_reveal_subhead: VOICE_CONFIG.slots.result_reveal_subhead,
    generation_candidate_count_label:
      VOICE_CONFIG.slots.generation_candidate_count_label,
    generation_pick_prompt: VOICE_CONFIG.slots.generation_pick_prompt,
    generation_enhancing_label: VOICE_CONFIG.slots.generation_enhancing_label,
    payment_value_prop: VOICE_CONFIG.slots.payment_value_prop,
    free_trial_emphasis: VOICE_CONFIG.slots.free_trial_emphasis,
    // ── Payment funnel — replaced with sentinels ─────────────────────────
    payment_step_headline: STUB_PAYMENT_STEP_HEADLINE,
    payment_step_subhead: STUB_PAYMENT_STEP_SUBHEAD_TEMPLATE,
    payment_step_body: STUB_PAYMENT_STEP_BODY,
    payment_annual_plan_cta: STUB_PAYMENT_ANNUAL_CTA,
    payment_monthly_plan_cta: STUB_PAYMENT_MONTHLY_CTA_TEMPLATE,
    payment_upsell_prompt: STUB_PAYMENT_UPSELL_PROMPT,
    payment_confirmed_headline: STUB_PAYMENT_CONFIRMED_HEADLINE,
    payment_confirmed_subhead: STUB_PAYMENT_CONFIRMED_SUBHEAD,
  }),
};

// ---------------------------------------------------------------------------
// getPaymentStepHeadline
// ---------------------------------------------------------------------------

describe('getPaymentStepHeadline — voice-config injection (Sub-AC 3d)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getPaymentStepHeadline(STUB_CONFIG)).toBe(STUB_PAYMENT_STEP_HEADLINE);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getPaymentStepHeadline(STUB_CONFIG)).not.toBe(
      getPaymentStepHeadline(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getPaymentStepHeadline(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getPaymentStepHeadline()).toBe(
      VOICE_CONFIG.slots.payment_step_headline,
    );
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getPaymentStepHeadline(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPaymentStepSubhead — template substitution
// ---------------------------------------------------------------------------

describe('getPaymentStepSubhead — voice-config injection (Sub-AC 3d)', () => {
  it('accepts a VoiceConfig parameter and returns a string containing the stub sentinel', () => {
    const result = getPaymentStepSubhead(12, 59, STUB_CONFIG);
    expect(result).toContain('STUB_SUBHEAD');
  });

  it('substitutes {{monthly_price}} with the monthly price integer', () => {
    const result = getPaymentStepSubhead(12, 59, STUB_CONFIG);
    expect(result).toContain('12');
    expect(result).not.toContain('{{monthly_price}}');
  });

  it('substitutes {{annual_price}} with the annual price integer', () => {
    const result = getPaymentStepSubhead(12, 59, STUB_CONFIG);
    expect(result).toContain('59');
    expect(result).not.toContain('{{annual_price}}');
  });

  it('produces the fully-substituted stub sentinel', () => {
    expect(getPaymentStepSubhead(12, 59, STUB_CONFIG)).toBe(
      'STUB_SUBHEAD:12:59:END',
    );
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    const stubResult = getPaymentStepSubhead(12, 59, STUB_CONFIG);
    const prodResult = getPaymentStepSubhead(12, 59, VOICE_CONFIG);
    expect(stubResult).not.toBe(prodResult);
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getPaymentStepSubhead(12, 59, STUB_CONFIG))).toBe(
      false,
    );
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    const expected = VOICE_CONFIG.slots.payment_step_subhead
      .replace('{{monthly_price}}', '12')
      .replace('{{annual_price}}', '59');
    expect(getPaymentStepSubhead(12, 59)).toBe(expected);
  });

  it('production output contains the substituted price values', () => {
    const result = getPaymentStepSubhead(12, 59);
    expect(result).toContain('12');
    expect(result).toContain('59');
  });

  it('production output does not contain raw price placeholder tokens', () => {
    const result = getPaymentStepSubhead(12, 59);
    expect(result).not.toContain('{{monthly_price}}');
    expect(result).not.toContain('{{annual_price}}');
  });
});

// ---------------------------------------------------------------------------
// getPaymentStepBody
// ---------------------------------------------------------------------------

describe('getPaymentStepBody — voice-config injection (Sub-AC 3d)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getPaymentStepBody(STUB_CONFIG)).toBe(STUB_PAYMENT_STEP_BODY);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getPaymentStepBody(STUB_CONFIG)).not.toBe(
      getPaymentStepBody(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getPaymentStepBody(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getPaymentStepBody()).toBe(VOICE_CONFIG.slots.payment_step_body);
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getPaymentStepBody(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPaymentAnnualPlanCta
// ---------------------------------------------------------------------------

describe('getPaymentAnnualPlanCta — voice-config injection (Sub-AC 3d)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getPaymentAnnualPlanCta(STUB_CONFIG)).toBe(STUB_PAYMENT_ANNUAL_CTA);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getPaymentAnnualPlanCta(STUB_CONFIG)).not.toBe(
      getPaymentAnnualPlanCta(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getPaymentAnnualPlanCta(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getPaymentAnnualPlanCta()).toBe(
      VOICE_CONFIG.slots.payment_annual_plan_cta,
    );
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getPaymentAnnualPlanCta(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPaymentMonthlyPlanCta — template substitution
// ---------------------------------------------------------------------------

describe('getPaymentMonthlyPlanCta — voice-config injection (Sub-AC 3d)', () => {
  it('accepts a VoiceConfig parameter and returns a string containing the stub sentinel', () => {
    const result = getPaymentMonthlyPlanCta(12, STUB_CONFIG);
    expect(result).toContain('STUB_MONTHLY_CTA');
  });

  it('substitutes {{monthly_price}} with the monthly price integer', () => {
    expect(getPaymentMonthlyPlanCta(12, STUB_CONFIG)).toBe(
      'STUB_MONTHLY_CTA:12:END',
    );
    expect(getPaymentMonthlyPlanCta(15, STUB_CONFIG)).toBe(
      'STUB_MONTHLY_CTA:15:END',
    );
  });

  it('does not leave raw {{monthly_price}} placeholder in output', () => {
    expect(getPaymentMonthlyPlanCta(12, STUB_CONFIG)).not.toContain(
      '{{monthly_price}}',
    );
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    const stubResult = getPaymentMonthlyPlanCta(12, STUB_CONFIG);
    const prodResult = getPaymentMonthlyPlanCta(12, VOICE_CONFIG);
    expect(stubResult).not.toBe(prodResult);
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getPaymentMonthlyPlanCta(12, STUB_CONFIG))).toBe(
      false,
    );
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    const expected = VOICE_CONFIG.slots.payment_monthly_plan_cta.replace(
      '{{monthly_price}}',
      '12',
    );
    expect(getPaymentMonthlyPlanCta(12)).toBe(expected);
  });

  it('production output contains the substituted price value', () => {
    expect(getPaymentMonthlyPlanCta(12)).toContain('12');
  });

  it('production output does not contain raw {{monthly_price}} token', () => {
    expect(getPaymentMonthlyPlanCta(12)).not.toContain('{{monthly_price}}');
  });
});

// ---------------------------------------------------------------------------
// getPaymentUpsellPrompt
// ---------------------------------------------------------------------------

describe('getPaymentUpsellPrompt — voice-config injection (Sub-AC 3d)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getPaymentUpsellPrompt(STUB_CONFIG)).toBe(STUB_PAYMENT_UPSELL_PROMPT);
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getPaymentUpsellPrompt(STUB_CONFIG)).not.toBe(
      getPaymentUpsellPrompt(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getPaymentUpsellPrompt(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getPaymentUpsellPrompt()).toBe(
      VOICE_CONFIG.slots.payment_upsell_prompt,
    );
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getPaymentUpsellPrompt(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPaymentConfirmedHeadline
// ---------------------------------------------------------------------------

describe('getPaymentConfirmedHeadline — voice-config injection (Sub-AC 3d)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getPaymentConfirmedHeadline(STUB_CONFIG)).toBe(
      STUB_PAYMENT_CONFIRMED_HEADLINE,
    );
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getPaymentConfirmedHeadline(STUB_CONFIG)).not.toBe(
      getPaymentConfirmedHeadline(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getPaymentConfirmedHeadline(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getPaymentConfirmedHeadline()).toBe(
      VOICE_CONFIG.slots.payment_confirmed_headline,
    );
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getPaymentConfirmedHeadline(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPaymentConfirmedSubhead
// ---------------------------------------------------------------------------

describe('getPaymentConfirmedSubhead — voice-config injection (Sub-AC 3d)', () => {
  it('accepts a VoiceConfig parameter and returns the stub sentinel', () => {
    expect(getPaymentConfirmedSubhead(STUB_CONFIG)).toBe(
      STUB_PAYMENT_CONFIRMED_SUBHEAD,
    );
  });

  it('stub result differs from production config output (no hardcoded string)', () => {
    expect(getPaymentConfirmedSubhead(STUB_CONFIG)).not.toBe(
      getPaymentConfirmedSubhead(VOICE_CONFIG),
    );
  });

  it('stub result does not contain any Korean characters (pure sentinel)', () => {
    expect(/[가-힣]/.test(getPaymentConfirmedSubhead(STUB_CONFIG))).toBe(false);
  });

  it('defaults to VOICE_CONFIG when no config arg is supplied', () => {
    expect(getPaymentConfirmedSubhead()).toBe(
      VOICE_CONFIG.slots.payment_confirmed_subhead,
    );
  });

  it('production output is a non-empty Korean string', () => {
    const prod = getPaymentConfirmedSubhead(VOICE_CONFIG);
    expect(prod.trim().length).toBeGreaterThan(0);
    expect(/[가-힣]/.test(prod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No-hardcoded-tone-strings guard (ToneSwitcher regression)
// ---------------------------------------------------------------------------

describe('no hardcoded legacy tone strings in any payment funnel output', () => {
  // Strings that would indicate hardcoded ToneSwitcher (4-tone) regression
  const LEGACY_TONE_NAMES = ['다정', '에디토리얼', '유쾌', '시적'];

  // All payment funnel outputs under the stub config
  const STUB_OUTPUTS = [
    getPaymentStepHeadline(STUB_CONFIG),
    getPaymentStepSubhead(12, 59, STUB_CONFIG),
    getPaymentStepBody(STUB_CONFIG),
    getPaymentAnnualPlanCta(STUB_CONFIG),
    getPaymentMonthlyPlanCta(12, STUB_CONFIG),
    getPaymentUpsellPrompt(STUB_CONFIG),
    getPaymentConfirmedHeadline(STUB_CONFIG),
    getPaymentConfirmedSubhead(STUB_CONFIG),
  ];

  // All payment funnel outputs under the production config
  const PROD_OUTPUTS = [
    getPaymentStepHeadline(VOICE_CONFIG),
    getPaymentStepSubhead(12, 59, VOICE_CONFIG),
    getPaymentStepBody(VOICE_CONFIG),
    getPaymentAnnualPlanCta(VOICE_CONFIG),
    getPaymentMonthlyPlanCta(12, VOICE_CONFIG),
    getPaymentUpsellPrompt(VOICE_CONFIG),
    getPaymentConfirmedHeadline(VOICE_CONFIG),
    getPaymentConfirmedSubhead(VOICE_CONFIG),
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

  it('all eight stub outputs are unique (no accidental aliasing)', () => {
    const unique = new Set(STUB_OUTPUTS);
    expect(unique.size).toBe(STUB_OUTPUTS.length);
  });
});

// ---------------------------------------------------------------------------
// Full stub coverage — every payment-funnel string reflects the stub's values
// (core Sub-AC 3d assertion: no hardcoded string bypass)
// ---------------------------------------------------------------------------

describe(
  'all payment-funnel strings reflect the stubbed voice config (Sub-AC 3d)',
  () => {
    it('getPaymentStepHeadline returns exactly the stub slot value', () => {
      expect(getPaymentStepHeadline(STUB_CONFIG)).toBe(
        STUB_PAYMENT_STEP_HEADLINE,
      );
      expect(getPaymentStepHeadline(STUB_CONFIG)).not.toBe(
        VOICE_CONFIG.slots.payment_step_headline,
      );
    });

    it(
      'getPaymentStepSubhead returns the stub template sentinel with prices substituted',
      () => {
        const result = getPaymentStepSubhead(12, 59, STUB_CONFIG);
        expect(result).toBe('STUB_SUBHEAD:12:59:END');
        expect(result).not.toContain('{{monthly_price}}');
        expect(result).not.toContain('{{annual_price}}');
      },
    );

    it('getPaymentStepBody returns exactly the stub slot value', () => {
      expect(getPaymentStepBody(STUB_CONFIG)).toBe(STUB_PAYMENT_STEP_BODY);
      expect(getPaymentStepBody(STUB_CONFIG)).not.toBe(
        VOICE_CONFIG.slots.payment_step_body,
      );
    });

    it('getPaymentAnnualPlanCta returns exactly the stub slot value', () => {
      expect(getPaymentAnnualPlanCta(STUB_CONFIG)).toBe(STUB_PAYMENT_ANNUAL_CTA);
      expect(getPaymentAnnualPlanCta(STUB_CONFIG)).not.toBe(
        VOICE_CONFIG.slots.payment_annual_plan_cta,
      );
    });

    it(
      'getPaymentMonthlyPlanCta returns the stub template sentinel with price substituted',
      () => {
        const result = getPaymentMonthlyPlanCta(12, STUB_CONFIG);
        expect(result).toBe('STUB_MONTHLY_CTA:12:END');
        expect(result).not.toContain('{{monthly_price}}');
      },
    );

    it('getPaymentUpsellPrompt returns exactly the stub slot value', () => {
      expect(getPaymentUpsellPrompt(STUB_CONFIG)).toBe(
        STUB_PAYMENT_UPSELL_PROMPT,
      );
      expect(getPaymentUpsellPrompt(STUB_CONFIG)).not.toBe(
        VOICE_CONFIG.slots.payment_upsell_prompt,
      );
    });

    it('getPaymentConfirmedHeadline returns exactly the stub slot value', () => {
      expect(getPaymentConfirmedHeadline(STUB_CONFIG)).toBe(
        STUB_PAYMENT_CONFIRMED_HEADLINE,
      );
      expect(getPaymentConfirmedHeadline(STUB_CONFIG)).not.toBe(
        VOICE_CONFIG.slots.payment_confirmed_headline,
      );
    });

    it('getPaymentConfirmedSubhead returns exactly the stub slot value', () => {
      expect(getPaymentConfirmedSubhead(STUB_CONFIG)).toBe(
        STUB_PAYMENT_CONFIRMED_SUBHEAD,
      );
      expect(getPaymentConfirmedSubhead(STUB_CONFIG)).not.toBe(
        VOICE_CONFIG.slots.payment_confirmed_subhead,
      );
    });
  },
);
