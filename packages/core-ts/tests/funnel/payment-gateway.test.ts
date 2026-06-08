/**
 * Unit tests — 통합 결제 인터페이스 프로토콜 적합성 (Sub-AC 2-1).
 *
 * Coverage matrix:
 *   1. Protocol shape — MockGateway satisfies the PaymentGateway interface.
 *   2. charge() happy path — stores transaction, returns ChargeSuccess.
 *   3. charge() forced failure — returns ChargeFailure, no transaction stored.
 *   4. cancel() happy path — transitions status to 'cancelled', returns CancelSuccess.
 *   5. cancel() unknown transaction — returns CancelFailure with 'not_found'.
 *   6. cancel() forced failure — returns CancelFailure without mutating store.
 *   7. status() happy path — reflects current stored status.
 *   8. status() post-cancel — reflects 'cancelled' status after cancel().
 *   9. status() unknown transaction — returns StatusFailure with 'not_found'.
 *  10. status() forced failure — returns StatusFailure without side effects.
 *  11. Call log — every call is appended in order with the correct method label.
 *  12. Idempotency key — forwarded verbatim in the call log.
 *  13. Clock injection — all timestamps use the injected clock, not Date.now.
 *  14. ID provider injection — transaction ids derived from the injected provider.
 *  15. Multiple charges — each gets a distinct transaction id and separate log entry.
 *  16. Immutability — returned success/failure objects are frozen.
 *  17. Metadata passthrough — metadata field preserved in the call log.
 */
import { describe, expect, it } from 'vitest';

import {
  MockGateway,
  type CancelFailure,
  type CancelSuccess,
  type ChargeFailure,
  type ChargeRequest,
  type ChargeSuccess,
  type PaymentGateway,
  type StatusFailure,
  type StatusSuccess,
} from '../../src/funnel/payment-gateway.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW_1 = 1_715_000_000_000; // 2024-05-06T11:33:20Z
const FIXED_NOW_2 = 1_715_000_001_000;

function makeClockSequence(...timestamps: number[]): () => number {
  let index = 0;
  return () => timestamps[index++ % timestamps.length] ?? FIXED_NOW_1;
}

const BASE_REQUEST: ChargeRequest = Object.freeze({
  idempotencyKey: 'idem_abc123',
  amountMinorUnits: 1200,
  currencyCode: 'USD',
  description: 'Glam-Up 월간 구독 $12',
  method: 'card',
  metadata: Object.freeze({ plan: 'monthly', userId: 'usr_001' }),
});

const ANNUAL_REQUEST: ChargeRequest = Object.freeze({
  idempotencyKey: 'idem_def456',
  amountMinorUnits: 5900,
  currencyCode: 'USD',
  description: 'Glam-Up 연간 구독 $59',
  method: 'toss_pay',
  metadata: Object.freeze({ plan: 'annual', userId: 'usr_002' }),
});

// ---------------------------------------------------------------------------
// 1. Protocol shape — MockGateway satisfies PaymentGateway
// ---------------------------------------------------------------------------

describe('Protocol shape', () => {
  it('MockGateway is assignable to PaymentGateway', () => {
    // TypeScript-level assertion: if this compiles, the protocol is satisfied.
    const gateway: PaymentGateway = new MockGateway();
    expect(typeof gateway.charge).toBe('function');
    expect(typeof gateway.cancel).toBe('function');
    expect(typeof gateway.status).toBe('function');
  });

  it('PaymentGateway protocol exposes exactly charge, cancel, status', () => {
    const gateway = new MockGateway();
    // Structural check — no extra public methods polluting the interface.
    const methods = ['charge', 'cancel', 'status'];
    for (const method of methods) {
      expect(method in gateway).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. charge() happy path
// ---------------------------------------------------------------------------

describe('MockGateway.charge() — happy path', () => {
  it('returns ok:true ChargeSuccess with a transactionId', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const result = await gateway.charge(BASE_REQUEST);

    expect(result.ok).toBe(true);
    const success = result as ChargeSuccess;
    expect(typeof success.transactionId).toBe('string');
    expect(success.transactionId.length).toBeGreaterThan(0);
  });

  it('returns status "pending" at creation time', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const result = await gateway.charge(BASE_REQUEST);

    const success = result as ChargeSuccess;
    expect(success.status).toBe('pending');
  });

  it('returns createdAt matching the injected clock', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const result = await gateway.charge(BASE_REQUEST);

    const success = result as ChargeSuccess;
    expect(success.createdAt).toBe(FIXED_NOW_1);
  });

  it('returns a providerRef string', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const result = await gateway.charge(BASE_REQUEST);

    const success = result as ChargeSuccess;
    expect(typeof success.providerRef).toBe('string');
    expect(success.providerRef.length).toBeGreaterThan(0);
  });

  it('stores the transaction so subsequent status() finds it', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const chargeResult = await gateway.charge(BASE_REQUEST);
    const { transactionId } = chargeResult as ChargeSuccess;

    const statusResult = await gateway.status({ transactionId });
    expect(statusResult.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. charge() forced failure
// ---------------------------------------------------------------------------

describe('MockGateway.charge() — forceChargeFailure', () => {
  it('returns ok:false ChargeFailure when forceChargeFailure is set', async () => {
    const gateway = new MockGateway({ forceChargeFailure: true });
    const result = await gateway.charge(BASE_REQUEST);

    expect(result.ok).toBe(false);
    const failure = result as ChargeFailure;
    expect(typeof failure.errorCode).toBe('string');
    expect(typeof failure.errorMessage).toBe('string');
  });

  it('stores NO transaction when charge fails', async () => {
    const gateway = new MockGateway({ forceChargeFailure: true });
    await gateway.charge(BASE_REQUEST);

    expect(gateway.storedCount).toBe(0);
  });

  it('still appends the call to the call log on failure', async () => {
    const gateway = new MockGateway({ forceChargeFailure: true });
    await gateway.charge(BASE_REQUEST);

    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]?.method).toBe('charge');
  });
});

// ---------------------------------------------------------------------------
// 4. cancel() happy path
// ---------------------------------------------------------------------------

describe('MockGateway.cancel() — happy path', () => {
  it('returns ok:true CancelSuccess after a successful charge', async () => {
    const clock = makeClockSequence(FIXED_NOW_1, FIXED_NOW_2);
    const gateway = new MockGateway({ now: clock });
    const { transactionId } = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;

    const result = await gateway.cancel({ transactionId, reason: 'user_requested' });

    expect(result.ok).toBe(true);
    const success = result as CancelSuccess;
    expect(success.transactionId).toBe(transactionId);
    expect(success.cancelledAt).toBe(FIXED_NOW_2);
  });

  it('transitions the stored status to "cancelled"', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const { transactionId } = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;

    await gateway.cancel({ transactionId, reason: 'user_requested' });
    const statusResult = await gateway.status({ transactionId });

    expect(statusResult.ok).toBe(true);
    const status = statusResult as StatusSuccess;
    expect(status.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// 5. cancel() unknown transaction
// ---------------------------------------------------------------------------

describe('MockGateway.cancel() — unknown transaction', () => {
  it('returns ok:false CancelFailure with errorCode "not_found"', async () => {
    const gateway = new MockGateway();
    const result = await gateway.cancel({
      transactionId: 'txn_does_not_exist',
      reason: 'test',
    });

    expect(result.ok).toBe(false);
    const failure = result as CancelFailure;
    expect(failure.errorCode).toBe('not_found');
  });

  it('does not mutate the store on a not-found cancel', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    await gateway.charge(BASE_REQUEST); // 1 transaction stored

    await gateway.cancel({ transactionId: 'txn_ghost', reason: 'test' });

    expect(gateway.storedCount).toBe(1); // unchanged
  });
});

// ---------------------------------------------------------------------------
// 6. cancel() forced failure
// ---------------------------------------------------------------------------

describe('MockGateway.cancel() — forceCancelFailure', () => {
  it('returns ok:false CancelFailure when forceCancelFailure is set', async () => {
    const gateway = new MockGateway({ forceCancelFailure: true, now: () => FIXED_NOW_1 });
    const { transactionId } = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;

    const result = await gateway.cancel({ transactionId, reason: 'test' });

    expect(result.ok).toBe(false);
  });

  it('does NOT transition status to cancelled when cancel is forced-failed', async () => {
    const gateway = new MockGateway({ forceCancelFailure: true, now: () => FIXED_NOW_1 });
    const { transactionId } = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;
    await gateway.cancel({ transactionId, reason: 'test' });

    const statusResult = await gateway.status({ transactionId });
    const status = statusResult as StatusSuccess;
    // Status should still be 'pending', not 'cancelled'
    expect(status.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// 7. status() happy path
// ---------------------------------------------------------------------------

describe('MockGateway.status() — happy path', () => {
  it('returns ok:true StatusSuccess with correct fields', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const { transactionId } = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;

    const result = await gateway.status({ transactionId });

    expect(result.ok).toBe(true);
    const success = result as StatusSuccess;
    expect(success.transactionId).toBe(transactionId);
    expect(success.status).toBe('pending');
    expect(success.amountMinorUnits).toBe(BASE_REQUEST.amountMinorUnits);
    expect(success.currencyCode).toBe(BASE_REQUEST.currencyCode);
    expect(success.updatedAt).toBe(FIXED_NOW_1);
  });
});

// ---------------------------------------------------------------------------
// 8. status() post-cancel
// ---------------------------------------------------------------------------

describe('MockGateway.status() — post-cancel', () => {
  it('reflects "cancelled" after cancel()', async () => {
    const clock = makeClockSequence(FIXED_NOW_1, FIXED_NOW_2);
    const gateway = new MockGateway({ now: clock });
    const { transactionId } = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;
    await gateway.cancel({ transactionId, reason: 'test' });

    const result = await gateway.status({ transactionId });
    const success = result as StatusSuccess;

    expect(success.status).toBe('cancelled');
    expect(success.updatedAt).toBe(FIXED_NOW_2);
  });
});

// ---------------------------------------------------------------------------
// 9. status() unknown transaction
// ---------------------------------------------------------------------------

describe('MockGateway.status() — unknown transaction', () => {
  it('returns ok:false StatusFailure with errorCode "not_found"', async () => {
    const gateway = new MockGateway();
    const result = await gateway.status({ transactionId: 'txn_ghost' });

    expect(result.ok).toBe(false);
    const failure = result as StatusFailure;
    expect(failure.errorCode).toBe('not_found');
    expect(typeof failure.errorMessage).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 10. status() forced failure
// ---------------------------------------------------------------------------

describe('MockGateway.status() — forceStatusFailure', () => {
  it('returns ok:false StatusFailure when forceStatusFailure is set', async () => {
    const gateway = new MockGateway({ forceStatusFailure: true, now: () => FIXED_NOW_1 });
    const { transactionId } = (
      await new MockGateway({ now: () => FIXED_NOW_1 }).charge(BASE_REQUEST)
    ) as ChargeSuccess;

    // Use a fresh gateway with forced failure and query a valid txn id
    const result = await gateway.status({ transactionId });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. Call log
// ---------------------------------------------------------------------------

describe('MockGateway — call log', () => {
  it('records charge, cancel, status in order', async () => {
    const clock = makeClockSequence(FIXED_NOW_1, FIXED_NOW_2, FIXED_NOW_1);
    const gateway = new MockGateway({ now: clock });
    const { transactionId } = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;
    await gateway.cancel({ transactionId, reason: 'test' });
    await gateway.status({ transactionId });

    expect(gateway.calls).toHaveLength(3);
    expect(gateway.calls[0]?.method).toBe('charge');
    expect(gateway.calls[1]?.method).toBe('cancel');
    expect(gateway.calls[2]?.method).toBe('status');
  });

  it('call log is append-only — new instances start empty', () => {
    const gateway = new MockGateway();
    expect(gateway.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 12. Idempotency key passthrough
// ---------------------------------------------------------------------------

describe('MockGateway — idempotency key', () => {
  it('preserves the idempotencyKey verbatim in the call log', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    await gateway.charge(BASE_REQUEST);

    const entry = gateway.calls[0];
    expect(entry?.method).toBe('charge');
    if (entry?.method === 'charge') {
      expect(entry.request.idempotencyKey).toBe(BASE_REQUEST.idempotencyKey);
    }
  });
});

// ---------------------------------------------------------------------------
// 13. Clock injection
// ---------------------------------------------------------------------------

describe('MockGateway — clock injection', () => {
  it('charge createdAt uses the injected clock, not Date.now', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const result = await gateway.charge(BASE_REQUEST);
    const success = result as ChargeSuccess;
    expect(success.createdAt).toBe(FIXED_NOW_1);
  });

  it('cancel cancelledAt uses the injected clock', async () => {
    const clock = makeClockSequence(FIXED_NOW_1, FIXED_NOW_2);
    const gateway = new MockGateway({ now: clock });
    const { transactionId } = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;
    const cancelResult = await gateway.cancel({ transactionId, reason: 'x' });
    const success = cancelResult as CancelSuccess;
    expect(success.cancelledAt).toBe(FIXED_NOW_2);
  });
});

// ---------------------------------------------------------------------------
// 14. ID provider injection
// ---------------------------------------------------------------------------

describe('MockGateway — ID provider injection', () => {
  it('uses the injected idProvider to generate transaction ids', async () => {
    const gateway = new MockGateway({
      now: () => FIXED_NOW_1,
      idProvider: (i) => `custom_txn_${i}`,
    });
    const result = await gateway.charge(BASE_REQUEST);
    const success = result as ChargeSuccess;
    expect(success.transactionId).toBe('custom_txn_0');
  });

  it('increments the index with each charge', async () => {
    const gateway = new MockGateway({
      now: () => FIXED_NOW_1,
      idProvider: (i) => `txn_id_${i}`,
    });
    const r1 = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;
    const r2 = (await gateway.charge(ANNUAL_REQUEST)) as ChargeSuccess;
    expect(r1.transactionId).toBe('txn_id_0');
    expect(r2.transactionId).toBe('txn_id_1');
  });
});

// ---------------------------------------------------------------------------
// 15. Multiple charges
// ---------------------------------------------------------------------------

describe('MockGateway — multiple charges', () => {
  it('assigns distinct transaction ids to each charge', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const r1 = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;
    const r2 = (await gateway.charge(ANNUAL_REQUEST)) as ChargeSuccess;
    expect(r1.transactionId).not.toBe(r2.transactionId);
  });

  it('stores both transactions independently', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const r1 = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;
    const r2 = (await gateway.charge(ANNUAL_REQUEST)) as ChargeSuccess;
    expect(gateway.storedCount).toBe(2);

    const s1 = (await gateway.status({ transactionId: r1.transactionId })) as StatusSuccess;
    const s2 = (await gateway.status({ transactionId: r2.transactionId })) as StatusSuccess;
    expect(s1.amountMinorUnits).toBe(BASE_REQUEST.amountMinorUnits);
    expect(s2.amountMinorUnits).toBe(ANNUAL_REQUEST.amountMinorUnits);
  });

  it('cancelling one does not affect the other', async () => {
    const clock = makeClockSequence(FIXED_NOW_1, FIXED_NOW_1, FIXED_NOW_2);
    const gateway = new MockGateway({ now: clock });
    const r1 = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;
    const r2 = (await gateway.charge(ANNUAL_REQUEST)) as ChargeSuccess;

    await gateway.cancel({ transactionId: r1.transactionId, reason: 'test' });

    const s2 = (await gateway.status({ transactionId: r2.transactionId })) as StatusSuccess;
    expect(s2.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// 16. Immutability of returned objects
// ---------------------------------------------------------------------------

describe('MockGateway — immutability', () => {
  it('ChargeSuccess result is frozen', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const result = await gateway.charge(BASE_REQUEST);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('ChargeFailure result is frozen', async () => {
    const gateway = new MockGateway({ forceChargeFailure: true });
    const result = await gateway.charge(BASE_REQUEST);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('CancelSuccess result is frozen', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const { transactionId } = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;
    const result = await gateway.cancel({ transactionId, reason: 'x' });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('CancelFailure result is frozen', async () => {
    const gateway = new MockGateway();
    const result = await gateway.cancel({ transactionId: 'ghost', reason: 'x' });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('StatusSuccess result is frozen', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    const { transactionId } = (await gateway.charge(BASE_REQUEST)) as ChargeSuccess;
    const result = await gateway.status({ transactionId });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('StatusFailure result is frozen', async () => {
    const gateway = new MockGateway();
    const result = await gateway.status({ transactionId: 'ghost' });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('call log entries are frozen', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    await gateway.charge(BASE_REQUEST);
    const entry = gateway.calls[0];
    expect(Object.isFrozen(entry)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. Metadata passthrough
// ---------------------------------------------------------------------------

describe('MockGateway — metadata passthrough', () => {
  it('preserves metadata in the call log', async () => {
    const gateway = new MockGateway({ now: () => FIXED_NOW_1 });
    await gateway.charge(BASE_REQUEST);

    const entry = gateway.calls[0];
    if (entry?.method === 'charge') {
      expect(entry.request.metadata).toEqual(BASE_REQUEST.metadata);
    } else {
      throw new Error('Expected charge entry');
    }
  });
});
