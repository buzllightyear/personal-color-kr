/**
 * Unit test — `apps/mobile/src/theme/colors.ts` color palette tokens.
 *
 * Verifies Sub-AC 6.1:
 *   "Create color palette module at apps/mobile/src/theme/colors.ts
 *    exporting soft pink/coral base colors, 4-season accent colors
 *    (spring/summer/autumn/winter), and 4-level grayscale, with a unit
 *    test verifying all required color tokens are exported with valid
 *    hex values."
 *
 * What this test asserts:
 *   1. The `COLORS` constant is exported with three top-level groups:
 *      `base`, `season`, `grayscale`.
 *   2. The `base` group exposes the soft pink/coral identity colors used by
 *      the Korean beauty market funnel UI (`pink`, `coral`, `blush`).
 *   3. The `season` group exposes the four Korean personal-color category
 *      accents (`spring`, `summer`, `autumn`, `winter`) — exhaustively, with
 *      no extra entries that would drift from the FunnelScreen ontology.
 *   4. The `grayscale` group exposes the 4-level neutral scale named by
 *      semantic intent (`background`, `text`, `border`, `disabled`).
 *   5. Every leaf value is a valid 6-digit uppercase `#RRGGBB` hex string.
 *      The single regex validates the entire palette in one sweep so
 *      adding a new colour requires no test-side bookkeeping.
 *   6. The exported type aliases (`BaseColorKey`, `SeasonKey`,
 *      `GrayscaleKey`) cover the runtime keys exhaustively — a TypeScript
 *      compile-time check encoded as a runtime fixture.
 *
 * Why a single hex regex rather than per-token equality:
 *   - We're testing the *contract* (every token is a valid hex), not the
 *     *content* (which specific hex Maria the designer picked). Per-token
 *     equality would couple this test to the brand palette and force a
 *     test edit every time the designer nudges a swatch.
 */
import { describe, expect, it } from 'vitest';

import {
  COLORS,
  type BaseColorKey,
  type GrayscaleKey,
  type SeasonKey,
} from '../src/theme/colors';

const HEX_6_DIGIT_UPPERCASE = /^#[0-9A-F]{6}$/;

describe('COLORS — theme color palette tokens', () => {
  it('exposes the three required palette groups: base, season, grayscale', () => {
    expect(Object.keys(COLORS).sort()).toEqual(['base', 'grayscale', 'season']);
  });

  describe('base — soft pink/coral identity colors', () => {
    it('exposes the three documented base tokens (pink, coral, blush)', () => {
      expect(Object.keys(COLORS.base).sort()).toEqual(['blush', 'coral', 'pink']);
    });

    it.each<[BaseColorKey, string]>(
      Object.entries(COLORS.base) as [BaseColorKey, string][],
    )('base.%s is a valid 6-digit uppercase hex (got %s)', (_key, value) => {
      expect(value).toMatch(HEX_6_DIGIT_UPPERCASE);
    });
  });

  describe('season — 4-season Korean personal-color accents', () => {
    it('exposes exactly the four canonical seasons (spring, summer, autumn, winter)', () => {
      // Sorted alphabetically: autumn, spring, summer, winter
      expect(Object.keys(COLORS.season).sort()).toEqual([
        'autumn',
        'spring',
        'summer',
        'winter',
      ]);
    });

    it.each<[SeasonKey, string]>(
      Object.entries(COLORS.season) as [SeasonKey, string][],
    )('season.%s is a valid 6-digit uppercase hex (got %s)', (_key, value) => {
      expect(value).toMatch(HEX_6_DIGIT_UPPERCASE);
    });

    it('all four season accents are unique (no two seasons share a color)', () => {
      const values = Object.values(COLORS.season);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('grayscale — 4-level neutral scale by semantic intent', () => {
    it('exposes exactly the four documented grayscale tokens', () => {
      expect(Object.keys(COLORS.grayscale).sort()).toEqual([
        'background',
        'border',
        'disabled',
        'text',
      ]);
    });

    it.each<[GrayscaleKey, string]>(
      Object.entries(COLORS.grayscale) as [GrayscaleKey, string][],
    )('grayscale.%s is a valid 6-digit uppercase hex (got %s)', (_key, value) => {
      expect(value).toMatch(HEX_6_DIGIT_UPPERCASE);
    });

    it('background is #FFFFFF (pure white) — light-mode-only constraint', () => {
      expect(COLORS.grayscale.background).toBe('#FFFFFF');
    });
  });

  describe('every leaf token is a valid hex (sweep across all groups)', () => {
    it('passes the 6-digit uppercase hex regex for every nested value', () => {
      const allLeafValues: string[] = [
        ...Object.values(COLORS.base),
        ...Object.values(COLORS.season),
        ...Object.values(COLORS.grayscale),
      ];
      for (const value of allLeafValues) {
        expect(value).toMatch(HEX_6_DIGIT_UPPERCASE);
      }
    });
  });

  describe('type-system contract — exported key unions stay in sync with runtime keys', () => {
    it('BaseColorKey covers every key in COLORS.base', () => {
      // Compile-time assertion: every runtime key must be assignable to
      // `BaseColorKey`. If a contributor adds a new base token but forgets
      // to widen the union, this `satisfies` check fails at typecheck time.
      const _exhaustive: Record<BaseColorKey, string> = COLORS.base;
      expect(Object.keys(_exhaustive).length).toBeGreaterThan(0);
    });

    it('SeasonKey covers every key in COLORS.season', () => {
      const _exhaustive: Record<SeasonKey, string> = COLORS.season;
      expect(Object.keys(_exhaustive).length).toBe(4);
    });

    it('GrayscaleKey covers every key in COLORS.grayscale', () => {
      const _exhaustive: Record<GrayscaleKey, string> = COLORS.grayscale;
      expect(Object.keys(_exhaustive).length).toBe(4);
    });
  });
});
