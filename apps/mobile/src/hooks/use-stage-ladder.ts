/**
 * Phase 6.2 — `useSyncExternalStore`-based adapter hooks that bind the
 * framework-agnostic `core-ts` stage-machine controllers to React Native.
 *
 * Two surfaces of the funnel render a Korean-label "stage ladder":
 *   - Step 5 `fake_loader`         → 5-stage Analyzing loader (5000 ms total).
 *   - Step 8 `fake_scan_animation` → 8-stage face-scan animation (3200 ms total).
 *
 * Both are driven by an identically-shaped controller from `core-ts`:
 *
 *     interface Controller<State> {
 *       start(): void;                                   // begin / restart
 *       cancel(): void;                                  // stop + reset to idle
 *       snapshot(): State;                               // referentially-stable read
 *       subscribe(fn: (s: State) => void): () => void;   // change notifications
 *     }
 *
 * These hooks own ONLY the React binding — there is zero business logic here.
 * All stage progression, timer cadence, completion latching and Korean label
 * resolution live in `core-ts`; the hook merely:
 *
 *   1. Constructs the controller exactly once per mount (lazy `useRef`), so
 *      the timeline is not reset on every render.
 *   2. Subscribes to it with React 18's `useSyncExternalStore`
 *      (`controller.subscribe` + `controller.snapshot`) so the component
 *      re-renders on every stage transition with a tearing-free snapshot.
 *   3. Projects the frozen controller state → frozen view-model via the pure
 *      `core-ts` render mapper (`renderAnalyzingLoaderComponent` /
 *      `renderScanAnimationComponent`). The mapper output is memoised on the
 *      state identity so `getSnapshot` stays referentially stable and React
 *      does not warn about an unstable store snapshot.
 *   4. Starts the controller on mount and cancels it on unmount via a single
 *      `useEffect`, guaranteeing no timer fires into an unmounted tree.
 *
 * Timer ownership: the RN layer schedules NO timers. The controller owns all
 * timing through its injected scheduler (default real `setTimeout`); tests
 * inject a fake scheduler to drive ticks synchronously. `onComplete` is
 * latched in a ref so callers can pass an inline arrow without re-creating
 * the controller or restarting the ladder.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import {
  renderAnalyzingLoaderComponent,
  useAnalyzingLoader as createAnalyzingLoaderController,
  type AnalyzingLoaderComponentViewModel,
  type AnalyzingLoaderController,
  type UseAnalyzingLoaderOptions,
} from 'core-ts/funnel';
import {
  renderScanAnimationComponent,
  useScanAnimation as createScanAnimationController,
  type ScanAnimationComponentViewModel,
  type ScanAnimationController,
  type UseScanAnimationOptions,
} from 'core-ts/scan_option';

// ---------------------------------------------------------------------------
// Shared controller shape + generic adapter
// ---------------------------------------------------------------------------

/**
 * The minimal slice of a `core-ts` controller this adapter depends on. Both
 * `AnalyzingLoaderController` and `ScanAnimationController` are structurally
 * assignable to this for their respective state types.
 */
interface StageLadderController<State> {
  readonly start: () => void;
  readonly cancel: () => void;
  readonly snapshot: () => State;
  readonly subscribe: (listener: (state: State) => void) => () => void;
}

/**
 * Bind a `core-ts` controller to React and project its state through a pure
 * view-model mapper.
 *
 * `controller` MUST be referentially stable across renders (callers build it
 * once via `useRef`). The controller's `snapshot()` returns a referentially
 * stable frozen state — unchanged ticks return the SAME object — so memoising
 * the mapper on `state` identity keeps the rendered view-model stable and
 * satisfies `useSyncExternalStore`'s cached-snapshot requirement.
 *
 * @param controller stable controller instance
 * @param render     pure `(state) => view-model` mapper from `core-ts`
 * @param autoStart  start the controller on mount (default `true`)
 */
function useStageLadderController<State, ViewModel>(
  controller: StageLadderController<State>,
  render: (state: State) => ViewModel,
  autoStart: boolean,
): ViewModel {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const viewModel = useMemo(() => render(state), [render, state]);

  useEffect(() => {
    if (autoStart) {
      controller.start();
    }
    // Cancel on unmount: clears in-flight timers + detaches subscribers so a
    // tick can never fire into an unmounted tree.
    return () => {
      controller.cancel();
    };
  }, [controller, autoStart]);

  return viewModel;
}

// ---------------------------------------------------------------------------
// Step 5 — Analyzing loader (5-stage / 5000 ms)
// ---------------------------------------------------------------------------

/** Options shared by both ladder hooks. */
interface StageLadderHookOptions<Scheduler> {
  /** Invoked once when the ladder latches into `'complete'`. */
  readonly onComplete?: () => void;
  /** Injected scheduler (clock + timers). Omit in production; tests pass a fake. */
  readonly scheduler?: Scheduler;
  /** Start the controller on mount. Defaults to `true`. */
  readonly autoStart?: boolean;
}

export type UseAnalyzingLoaderLadderOptions = StageLadderHookOptions<
  UseAnalyzingLoaderOptions['scheduler']
>;

/**
 * React adapter for the 5-stage Analyzing loader (funnel step 5
 * `fake_loader`). Returns the frozen `AnalyzingLoaderComponentViewModel` for
 * the current tick; the component re-renders on every stage transition.
 */
export function useAnalyzingLoaderLadder(
  options: UseAnalyzingLoaderLadderOptions = {},
): AnalyzingLoaderComponentViewModel {
  const onCompleteRef = useRef<(() => void) | undefined>(options.onComplete);
  useEffect(() => {
    onCompleteRef.current = options.onComplete;
  }, [options.onComplete]);

  const controllerRef = useRef<AnalyzingLoaderController | null>(null);
  if (controllerRef.current === null) {
    const handleComplete = (): void => {
      onCompleteRef.current?.();
    };
    // Build options conditionally — `exactOptionalPropertyTypes` forbids
    // assigning `scheduler: undefined` to an optional property.
    const controllerOptions: UseAnalyzingLoaderOptions =
      options.scheduler !== undefined
        ? { onComplete: handleComplete, scheduler: options.scheduler }
        : { onComplete: handleComplete };
    controllerRef.current = createAnalyzingLoaderController(controllerOptions);
  }

  return useStageLadderController(
    controllerRef.current,
    renderAnalyzingLoaderComponent,
    options.autoStart ?? true,
  );
}

// ---------------------------------------------------------------------------
// Step 8 — Scan animation (8-stage / 3200 ms)
// ---------------------------------------------------------------------------

export type UseScanAnimationLadderOptions = StageLadderHookOptions<
  UseScanAnimationOptions['scheduler']
>;

/**
 * React adapter for the 8-stage face-scan animation (funnel step 8
 * `fake_scan_animation`). Returns the frozen `ScanAnimationComponentViewModel`
 * for the current tick. The ladder latches at `'complete'` after 3200 ms and
 * holds that state until the screen's own 5000 ms auto-advance fires — the two
 * timers are independent, so the latch coexists without conflict.
 */
export function useScanAnimationLadder(
  options: UseScanAnimationLadderOptions = {},
): ScanAnimationComponentViewModel {
  const onCompleteRef = useRef<(() => void) | undefined>(options.onComplete);
  useEffect(() => {
    onCompleteRef.current = options.onComplete;
  }, [options.onComplete]);

  const controllerRef = useRef<ScanAnimationController | null>(null);
  if (controllerRef.current === null) {
    const handleComplete = (): void => {
      onCompleteRef.current?.();
    };
    const controllerOptions: UseScanAnimationOptions =
      options.scheduler !== undefined
        ? { onComplete: handleComplete, scheduler: options.scheduler }
        : { onComplete: handleComplete };
    controllerRef.current = createScanAnimationController(controllerOptions);
  }

  return useStageLadderController(
    controllerRef.current,
    renderScanAnimationComponent,
    options.autoStart ?? true,
  );
}
