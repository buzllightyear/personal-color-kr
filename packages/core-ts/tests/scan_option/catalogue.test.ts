/**
 * Unit tests — `scan_option` catalogue invariants.
 *
 * The canonical 3-option catalogue must:
 *   - Have exactly SCAN_OPTION_COUNT entries.
 *   - Hold `personal_color` as the lone main entry at slot 1.
 *   - Hold two `phase_n_tbd` placeholders at slots 2 and 3.
 *   - Be deeply frozen and identity-stable across calls.
 *   - Pass `validateScanOptionCatalogue` cleanly (single source of truth).
 */
import { describe, expect, it } from 'vitest';

import {
  MAIN_SCAN_ID,
  SCAN_OPTION_COUNT,
} from '../../src/scan_option/types.js';
import {
  SCAN_OPTION_CATALOGUE,
  SCAN_OPTION_CATALOGUE_SIZE,
  getMainScanOption,
  getScanOptions,
  getSecondaryScanOptions,
} from '../../src/scan_option/catalogue.js';
import {
  validateScanOptionCatalogue,
} from '../../src/scan_option/schema.js';

describe('SCAN_OPTION_CATALOGUE — structural invariants', () => {
  it(`contains exactly ${SCAN_OPTION_COUNT} entries`, () => {
    expect(SCAN_OPTION_CATALOGUE).toHaveLength(SCAN_OPTION_COUNT);
    expect(SCAN_OPTION_CATALOGUE_SIZE).toBe(SCAN_OPTION_COUNT);
  });

  it('is deeply frozen (top-level array + each entry)', () => {
    expect(Object.isFrozen(SCAN_OPTION_CATALOGUE)).toBe(true);
    for (const opt of SCAN_OPTION_CATALOGUE) {
      expect(Object.isFrozen(opt)).toBe(true);
    }
  });

  it('orders entries by slot 1 → 2 → 3', () => {
    SCAN_OPTION_CATALOGUE.forEach((opt, idx) => {
      expect(opt.slot).toBe(idx + 1);
    });
  });

  it('passes the catalogue schema validator cleanly', () => {
    const result = validateScanOptionCatalogue(SCAN_OPTION_CATALOGUE);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      // Surface the issues for easier triage if this ever regresses.
      console.error(result.errors);
    }
  });
});

describe('SCAN_OPTION_CATALOGUE — main / secondary semantics', () => {
  it(`has exactly one main entry with id === "${MAIN_SCAN_ID}" at slot 1`, () => {
    const mains = SCAN_OPTION_CATALOGUE.filter((o) => o.role === 'main');
    expect(mains).toHaveLength(1);
    expect(mains[0]?.id).toBe(MAIN_SCAN_ID);
    expect(mains[0]?.slot).toBe(1);
    expect(mains[0]?.status).toBe('available');
    expect(mains[0]?.placeholder).toBe(false);
  });

  it('has two secondary placeholders at slots 2 and 3', () => {
    const secondaries = SCAN_OPTION_CATALOGUE.filter(
      (o) => o.role === 'secondary',
    );
    expect(secondaries).toHaveLength(2);
    expect(secondaries.map((o) => o.slot).sort()).toEqual([2, 3]);
    for (const s of secondaries) {
      expect(s.status).toBe('phase_n_tbd');
      expect(s.placeholder).toBe(true);
    }
  });
});

describe('accessor helpers', () => {
  it('getScanOptions returns the frozen catalogue singleton', () => {
    const a = getScanOptions();
    const b = getScanOptions();
    expect(a).toBe(b);
    expect(a).toBe(SCAN_OPTION_CATALOGUE);
  });

  it('getMainScanOption returns the personal-color main entry', () => {
    const main = getMainScanOption();
    expect(main.id).toBe(MAIN_SCAN_ID);
    expect(main.role).toBe('main');
    expect(main.slot).toBe(1);
  });

  it('getSecondaryScanOptions returns the two placeholders frozen', () => {
    const sec = getSecondaryScanOptions();
    expect(sec).toHaveLength(2);
    expect(Object.isFrozen(sec)).toBe(true);
    expect(sec.every((o) => o.role === 'secondary')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 6.2 — `getScanOptions()` service-function contract
//
// Seed (Sub-AC 6.2):
//   "스캔 옵션 목록 반환 서비스 함수 — getScanOptions()가
//    정확히 3개 옵션과 메인=퍼스널 컬러를 반환하는지 단위 테스트"
//
// These assertions intentionally bypass `SCAN_OPTION_CATALOGUE`,
// `getMainScanOption`, and `getSecondaryScanOptions` so the **service
// function alone** is verified against the contract — a regression in any
// helper used elsewhere can't mask a regression in `getScanOptions()` itself.
// ---------------------------------------------------------------------------
describe('getScanOptions() — Sub-AC 6.2 contract', () => {
  it('returns exactly 3 options (SCAN_OPTION_COUNT)', () => {
    const options = getScanOptions();
    // Explicit literal `3` mirrors the Sub-AC wording verbatim.
    expect(options).toHaveLength(3);
    // Also pin to the named constant so the count stays in lock-step
    // if SCAN_OPTION_COUNT is ever (illegally) edited.
    expect(options).toHaveLength(SCAN_OPTION_COUNT);
    expect(SCAN_OPTION_COUNT).toBe(3);
  });

  it('returns exactly one main option, and it is "personal_color"', () => {
    const options = getScanOptions();
    const mains = options.filter((opt) => opt.role === 'main');

    // "정확히 ... 메인=퍼스널 컬러" → exactly one main, id = personal_color.
    expect(mains).toHaveLength(1);
    expect(mains[0]?.id).toBe('personal_color');
    expect(mains[0]?.id).toBe(MAIN_SCAN_ID);
  });

  it('returns the main option in the first slot with hook-grade Korean label', () => {
    const options = getScanOptions();
    const main = options.find((opt) => opt.role === 'main');

    // Defence-in-depth: the hook label must surface "퍼스널 컬러" copy so
    // Step 6 UI cannot accidentally render a non-hook CTA in the main slot.
    expect(main).toBeDefined();
    expect(main?.slot).toBe(1);
    expect(main?.status).toBe('available');
    expect(main?.placeholder).toBe(false);
    expect(main?.displayLabelKo).toContain('퍼스널 컬러');
  });

  it('returns 2 non-main (secondary placeholder) options alongside the main', () => {
    const options = getScanOptions();
    const nonMain = options.filter((opt) => opt.role !== 'main');

    // 3 total − 1 main = 2 secondary placeholders.
    expect(nonMain).toHaveLength(2);
    expect(nonMain.every((opt) => opt.role === 'secondary')).toBe(true);
    expect(nonMain.every((opt) => opt.id !== MAIN_SCAN_ID)).toBe(true);
  });

  it('return value is stable & frozen — safe for repeated reads', () => {
    const first = getScanOptions();
    const second = getScanOptions();

    expect(first).toBe(second); // identity-stable singleton
    expect(Object.isFrozen(first)).toBe(true);
    for (const opt of first) {
      expect(Object.isFrozen(opt)).toBe(true);
    }
  });
});
