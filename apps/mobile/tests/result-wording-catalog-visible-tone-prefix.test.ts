/**
 * Phase 3.4 invariant 5/5 (interview Q3=A) — visible WordingTone prefix
 * on recommendation item lines.
 *
 * Mirrors Python `_format_recommendation_item` which produces
 *
 *     "({tone label}) {kind label} · {title} — {blurb}"
 *
 * The TS catalog must encode the same visible prefix on lines index 2..5
 * of every season's recommendationLines. Each of the 4 Korean tone
 * labels (다정한 / 에디토리얼 / 유쾌한 / 시적인) must appear exactly
 * once across those 4 lines — that is the "톤 혼합" (tone-mix) surface
 * the curation screen renders.
 */
import { describe, expect, it } from 'vitest';

import {
  RESULT_WORDING_CATALOG,
  SEASONS,
  WORDING_TONE_LABELS,
} from '../src/wording/result-wording-catalog';

const KOREAN_TONE_LABELS = [
  WORDING_TONE_LABELS.affectionate,
  WORDING_TONE_LABELS.editorial,
  WORDING_TONE_LABELS.playful,
  WORDING_TONE_LABELS.poetic,
] as const;

// Visible prefix shape — opening paren, one of the 4 tone labels,
// closing paren, single space, kind label (Korean text + optional spaces),
// space + middle dot + space.
const VISIBLE_PREFIX_REGEX = /^\((다정한|에디토리얼|유쾌한|시적인)\) [가-힣 ]+ · /;

describe('result-wording catalog — visible WordingTone prefix on recommendation item lines (Phase 3.4 invariant 5/5)', () => {
  for (const season of SEASONS) {
    describe(`season=${season}`, () => {
      const itemLines = RESULT_WORDING_CATALOG[season].recommendationLines.slice(2, 6);

      it('extracts exactly 4 item lines (indices 2..5)', () => {
        expect(itemLines.length).toBe(4);
      });

      it('every item line matches the visible-prefix format', () => {
        itemLines.forEach((line, index) => {
          expect(
            VISIBLE_PREFIX_REGEX.test(line),
            `${season}.recommendationLines[${index + 2}] does not match visible WordingTone prefix: "${line}"`,
          ).toBe(true);
        });
      });

      it('each Korean tone label appears exactly once across the 4 item lines (4-voice mix invariant)', () => {
        const counts = new Map<string, number>();
        for (const label of KOREAN_TONE_LABELS) {
          counts.set(label, 0);
        }
        for (const line of itemLines) {
          for (const label of KOREAN_TONE_LABELS) {
            if (line.startsWith(`(${label}) `)) {
              counts.set(label, (counts.get(label) ?? 0) + 1);
            }
          }
        }
        for (const label of KOREAN_TONE_LABELS) {
          expect(counts.get(label)).toBe(1);
        }
      });
    });
  }
});
