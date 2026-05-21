/**
 * useEditContent — Phase 3.3 per-screen data hook for the edit tab
 * (Sub-AC 11). Independent of the other 3 post-payment hooks.
 *
 * Phase 4 swap site: `useDummy` → `usePython<EditView>(season)`.
 */
import type { DataHook } from '../contracts/data-hook';
import type { EditView, Season } from '../contracts/post-payment-views';
import { EDIT_VIEWS } from '../fixtures/post-payment-edit-views';
import { useDummy } from './use-dummy';

export function useEditContent(season: Season): DataHook<EditView> {
  return useDummy<EditView>(EDIT_VIEWS[season]);
}
