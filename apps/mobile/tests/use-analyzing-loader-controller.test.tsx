/**
 * Phase 6.2 — controller-hook test for the 5-stage Analyzing loader
 * (funnel step 5 `fake_loader`), exercised through the React adapter
 * `useAnalyzingLoaderLadder` (`src/hooks/use-stage-ladder.ts`).
 *
 * This is the *controller* half of the two-layer mock pattern: where the pure
 * render tests assert label/glyph projection, this file pins the temporal
 * contract. It drives the `core-ts` analyzing-loader controller through an
 * **injected fake scheduler** built on the same scheduler-injection seam that
 * `core-ts` itself documents (`{ now, setTimer, clearTimer }`). Ticks are
 * stepped synchronously — NO `vi.useFakeTimers`, NO wall clock — proving the
 * controller (not the RN layer) owns every timer.
 *
 * Behavioural assertions only (no snapshots):
 *   - The hook starts the ladder on mount → stage 0 active, rest pending.
 *   - Each synchronous scheduler tick advances exactly one stage.
 *   - The ladder latches at `complete` at 5000 ms with all 5 stages done and
 *     100% progress, and `onComplete` fires exactly once.
 *   - The latched state HOLDS past 5000 ms (idempotent — no regression / no
 *     re-fire), reconciling with the screen's separate auto-advance timer.
 *   - `autoStart: false` leaves the ladder idle through the full timeline.
 *   - Unmount cancels the controller so a late tick cannot fire `onComplete`.
 *   - Driving ticks before `start` (autoStart false) is inert.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ANALYZING_STAGE_DURATION_MS,
  ANALYZING_STAGE_LABELS,
  ANALYZING_TOTAL_DURATION_MS,
  ANALYZING_TOTAL_STAGES,
} from 'core-ts/funnel';

import {
  useAnalyzingLoaderLadder,
  type UseAnalyzingLoaderLadderOptions,
} from '../src/hooks/use-stage-ladder';

// ---------------------------------------------------------------------------
// Injected fake scheduler — synchronous, deterministic timeline driver.
//
// Implements the exact `{ now, setTimer, clearTimer }` seam the `core-ts`
// controller accepts via `useAnalyzingLoader({ scheduler })`. `advance(ms)`
// fires every due timer in ascending due-time order, so a single call can
// stride the whole 5-stage timeline synchronously.
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
// Probe component — captures the latest view-model from the adapter hook.
// ---------------------------------------------------------------------------

type AnalyzingVm = ReturnType<typeof useAnalyzingLoaderLadder>;

function renderLadder(options: UseAnalyzingLoaderLadderOptions): {
  vm: () => AnalyzingVm;
  unmount: () => void;
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
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Start-on-mount + initial projection.
// ---------------------------------------------------------------------------

describe('useAnalyzingLoaderLadder controller — mount', () => {
  it('starts on mount with the 5 Korean stages, stage 0 active and the rest pending', () => {
    const clock = createFakeClock();
    const { vm } = renderLadder({ scheduler: clock.scheduler });

    const model = vm();
    expect(model.items).toHaveLength(ANALYZING_TOTAL_STAGES);
    expect(model.items.map((i) => i.label)).toEqual([...ANALYZING_STAGE_LABELS]);
    expect(model.phase).toBe('running');
    expect(model.currentStageIndex).toBe(0);
    expect(model.items[0]?.status).toBe('active');
    expect(model.items.slice(1).every((i) => i.status === 'pending')).toBe(true);
    expect(model.ariaLive).toBe('polite');
    expect(model.totalDurationMs).toBe(ANALYZING_TOTAL_DURATION_MS);
  });
});

// ---------------------------------------------------------------------------
// Synchronous tick driving — one stage per 1000 ms boundary.
// ---------------------------------------------------------------------------

describe('useAnalyzingLoaderLadder controller — synchronous tick driving', () => {
  it('advances exactly one stage per scheduler tick', () => {
    const clock = createFakeClock();
    const { vm } = renderLadder({ scheduler: clock.scheduler });

    act(() => clock.advance(ANALYZING_STAGE_DURATION_MS));
    expect(vm().currentStageIndex).toBe(1);
    expect(vm().items[0]?.status).toBe('done');
    expect(vm().items[1]?.status).toBe('active');

    act(() => clock.advance(ANALYZING_STAGE_DURATION_MS));
    expect(vm().currentStageIndex).toBe(2);
    expect(vm().items[1]?.status).toBe('done');
    expect(vm().items[2]?.status).toBe('active');

    act(() => clock.advance(ANALYZING_STAGE_DURATION_MS));
    expect(vm().currentStageIndex).toBe(3);
    expect(vm().items[3]?.status).toBe('active');
  });

  it('marks every earlier stage done as the active stage walks forward', () => {
    const clock = createFakeClock();
    const { vm } = renderLadder({ scheduler: clock.scheduler });

    // Drive to stage 3 (3000 ms) in a single synchronous advance.
    act(() => clock.advance(3 * ANALYZING_STAGE_DURATION_MS));
    const model = vm();
    expect(model.currentStageIndex).toBe(3);
    expect(model.items.slice(0, 3).every((i) => i.status === 'done')).toBe(true);
    expect(model.items[3]?.status).toBe('active');
    expect(model.items[4]?.status).toBe('pending');
  });

  it('monotonically increases progressPercent across ticks without overshoot', () => {
    const clock = createFakeClock();
    const { vm } = renderLadder({ scheduler: clock.scheduler });

    const percents: number[] = [vm().progressPercent];
    for (let i = 1; i <= ANALYZING_TOTAL_STAGES; i += 1) {
      act(() => clock.advance(ANALYZING_STAGE_DURATION_MS));
      percents.push(vm().progressPercent);
    }
    // Non-decreasing, clamped to [0, 100].
    for (let i = 1; i < percents.length; i += 1) {
      expect(percents[i]!).toBeGreaterThanOrEqual(percents[i - 1]!);
    }
    expect(Math.min(...percents)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...percents)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Completion latch + timing reconciliation with the screen auto-advance.
// ---------------------------------------------------------------------------

describe('useAnalyzingLoaderLadder controller — completion latch', () => {
  it('latches at complete at 5000 ms with all stages done, 100%, assertive aria, onComplete once', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { vm } = renderLadder({ scheduler: clock.scheduler, onComplete });

    act(() => clock.advance(ANALYZING_TOTAL_DURATION_MS));

    const model = vm();
    expect(model.phase).toBe('complete');
    expect(model.isComplete).toBe(true);
    expect(model.progressPercent).toBe(100);
    expect(model.items.every((i) => i.status === 'done')).toBe(true);
    expect(model.ariaLive).toBe('assertive');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('holds the latch past 5000 ms — no state regression and no second onComplete', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { vm } = renderLadder({ scheduler: clock.scheduler, onComplete });

    act(() => clock.advance(ANALYZING_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('complete');
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Hold well past the latch (screen auto-advance is a separate timer).
    act(() => clock.advance(10_000));
    expect(vm().phase).toBe('complete');
    expect(vm().progressPercent).toBe(100);
    expect(vm().items.every((i) => i.status === 'done')).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not latch a single tick before the boundary (4999 ms still running)', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { vm } = renderLadder({ scheduler: clock.scheduler, onComplete });

    act(() => clock.advance(ANALYZING_TOTAL_DURATION_MS - 1));
    expect(vm().phase).toBe('running');
    expect(onComplete).not.toHaveBeenCalled();

    act(() => clock.advance(1));
    expect(vm().phase).toBe('complete');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — autoStart gating + unmount cancellation.
// ---------------------------------------------------------------------------

describe('useAnalyzingLoaderLadder controller — lifecycle', () => {
  it('stays idle through the whole timeline when autoStart is false', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { vm } = renderLadder({
      scheduler: clock.scheduler,
      autoStart: false,
      onComplete,
    });

    expect(vm().phase).toBe('idle');
    expect(vm().items.every((i) => i.status === 'pending')).toBe(true);

    act(() => clock.advance(ANALYZING_TOTAL_DURATION_MS));
    expect(vm().phase).toBe('idle');
    expect(vm().items.every((i) => i.status === 'pending')).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('cancels on unmount so a late tick cannot fire onComplete', () => {
    const clock = createFakeClock();
    const onComplete = vi.fn();
    const { unmount } = renderLadder({
      scheduler: clock.scheduler,
      onComplete,
    });

    act(() => clock.advance(2 * ANALYZING_STAGE_DURATION_MS));
    unmount();
    act(() => clock.advance(ANALYZING_TOTAL_DURATION_MS));
    expect(onComplete).not.toHaveBeenCalled();
  });
});
