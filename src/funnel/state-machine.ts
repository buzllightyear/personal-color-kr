/**
 * Glam Up 12단계 결제 깔때기 — pure functional state machine (한국 변형).
 *
 * Coding-style invariants enforced:
 *   - All public functions return NEW frozen instances (no mutation).
 *   - All transitions validated; invalid transitions throw InvalidTransitionError.
 *   - History is append-only and shared by reference for cheap prefix equality.
 *
 * Public API:
 *   - createFunnel()
 *   - startFunnel(machine)
 *   - advanceStep(machine)
 *   - skipStep(machine)         // only valid for rating_gate
 *   - abandonFunnel(machine)
 *   - getProgress(machine)
 *   - isTransitionAllowed(from, to)
 */
import {
  FUNNEL_STEPS_ORDERED,
  InvalidTransitionError,
  TOTAL_FUNNEL_STEPS,
  type FunnelEvent,
  type FunnelEventType,
  type FunnelMachine,
  type FunnelProgress,
  type FunnelState,
  type FunnelStepId,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const STEP_INDEX: ReadonlyMap<FunnelStepId, number> = new Map(
  FUNNEL_STEPS_ORDERED.map((step, idx) => [step, idx]),
);

const SKIPPABLE_STEPS: ReadonlySet<FunnelStepId> = new Set<FunnelStepId>([
  'rating_gate', // iOS native dialog — user may dismiss
]);

function isStepId(state: FunnelState): state is FunnelStepId {
  return STEP_INDEX.has(state as FunnelStepId);
}

/** Step index (0..11) for a known step id.  Caller must have verified isStepId. */
function indexOfStep(step: FunnelStepId): number {
  // STEP_INDEX is built from FUNNEL_STEPS_ORDERED, so every FunnelStepId is present.
  return STEP_INDEX.get(step) as number;
}

/** Step number (1..12) for a step id; null for terminal states. */
function stepNumberOf(state: FunnelState): number | null {
  if (!isStepId(state)) return null;
  return indexOfStep(state) + 1;
}

/** Monotonic timestamp source. Date.now() is monotonic-enough at coarse resolution;
 *  for strict monotonicity we clamp to >= last emitted timestamp. */
function nextTimestamp(prev: readonly FunnelEvent[]): number {
  const now = Date.now();
  const last = prev.at(-1);
  if (last && now < last.timestamp) {
    return last.timestamp;
  }
  return now;
}

function makeEvent(
  type: FunnelEventType,
  state: FunnelState,
  prevHistory: readonly FunnelEvent[],
): FunnelEvent {
  return Object.freeze({
    type,
    state,
    stepNumber: stepNumberOf(state),
    timestamp: nextTimestamp(prevHistory),
  }) satisfies FunnelEvent;
}

function freezeMachine(
  state: FunnelState,
  history: readonly FunnelEvent[],
  completedSteps: readonly FunnelStepId[],
): FunnelMachine {
  return Object.freeze({
    state,
    history: Object.freeze([...history]),
    completedSteps: Object.freeze([...completedSteps]),
  });
}

// ---------------------------------------------------------------------------
// Transition rule — single source of truth (used by both validators & runners)
// ---------------------------------------------------------------------------

/**
 * Returns true iff a direct transition from `from` to `to` is permitted
 * by the funnel rules (excluding any contextual constraints like "must be
 * the next step").  This is the pure structural rule check.
 */
export function isTransitionAllowed(from: FunnelState, to: FunnelState): boolean {
  // Terminal states are dead ends.
  if (from === 'completed' || from === 'abandoned') return false;

  // idle → step 1 only.
  if (from === 'idle') {
    return to === FUNNEL_STEPS_ORDERED[0];
  }

  // From an active step: allow successor, completion-after-last, abandon, or skip-of-rating.
  if (!isStepId(from)) return false;

  // Any active step → abandoned is allowed.
  if (to === 'abandoned') return true;

  const fromIdx = indexOfStep(from);

  // Last step → completed.
  if (fromIdx === FUNNEL_STEPS_ORDERED.length - 1) {
    return to === 'completed';
  }

  // Non-last active step → next step is allowed.
  if (isStepId(to)) {
    return indexOfStep(to) === fromIdx + 1;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Constructors & transitions
// ---------------------------------------------------------------------------

export function createFunnel(): FunnelMachine {
  return freezeMachine('idle', [], []);
}

export function startFunnel(machine: FunnelMachine): FunnelMachine {
  const firstStep = FUNNEL_STEPS_ORDERED[0] as FunnelStepId;
  if (!isTransitionAllowed(machine.state, firstStep)) {
    throw new InvalidTransitionError(
      machine.state,
      firstStep,
      'startFunnel requires idle state',
    );
  }
  const startedEvent = makeEvent('funnel_started', firstStep, machine.history);
  const enteredEvent = makeEvent('step_entered', firstStep, [
    ...machine.history,
    startedEvent,
  ]);
  return freezeMachine(
    firstStep,
    [...machine.history, startedEvent, enteredEvent],
    machine.completedSteps,
  );
}

/**
 * Mark the current step as completed and enter the next step.
 * If currently on step 12 (payment_model), transition to `completed`.
 */
export function advanceStep(machine: FunnelMachine): FunnelMachine {
  if (!isStepId(machine.state)) {
    throw new InvalidTransitionError(
      machine.state,
      machine.state,
      'advanceStep requires an active step (not a terminal state)',
    );
  }
  const fromIdx = indexOfStep(machine.state);

  // Final step → completed.
  if (fromIdx === FUNNEL_STEPS_ORDERED.length - 1) {
    const completedEvent = makeEvent('step_completed', machine.state, machine.history);
    const finishedEvent = makeEvent('funnel_completed', 'completed', [
      ...machine.history,
      completedEvent,
    ]);
    return freezeMachine(
      'completed',
      [...machine.history, completedEvent, finishedEvent],
      [...machine.completedSteps, machine.state],
    );
  }

  const nextStep = FUNNEL_STEPS_ORDERED[fromIdx + 1] as FunnelStepId;
  const completedEvent = makeEvent('step_completed', machine.state, machine.history);
  const enteredEvent = makeEvent('step_entered', nextStep, [
    ...machine.history,
    completedEvent,
  ]);
  return freezeMachine(
    nextStep,
    [...machine.history, completedEvent, enteredEvent],
    [...machine.completedSteps, machine.state],
  );
}

/**
 * Skip the current step.  Only `rating_gate` (step 4, iOS native dialog) is skippable.
 * A skipped step does NOT appear in completedSteps.
 */
export function skipStep(machine: FunnelMachine): FunnelMachine {
  if (!isStepId(machine.state) || !SKIPPABLE_STEPS.has(machine.state)) {
    throw new InvalidTransitionError(
      machine.state,
      machine.state,
      'skipStep is only allowed for rating_gate (iOS native dialog)',
    );
  }
  // SKIPPABLE_STEPS only contains rating_gate (step 4), which always has a successor.
  const fromIdx = indexOfStep(machine.state);
  const nextStep = FUNNEL_STEPS_ORDERED[fromIdx + 1] as FunnelStepId;

  const skippedEvent = makeEvent('step_skipped', machine.state, machine.history);
  const enteredEvent = makeEvent('step_entered', nextStep, [
    ...machine.history,
    skippedEvent,
  ]);
  return freezeMachine(
    nextStep,
    [...machine.history, skippedEvent, enteredEvent],
    machine.completedSteps, // skipped step NOT added
  );
}

/**
 * Abandon the funnel from any active step.
 */
export function abandonFunnel(machine: FunnelMachine): FunnelMachine {
  if (!isTransitionAllowed(machine.state, 'abandoned')) {
    throw new InvalidTransitionError(
      machine.state,
      'abandoned',
      'cannot abandon from terminal state',
    );
  }
  const abandonedEvent = makeEvent('funnel_abandoned', 'abandoned', machine.history);
  return freezeMachine(
    'abandoned',
    [...machine.history, abandonedEvent],
    machine.completedSteps,
  );
}

// ---------------------------------------------------------------------------
// Progress projection
// ---------------------------------------------------------------------------

export function getProgress(machine: FunnelMachine): FunnelProgress {
  const completedCount = machine.completedSteps.length;
  const isComplete = machine.state === 'completed';
  const isAbandoned = machine.state === 'abandoned';
  const progressPercent = isComplete
    ? 100
    : Math.round((completedCount / TOTAL_FUNNEL_STEPS) * 100);

  return Object.freeze({
    state: machine.state,
    stepNumber: stepNumberOf(machine.state),
    completedSteps: Object.freeze([...machine.completedSteps]),
    progressPercent,
    isComplete,
    isAbandoned,
  });
}
