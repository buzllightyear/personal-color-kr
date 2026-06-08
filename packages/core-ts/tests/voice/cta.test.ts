/**
 * Unit tests — deriveCta pure function (Sub-AC 13b-4).
 *
 * Verifies:
 *   - `deriveCta(config)` deterministically returns the correct CTA string
 *     for different platform/language simulation VoiceConfig stubs.
 *   - Different stub configs (representing different platform or language
 *     contexts) produce deterministically distinct or equal outputs — proving
 *     the function reads from the config, not a hardcoded string.
 *   - The production `VOICE_CONFIG` produces the expected Korean CTA.
 *   - The function is pure: calling it multiple times with the same input
 *     always returns the same value.
 *   - **Edge cases (boundary-value tests)**:
 *       (a) Empty string slot           → returns `''`
 *       (b) Whitespace-only slot        → returns `''`
 *       (c) Slot at exactly CTA_MAX_LENGTH chars → returned unchanged
 *       (d) Slot one char over limit    → truncated to CTA_MAX_LENGTH
 *       (e) Slot well over limit        → truncated to CTA_MAX_LENGTH
 *   - No hardcoded strings leak through (ASCII sentinel stubs).
 *   - No legacy ToneSwitcher (다정 / 에디토리얼 / 유쾌 / 시적) strings appear
 *     in any output.
 *
 * Platform / language variation strategy:
 *   Stubs represent four distinct deployment contexts:
 *
 *     PLATFORM_IOS_KO    — iOS native surface, Korean CTA
 *                          ("지금 내 셀카에 적용하기" flavour, touch/tap language)
 *     PLATFORM_ANDROID_KO — Android native surface, Korean CTA
 *                           (same touch/tap axis, distinct sentinel)
 *     PLATFORM_WEB_KO    — Web surface, Korean CTA
 *                           (click-friendly phrasing, distinct sentinel)
 *     LANGUAGE_EN_ASCII  — ASCII-only sentinel, simulates English context.
 *                           Proves the function never returns Korean regardless
 *                           of the config value.
 *
 *   If `deriveCta` ever returns a hardcoded string instead of the config
 *   slot value, the assertion fails because the sentinel cannot appear in
 *   any Korean production copy.
 */

import { describe, expect, it } from 'vitest';

import {
  VOICE_CONFIG,
  type VoiceConfig,
  type VoiceId,
} from '../../src/voice/config.js';
import { CTA_MAX_LENGTH, deriveCta } from '../../src/voice/cta.js';

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

/**
 * Builds a minimal VoiceConfig stub, overriding only `trend_drop_cta_primary`
 * with the supplied value.  All other slots keep their production values so
 * the VOICE_CONFIG integrity guard is satisfied.
 *
 * Callers can supply any string as the CTA sentinel — including all-ASCII
 * strings that would never appear in Korean production copy.
 */
function buildStub(trendDropCtaPrimary: string): VoiceConfig {
  return {
    voiceId: 'trend-editor-kr' as VoiceId,
    description: `test-stub — cta: "${trendDropCtaPrimary.slice(0, 40)}${trendDropCtaPrimary.length > 40 ? '…' : ''}"`,
    slots: Object.freeze({
      ...VOICE_CONFIG.slots,
      trend_drop_cta_primary: trendDropCtaPrimary,
    }),
  };
}

// ---------------------------------------------------------------------------
// Named stubs for platform / language variation tests
// ---------------------------------------------------------------------------

/**
 * Platform: iOS native — Korean CTA.
 * Touch/tap language; represents the primary iOS in-app button.
 */
const PLATFORM_IOS_KO = buildStub('PLATFORM_IOS_KO: 지금 내 셀카에 바로 적용하기');

/**
 * Platform: Android native — Korean CTA.
 * Same touch/tap axis as iOS; distinct sentinel for test isolation.
 */
const PLATFORM_ANDROID_KO = buildStub(
  'PLATFORM_ANDROID_KO: 지금 내 셀카에 적용하기 (Android)',
);

/**
 * Platform: Web — Korean CTA.
 * Click-friendly phrasing; distinct from native-app variants.
 */
const PLATFORM_WEB_KO = buildStub('PLATFORM_WEB_KO: 내 사진에 트렌드 적용하기');

/**
 * Language: English (ASCII-only) sentinel.
 * Simulates an English-language deployment context.
 * Proves the function reads from the config and never returns Korean copy
 * when the slot value contains no Korean characters.
 */
const LANGUAGE_EN_ASCII = buildStub('LANGUAGE_EN_ASCII: Apply Trend to My Selfie Now');

// ---------------------------------------------------------------------------
// Edge-case stubs (boundary-value inputs)
// ---------------------------------------------------------------------------

/** Empty string CTA slot — exercises the empty-guard branch. */
const STUB_EMPTY = buildStub('');

/** Whitespace-only CTA slot — exercises the whitespace-guard branch. */
const STUB_WHITESPACE = buildStub('   ');

/**
 * CTA at exactly CTA_MAX_LENGTH characters — should be returned unchanged.
 * Uses ASCII 'A' characters so the count is unambiguous.
 */
const EXACT_MAX_CTA = 'A'.repeat(CTA_MAX_LENGTH);
const STUB_EXACT_MAX = buildStub(EXACT_MAX_CTA);

/**
 * CTA one character over the limit — should be truncated to CTA_MAX_LENGTH.
 */
const ONE_OVER_CTA = 'B'.repeat(CTA_MAX_LENGTH + 1);
const STUB_ONE_OVER = buildStub(ONE_OVER_CTA);

/**
 * CTA well over the limit — should also be truncated to CTA_MAX_LENGTH.
 */
const WELL_OVER_CTA = 'C'.repeat(CTA_MAX_LENGTH * 2);
const STUB_WELL_OVER = buildStub(WELL_OVER_CTA);

// ---------------------------------------------------------------------------
// Core determinism tests
// ---------------------------------------------------------------------------

describe('deriveCta — deterministic pure function (Sub-AC 13b-4)', () => {
  it('returns a string for every config input', () => {
    for (const config of [
      PLATFORM_IOS_KO,
      PLATFORM_ANDROID_KO,
      PLATFORM_WEB_KO,
      LANGUAGE_EN_ASCII,
      VOICE_CONFIG,
    ]) {
      expect(typeof deriveCta(config)).toBe('string');
    }
  });

  it('is deterministic: same config → same output across repeated calls', () => {
    // Call each config twice and assert equality — proves referential transparency.
    expect(deriveCta(PLATFORM_IOS_KO)).toBe(deriveCta(PLATFORM_IOS_KO));
    expect(deriveCta(PLATFORM_ANDROID_KO)).toBe(deriveCta(PLATFORM_ANDROID_KO));
    expect(deriveCta(PLATFORM_WEB_KO)).toBe(deriveCta(PLATFORM_WEB_KO));
    expect(deriveCta(LANGUAGE_EN_ASCII)).toBe(deriveCta(LANGUAGE_EN_ASCII));
    expect(deriveCta(VOICE_CONFIG)).toBe(deriveCta(VOICE_CONFIG));
  });

  it('different platform/language stubs produce different CTA outputs', () => {
    const ios = deriveCta(PLATFORM_IOS_KO);
    const android = deriveCta(PLATFORM_ANDROID_KO);
    const web = deriveCta(PLATFORM_WEB_KO);
    const en = deriveCta(LANGUAGE_EN_ASCII);
    const prod = deriveCta(VOICE_CONFIG);

    expect(ios).not.toBe(android);
    expect(ios).not.toBe(web);
    expect(ios).not.toBe(en);
    expect(android).not.toBe(web);
    expect(android).not.toBe(en);
    expect(web).not.toBe(en);
    // Production config may or may not match the iOS stub — explicit assertion
    // that the production CTA is not equal to the override sentinels.
    expect(prod).not.toBe(ios);
    expect(prod).not.toBe(android);
    expect(prod).not.toBe(web);
    expect(prod).not.toBe(en);
  });
});

// ---------------------------------------------------------------------------
// Input/output mapping tests — one assertion per platform / language variant
// ---------------------------------------------------------------------------

describe('deriveCta — input/output mapping per platform/language variant (Sub-AC 13b-4)', () => {
  it('PLATFORM_IOS_KO → returns the iOS Korean CTA sentinel exactly', () => {
    expect(deriveCta(PLATFORM_IOS_KO)).toBe(
      'PLATFORM_IOS_KO: 지금 내 셀카에 바로 적용하기',
    );
  });

  it('PLATFORM_ANDROID_KO → returns the Android Korean CTA sentinel exactly', () => {
    expect(deriveCta(PLATFORM_ANDROID_KO)).toBe(
      'PLATFORM_ANDROID_KO: 지금 내 셀카에 적용하기 (Android)',
    );
  });

  it('PLATFORM_WEB_KO → returns the web Korean CTA sentinel exactly', () => {
    expect(deriveCta(PLATFORM_WEB_KO)).toBe(
      'PLATFORM_WEB_KO: 내 사진에 트렌드 적용하기',
    );
  });

  it('LANGUAGE_EN_ASCII → returns the English ASCII sentinel CTA exactly', () => {
    expect(deriveCta(LANGUAGE_EN_ASCII)).toBe(
      'LANGUAGE_EN_ASCII: Apply Trend to My Selfie Now',
    );
  });

  it('VOICE_CONFIG (production) → returns the trend_drop_cta_primary slot value', () => {
    expect(deriveCta(VOICE_CONFIG)).toBe(VOICE_CONFIG.slots.trend_drop_cta_primary);
  });
});

// ---------------------------------------------------------------------------
// Boundary-value (edge case) tests — empty fields
// ---------------------------------------------------------------------------

describe('deriveCta — edge case: empty field (Sub-AC 13b-4)', () => {
  it('returns "" when the CTA slot is an empty string', () => {
    expect(deriveCta(STUB_EMPTY)).toBe('');
  });

  it('returns "" when the CTA slot contains only whitespace', () => {
    expect(deriveCta(STUB_WHITESPACE)).toBe('');
  });

  it('empty-string result has length 0', () => {
    expect(deriveCta(STUB_EMPTY).length).toBe(0);
    expect(deriveCta(STUB_WHITESPACE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Boundary-value (edge case) tests — maximum length
// ---------------------------------------------------------------------------

describe('deriveCta — edge case: maximum length (Sub-AC 13b-4)', () => {
  it('CTA_MAX_LENGTH is a positive integer', () => {
    expect(typeof CTA_MAX_LENGTH).toBe('number');
    expect(Number.isInteger(CTA_MAX_LENGTH)).toBe(true);
    expect(CTA_MAX_LENGTH).toBeGreaterThan(0);
  });

  it('CTA at exactly CTA_MAX_LENGTH characters is returned unchanged', () => {
    const result = deriveCta(STUB_EXACT_MAX);
    expect(result).toBe(EXACT_MAX_CTA);
    expect(result.length).toBe(CTA_MAX_LENGTH);
  });

  it('CTA one character over CTA_MAX_LENGTH is truncated to exactly CTA_MAX_LENGTH', () => {
    const result = deriveCta(STUB_ONE_OVER);
    expect(result.length).toBe(CTA_MAX_LENGTH);
    expect(result).toBe('B'.repeat(CTA_MAX_LENGTH));
  });

  it('CTA well over CTA_MAX_LENGTH is truncated to exactly CTA_MAX_LENGTH', () => {
    const result = deriveCta(STUB_WELL_OVER);
    expect(result.length).toBe(CTA_MAX_LENGTH);
    expect(result).toBe('C'.repeat(CTA_MAX_LENGTH));
  });

  it('truncation preserves the leading characters of the original string', () => {
    // First chars of the truncated result must match the start of the input.
    const result = deriveCta(STUB_WELL_OVER);
    expect(result).toBe(WELL_OVER_CTA.slice(0, CTA_MAX_LENGTH));
  });

  it('returned string never exceeds CTA_MAX_LENGTH characters', () => {
    for (const config of [
      PLATFORM_IOS_KO,
      PLATFORM_ANDROID_KO,
      PLATFORM_WEB_KO,
      LANGUAGE_EN_ASCII,
      STUB_EXACT_MAX,
      STUB_ONE_OVER,
      STUB_WELL_OVER,
      VOICE_CONFIG,
    ]) {
      expect(deriveCta(config).length).toBeLessThanOrEqual(CTA_MAX_LENGTH);
    }
  });
});

// ---------------------------------------------------------------------------
// Production VOICE_CONFIG — content-level assertions
// ---------------------------------------------------------------------------

describe('deriveCta — production VOICE_CONFIG assertions (Sub-AC 13b-4)', () => {
  const prodCta = deriveCta(VOICE_CONFIG);

  it('production CTA is a non-empty string', () => {
    expect(prodCta.trim().length).toBeGreaterThan(0);
  });

  it('production CTA contains Korean characters', () => {
    // Korean syllable block: U+AC00–U+D7A3
    expect(/[가-힣]/.test(prodCta)).toBe(true);
  });

  it('production CTA does not exceed CTA_MAX_LENGTH', () => {
    expect(prodCta.length).toBeLessThanOrEqual(CTA_MAX_LENGTH);
  });

  it('production CTA references the action (적용) or related engagement verb', () => {
    // The CTA must contain an action verb — inviting the user to apply the trend.
    const hasActionVerb =
      prodCta.includes('적용') ||
      prodCta.includes('생성') ||
      prodCta.includes('시작') ||
      prodCta.includes('해제') ||
      prodCta.includes('보기');
    expect(hasActionVerb).toBe(true);
  });

  it('production CTA does not contain appearance/styling language', () => {
    // Seed constraint: voice covers timing + photo craft ONLY.
    expect(prodCta.includes('외모')).toBe(false);
    expect(prodCta.includes('스타일링')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ToneSwitcher regression guard
// ---------------------------------------------------------------------------

describe('deriveCta — no legacy ToneSwitcher strings in any output', () => {
  const LEGACY_TONE_NAMES = ['다정', '에디토리얼', '유쾌', '시적'];

  const ALL_OUTPUTS = [
    { label: 'PLATFORM_IOS_KO', result: deriveCta(PLATFORM_IOS_KO) },
    { label: 'PLATFORM_ANDROID_KO', result: deriveCta(PLATFORM_ANDROID_KO) },
    { label: 'PLATFORM_WEB_KO', result: deriveCta(PLATFORM_WEB_KO) },
    { label: 'LANGUAGE_EN_ASCII', result: deriveCta(LANGUAGE_EN_ASCII) },
    { label: 'VOICE_CONFIG', result: deriveCta(VOICE_CONFIG) },
  ];

  it.each(ALL_OUTPUTS)(
    '$label output contains no legacy 4-tone names',
    ({ label, result }) => {
      for (const tone of LEGACY_TONE_NAMES) {
        expect(
          result.includes(tone),
          `deriveCta(${label}) must not contain legacy tone "${tone}" — found in: "${result}"`,
        ).toBe(false);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// No hardcoded string guard
// ---------------------------------------------------------------------------

describe('deriveCta — stub output proves no hardcoded string leakage', () => {
  it('LANGUAGE_EN_ASCII output contains no Korean characters (pure config read)', () => {
    const result = deriveCta(LANGUAGE_EN_ASCII);
    expect(/[가-힣]/.test(result)).toBe(false);
  });

  it('LANGUAGE_EN_ASCII output matches exactly the stub sentinel', () => {
    // If the function returned any hardcoded Korean string, this would fail.
    expect(deriveCta(LANGUAGE_EN_ASCII)).toBe(
      'LANGUAGE_EN_ASCII: Apply Trend to My Selfie Now',
    );
  });

  it('PLATFORM_IOS_KO output does not equal PLATFORM_ANDROID_KO output', () => {
    // Sanity: two different platform stubs cannot produce the same CTA.
    expect(deriveCta(PLATFORM_IOS_KO)).not.toBe(deriveCta(PLATFORM_ANDROID_KO));
  });

  it('PLATFORM_IOS_KO output does not equal PLATFORM_WEB_KO output', () => {
    expect(deriveCta(PLATFORM_IOS_KO)).not.toBe(deriveCta(PLATFORM_WEB_KO));
  });

  it('ASCII-only stub output never equals the production Korean output', () => {
    expect(deriveCta(LANGUAGE_EN_ASCII)).not.toBe(deriveCta(VOICE_CONFIG));
  });

  it('all platform variant stubs read from their respective config slot values', () => {
    // Verifies the function is not returning any hardcoded value:
    // each stub's output must equal the slot value we injected.
    expect(deriveCta(PLATFORM_IOS_KO)).toBe(
      PLATFORM_IOS_KO.slots.trend_drop_cta_primary,
    );
    expect(deriveCta(PLATFORM_ANDROID_KO)).toBe(
      PLATFORM_ANDROID_KO.slots.trend_drop_cta_primary,
    );
    expect(deriveCta(PLATFORM_WEB_KO)).toBe(
      PLATFORM_WEB_KO.slots.trend_drop_cta_primary,
    );
    expect(deriveCta(LANGUAGE_EN_ASCII)).toBe(
      LANGUAGE_EN_ASCII.slots.trend_drop_cta_primary,
    );
  });
});
