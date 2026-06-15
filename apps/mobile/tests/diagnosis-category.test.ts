/**
 * Unit test — `diagnosis-category.ts` (machine-enum → Korean copy mapping).
 *
 * Pins the localized category label and the full `result_reveal` headline so
 * a copy change is an intentional, reviewed diff rather than a silent drift.
 */
import { describe, expect, it } from 'vitest';

import {
  buildResultHeadline,
  formatCategoryKorean,
  SEASON_KOREAN,
  TONE_KOREAN,
} from '../src/diagnosis-category';

describe('formatCategoryKorean', () => {
  it('maps each season + tone to its Korean label', () => {
    expect(formatCategoryKorean('spring', 'warm')).toBe('봄 웜톤');
    expect(formatCategoryKorean('summer', 'cool')).toBe('여름 쿨톤');
    expect(formatCategoryKorean('autumn', 'warm')).toBe('가을 웜톤');
    expect(formatCategoryKorean('winter', 'cool')).toBe('겨울 쿨톤');
  });

  it('exposes the four seasons and two tones', () => {
    expect(Object.keys(SEASON_KOREAN).sort()).toEqual([
      'autumn',
      'spring',
      'summer',
      'winter',
    ]);
    expect(Object.keys(TONE_KOREAN).sort()).toEqual(['cool', 'warm']);
  });
});

describe('buildResultHeadline', () => {
  it('wraps the category in the ✦ decoration matching the static teaser', () => {
    expect(buildResultHeadline('autumn', 'warm')).toBe(
      '당신의 카테고리는 ✦ 가을 웜톤 ✦',
    );
    expect(buildResultHeadline('summer', 'cool')).toBe(
      '당신의 카테고리는 ✦ 여름 쿨톤 ✦',
    );
  });
});
