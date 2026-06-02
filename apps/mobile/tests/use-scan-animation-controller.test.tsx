/**
 * Phase 6.2 — controller-focused tests for `useScanAnimationLadder`
 * (`src/hooks/use-stage-ladder.ts`), the React adapter for the 8-stage
 * face-scan animation behind funnel step 8 (`fake_scan_animation`).
 *
 * Sibling to `use-analyzing-loader-controller.test.tsx` (5-stage loader).
 * Where the shared `use-stage-ladder.test.tsx` covers BOTH hooks broadly,
 * this file pins the SCAN controller contract specifically:
 *
 *   - The ladder is driven exclusively by an *injected* fake scheduler that
 *     conforms to core-ts's `ScanAnimationScheduler` interface — proving the
 *     `core-ts` controller, not the RN layer, owns every timer. There is NO
 *     `vi.useFakeTimers`, NO wall clock, NO `setInterval` in the RN layer.
 *   - Each scheduler tick is stepped SYNCHRONOUSLY (the fake clock fires due
 *     timers in-line on `advance`), so the 400 ms cadence and the 3200 ms
 *     completion latch are deterministic and free of async flake.
 *   - Timing reconciliation: the 8-stage ladder latches at `complete` at
 *     3200 ms and HOLDS that latched state through the screen's separate
 *     5000 ms auto-advance window without regressing or re-firing.
 *
 * Behavioural assertions only — no snapshots.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as scanModule from 'core-ts/scan_option';
import {
  SCAN_ANIMATION_STAGE_DURATION_MS,
  SCAN_ANIMATION_STAGE_LABELS,
  SCAN_ANIMATION_TOTAL_DURATION_MS,
  SCAN_ANIMATION_TOTAL_STAGES,
  type ScanAnimationScheduler,
} from 'core-ts/scan_option';

import {
  useScanAnimationLadder,
  type UseScanAnimationLadderOptions,
} from '../src/hooks/use-stage-ladder';

// ---------------------------------------------------------------------------
// Injected fake scheduler — a synchronous, deterministic timeline driver that
// structurally satisfies core-ts's `ScanAnimationScheduler`. The controller
// receives THIS as its only source of "now" + timers; advancing the clock
// drives every stage transition in-line with no real time elapsing.
// ---------------------------------------------------------------------------

interface FakeClock {
  /** Scheduler handed to the hook — typed against the core-ts contract. */
  readonly scheduler: ScanAnimationScheduler;
  /** Advance virtual time by `ms`, firing every due timer in order. */
  readonly advance: (ms: number) => void;
}

function createFakeClock(): FakeClock {
  let nowMs = 0;
  let seq = 0;
  const timers = new Map<number, { dueAt: number; fn: () => void }>();

  const scheduler: ScanAnimationScheduler = Object.freeze({
    now: (): number => nowMs,
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = (seq += 1);
      timers.set(id, { dueAt: nowMs + ms, fn });
      return id;
    },
    clearTimer: (handle: unknown): void => {
      if (typeof handle === 'number') timers.delete(handle);
    },
  });

  function advance(ms: number): void {
    const target = nowMs + ms;
    // Fire due timers in ascending due-time order until none remain ≤ target.
    for (;;) {
      let nextId: number | undefined;
      let nextDue = Number.POSITIVE_INFINITY;
      for (const [id, t] of timers) {
        if (t.dueAt <= target && t.dueAt < nextDue) {
          nextDue = t.dueAt;
          nextId = id;
        }
      }
      if (nextId === undefined) break;
      const entry = timers.get(nextId);
      timers.delete(nextId);
      if (entry) {
        nowMs = entry.dueAt;
        entry.fn();
      }
    }
    nowMs = target;
  }

  return { scheduler, advance };
}

// ---------------------------------------------------------------------------
// Probe component — captures the latest view-model emitted by the hook.
// ---------------------------------------------------------------------------

type ScanVm = ReturnType<typeof useScanAnimationLadder>;

function renderScan(options: UseScanAnimationLadderOptions): {
  vm: () => ScanVm;
  unmount: () => void;
  rerender: () => void;
} {
  let latest: ScanVm | undefined;
  function Probe(): React.ReactElement | null {
    latest = useScanAnimationLadder(options);
    return null;
  }
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(React.createElement(Probe));
  });
  return {
    vm: () => {
      if (!latest) throw new Error('view-model not captured');
      return latest;
    },
    unmount: () => act(() => tree?.unmount()),
    rerender: () =>
      act(() => {
        tree?.update(React.createElement(Probe));
      }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Mount + initial projection
// ---------------------------------------------------------------------------

describe('useScanAnimationLadder — mount + initial state (injected scheduler)', () => {
  it('starts on mount and exposes the 8 Korean stages with stage 0 active', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler });

    const model = vm();
    expect(model.items).toHaveLength(SCAN_ANIMATION_TOTAL_STAGES);
    expect(model.items.map((i) => i.label)).toEqual([...SCAN_ANIMATION_STAGE_LABELS]);
    expect(model.phase).toBe('running');
    expect(model.items[0]?.status).toBe('active');
    expect(model.items[1]?.status).toBe('pending');
    expect(model.ariaLive).toBe('polite');
    expect(model.totalDurationMs).toBe(SCAN_ANIMATION_TOTAL_DURATION_MS);
    expect(model.totalStages).toBe(SCAN_ANIMATION_TOTAL_STAGES);
  });

  it('exposes a 0% progress and the first stage label on the initial frame', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler });

    expect(vm().progressPercent).toBe(0);
    expect(vm().currentStageIndex).toBe(0);
    expect(vm().currentStageLabel).toBe(SCAN_ANIMATION_STAGE_LABELS[0]);
  });
});

// ---------------------------------------------------------------------------
// Synchronous tick advancement — 400 ms cadence
// ---------------------------------------------------------------------------

describe('useScanAnimationLadder — synchronous 400 ms tick cadence', () => {
  it('advances the active stage on each injected scheduler tick', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler });

    act(() => clock.advance(SCAN_ANIMATION_STAGE_DURATION_MS));
    expect(vm().items[0]?.status).toBe('done');
    expect(vm().items[1]?.status).toBe('active');
    expect(vm().currentStageIndex).toBe(1);

    act(() => clock.advance(SCAN_ANIMATION_STAGE_DURATION_MS));
    expect(vm().items[1]?.status).toBe('done');
    expect(vm().items[2]?.status).toBe('active');
    expect(vm().currentStageIndex).toBe(2);
  });

  it('walks through all 8 stages in strict order under synchronous ticks', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler });

    const visited: number[] = [vm().currentStageIndex ?? -1];
    for (let i = 1; i < SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      act(() => clock.advance(SCAN_ANIMATION_STAGE_DURATION_MS));
      visited.push(vm().currentStageIndex ?? -1);
    }

    expect(visited).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(vm().phase).toBe('running');
    // Stage 7 active, every earlier stage done, last one not yet done.
    expect(vm().items[7]?.status).toBe('active');
    expect(
      vm()
        .items.slice(0, 7)
        .every((i) => i.status === 'done'),
    ).toBe(true);
  });

  it('reports monotonically non-decreasing progress across ticks', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler });

    let prev = vm().progressPercent;
    for (let i = 1; i <= SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      act(() => clock.advance(SCAN_ANIMATION_STAGE_DURATION_MS));
      const cur = vm().progressPercent;
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
    expect(prev).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Completion latch + timing reconciliation with the 5000 ms auto-advance
// ---------------------------------------------------------------------------

describe('useScanAnimationLadder — completion latch at 3200 ms', () => {
  it('latches at complete after 3200 ms with all stages done and 100%', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { vm } = renderScan({ scheduler: clock.scheduler, onComplete });

    act(() => clock.advance(SCAN_ANIMATION_TOTAL_DURATION_MS));

    const model = vm();
    expect(model.phase).toBe('complete');
    expect(model.isComplete).toBe(true);
    expect(model.progressPercent).toBe(100);
    expect(model.items.every((i) => i.status === 'done')).toBe(true);
    expect(model.ariaLive).toBe('assertive');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('holds the latch through the remaining 5000 ms auto-advance window', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { vm } = renderScan({ scheduler: clock.scheduler, onComplete });

    // Latch at 3200 ms.
    act(() => clock.advance(SCAN_ANIMATION_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('complete');
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Hold for the remaining 1800 ms until the screen's separate 5000 ms
    // auto-advance fires — state must NOT regress and onComplete must NOT
    // re-fire. The two timers are independent.
    act(() => clock.advance(5_000 - SCAN_ANIMATION_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('complete');
    expect(vm().progressPercent).toBe(100);
    expect(vm().items[7]?.status).toBe('done');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('fires onComplete exactly once even when time advances far past the latch', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    renderScan({ scheduler: clock.scheduler, onComplete });

    act(() => clock.advance(SCAN_ANIMATION_TOTAL_DURATION_MS + 20_000));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// autoStart + unmount lifecycle
// ---------------------------------------------------------------------------

describe('useScanAnimationLadder — lifecycle', () => {
  it('stays idle when autoStart is false', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler, autoStart: false });

    expect(vm().phase).toBe('idle');
    act(() => clock.advance(SCAN_ANIMATION_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('idle');
    expect(vm().items.every((i) => i.status === 'pending')).toBe(true);
  });

  it('cancels on unmount so onComplete cannot fire late', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { unmount } = renderScan({ scheduler: clock.scheduler, onComplete });

    act(() => clock.advance(800));
    unmount();
    act(() => clock.advance(SCAN_ANIMATION_TOTAL_DURATION_MS));
    expect(onComplete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Direct controller lifecycle — spy on the core-ts factory to assert the hook
// drives start()/cancel() with the correct cardinality.
// ---------------------------------------------------------------------------

/**
 * Wrap the `core-ts` controller factory so the real controller is returned but
 * with `start`/`cancel` replaced by spies, letting call counts be asserted
 * directly. Spies are captured once the hook constructs its controller.
 */
function spyOnScanFactory(): {
  start: () => ReturnType<typeof vi.fn>;
  cancel: () => ReturnType<typeof vi.fn>;
} {
  let startSpy: ReturnType<typeof vi.fn> | undefined;
  let cancelSpy: ReturnType<typeof vi.fn> | undefined;
  const real = scanModule.useScanAnimation as (
    ...args: unknown[]
  ) => Record<string, unknown>;
  vi.spyOn(scanModule, 'useScanAnimation').mockImplementation(((...args: unknown[]) => {
    const controller = real(...args);
    startSpy = vi.fn(controller.start as () => void);
    cancelSpy = vi.fn(controller.cancel as () => void);
    return { ...controller, start: startSpy, cancel: cancelSpy };
  }) as never);
  return {
    start: () => {
      if (!startSpy) throw new Error('controller not constructed');
      return startSpy;
    },
    cancel: () => {
      if (!cancelSpy) throw new Error('controller not constructed');
      return cancelSpy;
    },
  };
}

describe('useScanAnimationLadder — controller start/cancel cardinality', () => {
  it('calls controller.start() exactly once on mount', () => {
    const clock = createFakeClock();
    const spies = spyOnScanFactory();

    renderScan({ scheduler: clock.scheduler });

    expect(spies.start()).toHaveBeenCalledTimes(1);
    expect(spies.cancel()).not.toHaveBeenCalled();
  });

  it('calls controller.cancel() exactly once on unmount', () => {
    const clock = createFakeClock();
    const spies = spyOnScanFactory();

    const { unmount } = renderScan({ scheduler: clock.scheduler });
    expect(spies.cancel()).not.toHaveBeenCalled();

    unmount();
    expect(spies.cancel()).toHaveBeenCalledTimes(1);
    expect(spies.start()).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-start on a re-render (controller built once via useRef)', () => {
    const clock = createFakeClock();
    const spies = spyOnScanFactory();

    const { rerender } = renderScan({ scheduler: clock.scheduler });
    expect(spies.start()).toHaveBeenCalledTimes(1);

    rerender();
    rerender();
    expect(spies.start()).toHaveBeenCalledTimes(1);
    expect(spies.cancel()).not.toHaveBeenCalled();
  });

  it('does NOT start on mount when autoStart is false but still cancels on unmount', () => {
    const clock = createFakeClock();
    const spies = spyOnScanFactory();

    const { unmount } = renderScan({
      scheduler: clock.scheduler,
      autoStart: false,
    });
    expect(spies.start()).not.toHaveBeenCalled();

    unmount();
    expect(spies.cancel()).toHaveBeenCalledTimes(1);
  });
});
