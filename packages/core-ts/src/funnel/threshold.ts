/**
 * Sub-AC 1.3 — 5.5%+ 임계값 판정 (conversion-rate threshold judgment).
 *
 * The Seed pins the Phase-0 north-star metric to:
 *
 *     결제 전환율 ≥ 5.5%   ("PASS" / 목표 달성)
 *
 * but the exit condition also allows the team to RECONSIDER the target
 * for the Korean market when the funnel underperforms slightly.  We
 * model that with a three-band classifier:
 *
 *     status                gap                semantic
 *     ─────────────────────────────────────────────────────────────────
 *     PASS                  rate ≥ target      ship / scale spend.
 *     NEEDS_ADJUSTMENT      lowerBound ≤ rate  flag for re-targeting
 *                            < target          per the Seed exit
 *                                              condition.
 *     FAIL                  rate < lowerBound  funnel materially
 *                                              under-performed —
 *                                              reassess strategy.
 *
 * Defaults — pinned by the Seed and the canonical Phase-0 plan:
 *
 *     DEFAULT_NORTH_STAR_TARGET_PERCENT             = 5.5
 *     DEFAULT_NEEDS_ADJUSTMENT_LOWER_BOUND_PERCENT  = 4.0
 *
 * Why a pure function?  Every consumer — production dashboards,
 * automated alerts, evaluation scripts, integration tests — must
 * classify a rate identically so the 5.5% target is comparable
 * end-to-end.  No singletons, no globals, no I/O.  Same input always
 * yields the same frozen judgment object.
 *
 * This module sits one layer above {@link calculateConversionRate}: the
 * calculator turns event counts into a percentage; this module turns
 * the percentage into a verdict.  Composed together they form the
 * `events → rate → judgment` pipeline the orchestrator relies on.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default north-star target (in percent points, NOT a 0–1 fraction).
 *
 * Per the Seed:
 *
 *   exit_conditions:
 *     - 결제 전환율 5.5%+ 또는 한국 시장 조정 target 결정·도달
 *
 * Any future change must be deliberate; the unit tests pin the value
 * so it cannot drift silently.
 */
export const DEFAULT_NORTH_STAR_TARGET_PERCENT = 5.5;

/**
 * Default lower bound of the NEEDS_ADJUSTMENT band (in percent points).
 *
 * Below this value the funnel is considered to have failed outright
 * rather than merely needing a target adjustment.  The 4.0% threshold
 * is the Phase-0 "yellow-card" boundary chosen to give the team room
 * to re-evaluate the Korean-market target without masking serious
 * regression.
 */
export const DEFAULT_NEEDS_ADJUSTMENT_LOWER_BOUND_PERCENT = 4.0;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Three-band judgment status. */
export type ThresholdStatus = 'PASS' | 'NEEDS_ADJUSTMENT' | 'FAIL';

/**
 * Tunable thresholds.  Both fields default to the canonical Phase-0
 * values exposed as `DEFAULT_*` constants.  Override either when the
 * team adopts a Korean-market adjusted target (per the Seed exit
 * condition).
 */
export interface ThresholdOptions {
  /** Target percentage in [0, 100].  `rate >= target` ⇒ PASS. */
  readonly targetPercent?: number;
  /**
   * Lower bound of the NEEDS_ADJUSTMENT band in [0, 100].  Must be
   * `<= targetPercent`.  `rate < lowerBound` ⇒ FAIL.
   *
   * When `lowerBound === target` the classifier degenerates to a
   * binary PASS / FAIL.
   */
  readonly needsAdjustmentLowerBoundPercent?: number;
}

/**
 * Result of {@link evaluateConversionRateThreshold}.  Frozen — defence
 * in depth against accidental mutation by downstream consumers.
 */
export interface ThresholdJudgment {
  readonly status: ThresholdStatus;
  /** The input rate, echoed for traceability in logs / dashboards. */
  readonly ratePercent: number;
  /** Effective target used for the decision. */
  readonly targetPercent: number;
  /** Effective NEEDS_ADJUSTMENT lower bound used for the decision. */
  readonly needsAdjustmentLowerBoundPercent: number;
  /**
   * Signed gap from the target: `ratePercent - targetPercent`.
   * Positive when above target, negative when below.
   */
  readonly gapPercent: number;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Reject reasons.  Structured so callers branch on `err.reason`
 * instead of pattern-matching on `err.message`.
 */
export type ThresholdJudgmentErrorReason =
  | 'not_a_number'
  | 'not_finite'
  | 'out_of_range'
  | 'invalid_thresholds';

export class ThresholdJudgmentError extends Error {
  public override readonly name = 'ThresholdJudgmentError';
  public readonly reason: ThresholdJudgmentErrorReason;
  public readonly value: unknown;

  constructor(reason: ThresholdJudgmentErrorReason, message: string, value: unknown) {
    super(message);
    this.reason = reason;
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateRate(rate: unknown): asserts rate is number {
  if (typeof rate !== 'number') {
    throw new ThresholdJudgmentError(
      'not_a_number',
      `rate must be a number, got ${typeof rate}`,
      rate,
    );
  }
  if (Number.isNaN(rate) || !Number.isFinite(rate)) {
    throw new ThresholdJudgmentError(
      'not_finite',
      `rate must be a finite number (got ${rate})`,
      rate,
    );
  }
  if (rate < 0 || rate > 100) {
    throw new ThresholdJudgmentError(
      'out_of_range',
      `rate must lie in [0, 100] (got ${rate})`,
      rate,
    );
  }
}

function validateThresholdValue(
  field: 'targetPercent' | 'needsAdjustmentLowerBoundPercent',
  value: number,
): void {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new ThresholdJudgmentError(
      'invalid_thresholds',
      `${field} must be a finite number (got ${value})`,
      value,
    );
  }
  if (value < 0 || value > 100) {
    throw new ThresholdJudgmentError(
      'invalid_thresholds',
      `${field} must lie in [0, 100] (got ${value})`,
      value,
    );
  }
}

function resolveThresholds(options?: ThresholdOptions): {
  targetPercent: number;
  needsAdjustmentLowerBoundPercent: number;
} {
  const targetPercent = options?.targetPercent ?? DEFAULT_NORTH_STAR_TARGET_PERCENT;
  const needsAdjustmentLowerBoundPercent =
    options?.needsAdjustmentLowerBoundPercent ??
    DEFAULT_NEEDS_ADJUSTMENT_LOWER_BOUND_PERCENT;

  validateThresholdValue('targetPercent', targetPercent);
  validateThresholdValue(
    'needsAdjustmentLowerBoundPercent',
    needsAdjustmentLowerBoundPercent,
  );

  if (needsAdjustmentLowerBoundPercent > targetPercent) {
    throw new ThresholdJudgmentError(
      'invalid_thresholds',
      `needsAdjustmentLowerBoundPercent (${needsAdjustmentLowerBoundPercent}) must be <= targetPercent (${targetPercent})`,
      { targetPercent, needsAdjustmentLowerBoundPercent },
    );
  }

  return { targetPercent, needsAdjustmentLowerBoundPercent };
}

// ---------------------------------------------------------------------------
// Core classifier
// ---------------------------------------------------------------------------

/**
 * Classifies a conversion-rate percentage into PASS / NEEDS_ADJUSTMENT
 * / FAIL.  Pure: same input → same frozen output.  See the module
 * header for the band semantics and {@link ThresholdJudgmentError} for
 * reject reasons.
 */
export function evaluateConversionRateThreshold(
  rate: number,
  options?: ThresholdOptions,
): ThresholdJudgment {
  validateRate(rate);
  const { targetPercent, needsAdjustmentLowerBoundPercent } =
    resolveThresholds(options);

  let status: ThresholdStatus;
  if (rate >= targetPercent) {
    status = 'PASS';
  } else if (rate >= needsAdjustmentLowerBoundPercent) {
    status = 'NEEDS_ADJUSTMENT';
  } else {
    status = 'FAIL';
  }

  return Object.freeze({
    status,
    ratePercent: rate,
    targetPercent,
    needsAdjustmentLowerBoundPercent,
    gapPercent: rate - targetPercent,
  });
}

// ---------------------------------------------------------------------------
// Convenience predicates
// ---------------------------------------------------------------------------

/** True iff the judgment is PASS. */
export function isPass(judgment: ThresholdJudgment): boolean {
  return judgment.status === 'PASS';
}

/** True iff the judgment is NEEDS_ADJUSTMENT. */
export function needsAdjustment(judgment: ThresholdJudgment): boolean {
  return judgment.status === 'NEEDS_ADJUSTMENT';
}

/** True iff the judgment is FAIL. */
export function isFail(judgment: ThresholdJudgment): boolean {
  return judgment.status === 'FAIL';
}

// ---------------------------------------------------------------------------
// Simple boolean predicate — Sub-AC 1.1 surface
// ---------------------------------------------------------------------------

/**
 * Thin boolean predicate over the same classifier — convenient when
 * callers only need "did we hit the target?" without the full
 * judgment object.
 *
 * Note on units: this predicate accepts the target as a FRACTION in
 * [0, 1] (default `0.055` ⇒ 5.5%) to match the Sub-AC 1.1 contract,
 * while {@link evaluateConversionRateThreshold} works in percent
 * points.  We standardise on percent points internally and convert
 * here so the two surfaces stay consistent.
 */
export function isAboveThreshold(rate: number, target = 0.055): boolean {
  // Pass through the same finite-number checks the classifier uses,
  // then defer to the canonical comparison.  Converting `target * 100`
  // keeps the [0, 1] fraction convention exposed here while reusing
  // the percent-point classifier under the hood.
  validateRate(rate);
  if (typeof target !== 'number' || Number.isNaN(target) || !Number.isFinite(target)) {
    throw new ThresholdJudgmentError(
      'invalid_thresholds',
      `target must be a finite fraction in [0, 1] (got ${target})`,
      target,
    );
  }
  if (target < 0 || target > 1) {
    throw new ThresholdJudgmentError(
      'invalid_thresholds',
      `target must lie in [0, 1] (got ${target})`,
      target,
    );
  }
  return rate >= target * 100;
}
