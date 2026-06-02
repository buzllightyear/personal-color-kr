/**
 * `getScanOptions()` — selector that resolves the three scan options for
 * funnel step 6 (`scan_option_select`) directly from the frozen
 * `FUNNEL_SCREENS.scan_option_select` registry entry.
 *
 * Sub-AC 3.1 extraction:
 *   The selector previously lived inline inside `ScanOptionSelectScreen.tsx`
 *   (as `resolveScanOptions()`). Pulling it into its own module lets the
 *   shape of the option list be unit-tested in isolation — without spinning
 *   up `react-test-renderer` and the full `react-native` host-component
 *   mock — and gives any future surface (analytics replay, dev preview,
 *   E2E asserter) a single import to consume.
 *
 * Source of truth:
 *   - `FUNNEL_SCREENS.scan_option_select.metadata.optionCount` — the
 *     authoritative count (3) the selector validates the CTA list against.
 *     The metadata.optionCount === 3 invariant is enforced by the screen
 *     registry exhaustive test in core-ts; this selector additionally
 *     fails loud if a future refactor desynchronises the two.
 *   - `FUNNEL_SCREENS.scan_option_select.ctas` — Korean labels for the
 *     three options ('퍼스널 컬러 진단', '두번째 스캔 (곧 오픈)',
 *     '세번째 스캔 (곧 오픈)').
 *   - `FUNNEL_SCREENS.scan_option_select.metadata.mainScan` — flags which
 *     option is enabled in Phase 2.3 (`personal_color`). All other options
 *     surface the "곧 오픈" treatment.
 *
 * Failure mode:
 *   Every guard throws synchronously at module load (the call site uses
 *   `const SCAN_OPTIONS = getScanOptions()`), so any drift between
 *   metadata + CTAs breaks the build instead of silently rendering the
 *   wrong number of options or the wrong Korean copy.
 */
import { FUNNEL_SCREENS, type FunnelCtaAction } from 'core-ts/funnel';

/**
 * Stable, presentation-ready shape for one scan option card.
 * `key` and `testIdSuffix` are deliberately stable across renders so
 * React reconciliation + E2E assertions never depend on the upstream
 * CTA ordering.
 */
export interface ScanOption {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly testIdSuffix: string;
  readonly action: FunnelCtaAction;
}

const SCREEN = FUNNEL_SCREENS.scan_option_select;

/**
 * Pull the authoritative option count from `metadata.optionCount`.
 * Throws if the metadata field is missing or non-numeric — defensive
 * because `metadata` is typed as `Readonly<Record<string, unknown>>` and
 * the compiler cannot otherwise guarantee the field is a number.
 */
function readOptionCount(): number {
  const raw = SCREEN.metadata.optionCount;
  if (typeof raw !== 'number') {
    throw new Error(
      'FUNNEL_SCREENS.scan_option_select.metadata.optionCount must be a number',
    );
  }
  return raw;
}

/**
 * Returns the three scan option objects for funnel step 6, in the order
 * the screen renders them (primary → secondary slot 2 → secondary slot 3).
 *
 * Contract:
 *   - Length is always exactly `metadata.optionCount` (3 today).
 *   - Index 0 is the enabled '퍼스널 컬러 진단' option whose `action` is
 *     `select_scan_personal_color`.
 *   - Indices 1 and 2 are disabled '두번째 스캔 (곧 오픈)' /
 *     '세번째 스캔 (곧 오픈)' placeholders whose `action` is
 *     `select_scan_secondary` (so analytics can still bucket the press
 *     when/if the UI later wires them up).
 *
 * Immutable: the returned array and every element are frozen so callers
 * cannot mutate the shared snapshot.
 */
export function getScanOptions(): readonly ScanOption[] {
  const expected = readOptionCount();
  const ctas = SCREEN.ctas;
  if (ctas.length !== expected) {
    throw new Error(
      `FUNNEL_SCREENS.scan_option_select expects exactly ${expected} CTAs ` +
        `(got ${ctas.length})`,
    );
  }
  const [primary, secondaryA, secondaryB] = ctas;
  if (primary === undefined || secondaryA === undefined || secondaryB === undefined) {
    throw new Error('FUNNEL_SCREENS.scan_option_select CTAs malformed');
  }
  if (primary.action !== 'select_scan_personal_color') {
    throw new Error(
      `FUNNEL_SCREENS.scan_option_select primary CTA must be ` +
        `select_scan_personal_color (got ${primary.action})`,
    );
  }
  return Object.freeze([
    Object.freeze({
      key: 'personal_color',
      label: primary.label,
      enabled: true,
      testIdSuffix: 'personal-color',
      action: primary.action,
    }),
    Object.freeze({
      key: 'secondary_slot_2',
      label: secondaryA.label,
      enabled: false,
      testIdSuffix: 'secondary-slot-2',
      action: secondaryA.action,
    }),
    Object.freeze({
      key: 'secondary_slot_3',
      label: secondaryB.label,
      enabled: false,
      testIdSuffix: 'secondary-slot-3',
      action: secondaryB.action,
    }),
  ]) satisfies readonly ScanOption[];
}
