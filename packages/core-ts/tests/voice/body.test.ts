/**
 * Unit tests — deriveBody pure function (Sub-AC 13b-3).
 *
 * Verifies:
 *   - `deriveBody(config)` deterministically returns the correct body copy
 *     for different VoiceConfig inputs.
 *   - Different stub configs produce different body outputs — proving the
 *     function reads from the config, not a hardcoded string.
 *   - The production `VOICE_CONFIG` produces the expected Korean body copy.
 *   - The function is pure: calling it multiple times with the same input
 *     always returns the same value.
 *   - **Edge cases (boundary-value tests)**:
 *       (a) Empty string slot           → returns `''`
 *       (b) Whitespace-only slot        → returns `''`
 *       (c) Slot at exactly BODY_MAX_LENGTH chars → returned unchanged
 *       (d) Slot one char over limit    → truncated to BODY_MAX_LENGTH
 *       (e) Slot well over limit        → truncated to BODY_MAX_LENGTH
 *   - No hardcoded strings leak through (ASCII sentinel stubs).
 *   - No legacy ToneSwitcher (다정 / 에디토리얼 / 유쾌 / 시적) strings appear
 *     in any output.
 *
 * Stub strategy:
 *   Stub VoiceConfig objects are constructed by spreading `VOICE_CONFIG.slots`
 *   and overriding only `payment_step_body`.  This satisfies the VOICE_CONFIG
 *   integrity guard while keeping the body slot under full test control.
 *   The ASCII sentinel pattern (`PERSONA_ASCII_ONLY`) proves the function
 *   never returns Korean copy regardless of the input — only config-driven
 *   values flow through.
 */

import { describe, expect, it } from 'vitest';

import { VOICE_CONFIG, type VoiceConfig, type VoiceId } from '../../src/voice/config.js';
import { BODY_MAX_LENGTH, deriveBody } from '../../src/voice/body.js';

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

/**
 * Builds a minimal VoiceConfig stub, overriding only `payment_step_body` with
 * the supplied value.  All other slots keep their production values so the
 * VOICE_CONFIG integrity guard is satisfied.
 */
function buildStub(paymentStepBody: string): VoiceConfig {
  return {
    voiceId: 'trend-editor-kr' as VoiceId,
    description: `test-stub — body: "${paymentStepBody.slice(0, 40)}${paymentStepBody.length > 40 ? '…' : ''}"`,
    slots: Object.freeze({
      ...VOICE_CONFIG.slots,
      payment_step_body: paymentStepBody,
    }),
  };
}

// ---------------------------------------------------------------------------
// Named stubs for persona / input variation tests
// ---------------------------------------------------------------------------

/**
 * Persona A — free-trial emphasis axis.
 * Body copy describes the trial period in detail.
 */
const PERSONA_FREE_TRIAL = buildStub(
  'PERSONA_FREE_TRIAL: 7일 무료체험 — 연결제 선택 시 30일 추가로 총 37일 무료',
);

/**
 * Persona B — trend-cadence axis.
 * Body copy explains the trend-refresh value proposition.
 */
const PERSONA_TREND_CADENCE = buildStub(
  'PERSONA_TREND_CADENCE: 트렌드 드롭마다 새 recipe — 내 퍼스널 컬러 기반 생성',
);

/**
 * Persona C — ASCII-only sentinel.
 * Proves the function reads from the config and never returns hardcoded Korean.
 */
const PERSONA_ASCII_ONLY = buildStub(
  'PERSONA_ASCII_ONLY: TREND_PHOTO_GEN_BODY_SENTINEL',
);

// ---------------------------------------------------------------------------
// Edge-case stubs (boundary-value inputs)
// ---------------------------------------------------------------------------

/** Empty string body slot — exercises the empty-guard branch. */
const STUB_EMPTY = buildStub('');

/** Whitespace-only body slot — exercises the whitespace-guard branch. */
const STUB_WHITESPACE = buildStub('   ');

/**
 * Body at exactly BODY_MAX_LENGTH characters — should be returned unchanged.
 * Uses ASCII 'A' characters so the count is unambiguous.
 */
const EXACT_MAX_BODY = 'A'.repeat(BODY_MAX_LENGTH);
const STUB_EXACT_MAX = buildStub(EXACT_MAX_BODY);

/**
 * Body one character over the limit — should be truncated to BODY_MAX_LENGTH.
 */
const ONE_OVER_BODY = 'B'.repeat(BODY_MAX_LENGTH + 1);
const STUB_ONE_OVER = buildStub(ONE_OVER_BODY);

/**
 * Body well over the limit — should also be truncated to BODY_MAX_LENGTH.
 */
const WELL_OVER_BODY = 'C'.repeat(BODY_MAX_LENGTH * 2);
const STUB_WELL_OVER = buildStub(WELL_OVER_BODY);

// ---------------------------------------------------------------------------
// Core determinism tests
// ---------------------------------------------------------------------------

describe('deriveBody — deterministic pure function (Sub-AC 13b-3)', () => {
  it('returns a string for every config input', () => {
    for (const config of [
      PERSONA_FREE_TRIAL,
      PERSONA_TREND_CADENCE,
      PERSONA_ASCII_ONLY,
      VOICE_CONFIG,
    ]) {
      expect(typeof deriveBody(config)).toBe('string');
    }
  });

  it('is deterministic: same config → same output across repeated calls', () => {
    expect(deriveBody(PERSONA_FREE_TRIAL)).toBe(deriveBody(PERSONA_FREE_TRIAL));
    expect(deriveBody(PERSONA_TREND_CADENCE)).toBe(deriveBody(PERSONA_TREND_CADENCE));
    expect(deriveBody(PERSONA_ASCII_ONLY)).toBe(deriveBody(PERSONA_ASCII_ONLY));
    expect(deriveBody(VOICE_CONFIG)).toBe(deriveBody(VOICE_CONFIG));
  });

  it('different configs produce different body outputs', () => {
    const a = deriveBody(PERSONA_FREE_TRIAL);
    const b = deriveBody(PERSONA_TREND_CADENCE);
    const c = deriveBody(PERSONA_ASCII_ONLY);
    const d = deriveBody(VOICE_CONFIG);

    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(b).not.toBe(c);
    expect(b).not.toBe(d);
    expect(c).not.toBe(d);
  });
});

// ---------------------------------------------------------------------------
// Input/output mapping tests — one assertion per persona
// ---------------------------------------------------------------------------

describe('deriveBody — input/output mapping per persona (Sub-AC 13b-3)', () => {
  it('PERSONA_FREE_TRIAL → returns the free-trial axis body copy exactly', () => {
    expect(deriveBody(PERSONA_FREE_TRIAL)).toBe(
      'PERSONA_FREE_TRIAL: 7일 무료체험 — 연결제 선택 시 30일 추가로 총 37일 무료',
    );
  });

  it('PERSONA_TREND_CADENCE → returns the trend-cadence axis body copy exactly', () => {
    expect(deriveBody(PERSONA_TREND_CADENCE)).toBe(
      'PERSONA_TREND_CADENCE: 트렌드 드롭마다 새 recipe — 내 퍼스널 컬러 기반 생성',
    );
  });

  it('PERSONA_ASCII_ONLY → returns the ASCII sentinel body copy exactly', () => {
    expect(deriveBody(PERSONA_ASCII_ONLY)).toBe(
      'PERSONA_ASCII_ONLY: TREND_PHOTO_GEN_BODY_SENTINEL',
    );
  });

  it('VOICE_CONFIG (production) → returns the payment_step_body slot value', () => {
    expect(deriveBody(VOICE_CONFIG)).toBe(VOICE_CONFIG.slots.payment_step_body);
  });
});

// ---------------------------------------------------------------------------
// Boundary-value (edge case) tests — empty fields
// ---------------------------------------------------------------------------

describe('deriveBody — edge case: empty field (Sub-AC 13b-3)', () => {
  it('returns "" when the body slot is an empty string', () => {
    expect(deriveBody(STUB_EMPTY)).toBe('');
  });

  it('returns "" when the body slot contains only whitespace', () => {
    expect(deriveBody(STUB_WHITESPACE)).toBe('');
  });

  it('empty-string result has length 0', () => {
    expect(deriveBody(STUB_EMPTY).length).toBe(0);
    expect(deriveBody(STUB_WHITESPACE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Boundary-value (edge case) tests — maximum length
// ---------------------------------------------------------------------------

describe('deriveBody — edge case: maximum length (Sub-AC 13b-3)', () => {
  it('BODY_MAX_LENGTH is a positive integer', () => {
    expect(typeof BODY_MAX_LENGTH).toBe('number');
    expect(Number.isInteger(BODY_MAX_LENGTH)).toBe(true);
    expect(BODY_MAX_LENGTH).toBeGreaterThan(0);
  });

  it('body at exactly BODY_MAX_LENGTH characters is returned unchanged', () => {
    const result = deriveBody(STUB_EXACT_MAX);
    expect(result).toBe(EXACT_MAX_BODY);
    expect(result.length).toBe(BODY_MAX_LENGTH);
  });

  it('body one character over BODY_MAX_LENGTH is truncated to exactly BODY_MAX_LENGTH', () => {
    const result = deriveBody(STUB_ONE_OVER);
    expect(result.length).toBe(BODY_MAX_LENGTH);
    expect(result).toBe('B'.repeat(BODY_MAX_LENGTH));
  });

  it('body well over BODY_MAX_LENGTH is truncated to exactly BODY_MAX_LENGTH', () => {
    const result = deriveBody(STUB_WELL_OVER);
    expect(result.length).toBe(BODY_MAX_LENGTH);
    expect(result).toBe('C'.repeat(BODY_MAX_LENGTH));
  });

  it('truncation preserves the leading characters of the original string', () => {
    // First chars of the truncated result must match the start of the input.
    const result = deriveBody(STUB_WELL_OVER);
    expect(result).toBe(WELL_OVER_BODY.slice(0, BODY_MAX_LENGTH));
  });

  it('returned string never exceeds BODY_MAX_LENGTH characters', () => {
    for (const config of [
      PERSONA_FREE_TRIAL,
      PERSONA_TREND_CADENCE,
      PERSONA_ASCII_ONLY,
      STUB_EXACT_MAX,
      STUB_ONE_OVER,
      STUB_WELL_OVER,
      VOICE_CONFIG,
    ]) {
      expect(deriveBody(config).length).toBeLessThanOrEqual(BODY_MAX_LENGTH);
    }
  });
});

// ---------------------------------------------------------------------------
// Production VOICE_CONFIG — content-level assertions
// ---------------------------------------------------------------------------

describe('deriveBody — production VOICE_CONFIG assertions (Sub-AC 13b-3)', () => {
  const prodBody = deriveBody(VOICE_CONFIG);

  it('production body copy is a non-empty string', () => {
    expect(prodBody.trim().length).toBeGreaterThan(0);
  });

  it('production body copy contains Korean characters', () => {
    // Korean syllable block: U+AC00–U+D7A3
    expect(/[가-힣]/.test(prodBody)).toBe(true);
  });

  it('production body copy does not exceed BODY_MAX_LENGTH', () => {
    expect(prodBody.length).toBeLessThanOrEqual(BODY_MAX_LENGTH);
  });

  it('production body copy references the free-trial period (37일)', () => {
    // The Seed mandates "무료체험 강조" — the body must mention the trial period.
    expect(prodBody.includes('37일')).toBe(true);
  });

  it('production body copy does not contain appearance/styling language', () => {
    // Seed constraint: voice covers timing + photo craft ONLY.
    expect(prodBody.includes('외모')).toBe(false);
    expect(prodBody.includes('스타일링')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ToneSwitcher regression guard
// ---------------------------------------------------------------------------

describe('deriveBody — no legacy ToneSwitcher strings in any output', () => {
  const LEGACY_TONE_NAMES = ['다정', '에디토리얼', '유쾌', '시적'];

  const ALL_OUTPUTS = [
    { label: 'PERSONA_FREE_TRIAL', result: deriveBody(PERSONA_FREE_TRIAL) },
    { label: 'PERSONA_TREND_CADENCE', result: deriveBody(PERSONA_TREND_CADENCE) },
    { label: 'PERSONA_ASCII_ONLY', result: deriveBody(PERSONA_ASCII_ONLY) },
    { label: 'VOICE_CONFIG', result: deriveBody(VOICE_CONFIG) },
  ];

  it.each(ALL_OUTPUTS)(
    '$label output contains no legacy 4-tone names',
    ({ label, result }) => {
      for (const tone of LEGACY_TONE_NAMES) {
        expect(
          result.includes(tone),
          `deriveBody(${label}) must not contain legacy tone "${tone}" — found in: "${result}"`,
        ).toBe(false);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// No hardcoded string guard
// ---------------------------------------------------------------------------

describe('deriveBody — stub output proves no hardcoded string leakage', () => {
  it('PERSONA_ASCII_ONLY output contains no Korean characters (pure config read)', () => {
    const result = deriveBody(PERSONA_ASCII_ONLY);
    expect(/[가-힣]/.test(result)).toBe(false);
  });

  it('PERSONA_ASCII_ONLY output matches exactly the stub sentinel', () => {
    expect(deriveBody(PERSONA_ASCII_ONLY)).toBe(
      'PERSONA_ASCII_ONLY: TREND_PHOTO_GEN_BODY_SENTINEL',
    );
  });

  it('PERSONA_FREE_TRIAL output does not equal PERSONA_TREND_CADENCE output', () => {
    expect(deriveBody(PERSONA_FREE_TRIAL)).not.toBe(
      deriveBody(PERSONA_TREND_CADENCE),
    );
  });

  it('ASCII-only stub output never equals the production Korean output', () => {
    expect(deriveBody(PERSONA_ASCII_ONLY)).not.toBe(deriveBody(VOICE_CONFIG));
  });
});
