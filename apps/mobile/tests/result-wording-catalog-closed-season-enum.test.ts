/**
 * Phase 3.4 invariant 1/5 — closed 4-Season enum on the wording catalog.
 *
 * The catalog must expose exactly the 4 Korean personal-color season
 * slugs (spring-warm / summer-cool / autumn-warm / winter-cool) — same
 * set Phase 3.1 `_PRESET_TO_PROMPT` bijection, Phase 3.2 diagnose
 * runtime, and Phase 3.3 content hook track. Any drift (extra key,
 * missing key, renamed slug) is a compile-time error AND a runtime
 * assertion failure.
 */
import { describe, expect, it } from 'vitest';

import {
  RESULT_WORDING_CATALOG,
  SEASONS,
  type Season,
} from '../src/wording/result-wording-catalog';

const EXPECTED_SEASONS: ReadonlyArray<Season> = [
  'spring-warm',
  'summer-cool',
  'autumn-warm',
  'winter-cool',
];

describe('result-wording catalog — closed 4-Season enum (Phase 3.4 invariant 1/5)', () => {
  it('SEASONS tuple has exactly 4 members in canonical order', () => {
    expect(SEASONS.length).toBe(4);
    expect([...SEASONS]).toEqual([...EXPECTED_SEASONS]);
  });

  it('RESULT_WORDING_CATALOG key set equals the expected Season set', () => {
    const catalogKeys = Object.keys(RESULT_WORDING_CATALOG).sort();
    const expected = [...EXPECTED_SEASONS].sort();
    expect(catalogKeys).toEqual(expected);
  });

  it('every Season key in RESULT_WORDING_CATALOG carries the correct season field', () => {
    for (const season of EXPECTED_SEASONS) {
      expect(RESULT_WORDING_CATALOG[season].season).toBe(season);
    }
  });
});
