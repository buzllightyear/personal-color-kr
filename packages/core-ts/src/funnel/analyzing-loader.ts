/**
 * Sub-AC 10.1 — 5단계 'Analyzing' fake loader 상태 머신 + hook (`useAnalyzingLoader`).
 *
 * Step 8 (`fake_loader`) of the Glam Up 12단계 결제 깔때기 (한국 변형) is a
 * 5-second fake analysis screen that nudges price-anchoring — the user sees
 * the AI "thinking" before the locked result reveal in step 9.  This module
 * owns the *temporal contract* behind that screen:
 *
 *     stage 1  (0    – 1000 ms)  피부 톤 분석
 *     stage 2  (1000 – 2000 ms)  명도 측정
 *     stage 3  (2000 – 3000 ms)  채도 측정
 *     stage 4  (3000 – 4000 ms)  컨트라스트 측정
 *     stage 5  (4000 – 5000 ms)  결과 정리
 *     complete (≥ 5000 ms)        분석 완료
 *
 * The 5-stage × 1000 ms split lines up with:
 *   - Seed concept `fake_loader` (5단계 5초 fake Analyzing 로더).
 *   - `FUNNEL_SCREENS.fake_loader.metadata.durationMs = 5000` (step 8 screen).
 *   - The four dimensions named in the step's Korean subhead
 *     ("피부 톤 · 명도 · 채도 · 컨트라스트") + one synthesis stage.
 *
 * Module contract:
 *   - Pure state machine (`createAnalyzingLoader` / `startAnalyzingLoader` /
 *     `tickAnalyzingLoader`) — no globals, no `Date.now()`, every transition
 *     returns a NEW frozen `AnalyzingLoaderState`.  Same input → same output
 *     so unit tests can stride the timeline deterministically.
 *   - A `useAnalyzingLoader()` factory wraps the state machine into a small
 *     subscribable controller for the UI layer.  Timer + clock are *injected*
 *     (default = `setTimeout` / `Date.now`) so Vitest's fake-timers driver
 *     verifies the 1-second tick cadence and 5-second completion latch.
 *   - We deliberately do not depend on React: the codebase has no UI runtime
 *     dependency, so the "hook" surface is a framework-agnostic
 *     `AnalyzingLoaderController { start, cancel, snapshot, subscribe }`.
 *     A React adaptor on top can use `useSyncExternalStore(subscribe,
 *     snapshot)` verbatim.
 *
 * Immutability: every public surface (state, stages, controller record) is
 * `Object.freeze`d at construction.  Listeners receive frozen snapshots and
 * cannot mutate prior state through them.
 */

// ---------------------------------------------------------------------------
// Public constants — sourced from the Seed (do not change without updating
// the matching FUNNEL_SCREENS.fake_loader metadata and the ontology).
// ---------------------------------------------------------------------------

/** Number of distinct analysis stages shown to the user. */
export const ANALYZING_TOTAL_STAGES = 5 as const;

/** Each stage runs for exactly this many milliseconds. */
export const ANALYZING_STAGE_DURATION_MS = 1_000 as const;

/** Total wall-clock duration of the fake loader — matches step 8 metadata. */
export const ANALYZING_TOTAL_DURATION_MS = (ANALYZING_TOTAL_STAGES *
  ANALYZING_STAGE_DURATION_MS) as 5_000;

/**
 * Canonical 5-stage ladder rendered on top of the fake loader screen.
 * Order is meaningful — stage index = `STAGE_LABELS.indexOf(label)`.
 */
export const ANALYZING_STAGE_LABELS: readonly string[] = Object.freeze([
  '피부 톤 분석',
  '명도 측정',
  '채도 측정',
  '컨트라스트 측정',
  '결과 정리',
] as const);

/** Discrete index of one of the five analyzing stages (0..4). */
export type AnalyzingStageIndex = 0 | 1 | 2 | 3 | 4;

/** Phase the loader is currently in.  `'complete'` is terminal until `cancel`. */
export type AnalyzingPhase = 'idle' | 'running' | 'complete';

/**
 * One stage on the canonical ladder.  Pre-computed window so consumers can
 * render a progress bar or step indicator without recomputing offsets.
 */
export interface AnalyzingStage {
  readonly index: AnalyzingStageIndex;
  readonly label: string;
  readonly startsAtMs: number; // inclusive
  readonly endsAtMs: number; // exclusive (except final stage — see CANONICAL_STAGES)
}

/**
 * Frozen, ordered list of the 5 canonical stages.  Exported so UI / analytics
 * layers can reference the same windows the state machine uses internally.
 */
export const CANONICAL_ANALYZING_STAGES: readonly AnalyzingStage[] = Object.freeze(
  ANALYZING_STAGE_LABELS.map((label, idx) =>
    Object.freeze({
      index: idx as AnalyzingStageIndex,
      label,
      startsAtMs: idx * ANALYZING_STAGE_DURATION_MS,
      endsAtMs: (idx + 1) * ANALYZING_STAGE_DURATION_MS,
    }),
  ),
);

/**
 * Snapshot of the loader at a single point in time.  Treat as a value object —
 * every mutator returns a NEW frozen instance.
 *
 * `currentStageIndex` semantics:
 *   - `'idle'`     → `null`        (loader has not started)
 *   - `'running'`  → 0..4          (the stage currently visible)
 *   - `'complete'` → 4             (last stage stays latched so UIs can hold
 *                                   the final label while transitioning out)
 *
 * `progressPercent` is `0..100`, rounded down so callers can clamp a progress
 * bar without overshoot.  `100` is only reached when `phase === 'complete'`.
 */
export interface AnalyzingLoaderState {
  readonly phase: AnalyzingPhase;
  readonly currentStageIndex: AnalyzingStageIndex | null;
  readonly elapsedMs: number;
  readonly progressPercent: number;
  readonly startedAtMs: number | null;
  readonly stages: readonly AnalyzingStage[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clampNonNegative(n: number): number {
  return n < 0 || Number.isNaN(n) ? 0 : n;
}

/**
 * Map elapsed-ms → stage index.  Stage `i` covers `[i*1000, (i+1)*1000)` for
 * `i < 4`; the final stage absorbs everything ≥ 4000 ms so completion at
 * exactly 5000 ms still reports stage 4 (the synthesis label) while the
 * phase flips to `'complete'`.
 */
function stageIndexForElapsed(elapsedMs: number): AnalyzingStageIndex {
  const clamped = clampNonNegative(elapsedMs);
  if (clamped >= ANALYZING_TOTAL_DURATION_MS) {
    return (ANALYZING_TOTAL_STAGES - 1) as AnalyzingStageIndex;
  }
  const idx = Math.floor(clamped / ANALYZING_STAGE_DURATION_MS);
  // idx is bounded to [0, ANALYZING_TOTAL_STAGES - 1] by the early return above.
  return idx as AnalyzingStageIndex;
}

function progressPercentForElapsed(elapsedMs: number): number {
  const clamped = Math.min(ANALYZING_TOTAL_DURATION_MS, clampNonNegative(elapsedMs));
  return Math.floor((clamped / ANALYZING_TOTAL_DURATION_MS) * 100);
}

function freezeState(
  state: Omit<AnalyzingLoaderState, 'stages'>,
): AnalyzingLoaderState {
  return Object.freeze({
    ...state,
    stages: CANONICAL_ANALYZING_STAGES,
  }) satisfies AnalyzingLoaderState;
}

// ---------------------------------------------------------------------------
// Pure state-machine API
// ---------------------------------------------------------------------------

/** Initial state — idle, no stage selected, zero progress. */
export function createAnalyzingLoader(): AnalyzingLoaderState {
  return freezeState({
    phase: 'idle',
    currentStageIndex: null,
    elapsedMs: 0,
    progressPercent: 0,
    startedAtMs: null,
  });
}

/**
 * Begin the loader at wall-clock `nowMs`.  Always transitions to stage 0
 * regardless of prior state — calling `start` again resets the timeline so
 * the host UI can re-show the loader without leaking the old run.
 */
export function startAnalyzingLoader(
  _prev: AnalyzingLoaderState,
  nowMs: number,
): AnalyzingLoaderState {
  return freezeState({
    phase: 'running',
    currentStageIndex: 0,
    elapsedMs: 0,
    progressPercent: 0,
    startedAtMs: nowMs,
  });
}

/**
 * Project the loader forward in time.  Pure: same `(prev, nowMs)` always
 * produces the same next state.  Idle inputs are returned unchanged so the
 * caller can safely tick before `start`.
 */
export function tickAnalyzingLoader(
  prev: AnalyzingLoaderState,
  nowMs: number,
): AnalyzingLoaderState {
  if (prev.phase === 'idle' || prev.startedAtMs === null) {
    return prev;
  }

  const elapsed = clampNonNegative(nowMs - prev.startedAtMs);

  if (elapsed >= ANALYZING_TOTAL_DURATION_MS) {
    // Latch at the final stage with 100% progress.  Repeated ticks past the
    // boundary remain idempotent (no churn for subscribers).
    if (prev.phase === 'complete') {
      return prev;
    }
    return freezeState({
      phase: 'complete',
      currentStageIndex: (ANALYZING_TOTAL_STAGES - 1) as AnalyzingStageIndex,
      elapsedMs: ANALYZING_TOTAL_DURATION_MS,
      progressPercent: 100,
      startedAtMs: prev.startedAtMs,
    });
  }

  const nextStage = stageIndexForElapsed(elapsed);
  const nextPercent = progressPercentForElapsed(elapsed);

  // Skip churn when nothing observable changed (stage + percent identical).
  if (
    prev.phase === 'running' &&
    prev.currentStageIndex === nextStage &&
    prev.progressPercent === nextPercent &&
    prev.elapsedMs === elapsed
  ) {
    return prev;
  }

  return freezeState({
    phase: 'running',
    currentStageIndex: nextStage,
    elapsedMs: elapsed,
    progressPercent: nextPercent,
    startedAtMs: prev.startedAtMs,
  });
}

/**
 * Direct lookup — exposed because UIs sometimes need the stage label
 * without running a tick (e.g. SSR / preview rendering).
 */
export function getAnalyzingStage(index: AnalyzingStageIndex): AnalyzingStage {
  // CANONICAL_ANALYZING_STAGES is exhaustively keyed by AnalyzingStageIndex.
  return CANONICAL_ANALYZING_STAGES[index] as AnalyzingStage;
}

/** Returns true iff `phase === 'complete'`. */
export function isAnalyzingComplete(state: AnalyzingLoaderState): boolean {
  return state.phase === 'complete';
}

// ---------------------------------------------------------------------------
// `useAnalyzingLoader` — framework-agnostic controller
// ---------------------------------------------------------------------------

/** Listener invoked on every observable state change.  Always receives a
 *  frozen snapshot — listeners must not attempt to mutate it. */
export type AnalyzingLoaderListener = (state: AnalyzingLoaderState) => void;

/** Returned from `subscribe`; call to detach. */
export type AnalyzingLoaderUnsubscribe = () => void;

/**
 * Injectable scheduler primitives.  Defaults bind to the standard browser /
 * Node 20 globals so production callers need no configuration; tests inject
 * Vitest's fake timer or a manual driver.
 */
export interface AnalyzingLoaderScheduler {
  /** Returns "now" in ms.  Defaults to {@link Date.now}. */
  readonly now: () => number;
  /** Schedules `fn` to fire after `ms`.  Returns an opaque handle. */
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  /** Cancels a previously scheduled timer. */
  readonly clearTimer: (handle: unknown) => void;
}

/** Options accepted by {@link useAnalyzingLoader}. */
export interface UseAnalyzingLoaderOptions {
  /** Custom scheduler (clock + timers).  Defaults to wall-clock + setTimeout. */
  readonly scheduler?: Partial<AnalyzingLoaderScheduler>;
  /** Invoked once when the loader latches into `'complete'`. */
  readonly onComplete?: () => void;
  /** Invoked when the stage index changes (incl. initial start at stage 0). */
  readonly onStageChange?: (stage: AnalyzingStage) => void;
}

/**
 * The controller returned to the UI layer.  All four methods are frozen on
 * the record so callers cannot swap implementations after construction.
 */
export interface AnalyzingLoaderController {
  /** Begin (or restart) the 5-stage timeline. */
  readonly start: () => void;
  /** Stop the timeline and reset to idle without invoking `onComplete`. */
  readonly cancel: () => void;
  /** Synchronous read of the current state. */
  readonly snapshot: () => AnalyzingLoaderState;
  /** Subscribe to state changes; the returned function unsubscribes. */
  readonly subscribe: (listener: AnalyzingLoaderListener) => AnalyzingLoaderUnsubscribe;
}

// Default scheduler — uses the standard globals.  Captured as a constant so
// hot paths do not allocate a fresh object per call.
const DEFAULT_SCHEDULER: AnalyzingLoaderScheduler = Object.freeze({
  now: (): number => Date.now(),
  setTimer: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clearTimer: (handle: unknown): void => {
    if (handle !== undefined && handle !== null) {
      // setTimeout returns a NodeJS.Timeout or number depending on host —
      // clearTimeout accepts both at runtime.
      clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
    }
  },
});

function resolveScheduler(
  partial: Partial<AnalyzingLoaderScheduler> | undefined,
): AnalyzingLoaderScheduler {
  if (!partial) return DEFAULT_SCHEDULER;
  return Object.freeze({
    now: partial.now ?? DEFAULT_SCHEDULER.now,
    setTimer: partial.setTimer ?? DEFAULT_SCHEDULER.setTimer,
    clearTimer: partial.clearTimer ?? DEFAULT_SCHEDULER.clearTimer,
  });
}

/**
 * Build a fresh loader controller.  Equivalent of a React `useAnalyzingLoader`
 * hook minus the framework binding — see module-level docs.
 *
 * Lifecycle:
 *   1. `start()`   → state machine moves to stage 0, timers scheduled for
 *      stages 1..4 (each +1000 ms) and a final completion timer at 5000 ms.
 *   2. Each timer fires `tickAnalyzingLoader` → notifies subscribers.
 *   3. At 5000 ms the phase latches to `'complete'`, `onComplete` fires once,
 *      and all internal timers are cleared.
 *   4. `cancel()` clears any pending timers and resets state to `idle`.
 */
export function useAnalyzingLoader(
  options: UseAnalyzingLoaderOptions = {},
): AnalyzingLoaderController {
  const scheduler = resolveScheduler(options.scheduler);
  const onComplete = options.onComplete;
  const onStageChange = options.onStageChange;

  let state: AnalyzingLoaderState = createAnalyzingLoader();
  const listeners = new Set<AnalyzingLoaderListener>();
  const timerHandles: unknown[] = [];
  let lastNotifiedStage: AnalyzingStageIndex | null = null;
  let completionFired = false;

  function clearAllTimers(): void {
    for (const h of timerHandles) {
      scheduler.clearTimer(h);
    }
    timerHandles.length = 0;
  }

  function notify(): void {
    // Snapshot the listeners — subscribers may detach within their callback.
    const snapshot = state;
    for (const listener of [...listeners]) {
      listener(snapshot);
    }
  }

  function setState(next: AnalyzingLoaderState): void {
    if (next === state) return; // no-op tick — preserve referential stability
    state = next;

    // Stage-change side effect.
    if (
      state.currentStageIndex !== null &&
      state.currentStageIndex !== lastNotifiedStage &&
      onStageChange !== undefined
    ) {
      lastNotifiedStage = state.currentStageIndex;
      onStageChange(getAnalyzingStage(state.currentStageIndex));
    } else if (state.currentStageIndex !== null) {
      lastNotifiedStage = state.currentStageIndex;
    }

    // Completion side effect — fire exactly once per run.
    if (state.phase === 'complete' && !completionFired) {
      completionFired = true;
      clearAllTimers();
      notify();
      if (onComplete !== undefined) onComplete();
      return;
    }

    notify();
  }

  function start(): void {
    // Restarting an in-flight run resets timers + state — see startFunnel.
    clearAllTimers();
    lastNotifiedStage = null;
    completionFired = false;

    const startedAt = scheduler.now();
    setState(startAnalyzingLoader(state, startedAt));

    // Schedule a tick at the boundary of every subsequent stage + completion.
    // Iterations: 1..ANALYZING_TOTAL_STAGES (i.e. 1, 2, 3, 4, 5).
    for (let i = 1; i <= ANALYZING_TOTAL_STAGES; i += 1) {
      const fireAt = startedAt + i * ANALYZING_STAGE_DURATION_MS;
      const handle = scheduler.setTimer(() => {
        setState(tickAnalyzingLoader(state, fireAt));
      }, i * ANALYZING_STAGE_DURATION_MS);
      timerHandles.push(handle);
    }
  }

  function cancel(): void {
    clearAllTimers();
    lastNotifiedStage = null;
    completionFired = false;
    setState(createAnalyzingLoader());
  }

  function snapshot(): AnalyzingLoaderState {
    return state;
  }

  function subscribe(listener: AnalyzingLoaderListener): AnalyzingLoaderUnsubscribe {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return Object.freeze({
    start,
    cancel,
    snapshot,
    subscribe,
  }) satisfies AnalyzingLoaderController;
}
