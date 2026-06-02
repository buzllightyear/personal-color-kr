/**
 * Phase 3.4 invariant 3/5 — non-empty per-season catalog shape.
 *
 * Verifies the runtime shape contract for each ResultWordingEntry:
 *   - categoryLine is a non-empty string
 *   - guideLines is a tuple of exactly 4 non-empty strings
 *     (makeup → outfit → hair → accessory order)
 *   - recommendationLines length >= 6 with all entries non-empty
 *   - tones tuple length === 4 (one-of-each is verified in the closed
 *     WordingTone test)
 */
import { describe, expect, it } from 'vitest';

import { RESULT_WORDING_CATALOG, SEASONS } from '../src/wording/result-wording-catalog';

describe('result-wording catalog — non-empty per-season shape (Phase 3.4 invariant 3/5)', () => {
  for (const season of SEASONS) {
    describe(`season=${season}`, () => {
      const entry = RESULT_WORDING_CATALOG[season];

      it('categoryLine is a non-empty Korean string', () => {
        expect(typeof entry.categoryLine).toBe('string');
        expect(entry.categoryLine.trim().length).toBeGreaterThan(0);
      });

      it('guideLines length === 4 and every line is non-empty', () => {
        expect(entry.guideLines.length).toBe(4);
        for (const line of entry.guideLines) {
          expect(typeof line).toBe('string');
          expect(line.trim().length).toBeGreaterThan(0);
        }
      });

      it('recommendationLines length >= 6 and every line is non-empty', () => {
        expect(entry.recommendationLines.length).toBeGreaterThanOrEqual(6);
        for (const line of entry.recommendationLines) {
          expect(typeof line).toBe('string');
          expect(line.trim().length).toBeGreaterThan(0);
        }
      });

      it('tones tuple length === 4', () => {
        expect(entry.tones.length).toBe(4);
      });
    });
  }
});
