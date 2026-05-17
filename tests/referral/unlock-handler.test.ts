/**
 * Sub-AC 1.3 — Unit tests for the referral unlock-gate handler.
 *
 * The handler composes {@link validateReferralRedemption} with the
 * single `locked → unlocked` transition.  Tests cover:
 *
 *   • happy path: gate flips to `unlocked`, record is sealed with
 *     the redeemer id, output is frozen and the caller-supplied
 *     record is untouched (immutability).
 *   • idempotency: re-submitting on an already-`unlocked` gate is a
 *     no-op success without re-running validation.
 *   • every failure path from validation is surfaced verbatim, with
 *     `gateState: 'locked'`.
 */

import { describe, expect, it } from 'vitest';

import {
  processReferralRedemption,
  type ProcessReferralRedemptionRequest,
  type ReferralUnlockResult,
} from '../../src/referral/unlock-handler.js';
import type { ReferralRecord } from '../../src/referral/validation.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function record(overrides: Partial<ReferralRecord> = {}): ReferralRecord {
  return {
    code: 'PCKR-ABCDEF',
    issuerUserId: 'user-alice',
    issuedAtMs: NOW - ONE_DAY_MS,
    ttlMs: 7 * ONE_DAY_MS,
    redeemedByUserId: null,
    ...overrides,
  };
}

function request(
  overrides: Partial<ProcessReferralRedemptionRequest> = {},
): ProcessReferralRedemptionRequest {
  return {
    inputCode: 'PCKR-ABCDEF',
    redeemerUserId: 'user-bob',
    nowMs: NOW,
    record: record(),
    ...overrides,
  };
}

function expectOk(
  result: ReferralUnlockResult,
): asserts result is Extract<ReferralUnlockResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected ok result, got failure: ${result.reason}`);
  }
}

function expectFail(
  result: ReferralUnlockResult,
): asserts result is Extract<ReferralUnlockResult, { ok: false }> {
  if (result.ok) {
    throw new Error('expected failure result, got success');
  }
}

// ---------------------------------------------------------------------------
// Happy path — locked → unlocked
// ---------------------------------------------------------------------------

describe('processReferralRedemption — locked → unlocked', () => {
  it('flips the gate to unlocked on a valid redemption', () => {
    const result = processReferralRedemption(request());
    expectOk(result);
    expect(result.gateState).toBe('unlocked');
    expect(result.transitioned).toBe(true);
    expect(result.normalizedCode).toBe('PCKR-ABCDEF');
  });

  it('returns a sealed record with redeemedByUserId set', () => {
    const result = processReferralRedemption(
      request({ redeemerUserId: 'user-bob' }),
    );
    expectOk(result);
    expect(result.updatedRecord).not.toBeNull();
    expect(result.updatedRecord?.redeemedByUserId).toBe('user-bob');
    expect(result.updatedRecord?.code).toBe('PCKR-ABCDEF');
    expect(result.updatedRecord?.issuerUserId).toBe('user-alice');
  });

  it('does NOT mutate the caller-supplied record (immutability)', () => {
    const original = record();
    const before = { ...original };
    processReferralRedemption(request({ record: original }));
    expect(original).toEqual(before);
    expect(original.redeemedByUserId).toBeNull();
  });

  it('updatedRecord is frozen', () => {
    const result = processReferralRedemption(request());
    expectOk(result);
    expect(Object.isFrozen(result.updatedRecord)).toBe(true);
  });

  it('result envelope is frozen', () => {
    const result = processReferralRedemption(request());
    expectOk(result);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('preserves issuedAtMs and ttlMs on the sealed record', () => {
    const issuedAtMs = NOW - 2 * ONE_DAY_MS;
    const ttlMs = 5 * ONE_DAY_MS;
    const result = processReferralRedemption(
      request({ record: record({ issuedAtMs, ttlMs }) }),
    );
    expectOk(result);
    expect(result.updatedRecord?.issuedAtMs).toBe(issuedAtMs);
    expect(result.updatedRecord?.ttlMs).toBe(ttlMs);
  });

  it('normalizes whitespace-padded lowercase input', () => {
    const result = processReferralRedemption(
      request({ inputCode: '  pckr-abcdef  ' }),
    );
    expectOk(result);
    expect(result.normalizedCode).toBe('PCKR-ABCDEF');
  });
});

// ---------------------------------------------------------------------------
// Idempotency — already unlocked
// ---------------------------------------------------------------------------

describe('processReferralRedemption — idempotent re-submission', () => {
  it('returns success without transitioning when gate is already unlocked', () => {
    const result = processReferralRedemption(
      request({ priorGateState: 'unlocked' }),
    );
    expectOk(result);
    expect(result.gateState).toBe('unlocked');
    expect(result.transitioned).toBe(false);
    expect(result.updatedRecord).toBeNull();
  });

  it('idempotent path skips validation — bad input is NOT surfaced', () => {
    // A stale form re-submission with garbage should not surface
    // a "malformed" error to a user who already passed the gate.
    const result = processReferralRedemption(
      request({
        priorGateState: 'unlocked',
        inputCode: 'garbage',
        record: null,
      }),
    );
    expectOk(result);
    expect(result.gateState).toBe('unlocked');
    expect(result.transitioned).toBe(false);
  });

  it('default priorGateState is locked (requires validation)', () => {
    // Omitting priorGateState must NOT take the idempotent fast-path.
    const result = processReferralRedemption(request({ record: null }));
    expectFail(result);
    expect(result.reason).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// Failure surfacing — all five validation reasons must propagate
// ---------------------------------------------------------------------------

describe('processReferralRedemption — failure surfacing', () => {
  it('malformed input → gateState locked, reason malformed', () => {
    const result = processReferralRedemption(request({ inputCode: 'nope' }));
    expectFail(result);
    expect(result.gateState).toBe('locked');
    expect(result.reason).toBe('malformed');
  });

  it('record null → not_found', () => {
    const result = processReferralRedemption(request({ record: null }));
    expectFail(result);
    expect(result.reason).toBe('not_found');
  });

  it('already redeemed → already_redeemed', () => {
    const result = processReferralRedemption(
      request({ record: record({ redeemedByUserId: 'user-carol' }) }),
    );
    expectFail(result);
    expect(result.reason).toBe('already_redeemed');
  });

  it('past TTL → expired', () => {
    const result = processReferralRedemption(
      request({
        record: record({
          issuedAtMs: NOW - 30 * ONE_DAY_MS,
          ttlMs: 7 * ONE_DAY_MS,
        }),
      }),
    );
    expectFail(result);
    expect(result.reason).toBe('expired');
  });

  it('self-redemption → self_referral', () => {
    const result = processReferralRedemption(
      request({
        redeemerUserId: 'user-alice',
        record: record({ issuerUserId: 'user-alice' }),
      }),
    );
    expectFail(result);
    expect(result.reason).toBe('self_referral');
  });

  it('failure envelope is frozen', () => {
    const result = processReferralRedemption(request({ record: null }));
    expectFail(result);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
