/**
 * Sub-AC 1.1 — Unit tests for the referral code generator.
 *
 * Two main concerns:
 *   • format validation (regex, length, charset, no ambiguous chars)
 *   • collision prevention (uniqueness against an existing set,
 *     bounded retry budget, deterministic via injected RNG)
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GENERATE_MAX_ATTEMPTS,
  REFERRAL_CODE_CHARSET,
  REFERRAL_CODE_PATTERN,
  REFERRAL_CODE_PREFIX,
  REFERRAL_CODE_SEPARATOR,
  REFERRAL_CODE_SUFFIX_LENGTH,
  REFERRAL_CODE_TOTAL_LENGTH,
  ReferralCodeError,
  generateReferralCode,
  generateUniqueReferralCode,
  isValidReferralCode,
  normalizeReferralCode,
  type ReferralRandomInt,
} from '../../src/referral/code.js';

/** Deterministic counter-based RNG.  Cycles through the supplied indices. */
function rngFromSequence(values: readonly number[]): ReferralRandomInt {
  let cursor = 0;
  return () => {
    const next = values[cursor % values.length] as number;
    cursor += 1;
    return next;
  };
}

describe('referral code constants', () => {
  it('uses the documented format components', () => {
    expect(REFERRAL_CODE_PREFIX).toBe('PCKR');
    expect(REFERRAL_CODE_SEPARATOR).toBe('-');
    expect(REFERRAL_CODE_SUFFIX_LENGTH).toBe(6);
    expect(REFERRAL_CODE_TOTAL_LENGTH).toBe(11);
  });

  it('excludes visually ambiguous characters from the charset', () => {
    // Reduce mis-types over the phone / handwritten codes.
    expect(REFERRAL_CODE_CHARSET).not.toContain('0');
    expect(REFERRAL_CODE_CHARSET).not.toContain('1');
    expect(REFERRAL_CODE_CHARSET).not.toContain('I');
    expect(REFERRAL_CODE_CHARSET).not.toContain('L');
    expect(REFERRAL_CODE_CHARSET).not.toContain('O');
  });

  it('charset is uppercase ASCII alphanumeric only', () => {
    expect(REFERRAL_CODE_CHARSET).toMatch(/^[A-Z2-9]+$/);
  });
});

describe('isValidReferralCode', () => {
  it('accepts canonical codes', () => {
    expect(isValidReferralCode('PCKR-ABCDEF')).toBe(true);
    expect(isValidReferralCode('PCKR-23456H')).toBe(true);
  });

  it('rejects wrong prefix', () => {
    expect(isValidReferralCode('XXXX-ABCDEF')).toBe(false);
    expect(isValidReferralCode('pckr-ABCDEF')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidReferralCode('PCKR-ABCDE')).toBe(false);
    expect(isValidReferralCode('PCKR-ABCDEFG')).toBe(false);
    expect(isValidReferralCode('')).toBe(false);
  });

  it('rejects ambiguous characters in suffix', () => {
    expect(isValidReferralCode('PCKR-0ABCDE')).toBe(false);
    expect(isValidReferralCode('PCKR-1ABCDE')).toBe(false);
    expect(isValidReferralCode('PCKR-IABCDE')).toBe(false);
    expect(isValidReferralCode('PCKR-LABCDE')).toBe(false);
    expect(isValidReferralCode('PCKR-OABCDE')).toBe(false);
  });

  it('rejects lowercase suffix characters', () => {
    expect(isValidReferralCode('PCKR-abcdef')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidReferralCode(undefined)).toBe(false);
    expect(isValidReferralCode(null)).toBe(false);
    expect(isValidReferralCode(123_456)).toBe(false);
    expect(isValidReferralCode({})).toBe(false);
  });

  it('REFERRAL_CODE_PATTERN matches what the helper accepts', () => {
    expect(REFERRAL_CODE_PATTERN.test('PCKR-ABCDEF')).toBe(true);
    expect(REFERRAL_CODE_PATTERN.test('pckr-ABCDEF')).toBe(false);
  });
});

describe('normalizeReferralCode', () => {
  it('trims whitespace and uppercases', () => {
    expect(normalizeReferralCode('  pckr-abcdef  ')).toBe('PCKR-ABCDEF');
  });

  it('does not change already-canonical input', () => {
    expect(normalizeReferralCode('PCKR-ABCDEF')).toBe('PCKR-ABCDEF');
  });
});

describe('generateReferralCode', () => {
  it('produces a code that passes isValidReferralCode', () => {
    const code = generateReferralCode({ randomInt: rngFromSequence([0]) });
    expect(isValidReferralCode(code)).toBe(true);
  });

  it('is deterministic given a deterministic RNG', () => {
    const seq = [0, 1, 2, 3, 4, 5];
    const a = generateReferralCode({ randomInt: rngFromSequence(seq) });
    const b = generateReferralCode({ randomInt: rngFromSequence(seq) });
    expect(a).toBe(b);
  });

  it('maps RNG indices into charset characters in order', () => {
    const code = generateReferralCode({
      randomInt: rngFromSequence([0, 1, 2, 3, 4, 5]),
    });
    expect(code).toBe(
      `${REFERRAL_CODE_PREFIX}${REFERRAL_CODE_SEPARATOR}${REFERRAL_CODE_CHARSET.slice(0, 6)}`,
    );
  });

  it('uses the documented suffix length', () => {
    const code = generateReferralCode({ randomInt: rngFromSequence([0]) });
    expect(code.length).toBe(REFERRAL_CODE_TOTAL_LENGTH);
  });

  it('rejects RNG output outside the charset range', () => {
    expect(() =>
      generateReferralCode({ randomInt: rngFromSequence([REFERRAL_CODE_CHARSET.length]) }),
    ).toThrow(ReferralCodeError);

    expect(() =>
      generateReferralCode({ randomInt: rngFromSequence([-1]) }),
    ).toThrow(ReferralCodeError);

    expect(() =>
      generateReferralCode({ randomInt: rngFromSequence([1.5]) }),
    ).toThrow(ReferralCodeError);
  });

  it('default RNG produces valid codes across many draws (smoke test)', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(isValidReferralCode(generateReferralCode())).toBe(true);
    }
  });
});

describe('generateUniqueReferralCode', () => {
  it('returns a freshly minted code when none exist', () => {
    const code = generateUniqueReferralCode([], {
      randomInt: rngFromSequence([0]),
    });
    expect(isValidReferralCode(code)).toBe(true);
  });

  it('does not return any code from the existing set', () => {
    const first = generateReferralCode({ randomInt: rngFromSequence([0]) });

    // Sequence: first draw collides with `first`, second draw uses
    // index 1 across all 6 positions and is therefore distinct.
    const sequence = [
      0, 0, 0, 0, 0, 0, // attempt 1 → equals `first`, must be rejected
      1, 1, 1, 1, 1, 1, // attempt 2 → distinct
    ];

    const result = generateUniqueReferralCode([first], {
      randomInt: rngFromSequence(sequence),
    });
    expect(result).not.toBe(first);
    expect(isValidReferralCode(result)).toBe(true);
  });

  it('throws when the attempt budget is exhausted', () => {
    const collide = generateReferralCode({ randomInt: rngFromSequence([0]) });
    const taken = new Set<string>([collide]);
    // RNG always returns 0, so every attempt collides.
    expect(() =>
      generateUniqueReferralCode(taken, {
        randomInt: rngFromSequence([0]),
        maxAttempts: 3,
      }),
    ).toThrow(ReferralCodeError);
  });

  it('error reports the collision_budget_exhausted reason', () => {
    const collide = generateReferralCode({ randomInt: rngFromSequence([0]) });
    try {
      generateUniqueReferralCode([collide], {
        randomInt: rngFromSequence([0]),
        maxAttempts: 2,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReferralCodeError);
      expect((err as ReferralCodeError).reason).toBe('collision_budget_exhausted');
    }
  });

  it('accepts Set, Array, and arbitrary iterables for existingCodes', () => {
    const seed = generateReferralCode({ randomInt: rngFromSequence([0]) });
    // Different RNG, so guaranteed distinct on first try.
    const rng = rngFromSequence([2, 3, 4, 5, 6, 7]);

    const fromSet = generateUniqueReferralCode(new Set([seed]), { randomInt: rng });
    expect(isValidReferralCode(fromSet)).toBe(true);
    expect(fromSet).not.toBe(seed);

    const rng2 = rngFromSequence([8, 9, 10, 11, 12, 13]);
    const fromArr = generateUniqueReferralCode([seed], { randomInt: rng2 });
    expect(isValidReferralCode(fromArr)).toBe(true);
    expect(fromArr).not.toBe(seed);

    function* gen(): IterableIterator<string> {
      yield seed;
    }
    const rng3 = rngFromSequence([14, 15, 16, 17, 18, 19]);
    const fromGen = generateUniqueReferralCode(gen(), { randomInt: rng3 });
    expect(isValidReferralCode(fromGen)).toBe(true);
    expect(fromGen).not.toBe(seed);
  });

  it('rejects non-positive maxAttempts', () => {
    expect(() =>
      generateUniqueReferralCode([], {
        randomInt: rngFromSequence([0]),
        maxAttempts: 0,
      }),
    ).toThrow(ReferralCodeError);

    expect(() =>
      generateUniqueReferralCode([], {
        randomInt: rngFromSequence([0]),
        maxAttempts: -1,
      }),
    ).toThrow(ReferralCodeError);

    expect(() =>
      generateUniqueReferralCode([], {
        randomInt: rngFromSequence([0]),
        maxAttempts: 1.5,
      }),
    ).toThrow(ReferralCodeError);
  });

  it('default attempt budget is documented as positive integer', () => {
    expect(Number.isInteger(DEFAULT_GENERATE_MAX_ATTEMPTS)).toBe(true);
    expect(DEFAULT_GENERATE_MAX_ATTEMPTS).toBeGreaterThan(0);
  });

  it('minting 1000 codes in a loop never collides (probabilistic regression)', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const code = generateUniqueReferralCode(taken);
      expect(taken.has(code)).toBe(false);
      taken.add(code);
    }
    expect(taken.size).toBe(1000);
  });
});
