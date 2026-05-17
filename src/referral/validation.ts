/**
 * Sub-AC 1.2 — Referral redemption validation.
 *
 * Step 10 of the Korean funnel variant — `referral_gate` — requires
 * a friend's referral code before the user can unlock the next step.
 * The minting side (Sub-AC 1.1, `./code.ts`) only worries about
 * *generating* well-formed unique codes.  This module covers the
 * complementary concern: *redemption-time* validation of user input.
 *
 * Three concerns, per the AC:
 *
 *   1. **Validity** — the supplied string must canonicalize to a
 *      structurally-valid `PCKR-XXXXXX` code AND there must exist a
 *      matching record in the registry (provided by the caller —
 *      this module does not own storage).
 *   2. **Expiry** — every code has a TTL counted from `issuedAt`.
 *      Codes past `issuedAt + ttlMs` are rejected.  A code that has
 *      already been redeemed by someone else is also rejected
 *      (single-use semantics).
 *   3. **Self-referral block** — the redeemer cannot be the issuer.
 *      This is the core anti-gaming guard; without it a user could
 *      trivially unlock their own gate.
 *
 * The function is pure: callers supply the looked-up record and the
 * current timestamp, the function returns a discriminated-union
 * result.  Tests can drive every branch without mocks.
 *
 * Conventions:
 *   - All timestamps are milliseconds since the Unix epoch.
 *   - Comparisons normalize the input via {@link normalizeReferralCode}
 *     so the caller can hand us raw form-field input.
 */

import {
  isValidReferralCode,
  normalizeReferralCode,
} from './code.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Persisted referral record.  The owning system stores one per minted
 * code.  This module only *reads* records — it does not mutate them.
 */
export interface ReferralRecord {
  /** Canonical `PCKR-XXXXXX` form. */
  readonly code: string;
  /** Stable user id of the person who minted the code. */
  readonly issuerUserId: string;
  /** Issue time in epoch milliseconds. */
  readonly issuedAtMs: number;
  /** Lifetime in milliseconds from {@link issuedAtMs}. */
  readonly ttlMs: number;
  /**
   * The redeemer's user id, or `null` if the code has not been used.
   * Single-use: once set, the code is dead.
   */
  readonly redeemedByUserId: string | null;
}

/** Failure modes surfaced to the caller. */
export type ReferralValidationFailure =
  | 'malformed'
  | 'not_found'
  | 'expired'
  | 'already_redeemed'
  | 'self_referral';

export interface ReferralValidationRequest {
  /** Raw user input (e.g. typed into a form field).  May be untrimmed. */
  readonly inputCode: string;
  /** User attempting to redeem the code. */
  readonly redeemerUserId: string;
  /** Current time in epoch milliseconds (caller injects for determinism). */
  readonly nowMs: number;
  /**
   * Result of looking up the *normalized* code in storage.  Pass
   * `null` when no record matches — this distinguishes "malformed"
   * (we never even tried lookup) from "not found".
   */
  readonly record: ReferralRecord | null;
}

export type ReferralValidationResult =
  | {
      readonly ok: true;
      /** Canonical form the caller should use for downstream lookups. */
      readonly normalizedCode: string;
      readonly record: ReferralRecord;
    }
  | {
      readonly ok: false;
      readonly reason: ReferralValidationFailure;
    };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function fail(reason: ReferralValidationFailure): ReferralValidationResult {
  return Object.freeze({ ok: false, reason }) as ReferralValidationResult;
}

/**
 * Validate a redemption attempt.  Order of checks matters because
 * each step depends on the prior — we cannot evaluate expiry without
 * a record, nor self-referral without a known issuer.
 *
 * Returns a discriminated union so call-sites can pattern-match
 * exhaustively (TypeScript will complain if a new failure mode is
 * added but a handler is forgotten).
 */
export function validateReferralRedemption(
  request: ReferralValidationRequest,
): ReferralValidationResult {
  const normalized = normalizeReferralCode(request.inputCode);

  // 1. Structural validity — fast path that does not touch storage.
  if (!isValidReferralCode(normalized)) {
    return fail('malformed');
  }

  // 2. Registry presence — `record` is the result of a lookup the
  //    caller performed using `normalized`.  Null means no match.
  const { record } = request;
  if (record === null) {
    return fail('not_found');
  }

  // Sanity: the supplied record must actually correspond to the
  // normalized input.  If the caller wired up the lookup wrong, we
  // treat it as not-found rather than silently accepting it.
  if (record.code !== normalized) {
    return fail('not_found');
  }

  // 3. Already-redeemed — single-use semantics, checked before expiry
  //    so a stale already-used code reports the more specific reason.
  if (record.redeemedByUserId !== null) {
    return fail('already_redeemed');
  }

  // 4. Expiry — strictly less than expiry boundary is still valid.
  //    A non-positive `ttlMs` means the code was effectively dead
  //    on arrival; treat as expired.
  if (record.ttlMs <= 0) {
    return fail('expired');
  }
  const expiresAtMs = record.issuedAtMs + record.ttlMs;
  if (request.nowMs >= expiresAtMs) {
    return fail('expired');
  }

  // 5. Self-referral block — the redeemer cannot be the issuer.
  //    Compared by stable user id, not by display name.
  if (record.issuerUserId === request.redeemerUserId) {
    return fail('self_referral');
  }

  return Object.freeze({
    ok: true,
    normalizedCode: normalized,
    record,
  }) as ReferralValidationResult;
}
