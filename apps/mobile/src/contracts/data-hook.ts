/**
 * DataHook<T> — minimal async data contract for Python-dependent screens.
 *
 * This is the shared shape returned by every data hook in the navigation shell
 * so that the shell-time `useDummy<T>()` and the Phase 3/4 `usePython<T>()` are
 * interchangeable at call sites. Screens depend on this contract, not on a
 * concrete hook, which lets us swap the dummy implementation for the real
 * Python bridge without touching screen code.
 *
 * Shape:
 *   - `state` — the async lifecycle phase (see `ScreenState`); screens MUST
 *               exhaustively handle 'loading' | 'ready' | 'error'.
 *   - `data`  — the resolved payload, or `null` while `state !== 'ready'`.
 *               Consumers MUST narrow on `state === 'ready'` before reading
 *               `data` as `T`; treat `null` as the absence of a value in every
 *               other state.
 *
 * Conventions:
 *   - Hooks implementing this contract take their input via parameters and
 *     return `DataHook<T>` directly — no extra fields, no callbacks. Extra
 *     surface area belongs in a derived hook, not in this contract.
 *   - The generic parameter `T` is the resolved data shape on success. There
 *     is no separate error payload in the shell; error detail belongs to the
 *     hook's internal logging / telemetry, not to the screen.
 *
 * @example
 *   function ResultScreen(): JSX.Element {
 *     const { state, data } = useDummy<DiagnosisResult>();
 *     if (state === 'loading') return <Skeleton />;
 *     if (state === 'error')   return <ErrorRetry />;
 *     // state === 'ready' → data is non-null here.
 *     return <Result value={data!} />;
 *   }
 */
import type { ScreenState } from './screen-state';

export type DataHook<T> = {
  readonly state: ScreenState;
  readonly data: T | null;
};
