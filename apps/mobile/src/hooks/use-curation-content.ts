/**
 * useCurationContent — Phase 3.3 per-screen data hook for the curation
 * tab (Sub-AC 11). Independent of the other 3 post-payment hooks.
 *
 * Phase 4 swap site: `useDummy` → `usePython<CurationView>(season)`.
 */
import type { DataHook } from '../contracts/data-hook';
import type { CurationView, Season } from '../contracts/post-payment-views';
import { CURATION_VIEWS } from '../fixtures/post-payment-curation-views';
import { useDummy } from './use-dummy';

export function useCurationContent(season: Season): DataHook<CurationView> {
  return useDummy<CurationView>(CURATION_VIEWS[season]);
}
