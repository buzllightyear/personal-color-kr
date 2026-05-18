/**
 * Unit test — `apps/mobile/src/theme/index.ts` unified theme aggregator.
 *
 * Verifies Sub-AC 6.4:
 *   "Create theme index module at apps/mobile/src/theme/index.ts that
 *    aggregates and re-exports colors, typography, and spacing as a unified
 *    theme object, with a unit test verifying the theme object contains all
 *    three sub-modules with correct structure."
 *
 * What this test asserts:
 *   1. The barrel re-exports the three sub-module constants (`COLORS`,
 *      `TYPOGRAPHY`, `SPACING`) plus the ordered key list
 *      (`SPACING_KEYS_ORDERED`) — so a consumer doing
 *      `import { COLORS, TYPOGRAPHY, SPACING } from '../theme'` resolves the
 *      same identifiers as deep-importing each sub-module.
 *   2. The aggregate `THEME` constant is exported with exactly the three
 *      documented top-level fields (`colors`, `typography`, `spacing`) — no
 *      extra entries that would drift from the FunnelScreen ontology's
 *      design-token contract.
 *   3. Each `THEME` field is *referentially identical* to the corresponding
 *      named export. A consumer that compares `THEME.colors === COLORS` must
 *      get `true` — if the barrel rebuilt a shallow copy, leaf-level identity
 *      assertions (e.g. spreading `THEME.colors` into a StyleSheet) would
 *      silently diverge from spreading `COLORS` directly.
 *   4. Each sub-module under `THEME` has the same correct structure asserted
 *      by its own dedicated test (`theme-colors.test.ts`,
 *      `theme-typography.test.ts`, `theme-spacing.test.ts`):
 *        - `THEME.colors` has the three palette groups (base, season,
 *          grayscale) with the right keys.
 *        - `THEME.typography` has the five levels (headline, subhead, body,
 *          caption, button) each with the three weights (bold, medium,
 *          regular).
 *        - `THEME.spacing` has the seven t-shirt keys (xxs … xxl) all
 *          multiples of 4.
 *   5. The exported `Theme` type alias matches `typeof THEME` (compile-time
 *      check encoded as a runtime fixture) so downstream consumers can rely
 *      on the public type without re-deriving it.
 *
 * Why this test does NOT re-assert leaf-level contracts (hex regex, fontWeight
 * mapping, spacing-ascending-order) already covered by the per-sub-module
 * tests:
 *   - The per-sub-module tests already pin those contracts exhaustively. This
 *     test's job is the *aggregation* contract — that the barrel preserves
 *     structure and identity — not the leaf-level contracts. Re-asserting
 *     them here would couple the index test to leaf details and force a
 *     two-place edit every time the designer nudges a token.
 *   - The referential-identity assertions (`THEME.colors === COLORS`) make
 *     leaf-level re-assertions logically unnecessary: if the underlying
 *     constants pass their own tests AND the aggregate fields are identical
 *     references to those constants, the aggregate inherits the leaf
 *     contracts by transitivity.
 */
import { describe, expect, it } from 'vitest';

import {
  COLORS,
  SPACING,
  SPACING_KEYS_ORDERED,
  THEME,
  TYPOGRAPHY,
  type Theme,
} from '../src/theme';

describe('theme index — unified theme aggregator', () => {
  describe('named re-exports', () => {
    it('re-exports COLORS, TYPOGRAPHY, SPACING, SPACING_KEYS_ORDERED from the barrel', () => {
      // Defined-ness is sufficient — the per-sub-module tests pin the shape.
      expect(COLORS).toBeDefined();
      expect(TYPOGRAPHY).toBeDefined();
      expect(SPACING).toBeDefined();
      expect(SPACING_KEYS_ORDERED).toBeDefined();
    });

    it('SPACING_KEYS_ORDERED is a readonly array of spacing keys', () => {
      expect(Array.isArray(SPACING_KEYS_ORDERED)).toBe(true);
      expect(SPACING_KEYS_ORDERED.length).toBe(7);
    });
  });

  describe('THEME aggregate object', () => {
    it('exposes exactly the three documented sub-modules: colors, typography, spacing', () => {
      expect(Object.keys(THEME).sort()).toEqual([
        'colors',
        'spacing',
        'typography',
      ]);
    });

    it('THEME.colors is referentially identical to the COLORS named export', () => {
      // Identity (not deep equality) so that spreading THEME.colors and
      // spreading COLORS produce the same StyleSheet — and so a future
      // contributor cannot accidentally introduce a shallow-copy barrel that
      // silently breaks reference-based equality checks downstream.
      expect(THEME.colors).toBe(COLORS);
    });

    it('THEME.typography is referentially identical to the TYPOGRAPHY named export', () => {
      expect(THEME.typography).toBe(TYPOGRAPHY);
    });

    it('THEME.spacing is referentially identical to the SPACING named export', () => {
      expect(THEME.spacing).toBe(SPACING);
    });
  });

  describe('THEME.colors structure (color palette sub-module)', () => {
    it('exposes the three required palette groups: base, season, grayscale', () => {
      expect(Object.keys(THEME.colors).sort()).toEqual([
        'base',
        'grayscale',
        'season',
      ]);
    });

    it('base group exposes the three identity colors (pink, coral, blush)', () => {
      expect(Object.keys(THEME.colors.base).sort()).toEqual([
        'blush',
        'coral',
        'pink',
      ]);
    });

    it('season group exposes the four canonical seasons (spring, summer, autumn, winter)', () => {
      expect(Object.keys(THEME.colors.season).sort()).toEqual([
        'autumn',
        'spring',
        'summer',
        'winter',
      ]);
    });

    it('grayscale group exposes the four semantic neutrals (background, text, border, disabled)', () => {
      expect(Object.keys(THEME.colors.grayscale).sort()).toEqual([
        'background',
        'border',
        'disabled',
        'text',
      ]);
    });
  });

  describe('THEME.typography structure (typography scale sub-module)', () => {
    const EXPECTED_LEVELS = [
      'body',
      'button',
      'caption',
      'headline',
      'subhead',
    ];
    const EXPECTED_WEIGHTS = ['bold', 'medium', 'regular'];

    it('exposes exactly the five required levels', () => {
      expect(Object.keys(THEME.typography).sort()).toEqual(EXPECTED_LEVELS);
    });

    it.each(EXPECTED_LEVELS)(
      'level "%s" exposes exactly the three documented weights (bold, medium, regular)',
      (level) => {
        expect(
          Object.keys(
            THEME.typography[level as keyof typeof THEME.typography],
          ).sort(),
        ).toEqual(EXPECTED_WEIGHTS);
      },
    );

    it('produces exactly 15 typography combinations (5 levels × 3 weights)', () => {
      const combinationCount = Object.values(THEME.typography).reduce(
        (total, levelObj) => total + Object.keys(levelObj).length,
        0,
      );
      expect(combinationCount).toBe(15);
    });
  });

  describe('THEME.spacing structure (spacing scale sub-module)', () => {
    const EXPECTED_KEYS = ['lg', 'md', 'sm', 'xl', 'xs', 'xxl', 'xxs'];

    it('exposes exactly the seven required t-shirt keys', () => {
      expect(Object.keys(THEME.spacing).sort()).toEqual(EXPECTED_KEYS);
    });

    it('every token value is a positive integer multiple of 4', () => {
      for (const key of EXPECTED_KEYS) {
        const value = THEME.spacing[key as keyof typeof THEME.spacing];
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
        expect(value % 4).toBe(0);
      }
    });
  });

  describe('type-system contract', () => {
    it('the exported Theme type alias matches typeof THEME (compile-time contract)', () => {
      // Compile-time assertion: if `Theme` ever drifts from `typeof THEME`,
      // this assignment fails at typecheck time. The runtime check is
      // defence-in-depth — a passing typecheck plus this no-op runtime
      // assertion confirms both surfaces agree.
      const _exhaustive: Theme = THEME;
      expect(_exhaustive).toBe(THEME);
    });
  });
});
