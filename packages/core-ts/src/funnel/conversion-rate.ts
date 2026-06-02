/**
 * Sub-AC 1.2 — 결제 전환율 (payment conversion rate) computation.
 *
 * The app's NORTH-STAR METRIC.  Defined as:
 *
 *     conversion_rate = (checkout_completed / checkout_started) * 100
 *
 * Lives behind a SINGLE pure function so that every consumer —
 * the production PostHog-derived dashboard, internal cohort
 * reporting, integration tests, evaluation scripts — computes the
 * metric *identically*.  No drift between systems means the 5.5%
 * Phase-0 target is comparable end-to-end.
 *
 * Boundary contract (see unit tests for the full matrix):
 *
 *   - both counts == 0           → 0  ("0건" — no observations yet,
 *                                       dashboards render "0.00%").
 *   - startedCount == 0,
 *     completedCount > 0          → throws ("분모 0" + numerator > 0 is
 *                                       a logical impossibility — a
 *                                       completion implies a start the
 *                                       funnel never observed).
 *   - completedCount > startedCount → throws (invariant violation).
 *   - negative / non-integer /
 *     non-finite count           → throws (PostHog count fields are
 *                                       always non-negative integers).
 *
 * The function is pure: same input → same output, no globals, no I/O.
 */
import {
  PAYMENT_EVENT_TYPES,
  type PaymentEvent,
  type PaymentEventType,
} from './payment-tracking.js';

// ---------------------------------------------------------------------------
// Public input type
// ---------------------------------------------------------------------------

export interface ConversionRateInput {
  /** Number of `checkout_started` events observed in the window. */
  readonly startedCount: number;
  /** Number of `checkout_completed` events observed in the window. */
  readonly completedCount: number;
}

/**
 * Aggregated counts + the derived percentage.  Returned by
 * {@link calculateConversionRateFromEvents} so a single pass over the
 * event log gives callers everything they need for reporting (no need
 * to recount).
 */
export interface ConversionRateBreakdown {
  readonly startedCount: number;
  readonly completedCount: number;
  /** Percentage in the closed interval [0, 100]. */
  readonly ratePercent: number;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Reasons {@link calculateConversionRate} can reject its input.  Used
 * as a structured discriminator on {@link ConversionRateError} so
 * callers branch on `err.reason` instead of parsing the message.
 */
export type ConversionRateErrorReason =
  | 'not_a_number'
  | 'not_finite'
  | 'not_integer'
  | 'negative'
  | 'completed_exceeds_started';

export class ConversionRateError extends Error {
  public override readonly name = 'ConversionRateError';
  public readonly reason: ConversionRateErrorReason;
  public readonly value: unknown;

  constructor(reason: ConversionRateErrorReason, message: string, value: unknown) {
    super(message);
    this.reason = reason;
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateCount(field: 'startedCount' | 'completedCount', value: unknown): void {
  if (typeof value !== 'number') {
    throw new ConversionRateError(
      'not_a_number',
      `${field} must be a number, got ${typeof value}`,
      value,
    );
  }
  if (!Number.isFinite(value)) {
    throw new ConversionRateError(
      'not_finite',
      `${field} must be finite (got ${value})`,
      value,
    );
  }
  if (!Number.isInteger(value)) {
    throw new ConversionRateError(
      'not_integer',
      `${field} must be an integer (got ${value})`,
      value,
    );
  }
  if (value < 0) {
    throw new ConversionRateError(
      'negative',
      `${field} must be non-negative (got ${value})`,
      value,
    );
  }
}

// ---------------------------------------------------------------------------
// Pure function
// ---------------------------------------------------------------------------

/**
 * Computes the payment conversion-rate percentage from event counts.
 *
 * @returns Percentage in [0, 100].  Returns `0` when there are no
 * observations at all (both counts zero).  See the module header for
 * the boundary contract and {@link ConversionRateError} for the
 * reject reasons.
 */
export function calculateConversionRate(input: ConversionRateInput): number {
  validateCount('startedCount', input.startedCount);
  validateCount('completedCount', input.completedCount);

  if (input.completedCount > input.startedCount) {
    throw new ConversionRateError(
      'completed_exceeds_started',
      `completedCount (${input.completedCount}) cannot exceed startedCount (${input.startedCount})`,
      { startedCount: input.startedCount, completedCount: input.completedCount },
    );
  }

  // "0건" — no observations yet.  Returning 0 lets dashboards render
  // "0.00%" without special-casing; throwing here would force every
  // caller to wrap the call in a try/catch.
  if (input.startedCount === 0) {
    return 0;
  }

  return (input.completedCount / input.startedCount) * 100;
}

// ---------------------------------------------------------------------------
// Convenience — aggregate from an event log
// ---------------------------------------------------------------------------

/**
 * Counts `checkout_started` / `checkout_completed` events in `events`
 * and returns the same conversion-rate percentage
 * {@link calculateConversionRate} would compute, alongside the raw
 * counts so reporting consumers don't have to recount.
 *
 * Unknown event types in `events` are ignored — the function only
 * counts the canonical {@link PAYMENT_EVENT_TYPES} membership.  This
 * makes it safe to feed in a mixed PostHog event log without
 * pre-filtering.
 */
export function calculateConversionRateFromEvents(
  events: readonly PaymentEvent[],
): ConversionRateBreakdown {
  let startedCount = 0;
  let completedCount = 0;

  for (const evt of events) {
    if (!isKnownPaymentEventType(evt.type)) {
      continue;
    }
    if (evt.type === 'checkout_started') {
      startedCount += 1;
    } else if (evt.type === 'checkout_completed') {
      completedCount += 1;
    }
  }

  const ratePercent = calculateConversionRate({ startedCount, completedCount });
  return Object.freeze({ startedCount, completedCount, ratePercent });
}

function isKnownPaymentEventType(value: string): value is PaymentEventType {
  return (PAYMENT_EVENT_TYPES as readonly string[]).includes(value);
}
