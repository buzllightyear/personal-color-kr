/**
 * Integration tests — useRatingGate (Sub-AC 8.4).
 *
 * The hook stitches Sub-AC 8.1 (RatingGateService), 8.2 (RatingPersistence)
 * and 8.3 (RatingBridge) together.  These tests use the REAL service +
 * persistence implementations (with an in-memory KV store) and a stubbed
 * bridge so we can drive the data-flow end-to-end without StoreKit.
 *
 * Coverage matrix:
 *   1. Constructor validation
 *      a. Non-object options
 *      b. Missing/invalid service / persistence / bridge
 *      c. Invalid appVersion / now / onTriggerResult
 *      d. Returns a frozen controller
 *   2. Initial snapshot is sane before hydrate()
 *   3. hydrate()
 *      a. Replays previously prompted stages from persistence
 *      b. Idempotent (second call returns the same snapshot)
 *      c. Concurrent hydrate() calls share the same promise
 *   4. track() updates counters and re-evaluates
 *   5. trigger() pre-flight rejects when not hydrated
 *   6. trigger() returns 'no_stage_satisfied' when counters are below thresholds
 *   7. trigger() fires the bridge and persists on success
 *      a. Calls bridge.requestReview exactly once with the highest stage
 *      b. Calls persistence.recordPrompt with the right payload
 *      c. Updates the in-memory service so the same stage cannot re-fire
 *      d. onTriggerResult callback fires
 *   8. trigger() handles bridge-skipped (non-iOS) without persisting
 *   9. trigger() handles bridge-failed by still marking prompted
 *  10. trigger() handles persistence failure gracefully (in-memory still updates)
 *  11. trackAndTrigger() — convenience flow
 *  12. Concurrent trigger() calls return the same in-flight promise
 *  13. subscribe() fires on every state change
 *  14. Listener exceptions never break the flow
 *  15. End-to-end ladder: stage 1 → 2 → 3 → 4 sequentially
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createRatingGateService,
  type RatingGateService,
  type RatingTriggerStage,
} from '../../src/funnel/rating-gate.js';
import {
  createRatingPersistence,
  InMemoryKeyValueStore,
  type RatingPersistence,
} from '../../src/funnel/rating-persistence.js';
import {
  createRatingBridge,
  type RatingBridge,
  type RatingBridgeNativeBinding,
  type RatingBridgeResult,
} from '../../src/funnel/rating-bridge.js';
import {
  RatingHookError,
  useRatingGate,
  type RatingGateController,
  type RatingHookSnapshot,
  type RatingHookTriggerResult,
  type UseRatingGateOptions,
} from '../../src/funnel/rating-hook.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = '2026-05-16T12:00:00.000Z';
const APP_VERSION = '0.1.0';

interface BuildOptions {
  readonly initialBridgeBinding?: RatingBridgeNativeBinding;
  readonly initialPersistedStages?: readonly RatingTriggerStage[];
  readonly bridge?: RatingBridge;
  readonly now?: () => string;
  readonly onTriggerResult?: (r: RatingHookTriggerResult) => void;
}

function buildIosBridge(binding?: RatingBridgeNativeBinding): {
  bridge: RatingBridge;
  binding: ReturnType<typeof vi.fn>;
} {
  const stub =
    binding !== undefined
      ? (vi.fn(binding) as ReturnType<typeof vi.fn>)
      : (vi.fn(() => undefined) as ReturnType<typeof vi.fn>);
  const bridge = createRatingBridge({
    platform: 'ios',
    requestReviewNative: stub as unknown as RatingBridgeNativeBinding,
    now: () => FIXED_NOW,
    appVersion: APP_VERSION,
  });
  return { bridge, binding: stub };
}

async function build(
  options: BuildOptions = {},
): Promise<{
  controller: RatingGateController;
  service: RatingGateService;
  persistence: RatingPersistence;
  store: InMemoryKeyValueStore;
  bridge: RatingBridge;
  binding: ReturnType<typeof vi.fn> | null;
}> {
  const service = createRatingGateService();
  const store = new InMemoryKeyValueStore();
  const persistence = createRatingPersistence(store);

  // Seed persistence with prior prompted stages if requested.
  if (options.initialPersistedStages) {
    for (const stage of options.initialPersistedStages) {
      await persistence.recordPrompt({
        stage,
        promptedAt: FIXED_NOW,
        appVersion: APP_VERSION,
      });
    }
  }

  let bridge: RatingBridge;
  let binding: ReturnType<typeof vi.fn> | null = null;
  if (options.bridge !== undefined) {
    bridge = options.bridge;
  } else {
    const built = buildIosBridge(options.initialBridgeBinding);
    bridge = built.bridge;
    binding = built.binding;
  }

  const hookOptions: UseRatingGateOptions = {
    service,
    persistence,
    bridge,
    appVersion: APP_VERSION,
    now: options.now ?? (() => FIXED_NOW),
    ...(options.onTriggerResult !== undefined
      ? { onTriggerResult: options.onTriggerResult }
      : {}),
  };
  const controller = useRatingGate(hookOptions);

  return { controller, service, persistence, store, bridge, binding };
}

// ---------------------------------------------------------------------------
// 1. Constructor validation
// ---------------------------------------------------------------------------

describe('useRatingGate — constructor validation', () => {
  it('rejects null options with invalid_options', () => {
    let caught: unknown;
    try {
      useRatingGate(null as unknown as UseRatingGateOptions);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_options');
  });

  it('rejects missing service with invalid_service', async () => {
    const { bridge, persistence } = await build();
    let caught: unknown;
    try {
      useRatingGate({
        service: null as unknown as RatingGateService,
        persistence,
        bridge,
        appVersion: APP_VERSION,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_service');
  });

  it('rejects service missing one method with invalid_service', async () => {
    const { bridge, persistence } = await build();
    let caught: unknown;
    try {
      useRatingGate({
        service: { snapshot: () => undefined } as unknown as RatingGateService,
        persistence,
        bridge,
        appVersion: APP_VERSION,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_service');
  });

  it('rejects missing persistence with invalid_persistence', async () => {
    const { service, bridge } = await build();
    let caught: unknown;
    try {
      useRatingGate({
        service,
        persistence: null as unknown as RatingPersistence,
        bridge,
        appVersion: APP_VERSION,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_persistence');
  });

  it('rejects persistence missing one method with invalid_persistence', async () => {
    const { service, bridge } = await build();
    let caught: unknown;
    try {
      useRatingGate({
        service,
        persistence: { load: () => undefined } as unknown as RatingPersistence,
        bridge,
        appVersion: APP_VERSION,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_persistence');
  });

  it('rejects missing bridge with invalid_bridge', async () => {
    const { service, persistence } = await build();
    let caught: unknown;
    try {
      useRatingGate({
        service,
        persistence,
        bridge: null as unknown as RatingBridge,
        appVersion: APP_VERSION,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_bridge');
  });

  it('rejects bridge missing one method with invalid_bridge', async () => {
    const { service, persistence } = await build();
    let caught: unknown;
    try {
      useRatingGate({
        service,
        persistence,
        bridge: { canPromptNow: () => false } as unknown as RatingBridge,
        appVersion: APP_VERSION,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_bridge');
  });

  it('rejects empty appVersion with invalid_app_version', async () => {
    const { service, persistence, bridge } = await build();
    let caught: unknown;
    try {
      useRatingGate({ service, persistence, bridge, appVersion: '' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_app_version');
  });

  it('rejects non-string appVersion with invalid_app_version', async () => {
    const { service, persistence, bridge } = await build();
    let caught: unknown;
    try {
      useRatingGate({
        service,
        persistence,
        bridge,
        appVersion: 42 as unknown as string,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_app_version');
  });

  it('rejects non-function now with invalid_now', async () => {
    const { service, persistence, bridge } = await build();
    let caught: unknown;
    try {
      useRatingGate({
        service,
        persistence,
        bridge,
        appVersion: APP_VERSION,
        now: 'now' as unknown as () => string,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_now');
  });

  it('rejects non-function onTriggerResult with invalid_callback', async () => {
    const { service, persistence, bridge } = await build();
    let caught: unknown;
    try {
      useRatingGate({
        service,
        persistence,
        bridge,
        appVersion: APP_VERSION,
        onTriggerResult: 'oops' as unknown as (r: RatingHookTriggerResult) => void,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_callback');
  });

  it('returns a frozen controller', async () => {
    const { controller } = await build();
    expect(Object.isFrozen(controller)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Initial snapshot
// ---------------------------------------------------------------------------

describe('initial snapshot before hydrate()', () => {
  it('reports hydrated=false and zero counters', async () => {
    const { controller } = await build();
    const snap = controller.snapshot();
    expect(snap.hydrated).toBe(false);
    expect(snap.counters.app_launched).toBe(0);
    expect(snap.counters.diagnosis_completed).toBe(0);
    expect(snap.counters.share_completed).toBe(0);
    expect(snap.counters.payment_completed).toBe(0);
    expect(snap.alreadyPromptedStages).toEqual([]);
    expect(snap.lastDecision.shouldPrompt).toBe(false);
    expect(snap.lastTriggerResult).toBeNull();
  });

  it('returns a frozen snapshot', async () => {
    const { controller } = await build();
    const snap = controller.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. hydrate()
// ---------------------------------------------------------------------------

describe('hydrate()', () => {
  it('replays persisted promptedStages into the service', async () => {
    const { controller } = await build({
      initialPersistedStages: [1, 3],
    });
    const snap = await controller.hydrate();
    expect(snap.hydrated).toBe(true);
    expect([...snap.alreadyPromptedStages].sort()).toEqual([1, 3]);
  });

  it('is idempotent on a second call', async () => {
    const { controller } = await build({ initialPersistedStages: [2] });
    const first = await controller.hydrate();
    const second = await controller.hydrate();
    expect(second).toBe(first);
    expect([...second.alreadyPromptedStages]).toEqual([2]);
  });

  it('returns the same in-flight promise on concurrent calls', async () => {
    const { controller } = await build();
    const a = controller.hydrate();
    const b = controller.hydrate();
    expect(a).toBe(b);
    await Promise.all([a, b]);
  });

  it('handles cold-start (no persisted data) cleanly', async () => {
    const { controller } = await build();
    const snap = await controller.hydrate();
    expect(snap.hydrated).toBe(true);
    expect(snap.alreadyPromptedStages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. track()
// ---------------------------------------------------------------------------

describe('track()', () => {
  it('increments the targeted counter', async () => {
    const { controller } = await build();
    await controller.hydrate();
    const snap = await controller.track('app_launched');
    expect(snap.counters.app_launched).toBe(1);
  });

  it('accepts an explicit amount', async () => {
    const { controller } = await build();
    await controller.hydrate();
    const snap = await controller.track('diagnosis_completed', 3);
    expect(snap.counters.diagnosis_completed).toBe(3);
  });

  it('re-evaluates the decision after every increment', async () => {
    const { controller } = await build();
    await controller.hydrate();
    let snap = await controller.track('app_launched', 4);
    expect(snap.lastDecision.shouldPrompt).toBe(false);
    snap = await controller.track('app_launched'); // brings count to 5
    expect(snap.lastDecision.shouldPrompt).toBe(true);
    expect(snap.lastDecision.stage).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. trigger() pre-flight when not hydrated
// ---------------------------------------------------------------------------

describe('trigger() before hydrate', () => {
  it('refuses with outcome=not_hydrated and does not call the bridge', async () => {
    const { controller, binding } = await build();
    await controller.track('app_launched', 10);
    const result = await controller.trigger();
    expect(result.outcome).toBe('not_hydrated');
    expect(result.stage).toBeNull();
    expect(result.bridgeResult).toBeNull();
    expect(binding).not.toBeNull();
    expect(binding!).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. trigger() no_stage_satisfied
// ---------------------------------------------------------------------------

describe('trigger() with no satisfied stage', () => {
  it('returns outcome=no_stage_satisfied without invoking the bridge', async () => {
    const { controller, binding } = await build();
    await controller.hydrate();
    const result = await controller.trigger();
    expect(result.outcome).toBe('no_stage_satisfied');
    expect(result.stage).toBeNull();
    expect(result.bridgeResult).toBeNull();
    expect(result.persisted).toBeNull();
    expect(binding!).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. trigger() happy path — iOS + binding success
// ---------------------------------------------------------------------------

describe('trigger() — iOS happy path', () => {
  it('fires the bridge once for the highest satisfied stage and persists', async () => {
    const onTriggerResult = vi.fn();
    const { controller, store, binding } = await build({ onTriggerResult });
    await controller.hydrate();
    // App launched 5+ AND payment_completed 1 → stage 4 is highest.
    await controller.track('app_launched', 5);
    await controller.track('payment_completed', 1);

    const result = await controller.trigger();
    expect(result.outcome).toBe('prompted');
    expect(result.stage).toBe(4);
    expect(result.bridgeResult?.outcome).toBe('requested');
    expect(binding!).toHaveBeenCalledTimes(1);

    // Persistence layer was updated.
    expect(result.persisted).not.toBeNull();
    expect(result.persisted?.lastPromptedStage).toBe(4);
    expect(result.persisted?.lastPromptedVersion).toBe(APP_VERSION);
    expect(result.persisted?.lastPromptedAt).toBe(FIXED_NOW);

    // Persistence was actually written to the underlying KV store.
    const allKeys = Object.keys(store.snapshot());
    expect(allKeys.length).toBe(1);

    // onTriggerResult callback fired exactly once with the same record.
    expect(onTriggerResult).toHaveBeenCalledTimes(1);
    expect(onTriggerResult).toHaveBeenCalledWith(result);
  });

  it('does not re-fire the same stage on the next trigger', async () => {
    const { controller, binding } = await build();
    await controller.hydrate();
    await controller.track('app_launched', 5);

    const first = await controller.trigger();
    expect(first.outcome).toBe('prompted');
    expect(first.stage).toBe(1);
    expect(binding!).toHaveBeenCalledTimes(1);

    const second = await controller.trigger();
    expect(second.outcome).toBe('no_stage_satisfied');
    expect(binding!).toHaveBeenCalledTimes(1); // no second native call
  });
});

// ---------------------------------------------------------------------------
// 8. trigger() — non-iOS / native unavailable → bridge_skipped
// ---------------------------------------------------------------------------

describe('trigger() — bridge_skipped (non-iOS / native unavailable)', () => {
  it('reports skipped_non_ios when bridge platform is android', async () => {
    const androidBridge = createRatingBridge({ platform: 'android' });
    const { controller } = await build({ bridge: androidBridge });
    await controller.hydrate();
    await controller.track('app_launched', 5);
    const result = await controller.trigger();
    expect(result.outcome).toBe('bridge_skipped');
    expect(result.stage).toBe(1);
    expect(result.bridgeResult?.outcome).toBe('skipped_non_ios');
    expect(result.persisted).toBeNull();
  });

  it('reports skipped_native_unavailable on iOS without binding', async () => {
    const iosNoBinding = createRatingBridge({ platform: 'ios' });
    const { controller } = await build({ bridge: iosNoBinding });
    await controller.hydrate();
    await controller.track('app_launched', 5);
    const result = await controller.trigger();
    expect(result.outcome).toBe('bridge_skipped');
    expect(result.bridgeResult?.outcome).toBe('skipped_native_unavailable');
    expect(result.persisted).toBeNull();
  });

  it('does not mark prompted when bridge is skipped — stage re-arms next try', async () => {
    const androidBridge = createRatingBridge({ platform: 'android' });
    const { controller } = await build({ bridge: androidBridge });
    await controller.hydrate();
    await controller.track('app_launched', 5);
    await controller.trigger();
    // Snapshot still reports the stage as available.
    expect(controller.snapshot().lastDecision.shouldPrompt).toBe(true);
    expect(controller.snapshot().lastDecision.stage).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. trigger() — bridge_failed
// ---------------------------------------------------------------------------

describe('trigger() — bridge_failed (native threw)', () => {
  it('reports bridge_failed but still marks the stage as prompted', async () => {
    const throwingBinding: RatingBridgeNativeBinding = () => {
      throw new Error('StoreKit missing');
    };
    const { controller, binding } = await build({
      initialBridgeBinding: throwingBinding,
    });
    await controller.hydrate();
    await controller.track('app_launched', 5);

    const result = await controller.trigger();
    expect(result.outcome).toBe('bridge_failed');
    expect(result.stage).toBe(1);
    expect(result.bridgeResult?.outcome).toBe('failed');
    expect(result.bridgeResult?.error?.reason).toBe('native_threw');
    expect(result.bridgeResult?.error?.message).toBe('StoreKit missing');
    expect(result.persisted?.lastPromptedStage).toBe(1);
    expect(binding!).toHaveBeenCalledTimes(1);

    // Next trigger should NOT re-ask — stage is consumed.
    const second = await controller.trigger();
    expect(second.outcome).toBe('no_stage_satisfied');
  });
});

// ---------------------------------------------------------------------------
// 10. trigger() — persistence failure
// ---------------------------------------------------------------------------

describe('trigger() — persistence failure', () => {
  it('still marks the in-memory stage prompted when persistence rejects', async () => {
    const persistence: RatingPersistence = {
      load: async () => ({
        lastPromptedAt: null,
        lastPromptedVersion: null,
        lastPromptedStage: null,
        promptedStages: [],
        schemaVersion: 1,
      }),
      save: async (s) => s,
      clear: async () => undefined,
      recordPrompt: async () => {
        throw new Error('disk full');
      },
    };

    const { bridge, binding } = buildIosBridge();
    const service = createRatingGateService();
    const controller = useRatingGate({
      service,
      persistence,
      bridge,
      appVersion: APP_VERSION,
      now: () => FIXED_NOW,
    });

    await controller.hydrate();
    await controller.track('app_launched', 5);
    const result = await controller.trigger();
    expect(result.outcome).toBe('prompted');
    expect(result.persisted).toBeNull();
    expect(binding).toHaveBeenCalledTimes(1);

    // In-memory service still considers the stage consumed.
    const second = await controller.trigger();
    expect(second.outcome).toBe('no_stage_satisfied');
  });
});

// ---------------------------------------------------------------------------
// 11. trackAndTrigger()
// ---------------------------------------------------------------------------

describe('trackAndTrigger()', () => {
  it('increments the counter and then evaluates trigger in one call', async () => {
    const { controller, binding } = await build();
    await controller.hydrate();
    await controller.track('app_launched', 4); // 1 short of stage 1
    const result = await controller.trackAndTrigger('app_launched');
    expect(result.outcome).toBe('prompted');
    expect(result.stage).toBe(1);
    expect(binding!).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 12. Concurrent trigger()
// ---------------------------------------------------------------------------

describe('trigger() — concurrency guard', () => {
  it('returns the same in-flight promise when called concurrently', async () => {
    let resolveNative: () => void = () => undefined;
    const blockingBinding: RatingBridgeNativeBinding = () =>
      new Promise<void>((res) => {
        resolveNative = res;
      });
    const { controller, binding } = await build({
      initialBridgeBinding: blockingBinding,
    });
    await controller.hydrate();
    await controller.track('app_launched', 5);

    const a = controller.trigger();
    const b = controller.trigger();
    expect(a).toBe(b);

    resolveNative();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    expect(binding!).toHaveBeenCalledTimes(1); // only one native call
  });
});

// ---------------------------------------------------------------------------
// 13. subscribe()
// ---------------------------------------------------------------------------

describe('subscribe()', () => {
  it('fires the listener on every observable state change', async () => {
    const { controller } = await build();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();

    await controller.hydrate();
    expect(listener).toHaveBeenCalledTimes(1);

    await controller.track('app_launched');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await controller.track('app_launched');
    expect(listener).toHaveBeenCalledTimes(2); // detached
  });

  it('rejects a non-function listener with invalid_listener', async () => {
    const { controller } = await build();
    let caught: unknown;
    try {
      controller.subscribe('not a function' as unknown as (s: RatingHookSnapshot) => void);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RatingHookError);
    expect((caught as RatingHookError).reason).toBe('invalid_listener');
  });

  it('does not break the flow if a listener throws', async () => {
    const { controller } = await build();
    controller.subscribe(() => {
      throw new Error('boom');
    });
    // Should not propagate.
    const snap = await controller.hydrate();
    expect(snap.hydrated).toBe(true);
  });

  it('does not break the flow if onTriggerResult throws', async () => {
    const { controller, binding } = await build({
      onTriggerResult: () => {
        throw new Error('analytics down');
      },
    });
    await controller.hydrate();
    await controller.track('app_launched', 5);
    const result = await controller.trigger();
    expect(result.outcome).toBe('prompted');
    expect(binding!).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 14. Listener delivers frozen snapshots
// ---------------------------------------------------------------------------

describe('snapshot freezing', () => {
  it('every snapshot delivered to listeners is frozen', async () => {
    const { controller } = await build();
    const seen: RatingHookSnapshot[] = [];
    controller.subscribe((s) => seen.push(s));
    await controller.hydrate();
    await controller.track('app_launched');
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const s of seen) {
      expect(Object.isFrozen(s)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 15. Default now() — no injection
// ---------------------------------------------------------------------------

describe('default now()', () => {
  it('uses Date.now() when no `now` override is supplied', async () => {
    const service = createRatingGateService();
    const store = new InMemoryKeyValueStore();
    const persistence = createRatingPersistence(store);
    // Bridge with no `now` injected so the hook's defaultNow could be
    // exercised if the bridge result lacks a timestamp.  Force that path
    // by providing a bridge that returns promptedAt=null on success.
    const fakeBridge: RatingBridge = {
      canPromptNow: () => true,
      requestReview: async (stage) =>
        Object.freeze({
          outcome: 'requested',
          stage,
          platform: 'ios',
          promptedAt: null,
          appVersion: null,
          error: null,
        }) as RatingBridgeResult,
    };
    const controller = useRatingGate({
      service,
      persistence,
      bridge: fakeBridge,
      appVersion: APP_VERSION,
      // no `now` override → hook uses defaultNow()
    });
    await controller.hydrate();
    await controller.track('app_launched', 5);
    const result = await controller.trigger();
    expect(result.outcome).toBe('prompted');
    // defaultNow returns Date.toISOString() — should parse cleanly.
    expect(typeof result.persisted?.lastPromptedAt).toBe('string');
    expect(Number.isNaN(Date.parse(result.persisted!.lastPromptedAt!))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 16. End-to-end ladder
// ---------------------------------------------------------------------------

describe('end-to-end ladder progression', () => {
  it('walks stage 1 → 2 → 3 → 4 across separate trigger() calls', async () => {
    const onTriggerResult = vi.fn();
    const { controller, binding, store } = await build({ onTriggerResult });
    await controller.hydrate();

    // Stage 1 — 5 launches.
    await controller.track('app_launched', 5);
    const s1 = await controller.trigger();
    expect(s1.outcome).toBe('prompted');
    expect(s1.stage).toBe(1);

    // Stage 2 — 3 diagnoses.
    await controller.track('diagnosis_completed', 3);
    const s2 = await controller.trigger();
    expect(s2.outcome).toBe('prompted');
    expect(s2.stage).toBe(2);

    // Stage 3 — 1 share.
    await controller.track('share_completed');
    const s3 = await controller.trigger();
    expect(s3.outcome).toBe('prompted');
    expect(s3.stage).toBe(3);

    // Stage 4 — 1 payment.
    await controller.track('payment_completed');
    const s4 = await controller.trigger();
    expect(s4.outcome).toBe('prompted');
    expect(s4.stage).toBe(4);

    // After all four stages are consumed there is nothing left to fire.
    const s5 = await controller.trigger();
    expect(s5.outcome).toBe('no_stage_satisfied');

    expect(binding!).toHaveBeenCalledTimes(4);
    expect(onTriggerResult).toHaveBeenCalledTimes(5);

    // Persistence reflects the full ladder.
    const persisted = JSON.parse(
      Object.values(store.snapshot())[0] as string,
    ) as { promptedStages: number[]; lastPromptedStage: number };
    expect([...persisted.promptedStages].sort()).toEqual([1, 2, 3, 4]);
    expect(persisted.lastPromptedStage).toBe(4);
  });

  it('hydrating after a relaunch resumes from the persisted ladder position', async () => {
    // Round 1: pump stages 1 and 2 to disk.
    const { controller, store, persistence } = await build();
    await controller.hydrate();
    await controller.track('app_launched', 5);
    await controller.trigger(); // stage 1
    await controller.track('diagnosis_completed', 3);
    await controller.trigger(); // stage 2

    // Simulate relaunch: build a fresh controller using the SAME store.
    const service2 = createRatingGateService();
    const { bridge: bridge2, binding: binding2 } = buildIosBridge();
    const controller2 = useRatingGate({
      service: service2,
      persistence,
      bridge: bridge2,
      appVersion: APP_VERSION,
      now: () => FIXED_NOW,
    });

    await controller2.hydrate();
    // The new controller knows stages 1 and 2 are already prompted.
    const snap = controller2.snapshot();
    expect([...snap.alreadyPromptedStages].sort()).toEqual([1, 2]);

    // Even if we pump counters that would satisfy stage 1/2 again, the
    // ladder skips them — that's the whole point of persistence.
    await controller2.track('app_launched', 10);
    await controller2.track('diagnosis_completed', 10);
    const result = await controller2.trigger();
    expect(result.outcome).toBe('no_stage_satisfied');
    expect(binding2).not.toHaveBeenCalled();
    expect(Object.keys(store.snapshot()).length).toBe(1);
  });
});
