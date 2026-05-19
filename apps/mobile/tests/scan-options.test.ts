/**
 * Unit test — `getScanOptions()` selector (Sub-AC 3.1).
 *
 * The selector lives in `apps/mobile/src/funnel/scan-options.ts` and resolves
 * the three scan-option cards rendered by step 6 (`scan_option_select`).
 * Pulling the selector into its own module — rather than leaving it inline
 * inside `ScanOptionSelectScreen.tsx` — lets us assert the option shape
 * without `react-test-renderer` or the `react-native` host-component mock.
 *
 * Coverage:
 *   1. Length is exactly 3 and matches
 *      `FUNNEL_SCREENS.scan_option_select.metadata.optionCount`.
 *   2. Each option carries the Korean label sourced from the
 *      corresponding CTA in `FUNNEL_SCREENS.scan_option_select.ctas`
 *      (primary: '퍼스널 컬러 진단', slot 2: '두번째 스캔 (곧 오픈)',
 *      slot 3: '세번째 스캔 (곧 오픈)').
 *   3. The primary option is `enabled: true` and the two secondary
 *      options are `enabled: false` (the "곧 오픈" treatment).
 *   4. Option keys / testIdSuffixes are stable
 *      ('personal_color' / 'personal-color', 'secondary_slot_2' /
 *      'secondary-slot-2', 'secondary_slot_3' / 'secondary-slot-3').
 *   5. Each option carries the upstream `FunnelCtaAction` so analytics
 *      can bucket presses by their semantic action.
 *   6. The returned array and elements are frozen (no in-place mutation
 *      possible).
 *
 * No `react-native` mock is needed — the selector imports purely from
 * `core-ts/funnel` (a frozen registry) and has no UI surface.
 */
import { describe, expect, it } from 'vitest';

import { FUNNEL_SCREENS } from 'core-ts/funnel';
import { getScanOptions } from '../src/funnel/scan-options';

describe('getScanOptions — shape and source-of-truth alignment', () => {
  it('returns exactly metadata.optionCount === 3 options', () => {
    const expectedCount = FUNNEL_SCREENS.scan_option_select.metadata.optionCount;
    expect(expectedCount).toBe(3);
    const options = getScanOptions();
    expect(options).toHaveLength(3);
    expect(options.length).toBe(expectedCount);
  });

  it('sources Korean labels from FUNNEL_SCREENS.scan_option_select.ctas', () => {
    const options = getScanOptions();
    expect(options[0]?.label).toBe('퍼스널 컬러 진단');
    expect(options[1]?.label).toBe('두번째 스캔 (곧 오픈)');
    expect(options[2]?.label).toBe('세번째 스캔 (곧 오픈)');
  });

  it('flags the primary option as enabled and the two secondary options as disabled', () => {
    const options = getScanOptions();
    expect(options[0]?.enabled).toBe(true);
    expect(options[1]?.enabled).toBe(false);
    expect(options[2]?.enabled).toBe(false);
    // Exactly one enabled option = exactly one "곧 오픈"-free card.
    const enabledCount = options.filter((o) => o.enabled).length;
    const disabledCount = options.filter((o) => !o.enabled).length;
    expect(enabledCount).toBe(1);
    expect(disabledCount).toBe(2);
  });

  it('uses stable option keys and testIdSuffixes', () => {
    const options = getScanOptions();
    expect(options[0]?.key).toBe('personal_color');
    expect(options[0]?.testIdSuffix).toBe('personal-color');
    expect(options[1]?.key).toBe('secondary_slot_2');
    expect(options[1]?.testIdSuffix).toBe('secondary-slot-2');
    expect(options[2]?.key).toBe('secondary_slot_3');
    expect(options[2]?.testIdSuffix).toBe('secondary-slot-3');
  });

  it('carries the upstream FunnelCtaAction on every option', () => {
    const options = getScanOptions();
    expect(options[0]?.action).toBe('select_scan_personal_color');
    expect(options[1]?.action).toBe('select_scan_secondary');
    expect(options[2]?.action).toBe('select_scan_secondary');
  });

  it('freezes the returned array and its option objects', () => {
    const options = getScanOptions();
    expect(Object.isFrozen(options)).toBe(true);
    for (const option of options) {
      expect(Object.isFrozen(option)).toBe(true);
    }
  });

  it('returns equivalent snapshots across calls (idempotent)', () => {
    const a = getScanOptions();
    const b = getScanOptions();
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]?.key).toBe(b[i]?.key);
      expect(a[i]?.label).toBe(b[i]?.label);
      expect(a[i]?.enabled).toBe(b[i]?.enabled);
      expect(a[i]?.action).toBe(b[i]?.action);
      expect(a[i]?.testIdSuffix).toBe(b[i]?.testIdSuffix);
    }
  });
});
