/**
 * useDiagnosisContent — Phase 3.3 per-screen data hook for the
 * diagnosis tab (Sub-AC 11).
 *
 * Independent of the other 3 hooks (useEditContent / useGuideContent /
 * useCurationContent). A change to this hook's signature or to its
 * `DiagnosisView` slice type MUST not affect the other 3 — the
 * cross-coupling test in `apps/mobile/tests/post-payment-hook-independence.test.ts`
 * enforces the constraint.
 *
 * Phase 4 swap site: the `useDummy` call below becomes
 * `usePython<DiagnosisView>(season)` — single-line internal change with
 * zero impact on screens (Seed `phase4_portability`).
 */
import type { DataHook } from '../contracts/data-hook';
import type { DiagnosisView, Season } from '../contracts/post-payment-views';
import { DIAGNOSIS_VIEWS } from '../fixtures/post-payment-diagnosis-views';
import { useDummy } from './use-dummy';

/**
 * Resolve the DiagnosisView for a given Season via the existing
 * shell-time DataHook contract. Returns:
 *   - `{ state: 'ready', data: DiagnosisView }` once the fixture
 *     resolves (Phase 3.3 = synchronous);
 *   - `{ state: 'loading', data: null }` is unreachable today but the
 *     contract reserves it for Phase 4's async path.
 */
export function useDiagnosisContent(season: Season): DataHook<DiagnosisView> {
  return useDummy<DiagnosisView>(DIAGNOSIS_VIEWS[season]);
}
