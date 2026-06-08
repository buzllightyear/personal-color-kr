/**
 * Unit tests — deriveHeadline pure function (Sub-AC 13b-2).
 *
 * Verifies:
 *   - `deriveHeadline(config)` deterministically returns the correct headline
 *     for different tone/persona VoiceConfig combinations.
 *   - Different stub configs (representing different editorial personas) produce
 *     different headline outputs — proving the function reads from the config.
 *   - The production `VOICE_CONFIG` produces the expected Korean headline.
 *   - The function is pure: calling it multiple times with the same input
 *     always returns the same value.
 *   - No hardcoded strings leak through (stub values are all-ASCII sentinels
 *     that could never appear in Korean production copy).
 *   - No legacy ToneSwitcher (다정 / 에디토리얼 / 유쾌 / 시적) strings appear
 *     in any output.
 *
 * Stub strategy (tone/persona combinations):
 *   Three distinct stub VoiceConfig objects are constructed — each with a
 *   unique, clearly identifiable `diagnosis_wedge_headline` sentinel.  If
 *   `deriveHeadline` ever returns a hardcoded string instead of the config
 *   value, the assertion fails because the sentinel cannot appear in any
 *   Korean production copy.
 *
 *   Stub personas:
 *     PERSONA_TREND_TIMING — emphasises the "지금 막 뜬" timing axis.
 *     PERSONA_PHOTO_CRAFT  — emphasises the "구도·빛·보정" craft axis.
 *     PERSONA_ASCII_ONLY   — ASCII-only sentinel (zero Korean characters).
 */

import { describe, expect, it } from 'vitest';

import {
  VOICE_CONFIG,
  type VoiceConfig,
  type VoiceId,
} from '../../src/voice/config.js';
import { deriveHeadline } from '../../src/voice/headline.js';

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

/**
 * Builds a minimal VoiceConfig stub, overriding only `diagnosis_wedge_headline`
 * with the supplied value.  All other slots are taken from the production
 * VOICE_CONFIG so the integrity guard inside `voice/config.ts` is satisfied.
 *
 * Callers can supply any string as the headline sentinel — including all-ASCII
 * strings that would never appear in Korean production copy.
 */
function buildStub(diagnosisWedgeHeadline: string): VoiceConfig {
  return {
    voiceId: 'trend-editor-kr' as VoiceId,
    description: `test-stub — headline: "${diagnosisWedgeHeadline}"`,
    slots: Object.freeze({
      ...VOICE_CONFIG.slots,
      diagnosis_wedge_headline: diagnosisWedgeHeadline,
    }),
  };
}

// ---------------------------------------------------------------------------
// Three distinct tone/persona combinations for input/output mapping tests
// ---------------------------------------------------------------------------

/**
 * Persona A — "트렌드 타이밍" axis emphasis.
 * Headline reflects the "it just dropped" timing angle.
 */
const PERSONA_TREND_TIMING = buildStub(
  'PERSONA_TREND_TIMING: 트렌드가 방금 바뀌었어 — 네 셀카를 업데이트할 시간',
);

/**
 * Persona B — "사진 감각" axis emphasis.
 * Headline reflects the photo-craft (composition & light) angle.
 */
const PERSONA_PHOTO_CRAFT = buildStub(
  'PERSONA_PHOTO_CRAFT: 구도와 빛으로 만드는 셀카 — 트렌드 맞춤 보정',
);

/**
 * Persona C — ASCII-only sentinel.
 * Proves the function reads from the config and not from any hardcoded Korean
 * string.  If Korean characters appear in the output for this stub, the test
 * fails.
 */
const PERSONA_ASCII_ONLY = buildStub('PERSONA_ASCII_ONLY: TREND_PHOTO_GEN_HEADLINE');

// ---------------------------------------------------------------------------
// Core determinism tests
// ---------------------------------------------------------------------------

describe('deriveHeadline — deterministic pure function (Sub-AC 13b-2)', () => {
  it('returns a string for every config input', () => {
    for (const config of [
      PERSONA_TREND_TIMING,
      PERSONA_PHOTO_CRAFT,
      PERSONA_ASCII_ONLY,
      VOICE_CONFIG,
    ]) {
      expect(typeof deriveHeadline(config)).toBe('string');
    }
  });

  it('is deterministic: same config → same output across repeated calls', () => {
    // Call each config twice and assert equality — proves referential transparency.
    expect(deriveHeadline(PERSONA_TREND_TIMING)).toBe(
      deriveHeadline(PERSONA_TREND_TIMING),
    );
    expect(deriveHeadline(PERSONA_PHOTO_CRAFT)).toBe(
      deriveHeadline(PERSONA_PHOTO_CRAFT),
    );
    expect(deriveHeadline(PERSONA_ASCII_ONLY)).toBe(deriveHeadline(PERSONA_ASCII_ONLY));
    expect(deriveHeadline(VOICE_CONFIG)).toBe(deriveHeadline(VOICE_CONFIG));
  });

  it('different configs produce different headline outputs', () => {
    const a = deriveHeadline(PERSONA_TREND_TIMING);
    const b = deriveHeadline(PERSONA_PHOTO_CRAFT);
    const c = deriveHeadline(PERSONA_ASCII_ONLY);
    const d = deriveHeadline(VOICE_CONFIG);

    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(b).not.toBe(c);
    expect(b).not.toBe(d);
    expect(c).not.toBe(d);
  });
});

// ---------------------------------------------------------------------------
// Input/output mapping tests — one assertion per tone/persona combination
// ---------------------------------------------------------------------------

describe('deriveHeadline — input/output mapping per tone/persona (Sub-AC 13b-2)', () => {
  it('PERSONA_TREND_TIMING → returns the timing-axis headline exactly', () => {
    expect(deriveHeadline(PERSONA_TREND_TIMING)).toBe(
      'PERSONA_TREND_TIMING: 트렌드가 방금 바뀌었어 — 네 셀카를 업데이트할 시간',
    );
  });

  it('PERSONA_PHOTO_CRAFT → returns the craft-axis headline exactly', () => {
    expect(deriveHeadline(PERSONA_PHOTO_CRAFT)).toBe(
      'PERSONA_PHOTO_CRAFT: 구도와 빛으로 만드는 셀카 — 트렌드 맞춤 보정',
    );
  });

  it('PERSONA_ASCII_ONLY → returns the ASCII sentinel headline exactly', () => {
    expect(deriveHeadline(PERSONA_ASCII_ONLY)).toBe(
      'PERSONA_ASCII_ONLY: TREND_PHOTO_GEN_HEADLINE',
    );
  });

  it('VOICE_CONFIG (production) → returns the expected Korean entry-wedge headline', () => {
    expect(deriveHeadline(VOICE_CONFIG)).toBe(
      VOICE_CONFIG.slots.diagnosis_wedge_headline,
    );
  });
});

// ---------------------------------------------------------------------------
// Production VOICE_CONFIG — content-level assertions
// ---------------------------------------------------------------------------

describe('deriveHeadline — production VOICE_CONFIG assertions', () => {
  const prodHeadline = deriveHeadline(VOICE_CONFIG);

  it('production headline is a non-empty string', () => {
    expect(prodHeadline.trim().length).toBeGreaterThan(0);
  });

  it('production headline contains Korean characters', () => {
    // Korean syllable block: U+AC00–U+D7A3
    expect(/[가-힣]/.test(prodHeadline)).toBe(true);
  });

  it('production headline contains photo-craft language (구도 or 빛)', () => {
    const hasCraft = prodHeadline.includes('구도') || prodHeadline.includes('빛');
    expect(hasCraft).toBe(true);
  });

  it('production headline does not contain appearance/styling language', () => {
    // Seed constraint: voice covers timing + photo craft ONLY.
    // Appearance (외모) and styling (스타일링) are outside the product boundary.
    expect(prodHeadline.includes('외모')).toBe(false);
    expect(prodHeadline.includes('스타일링')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ToneSwitcher regression guard
// ---------------------------------------------------------------------------

describe('deriveHeadline — no legacy ToneSwitcher strings in any output', () => {
  const LEGACY_TONE_NAMES = ['다정', '에디토리얼', '유쾌', '시적'];

  const ALL_OUTPUTS = [
    { label: 'PERSONA_TREND_TIMING', result: deriveHeadline(PERSONA_TREND_TIMING) },
    { label: 'PERSONA_PHOTO_CRAFT', result: deriveHeadline(PERSONA_PHOTO_CRAFT) },
    { label: 'PERSONA_ASCII_ONLY', result: deriveHeadline(PERSONA_ASCII_ONLY) },
    { label: 'VOICE_CONFIG', result: deriveHeadline(VOICE_CONFIG) },
  ];

  it.each(ALL_OUTPUTS)(
    '$label output contains no legacy 4-tone names',
    ({ label, result }) => {
      for (const tone of LEGACY_TONE_NAMES) {
        expect(
          result.includes(tone),
          `deriveHeadline(${label}) must not contain legacy tone "${tone}" — found in: "${result}"`,
        ).toBe(false);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// No hardcoded string guard
// ---------------------------------------------------------------------------

describe('deriveHeadline — stub output proves no hardcoded string leakage', () => {
  it('PERSONA_ASCII_ONLY output contains no Korean characters (pure config read)', () => {
    const result = deriveHeadline(PERSONA_ASCII_ONLY);
    expect(/[가-힣]/.test(result)).toBe(false);
  });

  it('PERSONA_ASCII_ONLY output matches exactly the stub sentinel', () => {
    // If the function returned any hardcoded Korean string, this would fail.
    expect(deriveHeadline(PERSONA_ASCII_ONLY)).toBe(
      'PERSONA_ASCII_ONLY: TREND_PHOTO_GEN_HEADLINE',
    );
  });

  it('PERSONA_TREND_TIMING output does not equal PERSONA_PHOTO_CRAFT output', () => {
    // Sanity: two different personas cannot produce the same headline.
    expect(deriveHeadline(PERSONA_TREND_TIMING)).not.toBe(
      deriveHeadline(PERSONA_PHOTO_CRAFT),
    );
  });
});
