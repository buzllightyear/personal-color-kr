/**
 * Unit tests — PostHog 결제 이벤트 트래킹 모듈 (Sub-AC 1.1).
 *
 * Contract under test:
 *   - A SINGLE entry function `emitPaymentEvent` fires both
 *     `checkout_started` and `checkout_completed` events.
 *   - The function validates the event payload schema before emitting,
 *     so PostHog never receives malformed payment telemetry — the metric
 *     this app's north star (결제 전환율) is computed against.
 *
 * Coverage matrix:
 *   1. PAYMENT_EVENT_TYPES is the exact frozen tuple ['checkout_started',
 *      'checkout_completed'] — order locked because downstream dashboards
 *      rely on it.
 *   2. Happy paths:
 *      a. `checkout_started` emits a frozen event with pricing fields
 *         derived from PAYMENT_PLAN_CATALOGUE (single source of truth).
 *      b. `checkout_completed` adds orderId / amountUsd / providerRef
 *         on top of the same base shape.
 *      c. Sink receives the same frozen event reference.
 *      d. Injected `now` is honoured; falls back to Date.now() when
 *         omitted.
 *   3. Schema validation rejects:
 *      a. Unknown event types.
 *      b. Empty sessionId / handoffId.
 *      c. Unknown plan ids.
 *      d. Missing `checkout_completed`-only fields.
 *      e. `amountUsd` that is negative, non-finite, or not a number.
 *      f. Empty orderId / providerRef on `checkout_completed`.
 *      g. Non-integer timestamp / negative timestamp.
 *   4. On any schema failure: sink is NEVER called.
 *   5. Schema errors carry a structured `field` discriminator + the bad
 *      value so callers can branch / log without parsing the message.
 *   6. Pricing fields are derived from PAYMENT_PLAN_CATALOGUE — caller
 *     does NOT supply price/trial; mirrors checkout.ts source of truth.
 */
import { describe, expect, it, vi } from 'vitest';

import { PAYMENT_PLAN_CATALOGUE } from '../../src/funnel/checkout.js';
import {
  PAYMENT_EVENT_TYPES,
  PaymentEventSchemaError,
  emitPaymentEvent,
  type CheckoutCompletedEvent,
  type CheckoutStartedEvent,
  type PaymentAnalyticsSink,
  type PaymentEvent,
  type PaymentEventInput,
} from '../../src/funnel/payment-tracking.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_715_000_000_000; // 2024-05-06T11:33:20Z, deterministic
const SESSION_ID = 'sess_payment_01';
const HANDOFF_ID = 'chk_test_handoff_01';
const ORDER_ID = 'order_test_001';
const PROVIDER_REF = 'toss_payment_ref_001';

function makeMockSink(): PaymentAnalyticsSink & {
  readonly captured: readonly PaymentEvent[];
} {
  const captured: PaymentEvent[] = [];
  return {
    capture(event: PaymentEvent) {
      captured.push(event);
    },
    get captured(): readonly PaymentEvent[] {
      return captured;
    },
  };
}

function startedInput(
  overrides: Partial<Extract<PaymentEventInput, { type: 'checkout_started' }>> = {},
): Extract<PaymentEventInput, { type: 'checkout_started' }> {
  return {
    type: 'checkout_started',
    sessionId: SESSION_ID,
    handoffId: HANDOFF_ID,
    plan: 'annual',
    ...overrides,
  };
}

function completedInput(
  overrides: Partial<Extract<PaymentEventInput, { type: 'checkout_completed' }>> = {},
): Extract<PaymentEventInput, { type: 'checkout_completed' }> {
  return {
    type: 'checkout_completed',
    sessionId: SESSION_ID,
    handoffId: HANDOFF_ID,
    plan: 'annual',
    orderId: ORDER_ID,
    amountUsd: 59,
    providerRef: PROVIDER_REF,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

describe('PAYMENT_EVENT_TYPES', () => {
  it('exposes exactly the two checkout events in canonical order', () => {
    expect(PAYMENT_EVENT_TYPES).toEqual([
      'checkout_started',
      'checkout_completed',
    ]);
  });

  it('is frozen — downstream dashboards rely on stable membership', () => {
    expect(Object.isFrozen(PAYMENT_EVENT_TYPES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// emitPaymentEvent — checkout_started happy path
// ---------------------------------------------------------------------------

describe('emitPaymentEvent — checkout_started', () => {
  it('emits a frozen event with type + base fields', () => {
    const sink = makeMockSink();
    const event = emitPaymentEvent(startedInput(), {
      sink,
      now: () => FIXED_NOW,
    }) as CheckoutStartedEvent;

    expect(event.type).toBe('checkout_started');
    expect(event.sessionId).toBe(SESSION_ID);
    expect(event.handoffId).toBe(HANDOFF_ID);
    expect(event.plan).toBe('annual');
    expect(event.timestamp).toBe(FIXED_NOW);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('derives priceUsd / currencyCode / trialDays from PAYMENT_PLAN_CATALOGUE (annual)', () => {
    const sink = makeMockSink();
    const event = emitPaymentEvent(startedInput({ plan: 'annual' }), {
      sink,
      now: () => FIXED_NOW,
    }) as CheckoutStartedEvent;

    const annual = PAYMENT_PLAN_CATALOGUE.annual;
    expect(event.priceUsd).toBe(annual.priceUsd);
    expect(event.currencyCode).toBe(annual.currencyCode);
    expect(event.trialDays).toBe(annual.trialDays);
    // Korean variant: 7 + 30 = 37 day trial on annual.
    expect(event.trialDays).toBe(37);
    expect(event.priceUsd).toBe(59);
  });

  it('derives priceUsd / trialDays from PAYMENT_PLAN_CATALOGUE (monthly)', () => {
    const sink = makeMockSink();
    const event = emitPaymentEvent(startedInput({ plan: 'monthly' }), {
      sink,
      now: () => FIXED_NOW,
    }) as CheckoutStartedEvent;

    expect(event.priceUsd).toBe(12);
    expect(event.trialDays).toBe(0);
    expect(event.currencyCode).toBe('USD');
  });

  it('forwards the exact frozen event reference to the sink', () => {
    const sink = makeMockSink();
    const event = emitPaymentEvent(startedInput(), {
      sink,
      now: () => FIXED_NOW,
    });
    expect(sink.captured).toHaveLength(1);
    expect(sink.captured[0]).toBe(event);
  });

  it('honours an explicit timestamp in the input over the clock', () => {
    const sink = makeMockSink();
    const explicit = 999_999_999_999;
    const event = emitPaymentEvent(
      startedInput({ timestamp: explicit }),
      { sink, now: () => FIXED_NOW },
    );
    expect(event.timestamp).toBe(explicit);
  });

  it('falls back to Date.now() when no clock is supplied', () => {
    const sink = makeMockSink();
    const before = Date.now();
    const event = emitPaymentEvent(startedInput(), { sink });
    const after = Date.now();
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// emitPaymentEvent — checkout_completed happy path
// ---------------------------------------------------------------------------

describe('emitPaymentEvent — checkout_completed', () => {
  it('emits a frozen event with base + completed-specific fields', () => {
    const sink = makeMockSink();
    const event = emitPaymentEvent(completedInput(), {
      sink,
      now: () => FIXED_NOW,
    }) as CheckoutCompletedEvent;

    expect(event.type).toBe('checkout_completed');
    expect(event.sessionId).toBe(SESSION_ID);
    expect(event.handoffId).toBe(HANDOFF_ID);
    expect(event.plan).toBe('annual');
    expect(event.orderId).toBe(ORDER_ID);
    expect(event.amountUsd).toBe(59);
    expect(event.providerRef).toBe(PROVIDER_REF);
    expect(event.timestamp).toBe(FIXED_NOW);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('still derives plan pricing from the catalogue (priceUsd, trialDays)', () => {
    const sink = makeMockSink();
    const event = emitPaymentEvent(completedInput({ plan: 'monthly', amountUsd: 12 }), {
      sink,
      now: () => FIXED_NOW,
    }) as CheckoutCompletedEvent;
    expect(event.priceUsd).toBe(12);
    expect(event.trialDays).toBe(0);
  });

  it('allows amountUsd = 0 (trial activation with no immediate charge)', () => {
    const sink = makeMockSink();
    const event = emitPaymentEvent(completedInput({ amountUsd: 0 }), {
      sink,
      now: () => FIXED_NOW,
    }) as CheckoutCompletedEvent;
    expect(event.amountUsd).toBe(0);
    expect(sink.captured).toHaveLength(1);
  });

  it('forwards the exact frozen event reference to the sink', () => {
    const sink = makeMockSink();
    const event = emitPaymentEvent(completedInput(), {
      sink,
      now: () => FIXED_NOW,
    });
    expect(sink.captured).toHaveLength(1);
    expect(sink.captured[0]).toBe(event);
  });
});

// ---------------------------------------------------------------------------
// Schema validation — every reject path
// ---------------------------------------------------------------------------

describe('emitPaymentEvent — schema validation rejects bad input', () => {
  it('throws on unknown event type and does NOT call the sink', () => {
    const sink = makeMockSink();
    const capture = vi.spyOn(sink, 'capture');

    let caught: unknown;
    try {
      emitPaymentEvent(
        // intentional bad type — guard must catch at runtime
        { ...startedInput(), type: 'refund_issued' } as unknown as PaymentEventInput,
        { sink, now: () => FIXED_NOW },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PaymentEventSchemaError);
    expect((caught as PaymentEventSchemaError).field).toBe('type');
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    ['empty sessionId', startedInput({ sessionId: '' }), 'sessionId'],
    ['whitespace sessionId', startedInput({ sessionId: '   ' }), 'sessionId'],
    ['empty handoffId', startedInput({ handoffId: '' }), 'handoffId'],
    ['whitespace handoffId', startedInput({ handoffId: '   ' }), 'handoffId'],
  ])('rejects %s and does NOT call the sink', (_label, input, expectedField) => {
    const sink = makeMockSink();
    const capture = vi.spyOn(sink, 'capture');

    let caught: unknown;
    try {
      emitPaymentEvent(input, { sink, now: () => FIXED_NOW });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PaymentEventSchemaError);
    expect((caught as PaymentEventSchemaError).field).toBe(expectedField);
    expect(capture).not.toHaveBeenCalled();
  });

  it('rejects an unknown plan id and does NOT call the sink', () => {
    const sink = makeMockSink();
    const capture = vi.spyOn(sink, 'capture');

    let caught: unknown;
    try {
      emitPaymentEvent(
        startedInput({ plan: 'lifetime' as unknown as 'annual' }),
        { sink, now: () => FIXED_NOW },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PaymentEventSchemaError);
    expect((caught as PaymentEventSchemaError).field).toBe('plan');
    expect((caught as PaymentEventSchemaError).value).toBe('lifetime');
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    ['negative amountUsd', completedInput({ amountUsd: -1 })],
    ['NaN amountUsd', completedInput({ amountUsd: Number.NaN })],
    ['Infinity amountUsd', completedInput({ amountUsd: Number.POSITIVE_INFINITY })],
    ['non-number amountUsd', completedInput({ amountUsd: '59' as unknown as number })],
  ])('rejects %s on checkout_completed', (_label, input) => {
    const sink = makeMockSink();
    const capture = vi.spyOn(sink, 'capture');

    let caught: unknown;
    try {
      emitPaymentEvent(input, { sink, now: () => FIXED_NOW });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PaymentEventSchemaError);
    expect((caught as PaymentEventSchemaError).field).toBe('amountUsd');
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    ['empty orderId', completedInput({ orderId: '' }), 'orderId'],
    ['empty providerRef', completedInput({ providerRef: '' }), 'providerRef'],
  ])('rejects %s on checkout_completed', (_label, input, expectedField) => {
    const sink = makeMockSink();
    const capture = vi.spyOn(sink, 'capture');

    let caught: unknown;
    try {
      emitPaymentEvent(input, { sink, now: () => FIXED_NOW });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PaymentEventSchemaError);
    expect((caught as PaymentEventSchemaError).field).toBe(expectedField);
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    ['missing orderId', { ...completedInput(), orderId: undefined } as unknown as PaymentEventInput, 'orderId'],
    ['missing providerRef', { ...completedInput(), providerRef: undefined } as unknown as PaymentEventInput, 'providerRef'],
    ['missing amountUsd', { ...completedInput(), amountUsd: undefined } as unknown as PaymentEventInput, 'amountUsd'],
  ])('rejects %s', (_label, input, expectedField) => {
    const sink = makeMockSink();
    const capture = vi.spyOn(sink, 'capture');

    let caught: unknown;
    try {
      emitPaymentEvent(input, { sink, now: () => FIXED_NOW });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PaymentEventSchemaError);
    expect((caught as PaymentEventSchemaError).field).toBe(expectedField);
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    ['negative timestamp', startedInput({ timestamp: -1 })],
    ['non-finite timestamp', startedInput({ timestamp: Number.NaN })],
    ['non-integer timestamp', startedInput({ timestamp: 1.5 })],
  ])('rejects %s', (_label, input) => {
    const sink = makeMockSink();
    const capture = vi.spyOn(sink, 'capture');

    let caught: unknown;
    try {
      emitPaymentEvent(input, { sink, now: () => FIXED_NOW });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PaymentEventSchemaError);
    expect((caught as PaymentEventSchemaError).field).toBe('timestamp');
    expect(capture).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error class shape
// ---------------------------------------------------------------------------

describe('PaymentEventSchemaError', () => {
  it('extends Error, names itself, and exposes the failed field + value', () => {
    const err = new PaymentEventSchemaError('plan', 'bad plan', 'lifetime');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PaymentEventSchemaError');
    expect(err.field).toBe('plan');
    expect(err.value).toBe('lifetime');
    expect(err.message).toContain('bad plan');
  });
});
