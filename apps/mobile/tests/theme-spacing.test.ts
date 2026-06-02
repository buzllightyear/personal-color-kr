/**
 * Unit test — `apps/mobile/src/theme/spacing.ts` spacing scale tokens.
 *
 * Verifies Sub-AC 6.3:
 *   "Create spacing scale module at apps/mobile/src/theme/spacing.ts
 *    exporting a consistent spacing scale (e.g., xs/sm/md/lg/xl), with a
 *    unit test verifying spacing tokens are exported as numeric values in
 *    ascending order."
 *
 * What this test asserts:
 *   1. The `SPACING` constant is exported with exactly the seven documented
 *      t-shirt keys (`xxs`, `xs`, `sm`, `md`, `lg`, `xl`, `xxl`) — the seven
 *      values demanded by the Seed constraint "spacing must use multiples of
 *      4 (4, 8, 12, 16, 24, 32, 48)".
 *   2. Every token value is a finite, positive integer (Android subpixel
 *      rounding makes fractional spacing render inconsistently across
 *      devices, so the token contract requires integers).
 *   3. Every token value is a multiple of 4 — pins the Seed constraint
 *      directly so a future contributor cannot accidentally introduce a
 *      non-grid value like `10` or `20`.
 *   4. Iterated in scale-order via `SPACING_KEYS_ORDERED`, the values are
 *      strictly ascending — the core contract called out in the Sub-AC
 *      description.
 *   5. The exact pixel values match the Seed-mandated scale
 *      [4, 8, 12, 16, 24, 32, 48]. Pinned because that scale is the design
 *      contract, not a designer-tunable swatch.
 *   6. `SPACING_KEYS_ORDERED` is itself a 1:1 cover of `Object.keys(SPACING)`
 *      — neither has an entry the other lacks.
 *   7. The exported `SpacingKey` type union covers every runtime key
 *      exhaustively — a TypeScript compile-time check encoded as a runtime
 *      fixture.
 *
 * Why a separate `SPACING_KEYS_ORDERED` array drives the ascending-order check:
 *   - The t-shirt names sort alphabetically in the *wrong* order
 *     (`lg` < `md` < `sm` < `xl` < `xs` < `xxl` < `xxs`), so we cannot lean
 *     on `Object.keys(...).sort()` to get scale-order. The ordered array is
 *     the explicit, auditable source of truth.
 */
import { describe, expect, it } from 'vitest';

import { SPACING, SPACING_KEYS_ORDERED, type SpacingKey } from '../src/theme/spacing';

/** Canonical Seed-mandated scale, in ascending order. */
const EXPECTED_SCALE: readonly number[] = [4, 8, 12, 16, 24, 32, 48];

const EXPECTED_KEYS: readonly SpacingKey[] = [
  'xxs',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  'xxl',
];

describe('SPACING — theme spacing scale tokens', () => {
  it('exposes exactly the seven required t-shirt keys', () => {
    // Sorted alphabetically for stable equality (scale-order is exercised
    // separately via SPACING_KEYS_ORDERED below).
    expect(Object.keys(SPACING).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('exposes exactly seven tokens (matches the Seed-mandated 7-value scale)', () => {
    expect(Object.keys(SPACING)).toHaveLength(EXPECTED_SCALE.length);
  });

  describe.each(EXPECTED_KEYS)('SPACING.%s', (key) => {
    const value = SPACING[key];

    it('is a finite number', () => {
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
    });

    it('is a positive integer (Android subpixel rounding contract)', () => {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    });

    it('is a multiple of 4 (4-pixel grid alignment contract)', () => {
      expect(value % 4).toBe(0);
    });
  });

  describe('scale-order contract — values are strictly ascending', () => {
    it('SPACING_KEYS_ORDERED matches the t-shirt scale order', () => {
      expect(SPACING_KEYS_ORDERED).toEqual(EXPECTED_KEYS);
    });

    it('SPACING_KEYS_ORDERED covers every runtime key (no drift)', () => {
      expect([...SPACING_KEYS_ORDERED].sort()).toEqual(Object.keys(SPACING).sort());
    });

    it('iterated in scale-order, every value is strictly greater than its predecessor', () => {
      const valuesInOrder = SPACING_KEYS_ORDERED.map((key) => SPACING[key]);
      for (let i = 1; i < valuesInOrder.length; i += 1) {
        const previous = valuesInOrder[i - 1] as number;
        const current = valuesInOrder[i] as number;
        expect(current).toBeGreaterThan(previous);
      }
    });

    it('iterated in scale-order, values match the Seed-mandated scale [4, 8, 12, 16, 24, 32, 48]', () => {
      const valuesInOrder = SPACING_KEYS_ORDERED.map((key) => SPACING[key]);
      expect(valuesInOrder).toEqual(EXPECTED_SCALE);
    });
  });

  describe('type-system contract — exported key union stays in sync with runtime keys', () => {
    it('SpacingKey covers every key in SPACING', () => {
      // Compile-time assertion: every runtime key must be assignable to
      // `SpacingKey`. If a contributor adds a new spacing token but forgets
      // to widen the union, this `Record` typing fails at typecheck time.
      const _exhaustive: Record<SpacingKey, number> = SPACING;
      expect(Object.keys(_exhaustive).length).toBe(EXPECTED_KEYS.length);
    });

    it('SPACING_KEYS_ORDERED is typed as readonly SpacingKey[]', () => {
      // Runtime-side smoke: every entry in the ordered array is a valid
      // SpacingKey at runtime (the type already guarantees this at compile
      // time, but we re-assert at runtime for defence-in-depth).
      for (const key of SPACING_KEYS_ORDERED) {
        expect(EXPECTED_KEYS).toContain(key);
      }
    });
  });
});
