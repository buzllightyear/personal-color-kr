/**
 * Phase 6.2 — adapter hook tests for `useAnalyzingLoaderLadder` /
 * `useScanAnimationLadder` (`src/hooks/use-stage-ladder.ts`).
 *
 * These hooks bind the `core-ts` stage-machine controllers to React via
 * `useSyncExternalStore`. The tests drive a deterministic *injected* fake
 * scheduler (NO `vi.useFakeTimers`, NO wall clock) so each tick is stepped
 * synchronously — proving the controller, not the RN layer, owns all timing.
 *
 * Behavioural assertions only (no snapshots):
 *   - The hook starts the ladder on mount and exposes the projected
 *     view-model (Korean labels + pending/active/done tri-state).
 *   - Each scheduler tick advances the active stage and re-renders.
 *   - The ladder latches at `complete` at its total duration, fires
 *     `onComplete` exactly once, and HOLDS the latched state past that point
 *     (timing reconciliation with the screen's separate auto-advance timer).
 *   - `autoStart: false` leaves the ladder idle.
 *   - Unmount cancels the controller so `onComplete` cannot fire late.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as funnelModule from 'core-ts/funnel';
import {
  ANALYZING_STAGE_LABELS,
  ANALYZING_TOTAL_DURATION_MS,
} from 'core-ts/funnel';
import * as scanModule from 'core-ts/scan_option';
import {
  SCAN_ANIMATION_STAGE_LABELS,
  SCAN_ANIMATION_TOTAL_DURATION_MS,
} from 'core-ts/scan_option';

import {
  useAnalyzingLoaderLadder,
  useScanAnimationLadder,
  type UseAnalyzingLoaderLadderOptions,
  type UseScanAnimationLadderOptions,
} from '../src/hooks/use-stage-ladder';

// ---------------------------------------------------------------------------
// Injected fake scheduler — synchronous, deterministic timeline driver.
// ---------------------------------------------------------------------------

interface FakeScheduler {
  readonly now: () => number;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

interface FakeClock {
  readonly scheduler: FakeScheduler;
  /** Advance virtual time by `ms`, firing every timer due along the way. */
  readonly advance: (ms: number) => void;
}

function createFakeClock(): FakeClock {
  let nowMs = 0;
  let seq = 0;
  const timers = new Map<number, { dueAt: number; fn: () => void }>();

  const scheduler: FakeScheduler = {
    now: () => nowMs,
    setTimer: (fn, ms) => {
      const id = (seq += 1);
      timers.set(id, { dueAt: nowMs + ms, fn });
      return id;
    },
    clearTimer: (handle) => {
      if (typeof handle === 'number') timers.delete(handle);
    },
  };

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
// Probe components — capture the latest view-model from the hook.
// ---------------------------------------------------------------------------

type AnalyzingVm = ReturnType<typeof useAnalyzingLoaderLadder>;
type ScanVm = ReturnType<typeof useScanAnimationLadder>;

function renderAnalyzing(options: UseAnalyzingLoaderLadderOptions): {
  vm: () => AnalyzingVm;
  unmount: () => void;
  rerender: () => void;
} {
  let latest: AnalyzingVm | undefined;
  function Probe(): React.ReactElement | null {
    latest = useAnalyzingLoaderLadder(options);
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

/** Alias kept readable at call sites that exercise re-render behaviour. */
const renderAnalyzingRerenderable = renderAnalyzing;

function renderScan(options: UseScanAnimationLadderOptions): {
  vm: () => ScanVm;
  unmount: () => void;
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
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// useAnalyzingLoaderLadder — 5 stages × 1000 ms = 5000 ms.
// ---------------------------------------------------------------------------

describe('useAnalyzingLoaderLadder', () => {
  it('starts on mount and exposes the 5 Korean stages with stage 0 active', () => {
    const clock = createFakeClock();
    const { vm } = renderAnalyzing({ scheduler: clock.scheduler });

    const model = vm();
    expect(model.items).toHaveLength(5);
    expect(model.items.map((i) => i.label)).toEqual([...ANALYZING_STAGE_LABELS]);
    expect(model.phase).toBe('running');
    expect(model.items[0]?.status).toBe('active');
    expect(model.items[1]?.status).toBe('pending');
    expect(model.ariaLive).toBe('polite');
  });

  it('advances the active stage on each scheduler tick', () => {
    const clock = createFakeClock();
    const { vm } = renderAnalyzing({ scheduler: clock.scheduler });

    act(() => clock.advance(1_000));
    expect(vm().items[0]?.status).toBe('done');
    expect(vm().items[1]?.status).toBe('active');

    act(() => clock.advance(1_000));
    expect(vm().items[1]?.status).toBe('done');
    expect(vm().items[2]?.status).toBe('active');
    expect(vm().currentStageIndex).toBe(2);
  });

  it('latches at complete after 5000 ms with all stages done and 100%', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { vm } = renderAnalyzing({ scheduler: clock.scheduler, onComplete });

    act(() => clock.advance(ANALYZING_TOTAL_DURATION_MS));

    const model = vm();
    expect(model.phase).toBe('complete');
    expect(model.isComplete).toBe(true);
    expect(model.progressPercent).toBe(100);
    expect(model.items.every((i) => i.status === 'done')).toBe(true);
    expect(model.ariaLive).toBe('assertive');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('fires onComplete exactly once even when time advances past the latch', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    renderAnalyzing({ scheduler: clock.scheduler, onComplete });

    act(() => clock.advance(ANALYZING_TOTAL_DURATION_MS + 10_000));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('stays idle when autoStart is false', () => {
    const clock = createFakeClock();
    const { vm } = renderAnalyzing({
      scheduler: clock.scheduler,
      autoStart: false,
    });

    expect(vm().phase).toBe('idle');
    act(() => clock.advance(ANALYZING_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('idle');
    expect(vm().items.every((i) => i.status === 'pending')).toBe(true);
  });

  it('cancels on unmount so onComplete cannot fire late', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { unmount } = renderAnalyzing({
      scheduler: clock.scheduler,
      onComplete,
    });

    act(() => clock.advance(2_000));
    unmount();
    act(() => clock.advance(ANALYZING_TOTAL_DURATION_MS));
    expect(onComplete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useScanAnimationLadder — 8 stages × 400 ms = 3200 ms.
// ---------------------------------------------------------------------------

describe('useScanAnimationLadder', () => {
  it('starts on mount and exposes the 8 Korean stages with stage 0 active', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler });

    const model = vm();
    expect(model.items).toHaveLength(8);
    expect(model.items.map((i) => i.label)).toEqual([
      ...SCAN_ANIMATION_STAGE_LABELS,
    ]);
    expect(model.phase).toBe('running');
    expect(model.items[0]?.status).toBe('active');
    expect(model.totalDurationMs).toBe(SCAN_ANIMATION_TOTAL_DURATION_MS);
  });

  it('advances the active stage every 400 ms tick', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler });

    act(() => clock.advance(400));
    expect(vm().items[0]?.status).toBe('done');
    expect(vm().items[1]?.status).toBe('active');

    act(() => clock.advance(400));
    expect(vm().currentStageIndex).toBe(2);
  });

  it('latches at complete at 3200 ms and holds through the 5000 ms auto-advance window', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { vm } = renderScan({ scheduler: clock.scheduler, onComplete });

    // Latch at 3200 ms.
    act(() => clock.advance(SCAN_ANIMATION_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('complete');
    expect(vm().progressPercent).toBe(100);
    expect(vm().items.every((i) => i.status === 'done')).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Hold the latch for the remaining 1800 ms until the screen's separate
    // 5000 ms auto-advance fires — state must NOT regress or re-fire.
    act(() => clock.advance(5_000 - SCAN_ANIMATION_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('complete');
    expect(vm().items[7]?.status).toBe('done');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('stays idle when autoStart is false', () => {
    const clock = createFakeClock();
    const { vm } = renderScan({ scheduler: clock.scheduler, autoStart: false });

    expect(vm().phase).toBe('idle');
    act(() => clock.advance(SCAN_ANIMATION_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('idle');
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
// Controller lifecycle — DIRECT assertions on `start()` / `cancel()`.
//
// The behavioural tests above prove start/cancel *effects* (phase flips to
// `running` on mount; ticks are inert after unmount). These tests pin the
// contract one level lower: by spying on the `core-ts` controller factory we
// capture the exact controller the hook builds and assert it calls
// `controller.start()` once on mount and `controller.cancel()` once on
// unmount — and never on intervening re-renders (controller built once via
// the lazy `useRef`, lifecycle owned by a single `useEffect`).
// ---------------------------------------------------------------------------

/**
 * Wrap a `core-ts` controller factory with a `vi.spyOn` that returns the real
 * controller but with `start`/`cancel` replaced by spies, so call counts can
 * be asserted directly. Returns the captured spies (populated once the hook
 * constructs its controller on first render).
 */
function spyOnFactory<
  Module extends Record<Key, (...args: never[]) => unknown>,
  Key extends keyof Module,
>(
  mod: Module,
  key: Key,
): { start: () => ReturnType<typeof vi.fn>; cancel: () => ReturnType<typeof vi.fn> } {
  let startSpy: ReturnType<typeof vi.fn> | undefined;
  let cancelSpy: ReturnType<typeof vi.fn> | undefined;
  const real = mod[key] as (...args: unknown[]) => Record<string, unknown>;
  vi.spyOn(mod, key as never).mockImplementation(((...args: unknown[]) => {
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

describe('controller lifecycle (direct start/cancel assertions)', () => {
  it('useAnalyzingLoaderLadder calls controller.start() exactly once on mount', () => {
    const clock = createFakeClock();
    const spies = spyOnFactory(funnelModule, 'useAnalyzingLoader');

    renderAnalyzing({ scheduler: clock.scheduler });

    expect(spies.start()).toHaveBeenCalledTimes(1);
    expect(spies.cancel()).not.toHaveBeenCalled();
  });

  it('useAnalyzingLoaderLadder calls controller.cancel() exactly once on unmount', () => {
    const clock = createFakeClock();
    const spies = spyOnFactory(funnelModule, 'useAnalyzingLoader');

    const { unmount } = renderAnalyzing({ scheduler: clock.scheduler });
    expect(spies.cancel()).not.toHaveBeenCalled();

    unmount();
    expect(spies.cancel()).toHaveBeenCalledTimes(1);
    // Mount start fired once; unmount adds no further start.
    expect(spies.start()).toHaveBeenCalledTimes(1);
  });

  it('useAnalyzingLoaderLadder does NOT call start() on a re-render (controller built once)', () => {
    const clock = createFakeClock();
    const spies = spyOnFactory(funnelModule, 'useAnalyzingLoader');

    const { rerender } = renderAnalyzingRerenderable({
      scheduler: clock.scheduler,
    });
    expect(spies.start()).toHaveBeenCalledTimes(1);

    rerender();
    rerender();
    expect(spies.start()).toHaveBeenCalledTimes(1);
    expect(spies.cancel()).not.toHaveBeenCalled();
  });

  it('useAnalyzingLoaderLadder does NOT call start() on mount when autoStart is false, but still cancels on unmount', () => {
    const clock = createFakeClock();
    const spies = spyOnFactory(funnelModule, 'useAnalyzingLoader');

    const { unmount } = renderAnalyzing({
      scheduler: clock.scheduler,
      autoStart: false,
    });
    expect(spies.start()).not.toHaveBeenCalled();

    unmount();
    expect(spies.cancel()).toHaveBeenCalledTimes(1);
  });

  it('useScanAnimationLadder calls controller.start() exactly once on mount', () => {
    const clock = createFakeClock();
    const spies = spyOnFactory(scanModule, 'useScanAnimation');

    renderScan({ scheduler: clock.scheduler });

    expect(spies.start()).toHaveBeenCalledTimes(1);
    expect(spies.cancel()).not.toHaveBeenCalled();
  });

  it('useScanAnimationLadder calls controller.cancel() exactly once on unmount', () => {
    const clock = createFakeClock();
    const spies = spyOnFactory(scanModule, 'useScanAnimation');

    const { unmount } = renderScan({ scheduler: clock.scheduler });
    expect(spies.cancel()).not.toHaveBeenCalled();

    unmount();
    expect(spies.cancel()).toHaveBeenCalledTimes(1);
    expect(spies.start()).toHaveBeenCalledTimes(1);
  });
});
