/**
 * Component tests — Sub-AC 10.3: `AnalyzingLoader` UI component.
 *
 * The codebase has no React runtime, so the "component" is a framework-
 * agnostic view-model + a `mount` wrapper.  These tests verify:
 *
 *   - `renderAnalyzingLoaderComponent(state)` projects the loader state
 *     into a frozen view-model containing all 5 Korean stage texts plus
 *     per-row status (`pending` / `active` / `done`).
 *   - Idle, mid-stage, and complete states each produce the correct
 *     headline / subhead / progress / aria-live politeness.
 *   - `mountAnalyzingLoaderComponent({ render, onComplete })` invokes the
 *     render callback at every state boundary (idle frame → stage 0 →
 *     stages 1..4 → complete) and fires `onComplete` exactly once at
 *     5000 ms when driven by fake timers.
 *   - `unmount()` cancels in-flight timers and stops further renders.
 *
 * The fake-timer assertion is the load-bearing one for the Sub-AC: it
 * proves the 5-second `onComplete` contract claimed in the task brief.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ANALYZING_STAGE_LABELS,
  ANALYZING_TOTAL_DURATION_MS,
  CANONICAL_ANALYZING_STAGES,
  createAnalyzingLoader,
  startAnalyzingLoader,
  tickAnalyzingLoader,
  type AnalyzingLoaderState,
  type AnalyzingStageIndex,
} from '../../src/funnel/analyzing-loader.js';
import {
  ANALYZING_LOADER_COMPONENT_TEST_ID,
  mountAnalyzingLoaderComponent,
  renderAnalyzingLoaderComponent,
  type AnalyzingLoaderComponentViewModel,
} from '../../src/funnel/analyzing-loader-component.js';
import { FUNNEL_SCREENS } from '../../src/funnel/screens.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function projectAt(elapsed: number): AnalyzingLoaderState {
  return tickAnalyzingLoader(
    startAnalyzingLoader(createAnalyzingLoader(), 0),
    elapsed,
  );
}

function labelsOf(vm: AnalyzingLoaderComponentViewModel): readonly string[] {
  return vm.items.map((it) => it.label);
}

function statusesOf(
  vm: AnalyzingLoaderComponentViewModel,
): readonly string[] {
  return vm.items.map((it) => it.status);
}

// ---------------------------------------------------------------------------
// renderAnalyzingLoaderComponent — pure projection
// ---------------------------------------------------------------------------

describe('renderAnalyzingLoaderComponent — idle state', () => {
  it('produces a frozen view-model with headline / subhead from FUNNEL_SCREENS.fake_loader', () => {
    const vm = renderAnalyzingLoaderComponent();
    const screen = FUNNEL_SCREENS.fake_loader;

    expect(vm.stepId).toBe('fake_loader');
    expect(vm.stepNumber).toBe(8);
    expect(vm.headline).toBe(screen.headline);
    expect(vm.subhead).toBe(screen.subhead);
    expect(vm.testId).toBe(ANALYZING_LOADER_COMPONENT_TEST_ID);
    expect(vm.key).toBe(ANALYZING_LOADER_COMPONENT_TEST_ID);
    expect(Object.isFrozen(vm)).toBe(true);
    expect(Object.isFrozen(vm.items)).toBe(true);
  });

  it('renders all 5 Korean stage texts in canonical order, all pending', () => {
    const vm = renderAnalyzingLoaderComponent();
    expect(vm.items).toHaveLength(ANALYZING_STAGE_LABELS.length);
    expect(labelsOf(vm)).toEqual([...ANALYZING_STAGE_LABELS]);
    expect(statusesOf(vm)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    vm.items.forEach((it, idx) => {
      expect(it.index).toBe(idx);
      expect(it.testId).toBe(`analyzing-stage-${idx}`);
      expect(it.key).toBe(`analyzing-stage-${idx}`);
      expect(it.isActive).toBe(false);
      expect(it.isDone).toBe(false);
      expect(Object.isFrozen(it)).toBe(true);
    });
  });

  it('reports zero progress and silent aria-live at idle', () => {
    const vm = renderAnalyzingLoaderComponent();
    expect(vm.phase).toBe('idle');
    expect(vm.currentStageIndex).toBeNull();
    expect(vm.currentStageLabel).toBeNull();
    expect(vm.progressPercent).toBe(0);
    expect(vm.progressPercentText).toBe('0%');
    expect(vm.isComplete).toBe(false);
    expect(vm.ariaLive).toBe('off');
    expect(vm.totalDurationMs).toBe(ANALYZING_TOTAL_DURATION_MS);
    expect(vm.elapsedMs).toBe(0);
  });
});

describe('renderAnalyzingLoaderComponent — running stages', () => {
  it.each([
    [0, 0, 0, 'done|active|pending|pending|pending', 20], // boundary of stage 0
    [1, 1_000, 20, 'done|active|pending|pending|pending', 40],
    [2, 2_000, 40, 'done|done|active|pending|pending', 60],
    [3, 3_000, 60, 'done|done|done|active|pending', 80],
    [4, 4_000, 80, 'done|done|done|done|active', 100],
  ])(
    'stage %i (elapsed=%i ms) — items reflect per-row done/active/pending',
    (
      stageIndex,
      elapsed,
      progressPercent,
      _ignoredPattern,
      _progressAtBoundary,
    ) => {
      const state = projectAt(elapsed);
      const vm = renderAnalyzingLoaderComponent(state);

      expect(vm.phase).toBe('running');
      expect(vm.currentStageIndex).toBe(stageIndex);
      expect(vm.currentStageLabel).toBe(ANALYZING_STAGE_LABELS[stageIndex]);
      expect(vm.progressPercent).toBe(progressPercent);
      expect(vm.progressPercentText).toBe(`${progressPercent}%`);
      expect(vm.isComplete).toBe(false);
      expect(vm.ariaLive).toBe('polite');

      // Per-row status invariants.
      vm.items.forEach((it, idx) => {
        if (idx < stageIndex) {
          expect(it.status, `stage<${idx}>`).toBe('done');
          expect(it.isDone).toBe(true);
          expect(it.isActive).toBe(false);
        } else if (idx === stageIndex) {
          expect(it.status, `stage<${idx}>`).toBe('active');
          expect(it.isActive).toBe(true);
          expect(it.isDone).toBe(false);
        } else {
          expect(it.status, `stage<${idx}>`).toBe('pending');
          expect(it.isActive).toBe(false);
          expect(it.isDone).toBe(false);
        }
      });

      // Labels never change regardless of state.
      expect(labelsOf(vm)).toEqual([...ANALYZING_STAGE_LABELS]);
    },
  );

  it('mid-stage (non-boundary) elapsed still highlights the right stage', () => {
    // 2_500 ms → 1 full second into stage 2 (채도 측정).
    const vm = renderAnalyzingLoaderComponent(projectAt(2_500));
    expect(vm.currentStageIndex).toBe(2);
    expect(vm.currentStageLabel).toBe('채도 측정');
    expect(vm.items[2]?.isActive).toBe(true);
    expect(vm.items[1]?.isDone).toBe(true);
    expect(vm.items[3]?.status).toBe('pending');
    // Progress is floored: 2500 / 5000 = 50%.
    expect(vm.progressPercent).toBe(50);
    expect(vm.progressPercentText).toBe('50%');
  });
});

describe('renderAnalyzingLoaderComponent — complete state', () => {
  it('latches all rows to done, 100%, assertive aria-live', () => {
    const state = projectAt(ANALYZING_TOTAL_DURATION_MS);
    const vm = renderAnalyzingLoaderComponent(state);

    expect(vm.phase).toBe('complete');
    expect(vm.currentStageIndex).toBe(CANONICAL_ANALYZING_STAGES.length - 1);
    expect(vm.currentStageLabel).toBe(
      ANALYZING_STAGE_LABELS[ANALYZING_STAGE_LABELS.length - 1],
    );
    expect(vm.progressPercent).toBe(100);
    expect(vm.progressPercentText).toBe('100%');
    expect(vm.isComplete).toBe(true);
    expect(vm.ariaLive).toBe('assertive');

    statusesOf(vm).forEach((s) => expect(s).toBe('done'));
    vm.items.forEach((it) => {
      expect(it.isDone).toBe(true);
      expect(it.isActive).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// mountAnalyzingLoaderComponent — fake-timer driven
// ---------------------------------------------------------------------------

describe('mountAnalyzingLoaderComponent — fake-timer driven 5-second contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders idle → running stage 0 → ... → complete with 6 boundary renders', () => {
    const renders: AnalyzingLoaderComponentViewModel[] = [];
    const onComplete = vi.fn();

    const handle = mountAnalyzingLoaderComponent({
      render: (vm) => renders.push(vm),
      onComplete,
    });

    // First render = idle frame painted synchronously before start().
    // Second render = stage 0 fired by start().
    // Subsequent = stages 1..4 + complete.
    // Total: 1 idle + 1 start + 4 stage ticks + 1 completion = 7 renders.
    //
    // The first two arrive synchronously inside `mount`; the remainder fire
    // as the fake clock advances 1 s at a time.

    expect(renders).toHaveLength(2);
    expect(renders[0]?.phase).toBe('idle');
    expect(renders[1]?.phase).toBe('running');
    expect(renders[1]?.currentStageIndex).toBe(0);

    // Advance through each remaining stage boundary.
    const expectedAtMs: ReadonlyArray<{
      readonly afterMs: number;
      readonly stageIndex: AnalyzingStageIndex;
      readonly phase: 'running' | 'complete';
      readonly isComplete: boolean;
      readonly progress: number;
    }> = [
      { afterMs: 1_000, stageIndex: 1, phase: 'running', isComplete: false, progress: 20 },
      { afterMs: 2_000, stageIndex: 2, phase: 'running', isComplete: false, progress: 40 },
      { afterMs: 3_000, stageIndex: 3, phase: 'running', isComplete: false, progress: 60 },
      { afterMs: 4_000, stageIndex: 4, phase: 'running', isComplete: false, progress: 80 },
      { afterMs: 5_000, stageIndex: 4, phase: 'complete', isComplete: true, progress: 100 },
    ];

    let elapsed = 0;
    for (const step of expectedAtMs) {
      vi.advanceTimersByTime(step.afterMs - elapsed);
      elapsed = step.afterMs;

      const latest = handle.viewModel();
      expect(latest.phase, `at ${step.afterMs}ms`).toBe(step.phase);
      expect(latest.currentStageIndex, `at ${step.afterMs}ms`).toBe(
        step.stageIndex,
      );
      expect(latest.isComplete, `at ${step.afterMs}ms`).toBe(step.isComplete);
      expect(latest.progressPercent, `at ${step.afterMs}ms`).toBe(step.progress);
    }

    // 2 sync + 5 timer-driven = 7 renders total.
    expect(renders).toHaveLength(7);

    // Per-stage texts arrived in canonical order.
    const stageLabelsObserved = renders
      .filter((r) => r.currentStageLabel !== null)
      .map((r) => r.currentStageLabel);
    // [stage 0, stage 1, stage 2, stage 3, stage 4 (running), stage 4 (complete)]
    expect(stageLabelsObserved).toEqual([
      ANALYZING_STAGE_LABELS[0],
      ANALYZING_STAGE_LABELS[1],
      ANALYZING_STAGE_LABELS[2],
      ANALYZING_STAGE_LABELS[3],
      ANALYZING_STAGE_LABELS[4],
      ANALYZING_STAGE_LABELS[4],
    ]);
  });

  it('invokes onComplete exactly once after 5 seconds (not at 4.999s)', () => {
    const onComplete = vi.fn();
    mountAnalyzingLoaderComponent({
      render: () => undefined,
      onComplete,
    });

    vi.advanceTimersByTime(4_999);
    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Subsequent imaginary ticks do not re-fire.
    vi.advanceTimersByTime(10_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('final render before onComplete shows isComplete=true and 100% progress', () => {
    const renders: AnalyzingLoaderComponentViewModel[] = [];
    const onCompleteOrder: string[] = [];
    const onComplete = vi.fn(() => {
      onCompleteOrder.push('onComplete');
    });

    mountAnalyzingLoaderComponent({
      render: (vm) => {
        renders.push(vm);
        if (vm.isComplete) onCompleteOrder.push('render(complete)');
      },
      onComplete,
    });

    vi.advanceTimersByTime(ANALYZING_TOTAL_DURATION_MS);

    const last = renders[renders.length - 1];
    expect(last?.isComplete).toBe(true);
    expect(last?.progressPercent).toBe(100);
    expect(last?.ariaLive).toBe('assertive');

    // Render fires BEFORE onComplete so the UI is already painted at 100% when
    // the host navigates away inside the onComplete callback.
    expect(onCompleteOrder).toEqual(['render(complete)', 'onComplete']);
  });

  it('autoStart=false renders only the idle frame until start() is called', () => {
    const renders: AnalyzingLoaderComponentViewModel[] = [];
    const handle = mountAnalyzingLoaderComponent({
      render: (vm) => renders.push(vm),
      autoStart: false,
    });

    expect(renders).toHaveLength(1);
    expect(renders[0]?.phase).toBe('idle');

    // Time passes — no auto-start, so no more renders.
    vi.advanceTimersByTime(10_000);
    expect(renders).toHaveLength(1);

    // Manual start kicks the timeline off.
    handle.controller.start();
    expect(renders).toHaveLength(2);
    expect(renders[1]?.phase).toBe('running');
    expect(renders[1]?.currentStageIndex).toBe(0);

    vi.advanceTimersByTime(ANALYZING_TOTAL_DURATION_MS);
    expect(handle.viewModel().isComplete).toBe(true);
  });

  it('unmount() cancels timers and stops further renders + onComplete', () => {
    const renders: AnalyzingLoaderComponentViewModel[] = [];
    const onComplete = vi.fn();
    const handle = mountAnalyzingLoaderComponent({
      render: (vm) => renders.push(vm),
      onComplete,
    });

    vi.advanceTimersByTime(2_500); // mid-stage
    const beforeUnmount = renders.length;
    expect(beforeUnmount).toBeGreaterThan(2);

    handle.unmount();

    vi.advanceTimersByTime(10_000);
    expect(renders.length).toBe(beforeUnmount);
    expect(onComplete).not.toHaveBeenCalled();

    // Second unmount is idempotent (no throw, no extra calls).
    expect(() => handle.unmount()).not.toThrow();
  });

  it('accepts an injected scheduler for deterministic, timer-free assertions', () => {
    type DeferredTask = { readonly fireAt: number; readonly fn: () => void };
    const tasks: DeferredTask[] = [];
    let virtualNow = 0;

    const drainUpTo = (target: number): void => {
      tasks.sort((x, y) => x.fireAt - y.fireAt);
      while (tasks.length > 0 && (tasks[0] as DeferredTask).fireAt <= target) {
        const next = tasks.shift() as DeferredTask;
        virtualNow = next.fireAt;
        next.fn();
      }
      virtualNow = target;
    };

    const onComplete = vi.fn();
    const renders: AnalyzingLoaderComponentViewModel[] = [];
    const handle = mountAnalyzingLoaderComponent({
      render: (vm) => renders.push(vm),
      onComplete,
      scheduler: {
        now: () => virtualNow,
        setTimer: (fn, ms) => {
          const task: DeferredTask = { fireAt: virtualNow + ms, fn };
          tasks.push(task);
          return task;
        },
        clearTimer: (handleRef) => {
          const idx = tasks.indexOf(handleRef as DeferredTask);
          if (idx >= 0) tasks.splice(idx, 1);
        },
      },
    });

    drainUpTo(2_000);
    expect(handle.viewModel().currentStageIndex).toBe(2);
    expect(onComplete).not.toHaveBeenCalled();

    drainUpTo(5_000);
    expect(handle.viewModel().isComplete).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Last render exposed the assertive aria-live politeness so screen
    // readers announce completion before the host swaps screens.
    const last = renders[renders.length - 1];
    expect(last?.ariaLive).toBe('assertive');
  });
});
