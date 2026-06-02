/**
 * Sub-AC 10.2 — 8단계 가짜 스캔 애니메이션 진행 로직 + `useScanAnimation` hook.
 *
 * Sibling to `src/funnel/analyzing-loader.ts` (5-step Analyzing loader at
 * funnel step 8).  Where the *Analyzing loader* covers the "AI is thinking"
 * pause between the selfie upload (step 7) and the locked result reveal
 * (step 9), this *Scan animation* covers the visual scan-effect played
 * IMMEDIATELY AFTER the user picks the personal-color option on step 6
 * (`scan_option_select`) and BEFORE the selfie capture screen — the 8-phase
 * face-scan animation that mimics a real device-level vision pipeline.
 *
 * Seed grounding:
 *   - Ontology concept `fake_loader` is the union of TWO surfaces:
 *       • 5단계 5초 fake Analyzing 로더    → `analyzing-loader.ts` (done)
 *       • 8단계 fake 스캔 애니메이션         → THIS module
 *   - Constraint `commoditized_stack`: this module never calls any vendor —
 *     it owns only the *visual* timing for the fake scan; real face landmarks
 *     are produced by Replicate / MediaPipe / Face++ wrappers downstream.
 *   - Constraint `creator_signature`: the 8 stage labels read as a single
 *     coherent Korean-language scan narrative (not auto-translated).
 *
 * Canonical 8-stage timeline (400 ms / stage = 3200 ms total):
 *
 *     stage 1  (0    –  400 ms)  얼굴 감지
 *     stage 2  (400  –  800 ms)  윤곽 분석
 *     stage 3  (800  – 1200 ms)  피부 영역 추출
 *     stage 4  (1200 – 1600 ms)  눈 영역 분석
 *     stage 5  (1600 – 2000 ms)  입술 영역 분석
 *     stage 6  (2000 – 2400 ms)  컬러 샘플링
 *     stage 7  (2400 – 2800 ms)  톤 매칭
 *     stage 8  (2800 – 3200 ms)  결과 준비
 *     complete (≥ 3200 ms)        스캔 완료
 *
 * The 8 × 400 ms split was chosen so the animation:
 *   - feels deliberately fast (under 4 s — within UX research's "perceived
 *     instant" envelope so it does not compete with the 5 s Analyzing loader
 *     which has its own anchoring purpose), and
 *   - splits cleanly into the 8 visible scan-region beats above.
 *
 * Module contract (mirrors `analyzing-loader.ts` so call sites can share a
 * mental model):
 *   - Pure state machine (`createScanAnimation` / `startScanAnimation` /
 *     `tickScanAnimation`) — no globals, no `Date.now()`, every transition
 *     returns a NEW frozen `ScanAnimationState`.  Deterministic for tests.
 *   - `useScanAnimation()` returns a framework-agnostic controller with
 *     `{ start, cancel, snapshot, subscribe }`.  Timer + clock are injected
 *     (default `setTimeout` / `Date.now`) so Vitest's fake-timers driver can
 *     verify both the 400 ms cadence and the 3200 ms completion latch.
 *   - We intentionally do not depend on React: the codebase has no UI runtime
 *     dependency.  A React adaptor would call
 *     `useSyncExternalStore(controller.subscribe, controller.snapshot)`.
 *
 * Immutability: every public surface (state, stages, controller record) is
 * `Object.freeze`d at construction.  Listeners receive frozen snapshots.
 */

// ---------------------------------------------------------------------------
// Public constants — sourced from the Seed (do not change without updating
// the ontology and any UI rendering the same numbers).
// ---------------------------------------------------------------------------

/** Number of distinct scan stages shown to the user. */
export const SCAN_ANIMATION_TOTAL_STAGES = 8 as const;

/** Each stage runs for exactly this many milliseconds. */
export const SCAN_ANIMATION_STAGE_DURATION_MS = 400 as const;

/** Total wall-clock duration of the fake scan animation. */
export const SCAN_ANIMATION_TOTAL_DURATION_MS = (SCAN_ANIMATION_TOTAL_STAGES *
  SCAN_ANIMATION_STAGE_DURATION_MS) as 3_200;

/**
 * Canonical 8-stage ladder rendered over the fake scan animation.
 * Order is meaningful — stage index = `STAGE_LABELS.indexOf(label)`.
 *
 * Labels are deliberately written in a single Korean voice (퍼스널 컬러 진단
 * 시그니처) — see Seed constraint `creator_signature`.
 */
export const SCAN_ANIMATION_STAGE_LABELS: readonly string[] = Object.freeze([
  '얼굴 감지',
  '윤곽 분석',
  '피부 영역 추출',
  '눈 영역 분석',
  '입술 영역 분석',
  '컬러 샘플링',
  '톤 매칭',
  '결과 준비',
] as const);

/** Discrete index of one of the eight scan stages (0..7). */
export type ScanAnimationStageIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Phase the animation is currently in.  `'complete'` is terminal until `cancel`. */
export type ScanAnimationPhase = 'idle' | 'running' | 'complete';

/**
 * One stage on the canonical ladder.  Pre-computed window so consumers can
 * render a progress bar or step indicator without recomputing offsets.
 */
export interface ScanAnimationStage {
  readonly index: ScanAnimationStageIndex;
  readonly label: string;
  readonly startsAtMs: number; // inclusive
  readonly endsAtMs: number; // exclusive (except final stage — see notes)
}

/**
 * Frozen, ordered list of the 8 canonical stages.  Exported so UI / analytics
 * layers can reference the same windows the state machine uses internally.
 */
export const CANONICAL_SCAN_ANIMATION_STAGES: readonly ScanAnimationStage[] =
  Object.freeze(
    SCAN_ANIMATION_STAGE_LABELS.map((label, idx) =>
      Object.freeze({
        index: idx as ScanAnimationStageIndex,
        label,
        startsAtMs: idx * SCAN_ANIMATION_STAGE_DURATION_MS,
        endsAtMs: (idx + 1) * SCAN_ANIMATION_STAGE_DURATION_MS,
      }),
    ),
  );

/**
 * Snapshot of the scan animation at a single point in time.  Treat as a value
 * object — every mutator returns a NEW frozen instance.
 *
 * `currentStageIndex` semantics:
 *   - `'idle'`     → `null`        (animation has not started)
 *   - `'running'`  → 0..7          (the stage currently visible)
 *   - `'complete'` → 7             (last stage stays latched so UIs can hold
 *                                   the final label while transitioning out)
 *
 * `progressPercent` is `0..100`, floored so callers can clamp a progress bar
 * without overshoot.  `100` is only reached when `phase === 'complete'`.
 */
export interface ScanAnimationState {
  readonly phase: ScanAnimationPhase;
  readonly currentStageIndex: ScanAnimationStageIndex | null;
  readonly elapsedMs: number;
  readonly progressPercent: number;
  readonly startedAtMs: number | null;
  readonly stages: readonly ScanAnimationStage[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clampNonNegative(n: number): number {
  return n < 0 || Number.isNaN(n) ? 0 : n;
}

/**
 * Map elapsed-ms → stage index.  Stage `i` covers `[i*400, (i+1)*400)` for
 * `i < 7`; the final stage absorbs everything ≥ 2800 ms so completion at
 * exactly 3200 ms still reports stage 7 while the phase flips to `'complete'`.
 */
function stageIndexForElapsed(elapsedMs: number): ScanAnimationStageIndex {
  const clamped = clampNonNegative(elapsedMs);
  if (clamped >= SCAN_ANIMATION_TOTAL_DURATION_MS) {
    return (SCAN_ANIMATION_TOTAL_STAGES - 1) as ScanAnimationStageIndex;
  }
  const idx = Math.floor(clamped / SCAN_ANIMATION_STAGE_DURATION_MS);
  // idx is bounded to [0, TOTAL_STAGES - 1] by the early return above.
  return idx as ScanAnimationStageIndex;
}

function progressPercentForElapsed(elapsedMs: number): number {
  const clamped = Math.min(
    SCAN_ANIMATION_TOTAL_DURATION_MS,
    clampNonNegative(elapsedMs),
  );
  return Math.floor((clamped / SCAN_ANIMATION_TOTAL_DURATION_MS) * 100);
}

function freezeState(state: Omit<ScanAnimationState, 'stages'>): ScanAnimationState {
  return Object.freeze({
    ...state,
    stages: CANONICAL_SCAN_ANIMATION_STAGES,
  }) satisfies ScanAnimationState;
}

// ---------------------------------------------------------------------------
// Pure state-machine API
// ---------------------------------------------------------------------------

/** Initial state — idle, no stage selected, zero progress. */
export function createScanAnimation(): ScanAnimationState {
  return freezeState({
    phase: 'idle',
    currentStageIndex: null,
    elapsedMs: 0,
    progressPercent: 0,
    startedAtMs: null,
  });
}

/**
 * Begin the animation at wall-clock `nowMs`.  Always transitions to stage 0
 * regardless of prior state — calling `start` again resets the timeline so
 * the host UI can re-show the animation without leaking the old run.
 */
export function startScanAnimation(
  _prev: ScanAnimationState,
  nowMs: number,
): ScanAnimationState {
  return freezeState({
    phase: 'running',
    currentStageIndex: 0,
    elapsedMs: 0,
    progressPercent: 0,
    startedAtMs: nowMs,
  });
}

/**
 * Project the animation forward in time.  Pure: same `(prev, nowMs)` always
 * produces the same next state.  Idle inputs are returned unchanged so the
 * caller can safely tick before `start`.
 */
export function tickScanAnimation(
  prev: ScanAnimationState,
  nowMs: number,
): ScanAnimationState {
  if (prev.phase === 'idle' || prev.startedAtMs === null) {
    return prev;
  }

  const elapsed = clampNonNegative(nowMs - prev.startedAtMs);

  if (elapsed >= SCAN_ANIMATION_TOTAL_DURATION_MS) {
    // Latch at the final stage with 100% progress.  Repeated ticks past the
    // boundary remain idempotent (no churn for subscribers).
    if (prev.phase === 'complete') {
      return prev;
    }
    return freezeState({
      phase: 'complete',
      currentStageIndex: (SCAN_ANIMATION_TOTAL_STAGES - 1) as ScanAnimationStageIndex,
      elapsedMs: SCAN_ANIMATION_TOTAL_DURATION_MS,
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
export function getScanAnimationStage(
  index: ScanAnimationStageIndex,
): ScanAnimationStage {
  // CANONICAL_SCAN_ANIMATION_STAGES is exhaustively keyed by ScanAnimationStageIndex.
  return CANONICAL_SCAN_ANIMATION_STAGES[index] as ScanAnimationStage;
}

/** Returns true iff `phase === 'complete'`. */
export function isScanAnimationComplete(state: ScanAnimationState): boolean {
  return state.phase === 'complete';
}

// ---------------------------------------------------------------------------
// `useScanAnimation` — framework-agnostic controller
// ---------------------------------------------------------------------------

/** Listener invoked on every observable state change.  Always receives a
 *  frozen snapshot — listeners must not attempt to mutate it. */
export type ScanAnimationListener = (state: ScanAnimationState) => void;

/** Returned from `subscribe`; call to detach. */
export type ScanAnimationUnsubscribe = () => void;

/**
 * Injectable scheduler primitives.  Defaults bind to the standard browser /
 * Node 20 globals so production callers need no configuration; tests inject
 * Vitest's fake timer or a manual driver.
 */
export interface ScanAnimationScheduler {
  /** Returns "now" in ms.  Defaults to {@link Date.now}. */
  readonly now: () => number;
  /** Schedules `fn` to fire after `ms`.  Returns an opaque handle. */
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  /** Cancels a previously scheduled timer. */
  readonly clearTimer: (handle: unknown) => void;
}

/** Options accepted by {@link useScanAnimation}. */
export interface UseScanAnimationOptions {
  /** Custom scheduler (clock + timers).  Defaults to wall-clock + setTimeout. */
  readonly scheduler?: Partial<ScanAnimationScheduler>;
  /** Invoked once when the animation latches into `'complete'`. */
  readonly onComplete?: () => void;
  /** Invoked when the stage index changes (incl. initial start at stage 0). */
  readonly onStageChange?: (stage: ScanAnimationStage) => void;
}

/**
 * The controller returned to the UI layer.  All four methods are frozen on
 * the record so callers cannot swap implementations after construction.
 */
export interface ScanAnimationController {
  /** Begin (or restart) the 8-stage timeline. */
  readonly start: () => void;
  /** Stop the timeline and reset to idle without invoking `onComplete`. */
  readonly cancel: () => void;
  /** Synchronous read of the current state. */
  readonly snapshot: () => ScanAnimationState;
  /** Subscribe to state changes; the returned function unsubscribes. */
  readonly subscribe: (listener: ScanAnimationListener) => ScanAnimationUnsubscribe;
}

// Default scheduler — uses the standard globals.  Captured as a constant so
// hot paths do not allocate a fresh object per call.
const DEFAULT_SCHEDULER: ScanAnimationScheduler = Object.freeze({
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
  partial: Partial<ScanAnimationScheduler> | undefined,
): ScanAnimationScheduler {
  if (!partial) return DEFAULT_SCHEDULER;
  return Object.freeze({
    now: partial.now ?? DEFAULT_SCHEDULER.now,
    setTimer: partial.setTimer ?? DEFAULT_SCHEDULER.setTimer,
    clearTimer: partial.clearTimer ?? DEFAULT_SCHEDULER.clearTimer,
  });
}

/**
 * Build a fresh scan-animation controller.  Equivalent of a React
 * `useScanAnimation` hook minus the framework binding — see module-level docs.
 *
 * Lifecycle:
 *   1. `start()`   → state machine moves to stage 0, timers scheduled for
 *      stages 1..7 (each +400 ms) and a final completion timer at 3200 ms.
 *   2. Each timer fires `tickScanAnimation` → notifies subscribers.
 *   3. At 3200 ms the phase latches to `'complete'`, `onComplete` fires once,
 *      and all internal timers are cleared.
 *   4. `cancel()` clears any pending timers and resets state to `idle`.
 */
export function useScanAnimation(
  options: UseScanAnimationOptions = {},
): ScanAnimationController {
  const scheduler = resolveScheduler(options.scheduler);
  const onComplete = options.onComplete;
  const onStageChange = options.onStageChange;

  let state: ScanAnimationState = createScanAnimation();
  const listeners = new Set<ScanAnimationListener>();
  const timerHandles: unknown[] = [];
  let lastNotifiedStage: ScanAnimationStageIndex | null = null;
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

  function setState(next: ScanAnimationState): void {
    if (next === state) return; // no-op tick — preserve referential stability
    state = next;

    // Stage-change side effect.
    if (
      state.currentStageIndex !== null &&
      state.currentStageIndex !== lastNotifiedStage &&
      onStageChange !== undefined
    ) {
      lastNotifiedStage = state.currentStageIndex;
      onStageChange(getScanAnimationStage(state.currentStageIndex));
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
    // Restarting an in-flight run resets timers + state.
    clearAllTimers();
    lastNotifiedStage = null;
    completionFired = false;

    const startedAt = scheduler.now();
    setState(startScanAnimation(state, startedAt));

    // Schedule a tick at the boundary of every subsequent stage + completion.
    // Iterations: 1..SCAN_ANIMATION_TOTAL_STAGES (i.e. 1, 2, ..., 8).
    for (let i = 1; i <= SCAN_ANIMATION_TOTAL_STAGES; i += 1) {
      const fireAt = startedAt + i * SCAN_ANIMATION_STAGE_DURATION_MS;
      const handle = scheduler.setTimer(() => {
        setState(tickScanAnimation(state, fireAt));
      }, i * SCAN_ANIMATION_STAGE_DURATION_MS);
      timerHandles.push(handle);
    }
  }

  function cancel(): void {
    clearAllTimers();
    lastNotifiedStage = null;
    completionFired = false;
    setState(createScanAnimation());
  }

  function snapshot(): ScanAnimationState {
    return state;
  }

  function subscribe(listener: ScanAnimationListener): ScanAnimationUnsubscribe {
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
  }) satisfies ScanAnimationController;
}
