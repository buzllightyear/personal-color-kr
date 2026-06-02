/**
 * SCAN_OPTION_CATALOGUE — frozen 3-option list rendered on funnel Step 6.
 *
 * Single source of truth for the scan options.  Step 6's screen renderer
 * (`src/funnel/screens.ts`) reads from here so wording, role assignment,
 * and slot ordering stay synchronised across the funnel UI + analytics +
 * any future personalisation layer.
 *
 * Catalogue invariants (also enforced by `validateScanOptionCatalogue`):
 *   - Exactly `SCAN_OPTION_COUNT` (= 3) entries.
 *   - Exactly one `main` role, with `id === MAIN_SCAN_ID` (`personal_color`).
 *   - Slots {1, 2, 3} are each used exactly once; main occupies slot 1.
 *   - Secondary entries are `phase_n_tbd` placeholders.
 *   - All entries (and the array itself) are frozen.
 */
import { MAIN_SCAN_ID, SCAN_OPTION_COUNT, type ScanOption } from './types.js';

/**
 * The 3 canonical scan options, in CTA-render order (slot 1 → 2 → 3).
 *
 * Korean copy is intentionally short — Step 6 lists each option as a CTA
 * button.  Placeholder labels include "(곧 오픈)" to signal Phase-N status.
 */
export const SCAN_OPTION_CATALOGUE: readonly ScanOption[] = Object.freeze([
  Object.freeze({
    id: MAIN_SCAN_ID,
    role: 'main',
    slot: 1,
    status: 'available',
    displayLabelKo: '퍼스널 컬러 진단',
    placeholder: false,
  }) satisfies ScanOption,
  Object.freeze({
    id: 'scan_slot_2',
    role: 'secondary',
    slot: 2,
    status: 'phase_n_tbd',
    displayLabelKo: '두번째 스캔 (곧 오픈)',
    placeholder: true,
  }) satisfies ScanOption,
  Object.freeze({
    id: 'scan_slot_3',
    role: 'secondary',
    slot: 3,
    status: 'phase_n_tbd',
    displayLabelKo: '세번째 스캔 (곧 오픈)',
    placeholder: true,
  }) satisfies ScanOption,
]);

/**
 * Returns the frozen 3-option scan catalogue.
 * The returned array is `===` identical on every call (frozen singleton).
 */
export function getScanOptions(): readonly ScanOption[] {
  return SCAN_OPTION_CATALOGUE;
}

/**
 * Returns the single main scan option (퍼스널 컬러 진단).
 * Throws if the catalogue is malformed — a Seed-violation that should never
 * survive code review, but guarded here for defence-in-depth.
 */
export function getMainScanOption(): ScanOption {
  const main = SCAN_OPTION_CATALOGUE.find((opt) => opt.role === 'main');
  if (!main) {
    throw new Error('SCAN_OPTION_CATALOGUE is missing a main entry — Seed violation.');
  }
  return main;
}

/**
 * Returns the two secondary (placeholder) scan options, in slot order.
 */
export function getSecondaryScanOptions(): readonly ScanOption[] {
  return Object.freeze(SCAN_OPTION_CATALOGUE.filter((opt) => opt.role === 'secondary'));
}

/**
 * Compile-time check helper: the catalogue length matches the constant.
 * (Mostly a documentation aid — actual enforcement lives in `./schema.ts`.)
 */
export const SCAN_OPTION_CATALOGUE_SIZE: typeof SCAN_OPTION_COUNT = SCAN_OPTION_COUNT;
