/**
 * `requestStoreReview` — single native-module seam for the
 * `expo-store-review` SDK (rating-gate funnel step).
 *
 * Purpose:
 *   This module is the ONLY file in the apps/mobile workspace that imports
 *   from `expo-store-review`. Every other consumer (the rating-gate route
 *   variants, their tests) talks to the store-review SDK exclusively
 *   through {@link requestStoreReview}. This mirrors the Phase 2.5 Superwall
 *   precedent (`src/superwall/client.ts`): one wrapper file owns the native
 *   import so vitest can substitute the whole surface without resolving the
 *   native package, and a future SDK breaking change is adapted here rather
 *   than at every call site.
 *
 * Fire-and-forget contract (load-bearing):
 *   The native review prompt (`SKStoreReviewController` on iOS, the Play
 *   In-App Review API on Android) is rate-limited and may silently no-op —
 *   Apple/Google decide whether the dialog actually appears. The funnel
 *   MUST NOT block navigation on the prompt's presentation or outcome.
 *   Therefore:
 *     - `isAvailableAsync()` IS awaited (a cheap capability probe) so the
 *       returned {@link StoreReviewOutcome} can report `available` accurately
 *       for analytics.
 *     - `requestReview()` is NEVER awaited. It is dispatched as a detached
 *       promise whose rejection is caught and swallowed. The helper returns
 *       immediately after dispatch so the caller can navigate forward.
 *
 * Error-resilience contract:
 *   The helper swallows ALL exceptions internally — a throwing
 *   `isAvailableAsync()`, a synchronously-throwing `requestReview()`, and an
 *   async-rejecting `requestReview()` are each caught here. Callers never
 *   handle store-review errors; they receive a well-formed
 *   {@link StoreReviewOutcome} on every path. This keeps the rating-gate
 *   navigation linear and unconditional.
 *
 * Observability:
 *   `__DEV__`-gated `console.warn` breadcrumbs surface the dispatch status
 *   (dispatched / unavailable / error-swallowed) for simulator and
 *   TestFlight debugging. Production builds (`__DEV__ === false`) emit
 *   nothing — no `console.log`, no user-visible side effect.
 *
 * What this wrapper does NOT do:
 *   - It does NOT emit PostHog analytics. The rating-gate route variants own
 *     the `rating_prompt_completed` / `rating_prompt_skipped` capture via
 *     the `track-rating-prompt-*` placeholders, using the
 *     {@link StoreReviewOutcome} this helper returns as the payload source.
 *   - It does NOT persist a "review already attempted" flag. Re-display
 *     suppression via AsyncStorage/MMKV is explicitly deferred — the OS
 *     already rate-limits the native prompt.
 *   - It does NOT navigate. Navigation is the route file's responsibility
 *     and is intentionally decoupled from this helper's result.
 */
import * as StoreReview from 'expo-store-review';
import { Platform } from 'react-native';

/**
 * Narrowed `Platform.OS` value carried on every {@link StoreReviewOutcome}.
 *
 * `Platform.OS` is a wide union (`'ios' | 'android' | 'windows' | 'macos' |
 * 'web'`); the rating gate only meaningfully distinguishes the two native
 * store surfaces, so every non-iOS/Android platform collapses to `'other'`.
 * This keeps the analytics dimension small and stable while still recording
 * the (rare) web/desktop path distinctly from the native ones.
 */
export type StoreReviewPlatform = 'ios' | 'android' | 'other';

/**
 * Immutable result of a single {@link requestStoreReview} attempt.
 *
 * Inline-exported from this helper file (no separate `types.ts`) so the
 * outcome shape lives next to the only function that produces it.
 *
 * Fields:
 *   - `attempted` — whether `requestReview()` was actually dispatched to the
 *                   native SDK. `true` only when `isAvailableAsync()`
 *                   resolved truthy AND the dispatch was issued. `false`
 *                   when the SDK reported unavailable or `isAvailableAsync()`
 *                   threw.
 *   - `available` — the result of the `isAvailableAsync()` capability probe.
 *                   `false` when the probe threw (treated as unavailable).
 *   - `platform`  — the narrowed {@link StoreReviewPlatform} the attempt ran
 *                   on, captured before any SDK call so it is always present
 *                   even on the error-swallowed path.
 */
export interface StoreReviewOutcome {
  readonly attempted: boolean;
  readonly available: boolean;
  readonly platform: StoreReviewPlatform;
}

/**
 * Narrow the wide `Platform.OS` union down to the rating-gate's three-way
 * {@link StoreReviewPlatform}. Read at call time (not module-load time) so
 * unit tests that mock `Platform.OS` per case see the correct value.
 */
function resolvePlatform(): StoreReviewPlatform {
  if (Platform.OS === 'ios') {
    return 'ios';
  }
  if (Platform.OS === 'android') {
    return 'android';
  }
  return 'other';
}

/**
 * `__DEV__`-gated breadcrumb. React Native defines `__DEV__` as a global
 * boolean (true in dev, false in release); the vitest node runtime does not,
 * so the `typeof` guard keeps the helper from throwing a ReferenceError when
 * exercised outside a React Native bundle. Production (`__DEV__ === false`)
 * emits nothing.
 */
function devWarn(message: string): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(message);
  }
}

/**
 * Request the native in-app store-review prompt with guarded,
 * fire-and-forget semantics.
 *
 * Flow:
 *   1. Capture the narrowed platform (always present on the result).
 *   2. Await `isAvailableAsync()` — a cheap capability probe. If it throws,
 *      swallow the error, warn (dev only), and return
 *      `{ attempted: false, available: false, platform }`.
 *   3. If unavailable, warn (dev only) and return
 *      `{ attempted: false, available: false, platform }` WITHOUT dispatching.
 *   4. If available, dispatch `requestReview()` fire-and-forget — the call is
 *      issued synchronously (so callers/tests observe the dispatch
 *      immediately) but NEVER awaited. Both a synchronous throw and an async
 *      rejection are caught and swallowed. Return
 *      `{ attempted: true, available: true, platform }`.
 *
 * The returned promise resolves as soon as the availability probe completes —
 * it does NOT wait for the native prompt to present or dismiss. Callers use
 * the resolved {@link StoreReviewOutcome} purely to drive analytics and may
 * navigate forward unconditionally regardless of its contents.
 *
 * @returns A {@link StoreReviewOutcome} describing the attempt. Never rejects.
 */
export async function requestStoreReview(): Promise<StoreReviewOutcome> {
  const platform = resolvePlatform();

  let available = false;
  try {
    available = await StoreReview.isAvailableAsync();
  } catch (error) {
    // Swallow: a throwing capability probe must never propagate to the
    // caller or block navigation. Report it as unavailable.
    devWarn(
      `[store-review] isAvailableAsync() threw; swallowing and treating as unavailable: ${String(
        error,
      )}`,
    );
    return { attempted: false, available: false, platform };
  }

  if (!available) {
    // The OS reports the prompt cannot be shown (rate-limited, unsupported
    // device, etc.). Do NOT dispatch — there is nothing to attempt.
    devWarn(
      '[store-review] isAvailableAsync() reported unavailable; skipping requestReview() dispatch',
    );
    return { attempted: false, available: false, platform };
  }

  // Fire-and-forget dispatch. We invoke `requestReview()` synchronously so a
  // caller (or test) observes the dispatch immediately, but we deliberately
  // do NOT `await` it — navigation must not be gated on the native prompt.
  try {
    const reviewResult: unknown = StoreReview.requestReview();
    // Attach a rejection handler so an async failure never becomes an
    // unhandled promise rejection, but do not await the settle.
    if (
      reviewResult !== null &&
      typeof (reviewResult as Promise<void>)?.then === 'function'
    ) {
      void (reviewResult as Promise<void>).catch((error: unknown) => {
        devWarn(
          `[store-review] requestReview() rejected asynchronously; swallowing: ${String(
            error,
          )}`,
        );
      });
    }
  } catch (error) {
    // A synchronous throw from requestReview() is swallowed too — the
    // attempt was still made (the dispatch was issued), so `attempted`
    // remains true below per the contract that "attempted" tracks dispatch
    // intent, not native success.
    devWarn(
      `[store-review] requestReview() threw synchronously; swallowing: ${String(
        error,
      )}`,
    );
  }

  devWarn('[store-review] requestReview() dispatched (fire-and-forget)');
  return { attempted: true, available: true, platform };
}
