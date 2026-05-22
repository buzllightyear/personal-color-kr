/**
 * Phase 3.4 invariant 4/5 — Korean-only assertion on user-visible
 * wording strings.
 *
 * Asserts every user-visible string in RESULT_WORDING_CATALOG
 * (categoryLine + guideLines entries + recommendationLines entries) is
 * free of ASCII letters [A-Za-z]. Enum slugs (`spring-warm`,
 * `affectionate`, etc.) are NOT user-visible and therefore not in scope
 * for this assertion.
 */
import { describe, expect, it } from 'vitest';

import {
  RESULT_WORDING_CATALOG,
  SEASONS,
} from '../src/wording/result-wording-catalog';

const ASCII_LETTER_REGEX = /[A-Za-z]/;

function assertNoAscii(label: string, value: string): void {
  expect(
    ASCII_LETTER_REGEX.test(value),
    `${label} should be Korean-only; got ASCII letters in: "${value}"`,
  ).toBe(false);
}

describe('result-wording catalog — Korean-only assertion (Phase 3.4 invariant 4/5)', () => {
  for (const season of SEASONS) {
    describe(`season=${season}`, () => {
      const entry = RESULT_WORDING_CATALOG[season];

      it('categoryLine has no ASCII letters', () => {
        assertNoAscii(`${season}.categoryLine`, entry.categoryLine);
      });

      it('every guideLines entry has no ASCII letters', () => {
        entry.guideLines.forEach((line, index) => {
          assertNoAscii(`${season}.guideLines[${index}]`, line);
        });
      });

      it('every recommendationLines entry has no ASCII letters', () => {
        entry.recommendationLines.forEach((line, index) => {
          assertNoAscii(`${season}.recommendationLines[${index}]`, line);
        });
      });
    });
  }
});
