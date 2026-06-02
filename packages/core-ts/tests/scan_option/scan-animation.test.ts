/**
 * Unit tests — Sub-AC 10.2: 8-stage fake scan animation state machine
 * + `useScanAnimation` hook.
 *
 * Verifies:
 *   - Public constants match the Seed (8 stages × 400 ms = 3200 ms).
 *   - The 8 canonical stages line up 1:1 with the Korean scan labels and
 *     form a contiguous, gap-free, non-overlapping cover of [0, 3200 ms).
 *   - Pure state-machine transitions: idle → start (stage 0) → tick →
 *     latched complete at 3200 ms.
 *   - Boundary semantics: each `n*400 ms` boundary is the FIRST tick of
 *     stage `n` (inclusive lower bound, exclusive upper bound).
 *   - Stage transition ORDER is strictly 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7.
 *   - Progress percent climbs monotonically from 0 → 100.
 *   - Idempotence past completion (no churn).
 *   - Immutability — every returned state is frozen.
 *   - `useScanAnimation` hook driven by fake timers:
 *       * notifies subscribers on every observable change (start + each of
 *         the 7 intermediate boundaries + completion = 9 notifications),
 *       * passes each stage in canonical order to `onStageChange`,
 *       * fires `onComplete` exactly once at 3200 ms,
 *       * `cancel()` clears pending timers and resets to idle,
 *       * a fresh `start()` resets the timeline,
 *       * an injected scheduler drives the controller deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CANONICAL_SCAN_ANIMATION_STAGES,
  SCAN_ANIMATION_STAGE_DURATION_MS,
  SCAN_ANIMATION_STAGE_LABELS,
  SCAN_ANIMATION_TOTAL_DURATION_MS,
  SCAN_ANIMATION_TOTAL_STAGES,
  createScanAnimation,
  getScanAnimationStage,
  isScanAnimationComplete,
  startScanAnimation,
  tickScanAnimation,
  useScanAnimation,
  type ScanAnimationStage,
  type ScanAnimationStageIndex,
  type ScanAnimationState,
} from '../../src/scan_option/scan-animation.js';

// ---------------------------------------------------------------------------
// Constants & canonical stages
// ---------------------------------------------------------------------------

describe('scan-animation — public constants', () => {
  it('defines exactly 8 stages with a 400 ms cadence and a 3200 ms total', () => {
    expect(SCAN_ANIMATION_TOTAL_STAGES).toBe(8);
    expect(SCAN_ANIMATION_STAGE_DURATION_MS).toBe(400);
    expect(SCAN_ANIMATION_TOTAL_DURATION_MS).toBe(3_200);
    expect(SCAN_ANIMATION_TOTAL_STAGES * SCAN_ANIMATION_STAGE_DURATION_MS).toBe(
      SCAN_ANIMATION_TOTAL_DURATION_MS,
    );
  });

  it('exposes exactly 8 Korean stage labels', () => {
    expect(SCAN_ANIMATION_STAGE_LABELS).toHaveLength(SCAN_ANIMATION_TOTAL_STAGES);
    for (const label of SCAN_ANIMATION_STAGE_LABELS) {
      expect(label.length).toBeGreaterThan(0);
      expect(/[가-힣]/.test(label)).toBe(true);
    }
  });

  it('stage labels are all unique (no duplicated entries)', () => {
    const unique = new Set(SCAN_ANIMATION_STAGE_LABELS);
    expect(unique.size).toBe(SCAN_ANIMATION_STAGE_LABELS.length);
  });

  it('CANONICAL_SCAN_ANIMATION_STAGES windows tile [0, 3200) without gaps or overlap', () => {
    expect(CANONICAL_SCAN_ANIMATION_STAGES).toHaveLength(SCAN_ANIMATION_TOTAL_STAGES);
    CANONICAL_SCAN_ANIMATION_STAGES.forEach((stage, idx) => {
      expect(stage.index).toBe(idx);
      expect(stage.label).toBe(SCAN_ANIMATION_STAGE_LABELS[idx]);
      expect(stage.startsAtMs).toBe(idx * SCAN_ANIMATION_STAGE_DURATION_MS);
      expect(stage.endsAtMs).toBe((idx + 1) * SCAN_ANIMATION_STAGE_DURATION_MS);
      expect(Object.isFrozen(stage)).toBe(true);
    });
    // Contiguity: stage N+1 starts exactly where stage N ends.
    for (let i = 0; i < CANONICAL_SCAN_ANIMATION_STAGES.length - 1; i += 1) {
      const cur = CANONICAL_SCAN_ANIMATION_STAGES[i] as ScanAnimationStage;
      const next = CANONICAL_SCAN_ANIMATION_STAGES[i + 1] as ScanAnimationStage;
      expect(next.startsAtMs).toBe(cur.endsAtMs);
    }
  });

  it('CANONICAL_SCAN_ANIMATION_STAGES array is frozen', () => {
    expect(Object.isFrozen(CANONICAL_SCAN_ANIMATION_STAGES)).toBe(true);
    expect(Object.isFrozen(SCAN_ANIMATION_STAGE_LABELS)).toBe(true);
  });

  it('getScanAnimationStage is total over ScanAnimationStageIndex and returns the canonical record', () => {
    for (let i = 0; i < SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      const idx = i as ScanAnimationStageIndex;
      expect(getScanAnimationStage(idx)).toBe(CANONICAL_SCAN_ANIMATION_STAGES[idx]);
    }
  });
});

// ---------------------------------------------------------------------------
// Pure state machine
// ---------------------------------------------------------------------------

describe('createScanAnimation', () => {
  it('returns an idle, frozen state with 0% progress', () => {
    const s = createScanAnimation();
    expect(s.phase).toBe('idle');
    expect(s.currentStageIndex).toBeNull();
    expect(s.elapsedMs).toBe(0);
    expect(s.progressPercent).toBe(0);
    expect(s.startedAtMs).toBeNull();
    expect(s.stages).toBe(CANONICAL_SCAN_ANIMATION_STAGES);
    expect(Object.isFrozen(s)).toBe(true);
    expect(isScanAnimationComplete(s)).toBe(false);
  });
});

describe('startScanAnimation', () => {
  it('moves any prior state to running stage 0 anchored at `nowMs`', () => {
    const idle = createScanAnimation();
    const started = startScanAnimation(idle, 1_700_000_000_000);
    expect(started.phase).toBe('running');
    expect(started.currentStageIndex).toBe(0);
    expect(started.elapsedMs).toBe(0);
    expect(started.progressPercent).toBe(0);
    expect(started.startedAtMs).toBe(1_700_000_000_000);
    expect(Object.isFrozen(started)).toBe(true);
    expect(started).not.toBe(idle);
  });

  it('restarting from a running state re-anchors the timeline', () => {
    const a = startScanAnimation(createScanAnimation(), 1_000);
    const b = startScanAnimation(a, 5_500);
    expect(b.startedAtMs).toBe(5_500);
    expect(b.elapsedMs).toBe(0);
    expect(b.currentStageIndex).toBe(0);
  });
});

describe('tickScanAnimation — boundary semantics', () => {
  function project(elapsed: number): ScanAnimationState {
    return tickScanAnimation(startScanAnimation(createScanAnimation(), 0), elapsed);
  }

  it('idle ticks are inert', () => {
    const idle = createScanAnimation();
    expect(tickScanAnimation(idle, 9_999)).toBe(idle);
  });

  it.each([
    [0, 0],
    [1, 0],
    [399, 0],
    [400, 1],
    [500, 1],
    [799, 1],
    [800, 2],
    [1_199, 2],
    [1_200, 3],
    [1_599, 3],
    [1_600, 4],
    [1_999, 4],
    [2_000, 5],
    [2_399, 5],
    [2_400, 6],
    [2_799, 6],
    [2_800, 7],
    [3_199, 7],
  ])('elapsed=%i ms → stage %i', (elapsed, expectedStage) => {
    const s = project(elapsed);
    expect(s.phase).toBe('running');
    expect(s.currentStageIndex).toBe(expectedStage);
  });

  it('latches to complete at exactly 3200 ms with stage 7 and 100% progress', () => {
    const s = project(SCAN_ANIMATION_TOTAL_DURATION_MS);
    expect(s.phase).toBe('complete');
    expect(s.currentStageIndex).toBe(7);
    expect(s.progressPercent).toBe(100);
    expect(s.elapsedMs).toBe(SCAN_ANIMATION_TOTAL_DURATION_MS);
    expect(isScanAnimationComplete(s)).toBe(true);
  });

  it('further ticks past 3200 ms are idempotent (referential identity)', () => {
    const a = project(SCAN_ANIMATION_TOTAL_DURATION_MS);
    const b = tickScanAnimation(a, SCAN_ANIMATION_TOTAL_DURATION_MS + 9_999);
    expect(b).toBe(a);
  });

  it('clamps backward clock drift to zero elapsed', () => {
    const started = startScanAnimation(createScanAnimation(), 10_000);
    const drifted = tickScanAnimation(started, 5_000); // now < startedAtMs
    expect(drifted.elapsedMs).toBe(0);
    expect(drifted.currentStageIndex).toBe(0);
    expect(drifted.phase).toBe('running');
  });

  it('progress percent climbs monotonically from 0 to 100', () => {
    const samples = [0, 200, 400, 800, 1_200, 1_600, 2_000, 2_400, 2_800, 3_199, 3_200];
    const percents = samples.map((ms) => project(ms).progressPercent);
    for (let i = 1; i < percents.length; i += 1) {
      const prev = percents[i - 1] as number;
      const cur = percents[i] as number;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
    expect(percents[0]).toBe(0);
    expect(percents[percents.length - 1]).toBe(100);
  });

  it('repeated ticks within the same stage at the same elapsed ms return the same instance (no churn)', () => {
    const started = startScanAnimation(createScanAnimation(), 0);
    const a = tickScanAnimation(started, 500); // mid stage 1
    const b = tickScanAnimation(a, 500);
    expect(b).toBe(a);
  });

  it('every projected snapshot is frozen', () => {
    const samples = [0, 100, 400, 1_000, 2_500, 3_200, 5_000];
    for (const ms of samples) {
      const s = project(ms);
      expect(Object.isFrozen(s)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Stage transition ORDER
// ---------------------------------------------------------------------------

describe('stage transition order — strictly 0 → 7', () => {
  it('walking the timeline in 400 ms steps visits stages 0..7 in order', () => {
    const visited: ScanAnimationStageIndex[] = [];
    const started = startScanAnimation(createScanAnimation(), 0);
    let state: ScanAnimationState = started;
    if (state.currentStageIndex !== null) visited.push(state.currentStageIndex);

    for (let i = 1; i < SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      const next = tickScanAnimation(state, i * SCAN_ANIMATION_STAGE_DURATION_MS);
      if (next.currentStageIndex !== null) {
        visited.push(next.currentStageIndex);
      }
      state = next;
    }

    expect(visited).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

// ---------------------------------------------------------------------------
// useScanAnimation — fake-timer driven
// ---------------------------------------------------------------------------

describe('useScanAnimation — fake-timer driven 400 ms cadence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('progresses through 8 stages over 3200 ms with 400 ms transitions', () => {
    const controller = useScanAnimation();
    const observed: ScanAnimationState[] = [];
    controller.subscribe((s) => observed.push(s));

    controller.start();

    // After start: stage 0, 0% progress.
    const initial = controller.snapshot();
    expect(initial.phase).toBe('running');
    expect(initial.currentStageIndex).toBe(0);
    expect(initial.progressPercent).toBe(0);

    const expectedSequence: ReadonlyArray<{
      readonly afterMs: number;
      readonly stageIndex: ScanAnimationStageIndex;
      readonly phase: 'running' | 'complete';
      readonly progress: number;
    }> = [
      { afterMs: 400, stageIndex: 1, phase: 'running', progress: 12 },
      { afterMs: 800, stageIndex: 2, phase: 'running', progress: 25 },
      { afterMs: 1_200, stageIndex: 3, phase: 'running', progress: 37 },
      { afterMs: 1_600, stageIndex: 4, phase: 'running', progress: 50 },
      { afterMs: 2_000, stageIndex: 5, phase: 'running', progress: 62 },
      { afterMs: 2_400, stageIndex: 6, phase: 'running', progress: 75 },
      { afterMs: 2_800, stageIndex: 7, phase: 'running', progress: 87 },
      { afterMs: 3_200, stageIndex: 7, phase: 'complete', progress: 100 },
    ];

    let elapsed = 0;
    for (const step of expectedSequence) {
      const delta = step.afterMs - elapsed;
      vi.advanceTimersByTime(delta);
      elapsed = step.afterMs;

      const snap = controller.snapshot();
      expect(snap.phase, `at ${step.afterMs}ms`).toBe(step.phase);
      expect(snap.currentStageIndex, `at ${step.afterMs}ms`).toBe(step.stageIndex);
      expect(snap.progressPercent, `at ${step.afterMs}ms`).toBe(step.progress);
      expect(snap.elapsedMs, `at ${step.afterMs}ms`).toBe(step.afterMs);
    }

    // Subscribers see exactly 9 snapshots: 1 on start (stage 0) + 7 stage
    // boundaries (stages 1..7) + 1 completion.
    expect(observed).toHaveLength(9);
    expect(observed[0]?.currentStageIndex).toBe(0);
    expect(observed[1]?.currentStageIndex).toBe(1);
    expect(observed[2]?.currentStageIndex).toBe(2);
    expect(observed[3]?.currentStageIndex).toBe(3);
    expect(observed[4]?.currentStageIndex).toBe(4);
    expect(observed[5]?.currentStageIndex).toBe(5);
    expect(observed[6]?.currentStageIndex).toBe(6);
    expect(observed[7]?.currentStageIndex).toBe(7);
    expect(observed[7]?.phase).toBe('running');
    expect(observed[8]?.currentStageIndex).toBe(7);
    expect(observed[8]?.phase).toBe('complete');
  });

  it('invokes onStageChange with each stage in canonical order', () => {
    const stages: ScanAnimationStage[] = [];
    const controller = useScanAnimation({
      onStageChange: (s) => stages.push(s),
    });
    controller.start();
    vi.advanceTimersByTime(SCAN_ANIMATION_TOTAL_DURATION_MS);

    expect(stages.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(stages.map((s) => s.label)).toEqual([...SCAN_ANIMATION_STAGE_LABELS]);
  });

  it('invokes onComplete exactly once when the animation latches', () => {
    const onComplete = vi.fn();
    const controller = useScanAnimation({ onComplete });
    controller.start();

    vi.advanceTimersByTime(3_199);
    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Subsequent imaginary ticks do not re-fire.
    vi.advanceTimersByTime(10_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cancel() clears pending timers and resets to idle', () => {
    const onComplete = vi.fn();
    const observed: ScanAnimationState[] = [];
    const controller = useScanAnimation({ onComplete });
    controller.subscribe((s) => observed.push(s));

    controller.start();
    vi.advanceTimersByTime(1_700); // mid stage 4
    expect(controller.snapshot().phase).toBe('running');

    controller.cancel();
    const cancelled = controller.snapshot();
    expect(cancelled.phase).toBe('idle');
    expect(cancelled.currentStageIndex).toBeNull();
    expect(cancelled.progressPercent).toBe(0);

    // Pending timers should be neutralised — running the rest of the
    // 3.2 s window must NOT produce more state changes or fire onComplete.
    const sizeBefore = observed.length;
    vi.advanceTimersByTime(10_000);
    expect(observed.length).toBe(sizeBefore);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('restarting clears the prior run before re-entering stage 0', () => {
    const onComplete = vi.fn();
    const controller = useScanAnimation({ onComplete });
    controller.start();
    vi.advanceTimersByTime(1_500); // stage 3

    controller.start(); // re-anchor at "now"
    expect(controller.snapshot().currentStageIndex).toBe(0);
    expect(controller.snapshot().elapsedMs).toBe(0);

    // The full 3.2 s must elapse from the *new* start, not the old one.
    vi.advanceTimersByTime(3_199);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('subscribers can detach without affecting the rest', () => {
    const a = vi.fn();
    const b = vi.fn();
    const controller = useScanAnimation();
    const unsubA = controller.subscribe(a);
    controller.subscribe(b);

    controller.start();
    vi.advanceTimersByTime(400); // stage 1 boundary
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();

    const aCallsAtDetach = a.mock.calls.length;
    unsubA();

    vi.advanceTimersByTime(SCAN_ANIMATION_TOTAL_DURATION_MS); // run to completion
    expect(a.mock.calls.length).toBe(aCallsAtDetach);
    expect(b.mock.calls.length).toBeGreaterThan(aCallsAtDetach);
  });

  it('accepts an injected scheduler (clock + timers) for fully deterministic tests', () => {
    type DeferredTask = { readonly fireAt: number; readonly fn: () => void };
    const tasks: DeferredTask[] = [];
    let virtualNow = 0;

    const drainUpTo = (target: number): void => {
      // Fire tasks in scheduled order.
      tasks.sort((x, y) => x.fireAt - y.fireAt);
      while (tasks.length > 0 && (tasks[0] as DeferredTask).fireAt <= target) {
        const next = tasks.shift() as DeferredTask;
        virtualNow = next.fireAt;
        next.fn();
      }
      virtualNow = target;
    };

    const stagesSeen: ScanAnimationStageIndex[] = [];
    const controller = useScanAnimation({
      scheduler: {
        now: () => virtualNow,
        setTimer: (fn, ms) => {
          const task: DeferredTask = { fireAt: virtualNow + ms, fn };
          tasks.push(task);
          return task;
        },
        clearTimer: (handle) => {
          const idx = tasks.indexOf(handle as DeferredTask);
          if (idx >= 0) tasks.splice(idx, 1);
        },
      },
      onStageChange: (stage) => stagesSeen.push(stage.index),
    });

    controller.start();
    expect(controller.snapshot().currentStageIndex).toBe(0);

    // Walk through every boundary in order.
    for (let i = 1; i <= SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      drainUpTo(i * SCAN_ANIMATION_STAGE_DURATION_MS);
    }

    expect(controller.snapshot().phase).toBe('complete');
    expect(controller.snapshot().progressPercent).toBe(100);
    expect(stagesSeen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('uses the default scheduler when none is provided (smoke check)', () => {
    // No scheduler override → exercises the DEFAULT_SCHEDULER path.
    const onComplete = vi.fn();
    const controller = useScanAnimation({ onComplete });
    controller.start();
    vi.advanceTimersByTime(SCAN_ANIMATION_TOTAL_DURATION_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().phase).toBe('complete');
  });

  it('partial scheduler override falls back to defaults for missing fields', () => {
    // Only override `now` — `setTimer`/`clearTimer` come from the default.
    let nowCalls = 0;
    const controller = useScanAnimation({
      scheduler: {
        now: () => {
          nowCalls += 1;
          return Date.now();
        },
      },
    });
    controller.start();
    vi.advanceTimersByTime(SCAN_ANIMATION_TOTAL_DURATION_MS);
    expect(nowCalls).toBeGreaterThan(0);
    expect(controller.snapshot().phase).toBe('complete');
  });
});
