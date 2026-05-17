/**
 * Sub-AC 1.2 — Unit tests for redemption validation.
 *
 * The validator is the gate for funnel step 10; tests cover every
 * failure path because each maps to a distinct user-facing message:
 *
 *   • malformed         → "코드를 다시 확인해 주세요"
 *   • not_found         → "유효하지 않은 코드예요"
 *   • already_redeemed  → "이미 사용된 코드예요"
 *   • expired           → "만료된 코드예요"
 *   • self_referral     → "본인 코드는 사용할 수 없어요"
 *
 * The function is pure — no mocks, no fake timers, no I/O.
 */

import { describe, expect, it } from 'vitest';

import {
  validateReferralRedemption,
  type ReferralRecord,
  type ReferralValidationRequest,
  type ReferralValidationResult,
} from '../../src/referral/validation.js';

// ---------------------------------------------------------------------------
// Fixtures — small builders to keep individual cases readable.
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000; // arbitrary epoch ms — frozen for reproducibility.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function record(overrides: Partial<ReferralRecord> = {}): ReferralRecord {
  return {
    code: 'PCKR-ABCDEF',
    issuerUserId: 'user-alice',
    issuedAtMs: NOW - ONE_DAY_MS, // 1 day ago
    ttlMs: 7 * ONE_DAY_MS,        // 7-day TTL
    redeemedByUserId: null,
    ...overrides,
  };
}

function request(overrides: Partial<ReferralValidationRequest> = {}): ReferralValidationRequest {
  return {
    inputCode: 'PCKR-ABCDEF',
    redeemerUserId: 'user-bob',
    nowMs: NOW,
    record: record(),
    ...overrides,
  };
}

function expectOk(result: ReferralValidationResult): asserts result is Extract<
  ReferralValidationResult,
  { ok: true }
> {
  if (!result.ok) {
    throw new Error(`expected ok result, got failure: ${result.reason}`);
  }
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('validateReferralRedemption — success', () => {
  it('accepts a fresh, well-formed code from a different user', () => {
    const result = validateReferralRedemption(request());
    expectOk(result);
    expect(result.normalizedCode).toBe('PCKR-ABCDEF');
    expect(result.record.issuerUserId).toBe('user-alice');
  });

  it('normalizes whitespace-padded lowercase input', () => {
    const result = validateReferralRedemption(
      request({ inputCode: '  pckr-abcdef  ' }),
    );
    expectOk(result);
    expect(result.normalizedCode).toBe('PCKR-ABCDEF');
  });

  it('result is frozen (immutable)', () => {
    const result = validateReferralRedemption(request());
    expectOk(result);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Malformed input
// ---------------------------------------------------------------------------

describe('validateReferralRedemption — malformed', () => {
  it('rejects empty string', () => {
    const result = validateReferralRedemption(request({ inputCode: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('rejects wrong prefix', () => {
    const result = validateReferralRedemption(
      request({ inputCode: 'XXXX-ABCDEF' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('rejects ambiguous characters', () => {
    const result = validateReferralRedemption(
      request({ inputCode: 'PCKR-0ABCDE' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('does NOT look up the record when input is malformed', () => {
    // Even with a valid-looking record, malformed input must fail
    // before storage is consulted.
    const result = validateReferralRedemption(
      request({ inputCode: 'garbage', record: record() }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });
});

// ---------------------------------------------------------------------------
// Lookup failure
// ---------------------------------------------------------------------------

describe('validateReferralRedemption — not_found', () => {
  it('rejects when record is null', () => {
    const result = validateReferralRedemption(request({ record: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('rejects when record.code does not match normalized input', () => {
    // Caller wired the lookup wrong: the record they handed us is
    // for a different code.  Treat as not-found rather than accept.
    const result = validateReferralRedemption(
      request({
        inputCode: 'PCKR-ABCDEF',
        record: record({ code: 'PCKR-ZZZZZZ' }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// Already redeemed
// ---------------------------------------------------------------------------

describe('validateReferralRedemption — already_redeemed', () => {
  it('rejects when code was already used by someone else', () => {
    const result = validateReferralRedemption(
      request({
        record: record({ redeemedByUserId: 'user-carol' }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_redeemed');
  });

  it('rejects when code was already used by the same redeemer (no double-redemption)', () => {
    const result = validateReferralRedemption(
      request({
        redeemerUserId: 'user-bob',
        record: record({ redeemedByUserId: 'user-bob' }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_redeemed');
  });

  it('already_redeemed wins over expiry (more specific message)', () => {
    // Both conditions hold; we want the user to see "이미 사용됨"
    // rather than "만료" because the code was never theirs to use.
    const result = validateReferralRedemption(
      request({
        record: record({
          redeemedByUserId: 'user-carol',
          issuedAtMs: NOW - 30 * ONE_DAY_MS,
          ttlMs: 7 * ONE_DAY_MS, // expired 23 days ago
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_redeemed');
  });
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

describe('validateReferralRedemption — expired', () => {
  it('rejects when now is past issuedAtMs + ttlMs', () => {
    const result = validateReferralRedemption(
      request({
        record: record({
          issuedAtMs: NOW - 10 * ONE_DAY_MS,
          ttlMs: 7 * ONE_DAY_MS,
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects at the exact expiry boundary (>= is closed-end)', () => {
    const issuedAtMs = NOW - 7 * ONE_DAY_MS;
    const result = validateReferralRedemption(
      request({
        record: record({ issuedAtMs, ttlMs: 7 * ONE_DAY_MS }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('accepts one millisecond before expiry', () => {
    const issuedAtMs = NOW - 7 * ONE_DAY_MS + 1;
    const result = validateReferralRedemption(
      request({
        record: record({ issuedAtMs, ttlMs: 7 * ONE_DAY_MS }),
      }),
    );
    expectOk(result);
  });

  it('treats ttlMs <= 0 as expired (dead on arrival)', () => {
    expect(
      validateReferralRedemption(
        request({ record: record({ ttlMs: 0 }) }),
      ).ok,
    ).toBe(false);
    expect(
      validateReferralRedemption(
        request({ record: record({ ttlMs: -1 }) }),
      ).ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Self-referral block
// ---------------------------------------------------------------------------

describe('validateReferralRedemption — self_referral', () => {
  it('rejects when the redeemer is the issuer', () => {
    const result = validateReferralRedemption(
      request({
        redeemerUserId: 'user-alice',
        record: record({ issuerUserId: 'user-alice' }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('self_referral');
  });

  it('compares by stable user id, not by case-insensitive match', () => {
    // ids are opaque strings — the validator does NOT lowercase them.
    const result = validateReferralRedemption(
      request({
        redeemerUserId: 'USER-ALICE',
        record: record({ issuerUserId: 'user-alice' }),
      }),
    );
    expectOk(result); // different ids → not self-referral
  });

  it('self_referral check runs after expiry — fresh self-code is still blocked', () => {
    // The user-facing intent is clear: even an in-window code minted
    // by yourself must not unlock your own gate.
    const result = validateReferralRedemption(
      request({
        redeemerUserId: 'user-alice',
        record: record({
          issuerUserId: 'user-alice',
          issuedAtMs: NOW - 60 * 1000, // just minted
          ttlMs: ONE_DAY_MS,
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('self_referral');
  });
});

// ---------------------------------------------------------------------------
// Precedence audit — explicit table of (record state, expected reason)
// ---------------------------------------------------------------------------

describe('validateReferralRedemption — failure precedence', () => {
  const cases: ReadonlyArray<{
    name: string;
    req: ReferralValidationRequest;
    expected: 'malformed' | 'not_found' | 'already_redeemed' | 'expired' | 'self_referral';
  }> = [
    {
      name: 'malformed beats every other check',
      req: request({
        inputCode: 'nope',
        redeemerUserId: 'user-alice',
        record: record({
          issuerUserId: 'user-alice',
          redeemedByUserId: 'user-bob',
          ttlMs: -1,
        }),
      }),
      expected: 'malformed',
    },
    {
      name: 'not_found beats redeemed/expired/self',
      req: request({
        record: null,
      }),
      expected: 'not_found',
    },
    {
      name: 'already_redeemed beats expired & self',
      req: request({
        redeemerUserId: 'user-alice',
        record: record({
          issuerUserId: 'user-alice',
          redeemedByUserId: 'user-carol',
          ttlMs: -1,
        }),
      }),
      expected: 'already_redeemed',
    },
    {
      name: 'expired beats self_referral',
      req: request({
        redeemerUserId: 'user-alice',
        record: record({
          issuerUserId: 'user-alice',
          issuedAtMs: NOW - 30 * ONE_DAY_MS,
          ttlMs: 7 * ONE_DAY_MS,
        }),
      }),
      expected: 'expired',
    },
  ];

  for (const { name, req, expected } of cases) {
    it(name, () => {
      const result = validateReferralRedemption(req);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(expected);
    });
  }
});
