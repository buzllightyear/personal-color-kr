/**
 * PostHog 결제 이벤트 트래킹 모듈 — Sub-AC 1.1.
 *
 * A SINGLE function (`emitPaymentEvent`) fires both payment telemetry
 * events the app's north-star metric (결제 전환율) is computed from:
 *
 *   - `checkout_started`    — user initiates checkout handoff
 *   - `checkout_completed`  — payment provider confirms completion
 *
 * Wraps an injectable {@link PaymentAnalyticsSink} so the module is
 * unit-testable (a `vi.fn` sink) and provider-agnostic in production
 * (PostHog, Mixpanel, an in-house warehouse, etc.).  Time is injected
 * via `now` for deterministic tests; falls back to `Date.now()` when
 * omitted.
 *
 * Design choices:
 *   - Pricing (priceUsd / currencyCode / trialDays) is DERIVED from
 *     {@link PAYMENT_PLAN_CATALOGUE} so screen renderer, checkout
 *     trigger, and analytics never drift — single source of truth.
 *   - Every event is `Object.freeze`d before reaching the sink —
 *     defence-in-depth against accidental mutation before the wire.
 *   - Schema validation runs BEFORE the sink is touched, so a
 *     malformed payload never reaches PostHog.  Failures throw
 *     {@link PaymentEventSchemaError} carrying a structured `field`
 *     discriminator + the bad value.
 */
import {
  PAYMENT_PLAN_CATALOGUE,
  type PaymentPlanId,
  type PaymentPlanPricing,
} from './checkout.js';

// ---------------------------------------------------------------------------
// Public contract — event types
// ---------------------------------------------------------------------------

/**
 * Canonical PostHog event names for the two checkout milestones.
 * Order is part of the contract — downstream dashboards rely on it.
 */
export const PAYMENT_EVENT_TYPES = Object.freeze([
  'checkout_started',
  'checkout_completed',
] as const);

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

/**
 * Fields every payment analytics event carries.  Maps onto PostHog
 * event properties 1:1.
 */
interface PaymentEventBasePayload {
  readonly sessionId: string;
  readonly handoffId: string;
  readonly plan: PaymentPlanId;
  readonly priceUsd: number;
  readonly currencyCode: PaymentPlanPricing['currencyCode'];
  readonly trialDays: number;
  readonly timestamp: number; // ms epoch
}

export interface CheckoutStartedEvent extends PaymentEventBasePayload {
  readonly type: 'checkout_started';
}

export interface CheckoutCompletedEvent extends PaymentEventBasePayload {
  readonly type: 'checkout_completed';
  readonly orderId: string;
  readonly amountUsd: number;
  readonly providerRef: string;
}

export type PaymentEvent = CheckoutStartedEvent | CheckoutCompletedEvent;

// ---------------------------------------------------------------------------
// Input types — discriminated union the single emit function accepts
// ---------------------------------------------------------------------------

interface PaymentEventInputBase {
  readonly sessionId: string;
  readonly handoffId: string;
  readonly plan: PaymentPlanId;
  /** Optional override; clock from options is used when omitted. */
  readonly timestamp?: number;
}

export interface CheckoutStartedInput extends PaymentEventInputBase {
  readonly type: 'checkout_started';
}

export interface CheckoutCompletedInput extends PaymentEventInputBase {
  readonly type: 'checkout_completed';
  readonly orderId: string;
  readonly amountUsd: number;
  readonly providerRef: string;
}

export type PaymentEventInput = CheckoutStartedInput | CheckoutCompletedInput;

// ---------------------------------------------------------------------------
// Sink contract — PostHog client in prod, recorder/vi.fn in tests
// ---------------------------------------------------------------------------

export interface PaymentAnalyticsSink {
  capture(event: PaymentEvent): void;
}

export interface EmitPaymentEventOptions {
  readonly sink: PaymentAnalyticsSink;
  /** Injectable clock; defaults to `Date.now`. */
  readonly now?: () => number;
}

// ---------------------------------------------------------------------------
// Schema error
// ---------------------------------------------------------------------------

/**
 * The fields that schema validation can fail on.  Used as a structured
 * discriminator on {@link PaymentEventSchemaError}, so callers branch
 * on `err.field` rather than parsing the message.
 */
export type PaymentEventSchemaField =
  | 'type'
  | 'sessionId'
  | 'handoffId'
  | 'plan'
  | 'orderId'
  | 'amountUsd'
  | 'providerRef'
  | 'timestamp';

export class PaymentEventSchemaError extends Error {
  public override readonly name = 'PaymentEventSchemaError';
  public readonly field: PaymentEventSchemaField;
  public readonly value: unknown;

  constructor(field: PaymentEventSchemaField, message: string, value: unknown) {
    super(message);
    this.field = field;
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// Validation primitives
// ---------------------------------------------------------------------------

function isPaymentEventType(value: unknown): value is PaymentEventType {
  return (
    typeof value === 'string' &&
    (PAYMENT_EVENT_TYPES as readonly string[]).includes(value)
  );
}

function isPaymentPlanId(value: unknown): value is PaymentPlanId {
  return value === 'monthly' || value === 'annual';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function assertString(field: PaymentEventSchemaField, value: unknown): void {
  if (!isNonEmptyString(value)) {
    throw new PaymentEventSchemaError(
      field,
      `${field} must be a non-empty string`,
      value,
    );
  }
}

// ---------------------------------------------------------------------------
// Validation pipeline
// ---------------------------------------------------------------------------

function validateBase(input: PaymentEventInput): void {
  if (!isPaymentEventType(input.type)) {
    throw new PaymentEventSchemaError(
      'type',
      `Unknown payment event type: ${String(input.type)}`,
      input.type,
    );
  }
  assertString('sessionId', input.sessionId);
  assertString('handoffId', input.handoffId);
  if (!isPaymentPlanId(input.plan)) {
    throw new PaymentEventSchemaError(
      'plan',
      `Unknown payment plan id: ${String(input.plan)}`,
      input.plan,
    );
  }
  if (input.timestamp !== undefined && !isValidTimestamp(input.timestamp)) {
    throw new PaymentEventSchemaError(
      'timestamp',
      'timestamp must be a non-negative integer (ms epoch)',
      input.timestamp,
    );
  }
}

function validateCompleted(input: CheckoutCompletedInput): void {
  assertString('orderId', input.orderId);
  assertString('providerRef', input.providerRef);
  if (!isNonNegativeFiniteNumber(input.amountUsd)) {
    throw new PaymentEventSchemaError(
      'amountUsd',
      'amountUsd must be a finite, non-negative number',
      input.amountUsd,
    );
  }
}

// ---------------------------------------------------------------------------
// Public single function
// ---------------------------------------------------------------------------

/**
 * Validates `input` against the payment-event schema and, on success,
 * captures a frozen {@link PaymentEvent} on the supplied sink.
 *
 * Schema failures throw {@link PaymentEventSchemaError} BEFORE the sink
 * is touched — PostHog never sees a malformed payload.
 */
export function emitPaymentEvent(
  input: PaymentEventInput,
  options: EmitPaymentEventOptions,
): PaymentEvent {
  validateBase(input);
  if (input.type === 'checkout_completed') {
    validateCompleted(input);
  }

  const clock: () => number = options.now ?? Date.now;
  const timestamp = input.timestamp ?? clock();
  const pricing = PAYMENT_PLAN_CATALOGUE[input.plan];

  const base: PaymentEventBasePayload = {
    sessionId: input.sessionId,
    handoffId: input.handoffId,
    plan: input.plan,
    priceUsd: pricing.priceUsd,
    currencyCode: pricing.currencyCode,
    trialDays: pricing.trialDays,
    timestamp,
  };

  let event: PaymentEvent;
  if (input.type === 'checkout_started') {
    event = Object.freeze({
      type: 'checkout_started' as const,
      ...base,
    });
  } else {
    event = Object.freeze({
      type: 'checkout_completed' as const,
      ...base,
      orderId: input.orderId,
      amountUsd: input.amountUsd,
      providerRef: input.providerRef,
    });
  }

  options.sink.capture(event);
  return event;
}
