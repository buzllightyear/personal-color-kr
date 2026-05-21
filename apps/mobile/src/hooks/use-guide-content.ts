/**
 * useGuideContent — Phase 3.3 per-screen data hook for the guide tab
 * (Sub-AC 11). Independent of the other 3 post-payment hooks.
 *
 * Phase 4 swap site: `useDummy` → `usePython<GuideView>(season)`.
 */
import type { DataHook } from '../contracts/data-hook';
import type { GuideView, Season } from '../contracts/post-payment-views';
import { GUIDE_VIEWS } from '../fixtures/post-payment-guide-views';
import { useDummy } from './use-dummy';

export function useGuideContent(season: Season): DataHook<GuideView> {
  return useDummy<GuideView>(GUIDE_VIEWS[season]);
}
