/**
 * Subscription state transition function — Sub-AC 16d.
 *
 * Single responsibility: given a current subscription state and an incoming
 * lifecycle event, return the next state.  Throws on any invalid
 * (state, event) combination so callers never silently land in an
 * undefined state.
 *
 * Valid transitions (Seed constraints):
 *   trial      + trial_end     → active
 *   active     + payment_fail  → past_due
 *   past_due   + grace_expire  → cancelled
 *   active     + user_cancel   → cancelled
 *
 * All other (state, event) pairs are invalid and raise
 * {@link InvalidSubscriptionTransitionError}.
 *
 * Usage:
 *   const next = transition_subscription('trial', 'trial_end');   // → 'active'
 *   const next = transition_subscription('active', 'user_cancel');// → 'cancelled'
 *   transition_subscription('trial', 'payment_fail');             // throws
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All possible subscription lifecycle states. */
export type SubscriptionState = 'trial' | 'active' | 'past_due' | 'cancelled';

/** All possible subscription lifecycle events that can trigger a transition. */
export type SubscriptionEvent = 'trial_end' | 'payment_fail' | 'grace_expire' | 'user_cancel';

// ---------------------------------------------------------------------------
// Transition table (frozen — deterministic, no mutation)
// ---------------------------------------------------------------------------

/**
 * Nested lookup: TRANSITIONS[current_state][event] = next_state.
 *
 * Only valid (state, event) pairs are present.  Accessing a missing
 * combination returns `undefined`, which the function turns into a thrown error.
 */
const TRANSITIONS: Readonly<
  Partial<Record<SubscriptionState, Partial<Record<SubscriptionEvent, SubscriptionState>>>>
> = Object.freeze({
  trial: Object.freeze({
    trial_end: 'active' as const,
  }),
  active: Object.freeze({
    payment_fail: 'past_due' as const,
    user_cancel: 'cancelled' as const,
  }),
  past_due: Object.freeze({
    grace_expire: 'cancelled' as const,
  }),
  cancelled: Object.freeze({}),
});

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Thrown when `transition_subscription` receives an invalid
 * (current_state, event) combination — i.e. one not present in the
 * transition table.
 */
export class InvalidSubscriptionTransitionError extends Error {
  public override readonly name = 'InvalidSubscriptionTransitionError';
  public readonly currentState: unknown;
  public readonly event: unknown;

  constructor(currentState: unknown, event: unknown) {
    super(
      `Invalid subscription transition: state='${String(currentState)}' does not accept event='${String(event)}'.`,
    );
    this.currentState = currentState;
    this.event = event;
  }
}

// ---------------------------------------------------------------------------
// Public API — transition_subscription (AC spec name)
// ---------------------------------------------------------------------------

/**
 * Returns the next {@link SubscriptionState} for the given (current_state, event) pair.
 *
 * AC spec name: `transition_subscription(current_state, event)`
 *
 * | current_state | event        | next_state |
 * |---------------|--------------|------------|
 * | trial         | trial_end    | active     |
 * | active        | payment_fail | past_due   |
 * | past_due      | grace_expire | cancelled  |
 * | active        | user_cancel  | cancelled  |
 *
 * @param currentState - The subscription's present state.
 * @param event        - The lifecycle event triggering the transition.
 * @returns The next subscription state.
 * @throws {InvalidSubscriptionTransitionError} for any (state, event) pair not
 *         listed in the table above, including unknown state/event strings.
 *
 * @example
 * transition_subscription('trial', 'trial_end')      // → 'active'
 * transition_subscription('active', 'payment_fail')  // → 'past_due'
 * transition_subscription('past_due', 'grace_expire')// → 'cancelled'
 * transition_subscription('active', 'user_cancel')   // → 'cancelled'
 * transition_subscription('trial', 'payment_fail')   // throws
 */
export function transition_subscription(
  currentState: SubscriptionState,
  event: SubscriptionEvent,
): SubscriptionState;
export function transition_subscription(
  currentState: unknown,
  event: unknown,
): SubscriptionState;
export function transition_subscription(
  currentState: unknown,
  event: unknown,
): SubscriptionState {
  const stateMap = TRANSITIONS[currentState as SubscriptionState];
  if (stateMap !== undefined) {
    const nextState = stateMap[event as SubscriptionEvent];
    if (nextState !== undefined) {
      return nextState;
    }
  }
  throw new InvalidSubscriptionTransitionError(currentState, event);
}
