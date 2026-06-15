/**
 * Unit tests — editorial design tokens (`theme/editorial.ts`).
 *
 * Pins the additive monochrome / Pretendard layer that the VSCO direction
 * composes from, independently of the legacy `COLORS` / `TYPOGRAPHY` tokens.
 */
import { describe, expect, it } from 'vitest';

import { FONT, INK } from '../src/theme/editorial';

const HEX_6_DIGIT_UPPERCASE = /^#[0-9A-F]{6}$/;

describe('FONT — Pretendard family tokens', () => {
  it('exposes exactly the four registered Pretendard weights', () => {
    expect(Object.keys(FONT).sort()).toEqual([
      'light',
      'medium',
      'regular',
      'semibold',
    ]);
  });

  it('each value is a Pretendard PostScript family name', () => {
    for (const value of Object.values(FONT)) {
      expect(value.startsWith('Pretendard-')).toBe(true);
    }
  });
});

describe('INK — monochrome ramp', () => {
  it('exposes the documented ink tokens', () => {
    expect(Object.keys(INK).sort()).toEqual([
      'faint',
      'line',
      'muted',
      'paper',
      'primary',
      'wash',
    ]);
  });

  it.each(Object.entries(INK))(
    'INK.%s is a valid 6-digit uppercase hex (got %s)',
    (_key, value) => {
      expect(value).toMatch(HEX_6_DIGIT_UPPERCASE);
    },
  );

  it('primary ink is the near-black surface ink (agrees with legacy grayscale.text)', () => {
    expect(INK.primary).toBe('#1A1A1A');
  });
});
