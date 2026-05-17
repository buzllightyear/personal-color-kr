/**
 * Unit tests — 결제 전환율 conversion-rate calculator (Sub-AC 1.2).
 *
 * Contract under test:
 *   - A pure function `calculateConversionRate` computes the north-star
 *     metric `(checkout_completed / checkout_started) * 100`.
 *   - Same input → same output; no globals, no I/O.
 *
 * Coverage matrix:
 *   1. Happy path:
 *      a. Standard ratio (10/100 → 10).
 *      b. 100% conversion (5/5 → 100).
 *      c. 0% conversion (0/10 → 0).
 *      d. Decimal precision preserved (55/1000 → 5.5, matches the
 *         Phase-0 north-star target of 5.5%).
 *      e. Large counts don't lose precision (123_456/1_000_000).
 *   2. Boundary cases — "0건" and "분모 0":
 *      a. Both counts zero (no observations) → 0.
 *      b. startedCount > 0, completedCount = 0 → 0.
 *      c. startedCount = 0, completedCount > 0 → throws
 *         (logical impossibility — invariant violation).
 *   3. Invariant violation: completedCount > startedCount → throws.
 *   4. Schema validation rejects, with structured `reason`:
 *      a. Negative counts.
 *      b. Non-integer counts.
 *      c. Non-finite counts (NaN, Infinity).
 *      d. Non-number counts (string, undefined).
 *   5. Aggregator `calculateConversionRateFromEvents`:
 *      a. Empty list → 0 / 0 / 0%.
 *      b. Mixed event log counts both events.
 *      c. Frozen breakdown — defence-in-depth against mutation.
 *      d. Unknown event types in the list are ignored.
 *   6. Purity: invoking twice with the same input yields the same
 *      number; the input object is not mutated.
 *   7. Error class shape: name, reason discriminator, captured value.
 */
import { describe, expect, it } from 'vitest';

import {
  ConversionRateError,
  calculateConversionRate,
  calculateConversionRateFromEvents,
  type ConversionRateInput,
} from '../../src/funnel/conversion-rate.js';
import type { PaymentEvent } from '../../src/funnel/payment-tracking.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startedEvent(): PaymentEvent {
  return Object.freeze({
    type: 'checkout_started',
    sessionId: 'sess_test_1',
    handoffId: 'chk_test_handoff_1',
    plan: 'annual',
    priceUsd: 59,
    currencyCode: 'USD',
    trialDays: 37,
    timestamp: 1_715_000_000_000,
  }) as PaymentEvent;
}

function completedEvent(): PaymentEvent {
  return Object.freeze({
    type: 'checkout_completed',
    sessionId: 'sess_test_1',
    handoffId: 'chk_test_handoff_1',
    plan: 'annual',
    priceUsd: 59,
    currencyCode: 'USD',
    trialDays: 37,
    timestamp: 1_715_000_000_001,
    orderId: 'order_test_001',
    amountUsd: 59,
    providerRef: 'toss_payment_ref_001',
  }) as PaymentEvent;
}

function expectThrows(fn: () => unknown): ConversionRateError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ConversionRateError);
  return caught as ConversionRateError;
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('calculateConversionRate — happy path', () => {
  it('computes a standard ratio (10 / 100 → 10%)', () => {
    expect(
      calculateConversionRate({ startedCount: 100, completedCount: 10 }),
    ).toBe(10);
  });

  it('returns 100 when every started checkout completes', () => {
    expect(
      calculateConversionRate({ startedCount: 5, completedCount: 5 }),
    ).toBe(100);
  });

  it('returns 0 when no checkouts complete', () => {
    expect(
      calculateConversionRate({ startedCount: 10, completedCount: 0 }),
    ).toBe(0);
  });

  it('preserves decimal precision at the 5.5% north-star target', () => {
    // 55/1000 = 0.055 = 5.5%
    expect(
      calculateConversionRate({ startedCount: 1000, completedCount: 55 }),
    ).toBe(5.5);
  });

  it('handles large counts without precision loss', () => {
    const result = calculateConversionRate({
      startedCount: 1_000_000,
      completedCount: 123_456,
    });
    // 123456 / 1000000 * 100 = 12.3456
    expect(result).toBeCloseTo(12.3456, 10);
  });

  it('handles a single observation (1/1 → 100%)', () => {
    expect(
      calculateConversionRate({ startedCount: 1, completedCount: 1 }),
    ).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Boundary cases — "0건" and "분모 0"
// ---------------------------------------------------------------------------

describe('calculateConversionRate — boundary cases', () => {
  it('returns 0 when there are no observations at all ("0건" — both counts zero)', () => {
    // Dashboards rely on this to render "0.00%" without special-casing.
    expect(
      calculateConversionRate({ startedCount: 0, completedCount: 0 }),
    ).toBe(0);
  });

  it('returns 0 when starts exist but no completions yet', () => {
    expect(
      calculateConversionRate({ startedCount: 25, completedCount: 0 }),
    ).toBe(0);
  });

  it('throws when denominator is 0 but a completion was observed ("분모 0" + numerator > 0)', () => {
    // Logical impossibility: a completion implies a start.  If the
    // funnel never observed a start, the data is corrupt — throw
    // loudly instead of returning Infinity or NaN.
    const err = expectThrows(() =>
      calculateConversionRate({ startedCount: 0, completedCount: 1 }),
    );
    expect(err.reason).toBe('completed_exceeds_started');
  });

  it('throws when completedCount > startedCount (invariant violation)', () => {
    const err = expectThrows(() =>
      calculateConversionRate({ startedCount: 10, completedCount: 11 }),
    );
    expect(err.reason).toBe('completed_exceeds_started');
    expect(err.value).toEqual({ startedCount: 10, completedCount: 11 });
  });
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('calculateConversionRate — schema validation', () => {
  it.each([
    ['negative startedCount', { startedCount: -1, completedCount: 0 }, 'negative'],
    ['negative completedCount', { startedCount: 10, completedCount: -1 }, 'negative'],
  ] as const)('rejects %s', (_label, input, expectedReason) => {
    const err = expectThrows(() => calculateConversionRate(input));
    expect(err.reason).toBe(expectedReason);
  });

  it.each([
    ['non-integer startedCount', { startedCount: 1.5, completedCount: 0 }],
    ['non-integer completedCount', { startedCount: 10, completedCount: 0.5 }],
  ] as const)('rejects %s', (_label, input) => {
    const err = expectThrows(() => calculateConversionRate(input));
    expect(err.reason).toBe('not_integer');
  });

  it.each([
    ['NaN startedCount', { startedCount: Number.NaN, completedCount: 0 }],
    ['Infinity startedCount', { startedCount: Number.POSITIVE_INFINITY, completedCount: 0 }],
    ['-Infinity completedCount', { startedCount: 10, completedCount: Number.NEGATIVE_INFINITY }],
  ] as const)('rejects %s', (_label, input) => {
    const err = expectThrows(() => calculateConversionRate(input));
    expect(err.reason).toBe('not_finite');
  });

  it.each([
    ['string startedCount', { startedCount: '10' as unknown as number, completedCount: 1 }],
    ['undefined completedCount', { startedCount: 10, completedCount: undefined as unknown as number }],
    ['null startedCount', { startedCount: null as unknown as number, completedCount: 0 }],
  ] as const)('rejects %s', (_label, input) => {
    const err = expectThrows(() => calculateConversionRate(input));
    expect(err.reason).toBe('not_a_number');
  });
});

// ---------------------------------------------------------------------------
// Aggregator — derive from event log
// ---------------------------------------------------------------------------

describe('calculateConversionRateFromEvents', () => {
  it('returns 0% with both counts zero for an empty event log ("0건")', () => {
    const result = calculateConversionRateFromEvents([]);
    expect(result).toEqual({
      startedCount: 0,
      completedCount: 0,
      ratePercent: 0,
    });
  });

  it('counts checkout_started and checkout_completed events in a mixed log', () => {
    const events: PaymentEvent[] = [
      startedEvent(),
      startedEvent(),
      startedEvent(),
      startedEvent(),
      completedEvent(),
    ];
    const result = calculateConversionRateFromEvents(events);
    expect(result.startedCount).toBe(4);
    expect(result.completedCount).toBe(1);
    expect(result.ratePercent).toBe(25);
  });

  it('hits the 5.5% target on the canonical ratio (55 completions / 1000 starts)', () => {
    const events: PaymentEvent[] = [];
    for (let i = 0; i < 1000; i += 1) events.push(startedEvent());
    for (let i = 0; i < 55; i += 1) events.push(completedEvent());
    const result = calculateConversionRateFromEvents(events);
    expect(result.startedCount).toBe(1000);
    expect(result.completedCount).toBe(55);
    expect(result.ratePercent).toBe(5.5);
  });

  it('freezes the breakdown to prevent downstream mutation', () => {
    const result = calculateConversionRateFromEvents([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('ignores unknown event types in a noisy log', () => {
    const events = [
      startedEvent(),
      // stray event from another part of the system — must not be
      // counted by either branch.
      Object.freeze({
        type: 'page_view',
        sessionId: 'sess_test_1',
      }) as unknown as PaymentEvent,
      completedEvent(),
    ];
    const result = calculateConversionRateFromEvents(events);
    expect(result.startedCount).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(result.ratePercent).toBe(100);
  });

  it('propagates invariant violations from the underlying calculator', () => {
    // Completed without a matching start — corrupt log.
    const events: PaymentEvent[] = [completedEvent()];
    const err = expectThrows(() => calculateConversionRateFromEvents(events));
    expect(err.reason).toBe('completed_exceeds_started');
  });
});

// ---------------------------------------------------------------------------
// Purity guarantees
// ---------------------------------------------------------------------------

describe('calculateConversionRate — purity', () => {
  it('is deterministic for the same input', () => {
    const input: ConversionRateInput = { startedCount: 100, completedCount: 7 };
    expect(calculateConversionRate(input)).toBe(calculateConversionRate(input));
  });

  it('does not mutate the input object', () => {
    const input: ConversionRateInput = { startedCount: 100, completedCount: 7 };
    const snapshot = { ...input };
    calculateConversionRate(input);
    expect(input).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Error class shape
// ---------------------------------------------------------------------------

describe('ConversionRateError', () => {
  it('extends Error, names itself, and exposes reason + value', () => {
    const err = new ConversionRateError('negative', 'bad count', -1);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ConversionRateError');
    expect(err.reason).toBe('negative');
    expect(err.value).toBe(-1);
    expect(err.message).toContain('bad count');
  });
});
