/**
 * Sub-AC 8.3 — RatingBridge (iOS SKStoreReviewController native bridge).
 *
 * The iOS rating gate (Sub-AC 8.1 / 8.2) decides *when* to ask for a
 * review and *remembers* whether the dialog has been shown.  This module
 * is the thin "actually fire it" layer that bridges TypeScript → the
 * native `SKStoreReviewController.requestReview()` call on iOS.
 *
 * Why a separate module?
 *   - The rating gate must remain pure and platform-agnostic — it is the
 *     same code path on iOS, Android (no-op), Web (no-op), and tests.
 *   - The persistence layer must not depend on any platform API.
 *   - Calling into native code has fundamentally different ergonomics
 *     (it is a fire-and-forget request, the OS decides whether to
 *     actually show anything, and there is no callback).
 *
 * Bridge contract:
 *   - Pure dependency-injected: `createRatingBridge({ platform, ... })`
 *     never touches `globalThis` directly.  This makes mocking trivial
 *     in unit tests and keeps the module SSR-safe / tree-shakeable.
 *   - On iOS (`platform === 'ios'`) and when the native binding is
 *     available, `requestReview(stage)` invokes the native function and
 *     resolves with `{ outcome: 'requested', ... }`.
 *   - On any other platform it short-circuits to
 *     `{ outcome: 'skipped_non_ios', ... }` without ever calling native
 *     code — the host should treat this as success (the rating gate is
 *     iOS-only by design) but record the platform for analytics.
 *   - On iOS when the native binding is missing (e.g. running inside an
 *     Expo Go shell without the StoreKit module), the bridge resolves
 *     with `{ outcome: 'skipped_native_unavailable', ... }`.
 *   - If the native binding throws, the bridge catches the error and
 *     resolves with `{ outcome: 'failed', error: { reason, message } }`
 *     so the call site can branch on the outcome discriminator rather
 *     than wrap the call in try/catch.
 *   - All returned records are `Object.freeze`d.
 *
 * Integration with persistence:
 *   - This module DOES NOT touch the rating persistence layer directly.
 *     The host wires `RatingBridge.requestReview` and
 *     `RatingPersistence.recordPrompt` together at the application
 *     boundary (e.g. inside `RatingGateService.markPrompted`).  Keeping
 *     them decoupled means we can unit-test the bridge with pure mocks
 *     and swap persistence stores without touching native code.
 *
 * iOS implementation notes (host responsibility):
 *   - Wrap `SKStoreReviewController.requestReview(in:)` (iOS 14+) or
 *     `SKStoreReviewController.requestReview()` (iOS <14) in a thin
 *     bridge function that returns synchronously.  StoreKit itself is
 *     fire-and-forget — there is no completion handler.
 *   - The host MUST pass a function reference to `requestReviewNative`;
 *     it must NOT pass `SKStoreReviewController.requestReview` bound to
 *     an arbitrary scope.  React Native: wrap with
 *     `NativeModules.RatingGateBridge.requestReview`.
 */

import type { RatingPromptStage } from './rating-persistence.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Platforms the bridge understands.  Anything outside this set is
 * treated as `'unknown'` and skipped.  Note: even though Android and
 * Web are listed, they are explicit no-ops — only `'ios'` ever invokes
 * `SKStoreReviewController`.
 */
export const RATING_BRIDGE_PLATFORMS = Object.freeze([
  'ios',
  'android',
  'web',
  'unknown',
] as const);

export type RatingBridgePlatform = (typeof RATING_BRIDGE_PLATFORMS)[number];

/**
 * Result discriminator returned by {@link RatingBridge.requestReview}.
 *
 *   - 'requested'                  — native call succeeded (iOS only).
 *   - 'skipped_non_ios'            — platform !== 'ios'; no native call.
 *   - 'skipped_native_unavailable' — iOS but the binding is missing.
 *   - 'failed'                     — iOS, binding present, threw on call.
 */
export type RatingBridgeOutcome =
  | 'requested'
  | 'skipped_non_ios'
  | 'skipped_native_unavailable'
  | 'failed';

/**
 * Frozen audit record returned by `requestReview`.  Everything the host
 * needs to record the attempt (e.g. via `RatingPersistence.recordPrompt`)
 * is in here so the wiring layer doesn't need to consult globals.
 */
export interface RatingBridgeResult {
  readonly outcome: RatingBridgeOutcome;
  readonly stage: RatingPromptStage;
  readonly platform: RatingBridgePlatform;
  /** ISO-8601 timestamp when the native call was attempted, or null. */
  readonly promptedAt: string | null;
  /** Host app semver at attempt time, or null. */
  readonly appVersion: string | null;
  /** Set only when outcome === 'failed'. */
  readonly error: {
    readonly reason: RatingBridgeFailureReason;
    readonly message: string;
  } | null;
}

/** Machine-readable failure reasons for outcome === 'failed'. */
export type RatingBridgeFailureReason = 'native_threw' | 'native_rejected';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Native binding shape.  StoreKit's `requestReview` is fire-and-forget
 * with no completion handler — but we allow async returns so React
 * Native turbo modules that wrap it as a Promise also work.
 *
 * The function MAY throw synchronously or return a rejected Promise.
 * Both are caught by the bridge and surfaced as `{ outcome: 'failed' }`.
 */
export interface RatingBridgeNativeBinding {
  (): void | Promise<void>;
}

/**
 * Inputs to {@link createRatingBridge}.  Everything is injected so the
 * unit tests can stub each piece independently.
 */
export interface CreateRatingBridgeOptions {
  /**
   * Current platform, or a function returning it.  Functions are
   * re-evaluated on every `requestReview` call so the host can swap
   * platforms in dev/test without recreating the bridge.
   */
  readonly platform: RatingBridgePlatform | (() => RatingBridgePlatform);
  /**
   * Native `SKStoreReviewController.requestReview` wrapper.  Required to
   * fire on iOS; omit on Android/Web (the bridge short-circuits anyway).
   */
  readonly requestReviewNative?: RatingBridgeNativeBinding;
  /**
   * Hook used to stamp `promptedAt` on the result.  Defaults to
   * `() => new Date().toISOString()`.  Injectable so tests can pin time.
   */
  readonly now?: () => string;
  /**
   * Host app version (semver string), or a function returning it.
   * Defaults to `null` so the persistence layer can fall back to its
   * own version probe.
   */
  readonly appVersion?: string | (() => string | null);
}

export interface RatingBridge {
  /** Fire `SKStoreReviewController.requestReview()` for `stage`. */
  requestReview(stage: RatingPromptStage): Promise<RatingBridgeResult>;
  /**
   * True iff the bridge is configured for a platform that can actually
   * surface the dialog (iOS + native binding present).  Useful for the
   * UI layer to short-circuit "Rate us" buttons on non-iOS.
   */
  canPromptNow(): boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type RatingBridgeErrorReason =
  | 'invalid_platform'
  | 'invalid_stage'
  | 'invalid_native_binding'
  | 'invalid_now'
  | 'invalid_app_version';

/**
 * Thrown by {@link createRatingBridge} when *constructor* inputs are
 * malformed.  Runtime failures (e.g. native throws) are NOT errors —
 * they become `{ outcome: 'failed' }` results so the host always has a
 * well-typed return value.
 */
export class RatingBridgeError extends Error {
  public override readonly name = 'RatingBridgeError';
  public readonly reason: RatingBridgeErrorReason;
  public readonly value: unknown;

  constructor(reason: RatingBridgeErrorReason, message: string, value: unknown) {
    super(message);
    this.reason = reason;
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isRatingStage(value: unknown): value is RatingPromptStage {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isRatingBridgePlatform(value: unknown): value is RatingBridgePlatform {
  return (
    typeof value === 'string' &&
    (RATING_BRIDGE_PLATFORMS as readonly string[]).includes(value)
  );
}

function resolvePlatform(
  source: RatingBridgePlatform | (() => RatingBridgePlatform),
): RatingBridgePlatform {
  const raw = typeof source === 'function' ? source() : source;
  if (!isRatingBridgePlatform(raw)) {
    throw new RatingBridgeError(
      'invalid_platform',
      `platform must be one of ${RATING_BRIDGE_PLATFORMS.join(', ')} (got ${String(raw)})`,
      raw,
    );
  }
  return raw;
}

function resolveAppVersion(
  source: string | (() => string | null) | undefined,
): string | null {
  if (source === undefined) return null;
  const raw = typeof source === 'function' ? source() : source;
  if (raw === null) return null;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 64) {
    throw new RatingBridgeError(
      'invalid_app_version',
      `appVersion must be a 1..64 char string, null, or absent (got ${String(raw)})`,
      raw,
    );
  }
  return raw;
}

function resolveNow(source: (() => string) | undefined): string {
  const fn = source ?? defaultNow;
  const raw = fn();
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new RatingBridgeError(
      'invalid_now',
      `now() must return a non-empty string (got ${String(raw)})`,
      raw,
    );
  }
  return raw;
}

function defaultNow(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Wires `platform`, the optional native binding, and the time/version
 * hooks into a {@link RatingBridge} façade.  Pure constructor — does
 * NOT invoke the native binding eagerly; that only happens inside
 * `requestReview(...)`.
 */
export function createRatingBridge(options: CreateRatingBridgeOptions): RatingBridge {
  if (options === null || typeof options !== 'object') {
    throw new RatingBridgeError(
      'invalid_platform',
      `options must be an object (got ${options === null ? 'null' : typeof options})`,
      options,
    );
  }

  // Eagerly validate the *static* parts of the input (a literal platform
  // string, a non-function native binding type) so misuse fails fast.
  if (typeof options.platform === 'string') {
    if (!isRatingBridgePlatform(options.platform)) {
      throw new RatingBridgeError(
        'invalid_platform',
        `platform must be one of ${RATING_BRIDGE_PLATFORMS.join(', ')} (got ${String(options.platform)})`,
        options.platform,
      );
    }
  } else if (typeof options.platform !== 'function') {
    throw new RatingBridgeError(
      'invalid_platform',
      `platform must be a string or () => string (got ${typeof options.platform})`,
      options.platform,
    );
  }

  if (
    options.requestReviewNative !== undefined &&
    typeof options.requestReviewNative !== 'function'
  ) {
    throw new RatingBridgeError(
      'invalid_native_binding',
      `requestReviewNative must be a function or undefined (got ${typeof options.requestReviewNative})`,
      options.requestReviewNative,
    );
  }

  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new RatingBridgeError(
      'invalid_now',
      `now must be a function or undefined (got ${typeof options.now})`,
      options.now,
    );
  }

  if (
    options.appVersion !== undefined &&
    typeof options.appVersion !== 'string' &&
    typeof options.appVersion !== 'function'
  ) {
    throw new RatingBridgeError(
      'invalid_app_version',
      `appVersion must be a string, function, or undefined (got ${typeof options.appVersion})`,
      options.appVersion,
    );
  }

  const platformSource = options.platform;
  const nativeBinding = options.requestReviewNative;
  const nowSource = options.now;
  const appVersionSource = options.appVersion;

  function buildResult(args: {
    readonly outcome: RatingBridgeOutcome;
    readonly stage: RatingPromptStage;
    readonly platform: RatingBridgePlatform;
    readonly promptedAt: string | null;
    readonly appVersion: string | null;
    readonly error: RatingBridgeResult['error'];
  }): RatingBridgeResult {
    return Object.freeze({
      outcome: args.outcome,
      stage: args.stage,
      platform: args.platform,
      promptedAt: args.promptedAt,
      appVersion: args.appVersion,
      error: args.error === null ? null : Object.freeze({ ...args.error }),
    }) satisfies RatingBridgeResult;
  }

  return Object.freeze({
    canPromptNow(): boolean {
      let platform: RatingBridgePlatform;
      try {
        platform = resolvePlatform(platformSource);
      } catch {
        return false;
      }
      return platform === 'ios' && typeof nativeBinding === 'function';
    },

    async requestReview(stage: RatingPromptStage): Promise<RatingBridgeResult> {
      if (!isRatingStage(stage)) {
        throw new RatingBridgeError(
          'invalid_stage',
          `stage must be 1|2|3|4 (got ${String(stage)})`,
          stage,
        );
      }

      const platform = resolvePlatform(platformSource);

      // Non-iOS short-circuit: never invoke native, never stamp time.
      if (platform !== 'ios') {
        return buildResult({
          outcome: 'skipped_non_ios',
          stage,
          platform,
          promptedAt: null,
          appVersion: null,
          error: null,
        });
      }

      // iOS but binding missing (e.g. Expo Go without StoreKit module).
      if (typeof nativeBinding !== 'function') {
        return buildResult({
          outcome: 'skipped_native_unavailable',
          stage,
          platform,
          promptedAt: null,
          appVersion: null,
          error: null,
        });
      }

      // iOS + binding present → attempt the native call.
      const promptedAt = resolveNow(nowSource);
      const appVersion = resolveAppVersion(appVersionSource);

      try {
        // The native binding MAY be synchronous or async; awaiting a
        // non-Promise is a no-op so this branch handles both cases.
        await nativeBinding();
        return buildResult({
          outcome: 'requested',
          stage,
          platform,
          promptedAt,
          appVersion,
          error: null,
        });
      } catch (err) {
        // Distinguish synchronous throws from Promise rejections so
        // callers can tell whether the native call was even attempted.
        // (In practice both surface here, but the synchronous case
        // tends to indicate the module is missing while the async case
        // indicates StoreKit itself rejected — useful for analytics.)
        const reason: RatingBridgeFailureReason =
          err instanceof Error && err.name === 'NativeError'
            ? 'native_rejected'
            : 'native_threw';
        const message =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : 'unknown native failure';
        return buildResult({
          outcome: 'failed',
          stage,
          platform,
          promptedAt,
          appVersion,
          error: { reason, message },
        });
      }
    },
  }) satisfies RatingBridge;
}

// ---------------------------------------------------------------------------
// Convenience: no-op bridge for non-iOS targets
// ---------------------------------------------------------------------------

/**
 * Returns a bridge that always resolves with `{ outcome: 'skipped_non_ios' }`.
 * Handy as a default in dependency injection containers for the web /
 * Android builds where StoreKit is irrelevant.
 */
export function createNoopRatingBridge(
  platform: Exclude<RatingBridgePlatform, 'ios'> = 'unknown',
): RatingBridge {
  return createRatingBridge({ platform });
}
