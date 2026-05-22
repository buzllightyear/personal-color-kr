/**
 * Phase 3.4 invariant 2/5 — closed 4-WordingTone enum on the wording
 * catalog.
 *
 * The catalog must expose exactly the 4 voice-tone slugs (affectionate /
 * editorial / playful / poetic), each paired with the canonical Korean
 * label (다정한 / 에디토리얼 / 유쾌한 / 시적인) from Python
 * `WordingTone`. Each season's `tones` tuple must contain every
 * WordingTone exactly once (mirrors Python `FirstCuration.items`
 * "one-of-each" invariant).
 */
import { describe, expect, it } from 'vitest';

import {
  RESULT_WORDING_CATALOG,
  SEASONS,
  WORDING_TONE_LABELS,
  WORDING_TONES,
  type WordingTone,
} from '../src/wording/result-wording-catalog';

const EXPECTED_WORDING_TONES: ReadonlyArray<WordingTone> = [
  'affectionate',
  'editorial',
  'playful',
  'poetic',
];

const EXPECTED_KOREAN_LABELS: Readonly<Record<WordingTone, string>> = {
  affectionate: '다정한',
  editorial: '에디토리얼',
  playful: '유쾌한',
  poetic: '시적인',
};

describe('result-wording catalog — closed 4-WordingTone enum (Phase 3.4 invariant 2/5)', () => {
  it('WORDING_TONES tuple has exactly 4 members', () => {
    expect(WORDING_TONES.length).toBe(4);
    expect([...WORDING_TONES].sort()).toEqual(
      [...EXPECTED_WORDING_TONES].sort(),
    );
  });

  it('WORDING_TONE_LABELS pairs each slug with the canonical Korean label (Python WordingTone.label parity)', () => {
    for (const tone of EXPECTED_WORDING_TONES) {
      expect(WORDING_TONE_LABELS[tone]).toBe(EXPECTED_KOREAN_LABELS[tone]);
    }
  });

  it('every season s tones tuple contains exactly 4 entries — one of each WordingTone (Python FirstCuration invariant)', () => {
    for (const season of SEASONS) {
      const tones = RESULT_WORDING_CATALOG[season].tones;
      expect(tones.length).toBe(4);
      const counts: Record<WordingTone, number> = {
        affectionate: 0,
        editorial: 0,
        playful: 0,
        poetic: 0,
      };
      for (const tone of tones) {
        counts[tone] += 1;
      }
      for (const tone of EXPECTED_WORDING_TONES) {
        expect(counts[tone]).toBe(1);
      }
    }
  });
});
