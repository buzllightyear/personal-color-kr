/**
 * Sub-AC 1.3 — Referral unlock-gate handler.
 *
 * Step 10 of the Korean funnel variant (`referral_gate`) is locked
 * until the user redeems a friend's code.  Sub-AC 1.1 mints codes
 * (`./code.ts`) and Sub-AC 1.2 validates redemption attempts
 * (`./validation.ts`).  This handler *composes* those primitives into
 * the one transition the funnel cares about:
 *
 *   locked  --(valid redemption)-->  unlocked
 *
 * Responsibilities:
 *   1. Run {@link validateReferralRedemption} on the user input.
 *   2. On success, return an UPDATED record with `redeemedByUserId`
 *      set (single-use semantics — sealing the code) and a new
 *      `gateState: 'unlocked'` value the caller can persist + use
 *      to advance the funnel past Step 10.
 *   3. On failure, return the structured reason so the UI can show
 *      the appropriate Korean-language message without re-running
 *      validation.
 *
 * The handler is pure: it does NOT touch storage, time, or the
 * network.  The caller passes in the looked-up record + the current
 * timestamp, and persists the returned `updatedRecord` themselves.
 * That keeps unit tests trivial (no mocks) and lets the same
 * function run on the client (optimistic preview) and on the server
 * (authoritative seal).
 *
 * All public outputs are frozen — consistent with the rest of
 * `src/referral/`.
 */

import {
  validateReferralRedemption,
  type ReferralRecord,
  type ReferralValidationFailure,
  type ReferralValidationRequest,
} from './validation.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Funnel-facing gate state for Step 10.  The handler only ever
 * transitions `locked → unlocked`; downstream funnel logic (Step
 * 11+) reads `unlocked` to decide whether `advanceStep` is allowed.
 */
export type ReferralGateState = 'locked' | 'unlocked';

/**
 * Input for the handler.  Mirrors {@link ReferralValidationRequest}
 * but additionally carries the prior gate state so we can reject
 * redundant unlock attempts cleanly.
 *
 * `priorGateState` is informational: an already-unlocked gate is
 * treated as a no-op success (idempotent), NOT as an error.  That
 * matches the user experience — a user who taps "unlock" twice
 * should not see a failure toast.
 */
export interface ProcessReferralRedemptionRequest
  extends ReferralValidationRequest {
  /**
   * Current state of the user's `referral_gate`.  Defaults to
   * `'locked'` when omitted.
   */
  readonly priorGateState?: ReferralGateState;
}

/** Failure modes — same set as validation, surfaced verbatim. */
export type ReferralUnlockFailure = ReferralValidationFailure;

export type ReferralUnlockResult =
  | {
      readonly ok: true;
      /** Always `'unlocked'` on success. */
      readonly gateState: 'unlocked';
      /** Canonical form the caller should persist for downstream lookups. */
      readonly normalizedCode: string;
      /**
       * Updated record with `redeemedByUserId` set.  Caller must
       * persist this atomically with the gate-state change to
       * preserve single-use semantics.  When the gate was already
       * unlocked (idempotent path), this is `null` — there is
       * nothing new to write.
       */
      readonly updatedRecord: ReferralRecord | null;
      /**
       * `true` when this call actually transitioned the gate;
       * `false` when the gate was already unlocked.  Lets the
       * caller skip persistence + analytics on the no-op path.
       */
      readonly transitioned: boolean;
    }
  | {
      readonly ok: false;
      /** Gate stays locked on failure — exposed for symmetry. */
      readonly gateState: 'locked';
      readonly reason: ReferralUnlockFailure;
    };

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function fail(reason: ReferralUnlockFailure): ReferralUnlockResult {
  return Object.freeze({
    ok: false,
    gateState: 'locked',
    reason,
  }) as ReferralUnlockResult;
}

/**
 * Process a redemption attempt for the referral gate.
 *
 * Behaviour:
 *   - If `priorGateState === 'unlocked'`, returns a frozen idempotent
 *     success WITHOUT re-running validation.  The caller has already
 *     unlocked; there is nothing to do.
 *   - Otherwise, delegates to {@link validateReferralRedemption} and,
 *     on success, returns the updated record + `gateState: 'unlocked'`.
 *
 * The function never mutates the passed-in record.  It builds a new
 * frozen object instead — consistent with the project's immutability
 * rule.
 */
export function processReferralRedemption(
  request: ProcessReferralRedemptionRequest,
): ReferralUnlockResult {
  const priorGateState: ReferralGateState =
    request.priorGateState ?? 'locked';

  // Idempotent fast-path: gate already open, nothing to do.
  // We intentionally do NOT validate input in this branch — the user
  // could be re-submitting stale form data after an earlier success,
  // and the UI should not penalise them for it.
  if (priorGateState === 'unlocked') {
    return Object.freeze({
      ok: true,
      gateState: 'unlocked',
      normalizedCode: '',
      updatedRecord: null,
      transitioned: false,
    }) as ReferralUnlockResult;
  }

  const validation = validateReferralRedemption(request);
  if (!validation.ok) {
    return fail(validation.reason);
  }

  // Seal the record — single-use semantics.  Build a NEW frozen
  // record rather than mutating; the caller persists this.
  const updatedRecord: ReferralRecord = Object.freeze({
    code: validation.record.code,
    issuerUserId: validation.record.issuerUserId,
    issuedAtMs: validation.record.issuedAtMs,
    ttlMs: validation.record.ttlMs,
    redeemedByUserId: request.redeemerUserId,
  });

  return Object.freeze({
    ok: true,
    gateState: 'unlocked',
    normalizedCode: validation.normalizedCode,
    updatedRecord,
    transitioned: true,
  }) as ReferralUnlockResult;
}
