/**
 * useDummy<T> — shell-time implementation of the {@link DataHook} contract.
 *
 * This is the placeholder data hook used by the navigation shell while the
 * real Python bridge (`usePython<T>`) is built in Phase 3/4. Both hooks share
 * the exact same call signature and return shape so screens can swap from
 * `useDummy` to `usePython` without any structural change at the call site:
 *
 *   const { state, data } = useDummy<DiagnosisResult>(seed);
 *   const { state, data } = usePython<DiagnosisResult>(seed); // future
 *
 * Behaviour in the shell:
 *   - When `initial` is non-null, the hook reports `state: 'ready'` and
 *     surfaces the seed value as `data` so screens can render their happy
 *     path against dummy content during shell bring-up.
 *   - When `initial` is null (default), the hook reports `state: 'loading'`
 *     with `data: null`, exercising screens' skeleton / spinner branch.
 *
 * The shell intentionally never returns `state: 'error'`. The error branch
 * exists in the contract for the future `usePython<T>` implementation; screens
 * MUST still handle it exhaustively per the `ScreenState` union.
 *
 * The returned object is memoised on `initial` so consumers can rely on a
 * stable reference across renders without spurious effect re-runs.
 *
 * NOTE: This hook performs no I/O, no fetches, no vendor calls. It is a pure
 * synchronous adapter from a seed value to the {@link DataHook} shape. All
 * real async behaviour lands with `usePython<T>` in Phase 3/4.
 */
import { useMemo } from 'react';

import type { DataHook } from '../contracts/data-hook';

export function useDummy<T>(initial: T | null = null): DataHook<T> {
  return useMemo<DataHook<T>>(
    () => ({
      state: initial === null ? 'loading' : 'ready',
      data: initial,
    }),
    [initial],
  );
}
