/**
 * Unit tests — Sub-AC 10.1: 5-stage 'Analyzing' fake loader state machine
 * + `useAnalyzingLoader` hook.
 *
 * Verifies:
 *   - Public constants match the Seed (5 stages × 1000 ms = 5000 ms).
 *   - The 5 canonical stages line up 1:1 with the Korean labels (피부 톤,
 *     명도, 채도, 컨트라스트, 결과 정리) and the durationMs metadata on
 *     `FUNNEL_SCREENS.fake_loader`.
 *   - Pure state-machine transitions: idle → start (stage 0) → tick →
 *     latched complete at 5000 ms.
 *   - Boundary semantics: each `n*1000 ms` boundary is the FIRST tick of
 *     stage `n` (inclusive lower bound).
 *   - Idempotence past completion (no churn).
 *   - Immutability — every returned state is frozen.
 *   - `useAnalyzingLoader` hook driven by fake timers:
 *       * notifies subscribers on every observable change (start + each of
 *         the 4 intermediate ticks + completion = 5 boundary notifications),
 *       * passes each stage in canonical order to `onStageChange`,
 *       * fires `onComplete` exactly once at 5000 ms,
 *       * `cancel()` clears pending timers and resets to idle,
 *       * a fresh `start()` resets the timeline.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  ANALYZING_STAGE_DURATION_MS,
  ANALYZING_STAGE_LABELS,
  ANALYZING_TOTAL_DURATION_MS,
  ANALYZING_TOTAL_STAGES,
  CANONICAL_ANALYZING_STAGES,
  createAnalyzingLoader,
  getAnalyzingStage,
  isAnalyzingComplete,
  startAnalyzingLoader,
  tickAnalyzingLoader,
  useAnalyzingLoader,
  type AnalyzingLoaderState,
  type AnalyzingStage,
  type AnalyzingStageIndex,
} from '../../src/funnel/analyzing-loader.js';
import { FUNNEL_SCREENS } from '../../src/funnel/screens.js';

// ---------------------------------------------------------------------------
// Constants & canonical stages
// ---------------------------------------------------------------------------

describe('analyzing-loader — public constants', () => {
  it('defines exactly 5 stages with a 1000 ms cadence and a 5000 ms total', () => {
    expect(ANALYZING_TOTAL_STAGES).toBe(5);
    expect(ANALYZING_STAGE_DURATION_MS).toBe(1_000);
    expect(ANALYZING_TOTAL_DURATION_MS).toBe(5_000);
    expect(ANALYZING_TOTAL_STAGES * ANALYZING_STAGE_DURATION_MS).toBe(
      ANALYZING_TOTAL_DURATION_MS,
    );
  });

  it('aligns ANALYZING_TOTAL_DURATION_MS with FUNNEL_SCREENS.fake_loader durationMs', () => {
    const loaderScreen = FUNNEL_SCREENS.fake_loader;
    expect(loaderScreen.metadata['durationMs']).toBe(
      ANALYZING_TOTAL_DURATION_MS,
    );
  });

  it('exposes exactly 5 Korean stage labels', () => {
    expect(ANALYZING_STAGE_LABELS).toHaveLength(ANALYZING_TOTAL_STAGES);
    for (const label of ANALYZING_STAGE_LABELS) {
      expect(label.length).toBeGreaterThan(0);
      expect(/[가-힣]/.test(label)).toBe(true);
    }
  });

  it('CANONICAL_ANALYZING_STAGES windows tile [0, 5000) without gaps or overlap', () => {
    expect(CANONICAL_ANALYZING_STAGES).toHaveLength(ANALYZING_TOTAL_STAGES);
    CANONICAL_ANALYZING_STAGES.forEach((stage, idx) => {
      expect(stage.index).toBe(idx);
      expect(stage.label).toBe(ANALYZING_STAGE_LABELS[idx]);
      expect(stage.startsAtMs).toBe(idx * ANALYZING_STAGE_DURATION_MS);
      expect(stage.endsAtMs).toBe((idx + 1) * ANALYZING_STAGE_DURATION_MS);
      expect(Object.isFrozen(stage)).toBe(true);
    });
    // Contiguity: stage N+1 starts exactly where stage N ends.
    for (let i = 0; i < CANONICAL_ANALYZING_STAGES.length - 1; i += 1) {
      const cur = CANONICAL_ANALYZING_STAGES[i] as AnalyzingStage;
      const next = CANONICAL_ANALYZING_STAGES[i + 1] as AnalyzingStage;
      expect(next.startsAtMs).toBe(cur.endsAtMs);
    }
  });

  it('getAnalyzingStage is total over AnalyzingStageIndex and returns the canonical record', () => {
    for (let i = 0; i < ANALYZING_TOTAL_STAGES; i += 1) {
      const idx = i as AnalyzingStageIndex;
      expect(getAnalyzingStage(idx)).toBe(CANONICAL_ANALYZING_STAGES[idx]);
    }
  });
});

// ---------------------------------------------------------------------------
// Pure state machine
// ---------------------------------------------------------------------------

describe('createAnalyzingLoader', () => {
  it('returns an idle, frozen state with stage 0%', () => {
    const s = createAnalyzingLoader();
    expect(s.phase).toBe('idle');
    expect(s.currentStageIndex).toBeNull();
    expect(s.elapsedMs).toBe(0);
    expect(s.progressPercent).toBe(0);
    expect(s.startedAtMs).toBeNull();
    expect(s.stages).toBe(CANONICAL_ANALYZING_STAGES);
    expect(Object.isFrozen(s)).toBe(true);
  });
});

describe('startAnalyzingLoader', () => {
  it('moves any prior state to running stage 0 anchored at `nowMs`', () => {
    const idle = createAnalyzingLoader();
    const started = startAnalyzingLoader(idle, 1_700_000_000_000);
    expect(started.phase).toBe('running');
    expect(started.currentStageIndex).toBe(0);
    expect(started.elapsedMs).toBe(0);
    expect(started.progressPercent).toBe(0);
    expect(started.startedAtMs).toBe(1_700_000_000_000);
    expect(Object.isFrozen(started)).toBe(true);
    expect(started).not.toBe(idle);
  });

  it('restarting from a running state re-anchors the timeline', () => {
    const a = startAnalyzingLoader(createAnalyzingLoader(), 1_000);
    const b = startAnalyzingLoader(a, 5_500);
    expect(b.startedAtMs).toBe(5_500);
    expect(b.elapsedMs).toBe(0);
    expect(b.currentStageIndex).toBe(0);
  });
});

describe('tickAnalyzingLoader — boundary semantics', () => {
  function project(elapsed: number): AnalyzingLoaderState {
    return tickAnalyzingLoader(
      startAnalyzingLoader(createAnalyzingLoader(), 0),
      elapsed,
    );
  }

  it('idle ticks are inert', () => {
    const idle = createAnalyzingLoader();
    expect(tickAnalyzingLoader(idle, 9_999)).toBe(idle);
  });

  it.each([
    [0, 0],
    [1, 0],
    [999, 0],
    [1_000, 1],
    [1_500, 1],
    [1_999, 1],
    [2_000, 2],
    [2_999, 2],
    [3_000, 3],
    [3_500, 3],
    [3_999, 3],
    [4_000, 4],
    [4_999, 4],
  ])('elapsed=%i ms → stage %i', (elapsed, expectedStage) => {
    const s = project(elapsed);
    expect(s.phase).toBe('running');
    expect(s.currentStageIndex).toBe(expectedStage);
  });

  it('latches to complete at exactly 5000 ms with stage 4 and 100% progress', () => {
    const s = project(ANALYZING_TOTAL_DURATION_MS);
    expect(s.phase).toBe('complete');
    expect(s.currentStageIndex).toBe(4);
    expect(s.progressPercent).toBe(100);
    expect(s.elapsedMs).toBe(ANALYZING_TOTAL_DURATION_MS);
    expect(isAnalyzingComplete(s)).toBe(true);
  });

  it('further ticks past 5000 ms are idempotent (referential identity)', () => {
    const a = project(ANALYZING_TOTAL_DURATION_MS);
    const b = tickAnalyzingLoader(a, ANALYZING_TOTAL_DURATION_MS + 9_999);
    expect(b).toBe(a);
  });

  it('clamps backward clock drift to zero elapsed', () => {
    const started = startAnalyzingLoader(createAnalyzingLoader(), 10_000);
    const drifted = tickAnalyzingLoader(started, 5_000); // now < startedAtMs
    expect(drifted.elapsedMs).toBe(0);
    expect(drifted.currentStageIndex).toBe(0);
    expect(drifted.phase).toBe('running');
  });

  it('progress percent climbs monotonically from 0 to 100', () => {
    const samples = [0, 500, 1_000, 1_500, 2_500, 3_750, 4_999, 5_000];
    const percents = samples.map((ms) => project(ms).progressPercent);
    // Monotonic non-decreasing.
    for (let i = 1; i < percents.length; i += 1) {
      const prev = percents[i - 1] as number;
      const cur = percents[i] as number;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
    expect(percents[0]).toBe(0);
    expect(percents[percents.length - 1]).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// useAnalyzingLoader — fake-timer driven
// ---------------------------------------------------------------------------

describe('useAnalyzingLoader — fake-timer driven 1-second cadence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('progresses through 5 stages over 5 seconds with 1-second transitions', () => {
    const controller = useAnalyzingLoader();
    const observed: AnalyzingLoaderState[] = [];
    controller.subscribe((s) => observed.push(s));

    controller.start();

    // After start: stage 0, 0% progress.
    const initial = controller.snapshot();
    expect(initial.phase).toBe('running');
    expect(initial.currentStageIndex).toBe(0);
    expect(initial.progressPercent).toBe(0);

    // Advance one stage at a time and assert the transition fires
    // exactly on the boundary.
    const expectedSequence: ReadonlyArray<{
      readonly afterMs: number;
      readonly stageIndex: AnalyzingStageIndex;
      readonly phase: 'running' | 'complete';
      readonly progress: number;
    }> = [
      { afterMs: 1_000, stageIndex: 1, phase: 'running', progress: 20 },
      { afterMs: 2_000, stageIndex: 2, phase: 'running', progress: 40 },
      { afterMs: 3_000, stageIndex: 3, phase: 'running', progress: 60 },
      { afterMs: 4_000, stageIndex: 4, phase: 'running', progress: 80 },
      { afterMs: 5_000, stageIndex: 4, phase: 'complete', progress: 100 },
    ];

    let elapsed = 0;
    for (const step of expectedSequence) {
      const delta = step.afterMs - elapsed;
      vi.advanceTimersByTime(delta);
      elapsed = step.afterMs;

      const snap = controller.snapshot();
      expect(snap.phase, `at ${step.afterMs}ms`).toBe(step.phase);
      expect(snap.currentStageIndex, `at ${step.afterMs}ms`).toBe(
        step.stageIndex,
      );
      expect(snap.progressPercent, `at ${step.afterMs}ms`).toBe(step.progress);
      expect(snap.elapsedMs, `at ${step.afterMs}ms`).toBe(step.afterMs);
    }

    // Subscribers see exactly 6 snapshots: 1 on start (stage 0) + 4 stage
    // boundaries (stages 1..4) + 1 completion.
    expect(observed).toHaveLength(6);
    expect(observed[0]?.currentStageIndex).toBe(0);
    expect(observed[1]?.currentStageIndex).toBe(1);
    expect(observed[2]?.currentStageIndex).toBe(2);
    expect(observed[3]?.currentStageIndex).toBe(3);
    expect(observed[4]?.currentStageIndex).toBe(4);
    expect(observed[4]?.phase).toBe('running');
    expect(observed[5]?.currentStageIndex).toBe(4);
    expect(observed[5]?.phase).toBe('complete');
  });

  it('invokes onStageChange with each stage in canonical order', () => {
    const stages: AnalyzingStage[] = [];
    const controller = useAnalyzingLoader({
      onStageChange: (s) => stages.push(s),
    });
    controller.start();
    vi.advanceTimersByTime(ANALYZING_TOTAL_DURATION_MS);

    expect(stages.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(stages.map((s) => s.label)).toEqual([...ANALYZING_STAGE_LABELS]);
  });

  it('invokes onComplete exactly once when the loader latches', () => {
    const onComplete = vi.fn();
    const controller = useAnalyzingLoader({ onComplete });
    controller.start();

    vi.advanceTimersByTime(4_999);
    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Subsequent imaginary ticks do not re-fire.
    vi.advanceTimersByTime(10_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cancel() clears pending timers and resets to idle', () => {
    const onComplete = vi.fn();
    const observed: AnalyzingLoaderState[] = [];
    const controller = useAnalyzingLoader({ onComplete });
    controller.subscribe((s) => observed.push(s));

    controller.start();
    vi.advanceTimersByTime(2_500); // mid-stage 3
    expect(controller.snapshot().phase).toBe('running');

    controller.cancel();
    const cancelled = controller.snapshot();
    expect(cancelled.phase).toBe('idle');
    expect(cancelled.currentStageIndex).toBeNull();
    expect(cancelled.progressPercent).toBe(0);

    // Pending timers should be neutralised — running the rest of the
    // 5 s window must NOT produce more state changes or fire onComplete.
    const sizeBefore = observed.length;
    vi.advanceTimersByTime(10_000);
    expect(observed.length).toBe(sizeBefore);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('restarting clears the prior run before re-entering stage 0', () => {
    const onComplete = vi.fn();
    const controller = useAnalyzingLoader({ onComplete });
    controller.start();
    vi.advanceTimersByTime(3_000); // stage 3

    controller.start(); // re-anchor at "now"
    expect(controller.snapshot().currentStageIndex).toBe(0);
    expect(controller.snapshot().elapsedMs).toBe(0);

    // The full 5 s must elapse from the *new* start, not the old one.
    vi.advanceTimersByTime(4_999);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('subscribers can detach without affecting the rest', () => {
    const a = vi.fn();
    const b = vi.fn();
    const controller = useAnalyzingLoader();
    const unsubA = controller.subscribe(a);
    controller.subscribe(b);

    controller.start();
    vi.advanceTimersByTime(1_000); // stage 1 boundary
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();

    const aCallsAtDetach = a.mock.calls.length;
    unsubA();

    vi.advanceTimersByTime(ANALYZING_TOTAL_DURATION_MS); // run to completion
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

    const controller = useAnalyzingLoader({
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
    });

    controller.start();
    expect(controller.snapshot().currentStageIndex).toBe(0);

    drainUpTo(1_000);
    expect(controller.snapshot().currentStageIndex).toBe(1);

    drainUpTo(2_000);
    expect(controller.snapshot().currentStageIndex).toBe(2);

    drainUpTo(5_000);
    expect(controller.snapshot().phase).toBe('complete');
    expect(controller.snapshot().progressPercent).toBe(100);
  });
});
