/**
 * Sub-AC 10.3 — `AnalyzingLoader` UI component.
 *
 * Builds on Sub-AC 10.1's pure state machine + `useAnalyzingLoader` hook
 * (`src/funnel/analyzing-loader.ts`) and produces a framework-agnostic UI
 * surface for funnel Step 8 (`fake_loader`).
 *
 * Why "framework-agnostic":
 *   This repository has no React runtime dependency — Vitest runs in a Node
 *   environment.  The component returns a frozen view-model that a real
 *   React Native / Web component renders 1:1, plus a `mount` function that
 *   wires the controller to a render callback.  Snapping a thin React adaptor
 *   on top is then trivial:
 *
 *   ```tsx
 *   // Real React component (lives in the host RN/Web app, not in this repo).
 *   function AnalyzingLoaderScreen({ onComplete }: { onComplete: () => void }) {
 *     const controller = useMemo(() => useAnalyzingLoader({ onComplete }), []);
 *     const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
 *     const vm = renderAnalyzingLoaderComponent(state);
 *     useEffect(() => { controller.start(); return controller.cancel; }, []);
 *     return (
 *       <View testID={vm.testId}>
 *         <Text>{vm.headline}</Text>
 *         <Text>{vm.subhead}</Text>
 *         <ProgressBar value={vm.progressPercent} />
 *         {vm.items.map((it) => (
 *           <Text key={it.key} testID={it.testId} accessibilityState={{ selected: it.isActive }}>
 *             {it.label}
 *           </Text>
 *         ))}
 *       </View>
 *     );
 *   }
 *   ```
 *
 * What this module owns:
 *   1. `renderAnalyzingLoaderComponent(state)` — pure (state → view-model)
 *      projection.  Every observable thing the host UI needs is precomputed
 *      (stage statuses, ARIA live politeness, percent strings, test ids).
 *   2. `mountAnalyzingLoaderComponent({ render, onComplete })` — convenience
 *      wrapper that creates a controller, pushes the initial view-model to
 *      the render callback, re-renders on every state change, and forwards
 *      `onComplete` exactly once.  Returns the underlying controller plus a
 *      cleanup `unmount()` that cancels in-flight timers and detaches
 *      subscribers.
 *
 * Integrity:
 *   At construction time we cross-check `FUNNEL_SCREENS.fake_loader.metadata.
 *   durationMs` against `ANALYZING_TOTAL_DURATION_MS` so a Seed drift fails
 *   loudly rather than silently.  See `tests/funnel/analyzing-loader.test.ts`
 *   for the parallel state-machine integrity assertion.
 *
 * Immutability:
 *   Every public surface (view-model, items, controller record) is
 *   `Object.freeze`d.  `render` callbacks therefore cannot mutate prior
 *   state through their argument.
 */
import {
  ANALYZING_STAGE_LABELS,
  ANALYZING_TOTAL_DURATION_MS,
  ANALYZING_TOTAL_STAGES,
  CANONICAL_ANALYZING_STAGES,
  createAnalyzingLoader,
  useAnalyzingLoader,
  type AnalyzingLoaderController,
  type AnalyzingLoaderState,
  type AnalyzingPhase,
  type AnalyzingStageIndex,
  type UseAnalyzingLoaderOptions,
} from './analyzing-loader.js';
import { FUNNEL_SCREENS } from './screens.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-row status the UI uses to colour / decorate the stage list:
 *   - `pending` → not yet reached (greyed checkbox).
 *   - `active`  → currently animating (spinner / highlight).
 *   - `done`    → finished (filled checkmark).
 *
 * Derived from the loader state — never persisted, never user-editable.
 */
export type AnalyzingLoaderStageStatus = 'pending' | 'active' | 'done';

/**
 * View-model row for one of the five analyzing stages.
 *
 * `key` and `testId` are deterministic (`analyzing-stage-<index>`) so React
 * keys, snapshot tests, and E2E selectors all line up.  `isActive` / `isDone`
 * are convenience aliases on top of `status` — most callers prefer reading
 * a boolean over comparing a string literal.
 */
export interface AnalyzingLoaderStageItemViewModel {
  readonly index: AnalyzingStageIndex;
  readonly label: string;
  readonly status: AnalyzingLoaderStageStatus;
  readonly isActive: boolean;
  readonly isDone: boolean;
  readonly key: string;
  readonly testId: string;
}

/**
 * Top-level view-model rendered by the React adaptor.
 *
 * Field rationale:
 *   - `stepId` / `stepNumber` — let analytics overlays read which funnel
 *     step is on screen without re-deriving it.
 *   - `headline` / `subhead` — sourced from `FUNNEL_SCREENS.fake_loader`,
 *     not duplicated here.
 *   - `phase` / `currentStageIndex` / `progressPercent` — passed through
 *     from the loader state but exported on a stable shape so React
 *     memoisation works on a single object reference.
 *   - `currentStageLabel` — convenience for screen-reader announcements
 *     and bottom-of-screen "지금 분석 중" text.
 *   - `progressPercentText` — pre-formatted ("0%" – "100%") so render code
 *     never does any string concatenation.
 *   - `isComplete` — boolean alias for `phase === 'complete'`.
 *   - `ariaLive` — politeness level for screen readers; `polite` while
 *     animating, `off` at idle, `assertive` at completion.
 *   - `items` — always length 5, in stage order 0 → 4.
 *   - `key` / `testId` — root element identity.
 */
export interface AnalyzingLoaderComponentViewModel {
  readonly stepId: 'fake_loader';
  readonly stepNumber: 8;
  readonly headline: string;
  readonly subhead: string;
  readonly phase: AnalyzingPhase;
  readonly currentStageIndex: AnalyzingStageIndex | null;
  readonly currentStageLabel: string | null;
  readonly progressPercent: number;
  readonly progressPercentText: string;
  readonly elapsedMs: number;
  readonly totalDurationMs: number;
  readonly isComplete: boolean;
  readonly ariaLive: 'off' | 'polite' | 'assertive';
  readonly items: readonly AnalyzingLoaderStageItemViewModel[];
  readonly key: string;
  readonly testId: string;
}

/**
 * Thrown at module load if the Step-8 screen metadata and the analyzing-
 * loader constants disagree.  Surfaces a Seed-level integrity break loudly.
 */
export class AnalyzingLoaderComponentIntegrityError extends Error {
  public override readonly name = 'AnalyzingLoaderComponentIntegrityError';
  public readonly detail: string;

  constructor(detail: string) {
    super(`Analyzing loader component integrity error: ${detail}`);
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Integrity check — runs once at import time.  If FUNNEL_SCREENS.fake_loader's
// durationMs ever drifts from ANALYZING_TOTAL_DURATION_MS we want the build to
// fail loudly here rather than wait for the runtime to mis-fire onComplete.
// ---------------------------------------------------------------------------

(function assertSeedAlignment(): void {
  const screen = FUNNEL_SCREENS.fake_loader;
  if (screen.metadata['durationMs'] !== ANALYZING_TOTAL_DURATION_MS) {
    throw new AnalyzingLoaderComponentIntegrityError(
      `FUNNEL_SCREENS.fake_loader.metadata.durationMs (${String(
        screen.metadata['durationMs'],
      )}) ≠ ANALYZING_TOTAL_DURATION_MS (${ANALYZING_TOTAL_DURATION_MS})`,
    );
  }
  if (ANALYZING_STAGE_LABELS.length !== ANALYZING_TOTAL_STAGES) {
    throw new AnalyzingLoaderComponentIntegrityError(
      `ANALYZING_STAGE_LABELS length ${ANALYZING_STAGE_LABELS.length} ≠ ANALYZING_TOTAL_STAGES ${ANALYZING_TOTAL_STAGES}`,
    );
  }
})();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function statusForIndex(
  state: AnalyzingLoaderState,
  index: AnalyzingStageIndex,
): AnalyzingLoaderStageStatus {
  if (state.phase === 'complete') return 'done';
  if (state.phase === 'idle' || state.currentStageIndex === null) {
    return 'pending';
  }
  // Running — earlier stages are done, current is active, later are pending.
  if (index < state.currentStageIndex) return 'done';
  if (index === state.currentStageIndex) return 'active';
  return 'pending';
}

function ariaLiveForPhase(phase: AnalyzingPhase): 'off' | 'polite' | 'assertive' {
  // Idle = nothing to announce; running = chatty but polite (don't interrupt
  // upstream announcements); complete = assertive so screen readers tell the
  // user we're done before any subsequent screen mounts.
  switch (phase) {
    case 'idle':
      return 'off';
    case 'running':
      return 'polite';
    case 'complete':
      return 'assertive';
  }
}

function buildItems(
  state: AnalyzingLoaderState,
): readonly AnalyzingLoaderStageItemViewModel[] {
  return Object.freeze(
    CANONICAL_ANALYZING_STAGES.map((stage) => {
      const status = statusForIndex(state, stage.index);
      return Object.freeze({
        index: stage.index,
        label: stage.label,
        status,
        isActive: status === 'active',
        isDone: status === 'done',
        key: `analyzing-stage-${stage.index}`,
        testId: `analyzing-stage-${stage.index}`,
      }) satisfies AnalyzingLoaderStageItemViewModel;
    }),
  );
}

function currentStageLabel(state: AnalyzingLoaderState): string | null {
  if (state.currentStageIndex === null) return null;
  // Bound-checked via `currentStageIndex`'s nominal type (0..4).
  const label = ANALYZING_STAGE_LABELS[state.currentStageIndex];
  return label ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const ANALYZING_LOADER_COMPONENT_TEST_ID = 'analyzing-loader' as const;

/**
 * Pure projection — given an `AnalyzingLoaderState`, returns the frozen
 * view-model the host UI should render.  Same input → same output (modulo
 * object identity, since every call returns a fresh frozen record).
 *
 * Defaults: if no state is supplied we project the loader's idle state, so
 * the host can render the component in a server-rendered / first-frame
 * context without instantiating a controller first.
 */
export function renderAnalyzingLoaderComponent(
  state: AnalyzingLoaderState = createAnalyzingLoader(),
): AnalyzingLoaderComponentViewModel {
  const screen = FUNNEL_SCREENS.fake_loader;
  const items = buildItems(state);

  return Object.freeze({
    stepId: 'fake_loader',
    stepNumber: 8,
    headline: screen.headline,
    subhead: screen.subhead,
    phase: state.phase,
    currentStageIndex: state.currentStageIndex,
    currentStageLabel: currentStageLabel(state),
    progressPercent: state.progressPercent,
    progressPercentText: `${state.progressPercent}%`,
    elapsedMs: state.elapsedMs,
    totalDurationMs: ANALYZING_TOTAL_DURATION_MS,
    isComplete: state.phase === 'complete',
    ariaLive: ariaLiveForPhase(state.phase),
    items,
    key: ANALYZING_LOADER_COMPONENT_TEST_ID,
    testId: ANALYZING_LOADER_COMPONENT_TEST_ID,
  }) satisfies AnalyzingLoaderComponentViewModel;
}

/**
 * Render callback signature consumed by `mountAnalyzingLoaderComponent`.
 * Receives a frozen view-model on every state change.  Hosts MUST treat the
 * argument as immutable and copy any data they want to mutate.
 */
export type AnalyzingLoaderRenderCallback = (
  viewModel: AnalyzingLoaderComponentViewModel,
) => void;

/** Options for {@link mountAnalyzingLoaderComponent}. */
export interface MountAnalyzingLoaderComponentOptions {
  /** Required — invoked with a fresh view-model on mount and on every change. */
  readonly render: AnalyzingLoaderRenderCallback;
  /** Optional — invoked once when the loader latches into `'complete'`. */
  readonly onComplete?: () => void;
  /**
   * Optional — if `false`, `mount` does NOT auto-call `controller.start()`.
   * Defaults to `true` so the loader behaves like a self-driving widget.
   */
  readonly autoStart?: boolean;
  /**
   * Optional — forwarded to {@link useAnalyzingLoader}.  Tests inject a
   * deterministic clock + setTimer; production callers omit this.
   */
  readonly scheduler?: UseAnalyzingLoaderOptions['scheduler'];
}

/**
 * Handle returned from {@link mountAnalyzingLoaderComponent}.  Wraps the
 * underlying loader controller plus a single-shot `unmount()` that cancels
 * in-flight timers and detaches the render subscription.
 */
export interface AnalyzingLoaderComponentHandle {
  /** The loader controller from Sub-AC 10.1.  Exposed for advanced callers. */
  readonly controller: AnalyzingLoaderController;
  /** The most recent view-model rendered.  Stable across calls until next tick. */
  readonly viewModel: () => AnalyzingLoaderComponentViewModel;
  /** Cancel timers + detach subscriber.  Idempotent. */
  readonly unmount: () => void;
}

/**
 * Wire a render callback to the analyzing-loader state machine.
 *
 * Default lifecycle (`autoStart === true`):
 *   1. Constructs a controller via {@link useAnalyzingLoader}.
 *   2. Subscribes a translator that converts each loader state → view-model
 *      and forwards it to `render`.
 *   3. Calls `render` with the idle view-model (frame 0) so the host can
 *      paint a non-empty UI immediately.
 *   4. Calls `controller.start()` — translator now fires on every tick.
 *   5. At t = 5000 ms the phase latches to `'complete'`, `render` receives
 *      a `isComplete: true` view-model, then `onComplete` fires (in that
 *      order so the UI is already showing 100% before the navigation push).
 *
 * `unmount()` runs `controller.cancel()` and unsubscribes — safe to call
 * inside a React `useEffect` cleanup.
 */
export function mountAnalyzingLoaderComponent(
  options: MountAnalyzingLoaderComponentOptions,
): AnalyzingLoaderComponentHandle {
  const render = options.render;
  const autoStart = options.autoStart ?? true;
  const onComplete = options.onComplete;

  // Latest view-model — captured so `handle.viewModel()` is a cheap read.
  let latest: AnalyzingLoaderComponentViewModel = renderAnalyzingLoaderComponent();
  let unmounted = false;

  const controllerOptions: UseAnalyzingLoaderOptions = {};
  if (options.scheduler !== undefined) {
    (controllerOptions as { scheduler: typeof options.scheduler }).scheduler =
      options.scheduler;
  }
  if (onComplete !== undefined) {
    (controllerOptions as { onComplete: () => void }).onComplete = () => {
      if (unmounted) return;
      onComplete();
    };
  }

  const controller = useAnalyzingLoader(controllerOptions);

  const unsubscribe = controller.subscribe((state) => {
    if (unmounted) return;
    latest = renderAnalyzingLoaderComponent(state);
    render(latest);
  });

  // Paint frame 0 so the host renders a non-empty UI immediately — even if
  // `autoStart === false` (e.g. preview mode).  The first real state change
  // overwrites this via the subscriber callback.
  render(latest);

  if (autoStart) {
    controller.start();
  }

  function unmount(): void {
    if (unmounted) return;
    unmounted = true;
    controller.cancel();
    unsubscribe();
  }

  function viewModel(): AnalyzingLoaderComponentViewModel {
    return latest;
  }

  return Object.freeze({
    controller,
    viewModel,
    unmount,
  }) satisfies AnalyzingLoaderComponentHandle;
}
