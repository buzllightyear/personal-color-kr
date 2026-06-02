/**
 * Unit test — `apps/mobile/src/theme/typography.ts` typography scale tokens.
 *
 * Verifies Sub-AC 6.2:
 *   "Create typography scale module at apps/mobile/src/theme/typography.ts
 *    exporting headline/subhead/body/caption/button styles in
 *    bold/medium/regular weights, with a unit test verifying all 15
 *    typography combinations are exported with correct fontSize and
 *    fontWeight properties."
 *
 * What this test asserts:
 *   1. The `TYPOGRAPHY` constant is exported with the five required levels
 *      (`headline`, `subhead`, `body`, `caption`, `button`) — exhaustively,
 *      with no extra entries that would drift from the FunnelScreen
 *      ontology's documented typography contract.
 *   2. Every level exposes exactly the three documented weights (`bold`,
 *      `medium`, `regular`).
 *   3. The 5 × 3 matrix produces exactly 15 typography combinations and
 *      every one of them has:
 *        - `fontSize`: a positive integer (Android subpixel rounding makes
 *          fractional sizes render inconsistently across devices, so the
 *          token contract requires integers).
 *        - `fontWeight`: one of `'400'` (regular), `'500'` (medium), or
 *          `'700'` (bold). React Native rejects any other string at runtime
 *          on Android; numeric strings round-trip through Expo Router
 *          transitions more reliably than `'bold'`/`'normal'`.
 *   4. The fontWeight mapping is consistent across all five levels:
 *      `bold === '700'`, `medium === '500'`, `regular === '400'`. A
 *      contributor cannot accidentally set `body.bold.fontWeight = '600'`
 *      and silently produce uneven emphasis between screens.
 *   5. Within each level, fontSize is *invariant under weight* — i.e.
 *      `headline.bold.fontSize === headline.medium.fontSize === headline.regular.fontSize`.
 *      The weight axis controls emphasis; the size axis controls hierarchy;
 *      they must not bleed into each other.
 *   6. The exported type aliases (`TypographyLevel`, `TypographyWeight`)
 *      cover the runtime keys exhaustively — a TypeScript compile-time
 *      check encoded as a runtime fixture.
 *
 * Why per-token equality (rather than a single-regex sweep like the colors
 * test does):
 *   - Typography has *two* contracts to validate (size + weight) and the
 *     mapping bold→'700', medium→'500', regular→'400' is a fixed
 *     specification — not a designer-tunable swatch — so pinning the exact
 *     values here is the *point* of the test, not coupling.
 */
import { describe, expect, it } from 'vitest';

import {
  TYPOGRAPHY,
  type FontWeightNumeric,
  type TypographyLevel,
  type TypographyWeight,
} from '../src/theme/typography';

const LEVELS: readonly TypographyLevel[] = [
  'headline',
  'subhead',
  'body',
  'caption',
  'button',
];

const WEIGHTS: readonly TypographyWeight[] = ['bold', 'medium', 'regular'];

/** Canonical bold/medium/regular → numeric-string mapping. */
const EXPECTED_WEIGHT_VALUE: Readonly<Record<TypographyWeight, FontWeightNumeric>> = {
  bold: '700',
  medium: '500',
  regular: '400',
};

/** Canonical fontSize per level (invariant under weight). */
const EXPECTED_LEVEL_FONT_SIZE: Readonly<Record<TypographyLevel, number>> = {
  headline: 28,
  subhead: 20,
  body: 16,
  caption: 12,
  button: 16,
};

/**
 * Flatten the 5 × 3 matrix into 15 tuples for parameterised `.each()`
 * assertions. Each tuple is `[level, weight, expectedFontSize, expectedFontWeight]`.
 */
const ALL_COMBINATIONS: ReadonlyArray<
  readonly [TypographyLevel, TypographyWeight, number, FontWeightNumeric]
> = LEVELS.flatMap((level) =>
  WEIGHTS.map(
    (weight) =>
      [
        level,
        weight,
        EXPECTED_LEVEL_FONT_SIZE[level],
        EXPECTED_WEIGHT_VALUE[weight],
      ] as const,
  ),
);

describe('TYPOGRAPHY — theme typography scale tokens', () => {
  it('exposes exactly the five required levels (headline, subhead, body, caption, button)', () => {
    expect(Object.keys(TYPOGRAPHY).sort()).toEqual([...LEVELS].sort());
  });

  it('produces exactly 15 typography combinations (5 levels × 3 weights)', () => {
    const combinationCount = Object.values(TYPOGRAPHY).reduce(
      (total, levelObj) => total + Object.keys(levelObj).length,
      0,
    );
    expect(combinationCount).toBe(15);
  });

  describe.each(LEVELS)('level %s', (level) => {
    it('exposes exactly the three documented weights (bold, medium, regular)', () => {
      expect(Object.keys(TYPOGRAPHY[level]).sort()).toEqual([...WEIGHTS].sort());
    });

    it('fontSize is invariant under weight (size axis decoupled from weight axis)', () => {
      const sizes = WEIGHTS.map((weight) => TYPOGRAPHY[level][weight].fontSize);
      const uniqueSizes = new Set(sizes);
      expect(uniqueSizes.size).toBe(1);
    });
  });

  describe.each(ALL_COMBINATIONS)(
    'TYPOGRAPHY.%s.%s',
    (level, weight, expectedFontSize, expectedFontWeight) => {
      const token = TYPOGRAPHY[level][weight];

      it(`has fontSize === ${expectedFontSize}`, () => {
        expect(token.fontSize).toBe(expectedFontSize);
      });

      it('has a positive-integer fontSize (Android subpixel rounding contract)', () => {
        expect(Number.isInteger(token.fontSize)).toBe(true);
        expect(token.fontSize).toBeGreaterThan(0);
      });

      it(`has fontWeight === '${expectedFontWeight}'`, () => {
        expect(token.fontWeight).toBe(expectedFontWeight);
      });

      it("has a fontWeight in the RN-supported numeric set ('400' | '500' | '700')", () => {
        expect(['400', '500', '700']).toContain(token.fontWeight);
      });
    },
  );

  describe('weight → numeric-string mapping is consistent across all levels', () => {
    it.each(WEIGHTS)(
      'every level maps weight "%s" to the same numeric fontWeight',
      (weight) => {
        const weightValuesAcrossLevels = LEVELS.map(
          (level) => TYPOGRAPHY[level][weight].fontWeight,
        );
        const unique = new Set(weightValuesAcrossLevels);
        expect(unique.size).toBe(1);
        expect(weightValuesAcrossLevels[0]).toBe(EXPECTED_WEIGHT_VALUE[weight]);
      },
    );
  });

  describe('type-system contract — exported key unions stay in sync with runtime keys', () => {
    it('TypographyLevel covers every top-level key in TYPOGRAPHY', () => {
      // Compile-time assertion: every runtime key must be assignable to
      // `TypographyLevel`. If a contributor adds a new level but forgets to
      // widen the union, this `Record` typing fails at typecheck time.
      const _exhaustive: Record<TypographyLevel, unknown> = TYPOGRAPHY;
      expect(Object.keys(_exhaustive).length).toBe(5);
    });

    it('TypographyWeight covers every weight key in TYPOGRAPHY.headline', () => {
      const _exhaustive: Record<TypographyWeight, unknown> = TYPOGRAPHY.headline;
      expect(Object.keys(_exhaustive).length).toBe(3);
    });
  });
});
