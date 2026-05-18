/**
 * useAutoAdvanceTimer — fire-once auto-advance timer with cleanup.
 *
 * Shared timer hook used by funnel screens that auto-advance after a fixed
 * delay with no user-interactive button (e.g. step 5 `fake_loader`, step 8
 * `fake_scan_animation`). The hook schedules a single `setTimeout` on mount
 * (or when the latched dependencies change) and **guarantees the timer is
 * cleared on unmount** so a callback cannot fire on an unmounted component
 * — the canonical React leak that causes "Can't perform a state update on
 * an unmounted component" warnings.
 *
 * Contract:
 *   - `durationMs` — non-negative integer millisecond delay. Hardcoded by
 *                    callers to match `core-ts` screens metadata (e.g. 5_000
 *                    for `fake_loader`). The hook does NOT default this value;
 *                    callers must own the source of truth.
 *   - `onElapsed`  — callback fired exactly once after `durationMs`. Captured
 *                    in a ref so callers can pass an inline arrow without
 *                    re-scheduling the timer every render (React's stable
 *                    identity escape hatch). If the component unmounts before
 *                    the timer fires, the callback is NOT invoked.
 *   - `enabled`    — optional flag (default `true`) that skips scheduling
 *                    entirely when `false`. Allows callers to gate the timer
 *                    on a precondition (e.g. context readiness) without
 *                    conditionally calling the hook (rules-of-hooks).
 *
 * Cleanup semantics:
 *   The returned `useEffect` registers a cleanup function that calls
 *   `clearTimeout` on the scheduled handle. React invokes this cleanup on
 *   unmount AND before re-running the effect when `durationMs` / `enabled`
 *   change, so the latched timer is always paired with exactly one
 *   `clearTimeout` call regardless of which lifecycle path runs.
 *
 * Why a custom hook (not inline `useEffect` per screen):
 *   - DRY across the 2+ auto-advance screens (fake_loader, fake_scan_animation).
 *   - Pins the cleanup pattern in one tested location so a future screen
 *     cannot reintroduce the unmounted-callback leak.
 *   - Keeps screen files thin wrappers per the Phase 2.1 architecture
 *     (route file → presentational component → hook).
 *
 * Non-goals (out of scope):
 *   - No pause/resume / no progress reporting — fake_loader has no progress
 *     bar in MVP, just `<ActivityIndicator />`. If a future screen needs a
 *     progress tick, add a separate `useProgressTimer` hook.
 *   - No `setInterval` — the funnel only ever needs a single fire-once
 *     auto-advance. `setInterval` would require additional cleanup discipline
 *     we deliberately avoid here.
 *
 * @example
 *   function FakeLoaderScreen({ onNext }: { onNext: () => void }) {
 *     useAutoAdvanceTimer({ durationMs: 5_000, onElapsed: onNext });
 *     return <ActivityIndicator />;
 *   }
 */
import { useEffect, useRef } from 'react';

export interface UseAutoAdvanceTimerOptions {
  /** Millisecond delay before `onElapsed` fires. Caller-supplied — no default. */
  readonly durationMs: number;
  /** Callback fired exactly once after `durationMs` (skipped if unmounted first). */
  readonly onElapsed: () => void;
  /** When `false`, no timer is scheduled. Defaults to `true`. */
  readonly enabled?: boolean;
}

/**
 * Schedule a one-shot timer that fires `onElapsed` after `durationMs` and
 * cleans up on unmount or dependency change. Returns nothing — the timer
 * handle is intentionally private so callers cannot mutate it.
 *
 * @see UseAutoAdvanceTimerOptions
 */
export function useAutoAdvanceTimer(options: UseAutoAdvanceTimerOptions): void {
  const { durationMs, onElapsed, enabled = true } = options;

  // Latch the latest callback in a ref so the effect doesn't re-schedule the
  // timer on every render just because the caller passed an inline arrow.
  // The effect reads `onElapsedRef.current` at fire time, picking up the
  // newest closure without restarting the countdown.
  const onElapsedRef = useRef<() => void>(onElapsed);
  useEffect(() => {
    onElapsedRef.current = onElapsed;
  }, [onElapsed]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handle = setTimeout(() => {
      onElapsedRef.current();
    }, durationMs);

    // Cleanup: React invokes this on unmount AND before re-running the
    // effect when `durationMs` or `enabled` change. Pairing exactly one
    // setTimeout with exactly one clearTimeout per effect run is the
    // canonical leak-free pattern.
    return () => {
      clearTimeout(handle);
    };
  }, [durationMs, enabled]);
}
