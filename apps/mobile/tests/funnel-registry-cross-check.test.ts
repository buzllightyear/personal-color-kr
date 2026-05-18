/**
 * 4중 정합 cross-check — AC 2 + AC 4.
 *
 * Pins the four sources-of-truth in the funnel registry chain at the
 * same 12 entries in the same canonical order:
 *
 *   1. `FUNNEL_STEPS_ORDERED`  (core-ts/funnel/types.ts, snake_case)
 *   2. `FUNNEL_KEBAB_SLUGS_ORDERED`  (mobile/src/linking.config.ts)
 *   3. The 12 file routes under `apps/mobile/app/(funnel)/<kebab>.tsx`
 *      (registry completeness — every snake_case id has a matching file)
 *   4. The `LINKING_CONFIG.screens['(funnel)'].screens` entries
 *
 * A drift in any of the four — a rename in core-ts that doesn't
 * propagate to files, a stale `(funnel)/_layout.tsx` registration, a
 * missing `linking.config.ts` entry — surfaces as a single failing
 * assertion here rather than as a runtime 404 in the Expo Router stack.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FUNNEL_STEPS_ORDERED, TOTAL_FUNNEL_STEPS } from 'core-ts/funnel/types';

import {
  FUNNEL_KEBAB_SLUGS,
  FUNNEL_KEBAB_SLUGS_ORDERED,
  LINKING_CONFIG,
  TOTAL_FUNNEL_KEBAB_ROUTES,
  toKebabSlug,
} from '../src/linking.config';

const FUNNEL_ROUTE_DIR = path.resolve(__dirname, '..', 'app', '(funnel)');

function listFunnelKebabFiles(): readonly string[] {
  const entries = fs.readdirSync(FUNNEL_ROUTE_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
    .filter((e) => !e.name.startsWith('_')) // exclude _layout.tsx, _guards.ts
    .map((e) => e.name.replace(/\.tsx$/, ''))
    .sort();
}

describe('funnel registry — 4중 정합 cross-check (AC 2 + AC 4)', () => {
  it('FUNNEL_STEPS_ORDERED has exactly 12 entries', () => {
    expect(FUNNEL_STEPS_ORDERED).toHaveLength(TOTAL_FUNNEL_STEPS);
    expect(TOTAL_FUNNEL_STEPS).toBe(12);
  });

  it('FUNNEL_KEBAB_SLUGS_ORDERED is the kebab transform of FUNNEL_STEPS_ORDERED in the same order', () => {
    const expected = FUNNEL_STEPS_ORDERED.map((id) => toKebabSlug(id));
    expect(FUNNEL_KEBAB_SLUGS_ORDERED).toEqual(expected);
  });

  it('TOTAL_FUNNEL_KEBAB_ROUTES equals TOTAL_FUNNEL_STEPS (12)', () => {
    expect(TOTAL_FUNNEL_KEBAB_ROUTES).toBe(TOTAL_FUNNEL_STEPS);
  });

  it('apps/mobile/app/(funnel)/ contains exactly 12 kebab .tsx files (registry completeness)', () => {
    const files = listFunnelKebabFiles();
    const expected = [...FUNNEL_KEBAB_SLUGS_ORDERED].sort();
    expect(files).toEqual(expected);
  });

  it('every FunnelStepId has a corresponding (funnel)/<kebab>.tsx file', () => {
    const files = new Set(listFunnelKebabFiles());
    for (const id of FUNNEL_STEPS_ORDERED) {
      const slug = FUNNEL_KEBAB_SLUGS[id];
      expect(files.has(slug)).toBe(true);
    }
  });

  it('LINKING_CONFIG funnel screens block has exactly the 12 kebab entries (key === value)', () => {
    const screens = LINKING_CONFIG.screens['(funnel)'].screens;
    const keys = Object.keys(screens).sort();
    const expected = [...FUNNEL_KEBAB_SLUGS_ORDERED].sort();
    expect(keys).toEqual(expected);
    for (const [key, value] of Object.entries(screens)) {
      expect(value).toBe(key);
    }
  });

  it('no stray step-N.tsx legacy v0.1 files remain in (funnel)/', () => {
    const entries = fs.readdirSync(FUNNEL_ROUTE_DIR);
    const legacy = entries.filter((name) => /^step-\d+\.tsx$/.test(name));
    expect(legacy).toEqual([]);
  });
});
