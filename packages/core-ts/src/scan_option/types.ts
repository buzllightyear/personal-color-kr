/**
 * ScanOption — Step 6 (`scan_option_select`) data model.
 *
 * Ontology concept (Seed): `scan_option [array]`
 *   - 단계 6 스캔 종류 3개 옵션
 *   - 메인 = 퍼스널 컬러 진단 (입구 hook)
 *   - 보조 2개 = post-seed/build phase 결정 (placeholder, Phase-N TBD)
 *
 * Seed constraints honoured here:
 *   - 퍼스널 컬러 진단 = hook only (constraint #1)
 *     ⇒ exactly one `main` role; it must be the `personal_color` scan.
 *   - AR 메이크업 try-on 보류 (constraint #7)
 *     ⇒ neither placeholder slot may declare `ar_makeup_try_on` as a status.
 *   - The catalogue is fixed at 3 options (no more, no fewer) so Step 6
 *     of the funnel always renders 3 CTAs (see `src/funnel/screens.ts`).
 *
 * Immutability: types are `readonly`; concrete instances are deeply frozen by
 * the catalogue module.  Validators in `./schema.ts` never mutate input.
 *
 * This file contains TYPES + CONSTANTS only.  No runtime behaviour beyond
 * pure value declarations — safe to import from anywhere.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * Stable identifier for each of the 3 scan options.
 *
 * `personal_color` is the canonical entry hook and must occupy the main slot.
 * `scan_slot_2` / `scan_slot_3` are deliberately generic placeholders — they
 * are filled in at the post-seed / build phase (Seed constraint defers the
 * choice).  Renaming a placeholder slot is a SAFE refactor; reassigning
 * `personal_color` to a non-main role is a Seed-violation.
 */
export type ScanOptionId = 'personal_color' | 'scan_slot_2' | 'scan_slot_3';

/**
 * Role of a scan option inside the catalogue.
 *
 * `main`      — primary CTA on Step 6, drives the entire 12-step funnel.
 * `secondary` — placeholder slots reserved for Phase-N expansion.
 */
export type ScanOptionRole = 'main' | 'secondary';

/**
 * Availability status of a scan option.
 *
 * `available`   — fully built, usable today.
 * `phase_n_tbd` — placeholder, decision deferred to post-seed phase.
 */
export type ScanOptionStatus = 'available' | 'phase_n_tbd';

/**
 * Slot index — the visual ordering on Step 6's CTA stack.
 *
 * Slot 1 must always be the main scan (personal_color).
 * Slots 2 & 3 are the secondary placeholders.
 */
export type ScanOptionSlot = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// ScanOption record
// ---------------------------------------------------------------------------

/**
 * One scan option entry.
 *
 * Field invariants (validated by `./schema.ts`):
 *   - `id === 'personal_color'`  ⇒  `role === 'main'`,  `slot === 1`,
 *                                   `status === 'available'`,
 *                                   `placeholder === false`.
 *   - `id !== 'personal_color'`  ⇒  `role === 'secondary'`,  `slot ∈ {2,3}`,
 *                                   `status === 'phase_n_tbd'`,
 *                                   `placeholder === true`.
 *   - `displayLabelKo` non-empty and contains at least one Hangul codepoint.
 */
export interface ScanOption {
  readonly id: ScanOptionId;
  readonly role: ScanOptionRole;
  readonly slot: ScanOptionSlot;
  readonly status: ScanOptionStatus;
  readonly displayLabelKo: string;
  readonly placeholder: boolean;
}

// ---------------------------------------------------------------------------
// Compile-time constants
// ---------------------------------------------------------------------------

/** Fixed total option count for Step 6 — never 2 or 4, always 3. */
export const SCAN_OPTION_COUNT = 3 as const;

/** Allowed slot values, in canonical CTA-render order. */
export const SCAN_OPTION_SLOTS: readonly ScanOptionSlot[] = [1, 2, 3] as const;

/** All legal `ScanOptionId` values, in catalogue order. */
export const SCAN_OPTION_IDS: readonly ScanOptionId[] = [
  'personal_color',
  'scan_slot_2',
  'scan_slot_3',
] as const;

/** All legal `ScanOptionRole` values. */
export const SCAN_OPTION_ROLES: readonly ScanOptionRole[] = [
  'main',
  'secondary',
] as const;

/** All legal `ScanOptionStatus` values. */
export const SCAN_OPTION_STATUSES: readonly ScanOptionStatus[] = [
  'available',
  'phase_n_tbd',
] as const;

/** The single canonical main-scan id (Seed: 퍼스널 컬러 진단 = hook only). */
export const MAIN_SCAN_ID: ScanOptionId = 'personal_color';
