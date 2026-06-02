/**
 * Sub-AC 8.4 — `useRatingGate`: integration hook that wires the three
 * iOS rating-gate building blocks together.
 *
 *   ┌──────────────────────────┐    ┌──────────────────────────────┐
 *   │  RatingGateService (8.1) │◄───┤   RatingPersistence (8.2)    │
 *   │  4-stage trigger ladder  │    │   UserDefaults / AsyncStorage │
 *   └────────────┬─────────────┘    └──────────────┬────────────────┘
 *                │ evaluate()/track()              │ load()/recordPrompt()
 *                ▼                                  ▼
 *   ┌─────────────────────────────────────────────────────────┐
 *   │             useRatingGate(...)  ── this module ──       │
 *   │  • hydrate persisted prompt history into the service     │
 *   │  • track user actions (app_launched, diagnosis_completed │
 *   │    share_completed, payment_completed)                   │
 *   │  • when a stage threshold is met → call native bridge    │
 *   │  • on success → record prompt via persistence            │
 *   │  • notify subscribers with a frozen, hook-level snapshot │
 *   └─────────────────────────┬───────────────────────────────┘
 *                             ▼
 *               ┌──────────────────────────┐
 *               │  RatingBridge (8.3)      │
 *               │  SKStoreReviewController │
 *               └──────────────────────────┘
 *
 * Design choices:
 *   - The hook is framework-agnostic so the codebase (no React runtime
 *     dependency) can use it directly.  A React adaptor on top can use
 *     `useSyncExternalStore(subscribe, snapshot)` verbatim.
 *   - All state mutations route through one private `apply()` helper so
 *     every observable transition emits exactly one frozen snapshot.
 *   - The hook NEVER mutates the inputs (`service`, `persistence`,
 *     `bridge`); it only calls their public APIs.  This keeps each
 *     sub-system independently unit-testable.
 *   - Constructor validates the wiring up-front and throws a discriminated
 *     `RatingHookError`.  Runtime failures (bridge throwing, persistence
 *     failing) DO NOT throw — they surface as the discriminated
 *     `trigger()` result so call-sites branch on a tag, not on try/catch.
 *   - Re-entrancy guard: only one `trigger()` may be in flight per
 *     controller.  Concurrent calls return the in-flight promise so the
 *     iOS dialog cannot be requested twice for the same engagement event.
 */

import {
  evaluateRatingTrigger,
  type EvaluateRatingTriggerOptions,
  type RatingActionCounters,
  type RatingActionType,
  type RatingGateService,
  type RatingGateSnapshot,
  type RatingTriggerCondition,
  type RatingTriggerDecision,
  type RatingTriggerStage,
} from './rating-gate.js';
import type { RatingPersistedState, RatingPersistence } from './rating-persistence.js';
import type { RatingBridge, RatingBridgeResult } from './rating-bridge.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Outcome discriminator for {@link RatingGateController.trigger}.
 *
 *  - 'not_hydrated'           — `trigger()` called before `hydrate()`.
 *  - 'no_stage_satisfied'     — counters do not yet meet any stage.
 *  - 'bridge_skipped'         — bridge reported skipped_non_ios or
 *                               skipped_native_unavailable.  We DO NOT
 *                               record the prompt to persistence so the
 *                               stage can re-arm on iOS later.
 *  - 'bridge_failed'          — bridge attempted the native call but it
 *                               threw / rejected.  We DO record the
 *                               prompt so we don't spam StoreKit.
 *  - 'prompted'               — native dialog was requested AND the
 *                               prompt event was persisted.
 */
export type RatingHookTriggerOutcome =
  | 'not_hydrated'
  | 'no_stage_satisfied'
  | 'bridge_skipped'
  | 'bridge_failed'
  | 'prompted';

/** Frozen record returned by every call to {@link RatingGateController.trigger}. */
export interface RatingHookTriggerResult {
  readonly outcome: RatingHookTriggerOutcome;
  readonly stage: RatingTriggerStage | null;
  readonly decision: RatingTriggerDecision;
  readonly bridgeResult: RatingBridgeResult | null;
  /** Persisted state AFTER the prompt was recorded (null if not recorded). */
  readonly persisted: RatingPersistedState | null;
}

/** Frozen snapshot delivered to subscribers and via `snapshot()`. */
export interface RatingHookSnapshot {
  /** True iff `hydrate()` has successfully run at least once. */
  readonly hydrated: boolean;
  readonly counters: RatingActionCounters;
  readonly alreadyPromptedStages: readonly RatingTriggerStage[];
  /** Most recent decision from `evaluate()` (recomputed on every change). */
  readonly lastDecision: RatingTriggerDecision;
  /** Most recent `trigger()` result, or null if `trigger()` has not run yet. */
  readonly lastTriggerResult: RatingHookTriggerResult | null;
}

/** Listener invoked on every observable state change with a frozen snapshot. */
export type RatingHookListener = (snapshot: RatingHookSnapshot) => void;

/** Returned from `subscribe`; call to detach. */
export type RatingHookUnsubscribe = () => void;

/** Public controller surface returned by {@link useRatingGate}. */
export interface RatingGateController {
  /** Load persisted prompt history into the in-memory service. Idempotent. */
  hydrate(): Promise<RatingHookSnapshot>;
  /** Increment one counter and re-evaluate.  Returns the latest snapshot. */
  track(action: RatingActionType, amount?: number): Promise<RatingHookSnapshot>;
  /**
   * Evaluate the ladder, fire the native bridge if a fresh stage is
   * satisfied, and persist the prompt event on success.  Never throws —
   * branch on {@link RatingHookTriggerResult.outcome} instead.
   */
  trigger(): Promise<RatingHookTriggerResult>;
  /**
   * Convenience helper: `await controller.track(action)` then
   * `await controller.trigger()` in a single call.  Same return value as
   * {@link RatingGateController.trigger}.
   */
  trackAndTrigger(
    action: RatingActionType,
    amount?: number,
  ): Promise<RatingHookTriggerResult>;
  /** Synchronous read of the current snapshot. */
  snapshot(): RatingHookSnapshot;
  /** Subscribe to state changes; the returned function unsubscribes. */
  subscribe(listener: RatingHookListener): RatingHookUnsubscribe;
}

/** Options accepted by {@link useRatingGate}. */
export interface UseRatingGateOptions {
  readonly service: RatingGateService;
  readonly persistence: RatingPersistence;
  readonly bridge: RatingBridge;
  /**
   * App version used when calling `persistence.recordPrompt`.  Required
   * because the persisted state stores it for re-arming on version bumps.
   */
  readonly appVersion: string;
  /**
   * Custom `now()` hook returning an ISO-8601 string.  Defaults to
   * `() => new Date().toISOString()`.  Injectable so tests can pin time.
   */
  readonly now?: () => string;
  /**
   * Optional fan-out callback fired after every `trigger()` completes.
   * Useful for analytics/event sinks.  Exceptions are swallowed so a
   * faulty listener cannot break the rating flow.
   */
  readonly onTriggerResult?: (result: RatingHookTriggerResult) => void;
  /**
   * Override the evaluation ladder.  Forwarded verbatim to
   * `evaluateRatingTrigger`.  Almost always omit — the default is the
   * canonical 4-stage Seed ladder.
   */
  readonly conditions?: readonly RatingTriggerCondition[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type RatingHookErrorReason =
  | 'invalid_options'
  | 'invalid_service'
  | 'invalid_persistence'
  | 'invalid_bridge'
  | 'invalid_app_version'
  | 'invalid_now'
  | 'invalid_listener'
  | 'invalid_callback';

/**
 * Thrown by {@link useRatingGate} when *constructor* inputs are
 * malformed.  Runtime failures (e.g. persistence rejecting) DO NOT
 * throw — they surface as the discriminated `trigger()` result.
 */
export class RatingHookError extends Error {
  public override readonly name = 'RatingHookError';
  public readonly reason: RatingHookErrorReason;
  public readonly value: unknown;

  constructor(reason: RatingHookErrorReason, message: string, value: unknown) {
    super(message);
    this.reason = reason;
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateOptions(options: unknown): asserts options is UseRatingGateOptions {
  if (options === null || typeof options !== 'object') {
    throw new RatingHookError(
      'invalid_options',
      `options must be an object (got ${options === null ? 'null' : typeof options})`,
      options,
    );
  }
}

function validateService(value: unknown): asserts value is RatingGateService {
  if (value === null || typeof value !== 'object') {
    throw new RatingHookError(
      'invalid_service',
      `service must be an object (got ${value === null ? 'null' : typeof value})`,
      value,
    );
  }
  for (const method of ['track', 'evaluate', 'markPrompted', 'snapshot'] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== 'function') {
      throw new RatingHookError(
        'invalid_service',
        `service.${method} must be a function`,
        value,
      );
    }
  }
}

function validatePersistence(value: unknown): asserts value is RatingPersistence {
  if (value === null || typeof value !== 'object') {
    throw new RatingHookError(
      'invalid_persistence',
      `persistence must be an object (got ${value === null ? 'null' : typeof value})`,
      value,
    );
  }
  for (const method of ['load', 'save', 'clear', 'recordPrompt'] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== 'function') {
      throw new RatingHookError(
        'invalid_persistence',
        `persistence.${method} must be a function`,
        value,
      );
    }
  }
}

function validateBridge(value: unknown): asserts value is RatingBridge {
  if (value === null || typeof value !== 'object') {
    throw new RatingHookError(
      'invalid_bridge',
      `bridge must be an object (got ${value === null ? 'null' : typeof value})`,
      value,
    );
  }
  for (const method of ['requestReview', 'canPromptNow'] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== 'function') {
      throw new RatingHookError(
        'invalid_bridge',
        `bridge.${method} must be a function`,
        value,
      );
    }
  }
}

function validateAppVersion(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new RatingHookError(
      'invalid_app_version',
      `appVersion must be a 1..64 char non-empty string (got ${String(value)})`,
      value,
    );
  }
}

function validateNow(value: unknown): asserts value is () => string {
  if (typeof value !== 'function') {
    throw new RatingHookError(
      'invalid_now',
      `now must be a function (got ${typeof value})`,
      value,
    );
  }
}

function validateCallback(
  value: unknown,
): asserts value is (...args: unknown[]) => unknown {
  if (typeof value !== 'function') {
    throw new RatingHookError(
      'invalid_callback',
      `callback must be a function (got ${typeof value})`,
      value,
    );
  }
}

function isRatingStage(value: unknown): value is RatingTriggerStage {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Build a fresh integration controller binding the three rating-gate
 * sub-systems together.  See module-level docs for the data-flow diagram.
 */
export function useRatingGate(options: UseRatingGateOptions): RatingGateController {
  validateOptions(options);
  validateService(options.service);
  validatePersistence(options.persistence);
  validateBridge(options.bridge);
  validateAppVersion(options.appVersion);
  if (options.now !== undefined) validateNow(options.now);
  if (options.onTriggerResult !== undefined) validateCallback(options.onTriggerResult);

  const service = options.service;
  const persistence = options.persistence;
  const bridge = options.bridge;
  const appVersion = options.appVersion;
  const now: () => string = options.now ?? defaultNow;
  const onTriggerResult = options.onTriggerResult;
  const conditions = options.conditions;

  const listeners = new Set<RatingHookListener>();
  let hydrated = false;
  let hydrationPromise: Promise<RatingHookSnapshot> | null = null;
  let triggerPromise: Promise<RatingHookTriggerResult> | null = null;
  let lastTriggerResult: RatingHookTriggerResult | null = null;
  let snapshotCache: RatingHookSnapshot = buildSnapshot();

  function evaluate(): RatingTriggerDecision {
    const gateSnapshot = service.snapshot();
    const evalOptions: EvaluateRatingTriggerOptions = {
      alreadyPromptedStages: gateSnapshot.alreadyPromptedStages,
      ...(conditions !== undefined ? { conditions } : {}),
    };
    return evaluateRatingTrigger(gateSnapshot.counters, evalOptions);
  }

  function buildSnapshot(): RatingHookSnapshot {
    const gateSnapshot: RatingGateSnapshot = service.snapshot();
    const decision = evaluate();
    return Object.freeze({
      hydrated,
      counters: gateSnapshot.counters,
      alreadyPromptedStages: gateSnapshot.alreadyPromptedStages,
      lastDecision: decision,
      lastTriggerResult,
    }) satisfies RatingHookSnapshot;
  }

  function apply(): RatingHookSnapshot {
    snapshotCache = buildSnapshot();
    // Snapshot listener set so subscribers may detach within a callback.
    for (const listener of [...listeners]) {
      try {
        listener(snapshotCache);
      } catch {
        // Listener exceptions never break the rating flow.
      }
    }
    return snapshotCache;
  }

  function makeTriggerResult(args: {
    outcome: RatingHookTriggerOutcome;
    stage: RatingTriggerStage | null;
    decision: RatingTriggerDecision;
    bridgeResult: RatingBridgeResult | null;
    persisted: RatingPersistedState | null;
  }): RatingHookTriggerResult {
    return Object.freeze({
      outcome: args.outcome,
      stage: args.stage,
      decision: args.decision,
      bridgeResult: args.bridgeResult,
      persisted: args.persisted,
    }) satisfies RatingHookTriggerResult;
  }

  function emitTriggerResult(result: RatingHookTriggerResult): RatingHookTriggerResult {
    lastTriggerResult = result;
    apply();
    if (onTriggerResult !== undefined) {
      try {
        onTriggerResult(result);
      } catch {
        // Analytics/listener errors never break the rating flow.
      }
    }
    return result;
  }

  function hydrate(): Promise<RatingHookSnapshot> {
    if (hydrated) return Promise.resolve(snapshotCache);
    if (hydrationPromise !== null) return hydrationPromise;

    hydrationPromise = (async (): Promise<RatingHookSnapshot> => {
      try {
        const persisted = await persistence.load();
        // Replay each previously-prompted stage into the service so the
        // ladder does not re-ask.  markPrompted is idempotent — duplicates
        // are de-duped inside the service.
        for (const stage of persisted.promptedStages) {
          if (isRatingStage(stage)) {
            service.markPrompted(stage);
          }
        }
        hydrated = true;
        return apply();
      } finally {
        hydrationPromise = null;
      }
    })();

    return hydrationPromise;
  }

  async function track(
    action: RatingActionType,
    amount?: number,
  ): Promise<RatingHookSnapshot> {
    // Delegate counter validation to the service — preserves error reasons.
    if (amount === undefined) {
      service.track(action);
    } else {
      service.track(action, amount);
    }
    return apply();
  }

  function trigger(): Promise<RatingHookTriggerResult> {
    if (triggerPromise !== null) return triggerPromise;

    triggerPromise = (async (): Promise<RatingHookTriggerResult> => {
      try {
        // Pre-flight: refuse to fire before hydration so we never
        // double-prompt a user who had stage N stored on disk.
        if (!hydrated) {
          const decision = evaluate();
          return emitTriggerResult(
            makeTriggerResult({
              outcome: 'not_hydrated',
              stage: null,
              decision,
              bridgeResult: null,
              persisted: null,
            }),
          );
        }

        const decision = evaluate();
        if (!decision.shouldPrompt || decision.stage === null) {
          return emitTriggerResult(
            makeTriggerResult({
              outcome: 'no_stage_satisfied',
              stage: null,
              decision,
              bridgeResult: null,
              persisted: null,
            }),
          );
        }

        const stage = decision.stage;
        const bridgeResult = await bridge.requestReview(stage);

        if (
          bridgeResult.outcome === 'skipped_non_ios' ||
          bridgeResult.outcome === 'skipped_native_unavailable'
        ) {
          // Do NOT mark prompted — the stage should re-arm when iOS
          // becomes available (e.g. tester switches platforms).
          return emitTriggerResult(
            makeTriggerResult({
              outcome: 'bridge_skipped',
              stage,
              decision,
              bridgeResult,
              persisted: null,
            }),
          );
        }

        // 'requested' and 'failed' both consumed the stage as far as the
        // user is concerned — StoreKit's 3-per-year cap covers 'failed'.
        service.markPrompted(stage);

        const promptedAt = bridgeResult.promptedAt ?? now();
        const versionForPersistence = bridgeResult.appVersion ?? appVersion;

        let persisted: RatingPersistedState | null = null;
        try {
          persisted = await persistence.recordPrompt({
            stage,
            promptedAt,
            appVersion: versionForPersistence,
          });
        } catch {
          // Persistence failures are non-fatal — the in-memory service
          // already remembers the stage so the dialog will not re-ask
          // this session.  Next launch the persistence layer may recover.
          persisted = null;
        }

        return emitTriggerResult(
          makeTriggerResult({
            outcome:
              bridgeResult.outcome === 'requested' ? 'prompted' : 'bridge_failed',
            stage,
            decision,
            bridgeResult,
            persisted,
          }),
        );
      } finally {
        triggerPromise = null;
      }
    })();

    return triggerPromise;
  }

  async function trackAndTrigger(
    action: RatingActionType,
    amount?: number,
  ): Promise<RatingHookTriggerResult> {
    await track(action, amount);
    return trigger();
  }

  function snapshot(): RatingHookSnapshot {
    return snapshotCache;
  }

  function subscribe(listener: RatingHookListener): RatingHookUnsubscribe {
    if (typeof listener !== 'function') {
      throw new RatingHookError(
        'invalid_listener',
        `listener must be a function (got ${typeof listener})`,
        listener,
      );
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  // Initialize the cached snapshot so `snapshot()` is safe to call before
  // `hydrate()` returns.
  snapshotCache = buildSnapshot();

  return Object.freeze({
    hydrate,
    track,
    trigger,
    trackAndTrigger,
    snapshot,
    subscribe,
  }) satisfies RatingGateController;
}
