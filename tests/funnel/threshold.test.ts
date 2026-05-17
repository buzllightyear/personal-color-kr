/**
 * Unit tests — 5.5% 임계값 판정 모듈 (Sub-AC 1.3).
 *
 * Contract under test:
 *   - A pure function `evaluateConversionRateThreshold` classifies a
 *     conversion-rate percentage into one of three states:
 *
 *       PASS              — at or above the north-star target (default 5.5%).
 *       NEEDS_ADJUSTMENT  — below the target, but within the adjustment
 *                           band where the Korean-market target may be
 *                           reconsidered per the Seed exit condition
 *                           ("5.5%+ 또는 한국 시장 조정 target 결정·도달").
 *       FAIL              — below the adjustment band — the funnel
 *                           materially underperformed; reassess strategy.
 *
 *   - The function is pure: same input → same output, no globals, no
 *     I/O.  Default thresholds are exposed as named constants so call
 *     sites and dashboards agree on the boundary values.
 *
 * Coverage matrix:
 *   1. Boundary cases at the canonical 5.5% / 4.0% bands:
 *      a. exactly 5.5%        → PASS                (closed lower bound).
 *      b. 5.4999%             → NEEDS_ADJUSTMENT    (just below target).
 *      c. exactly 4.0%        → NEEDS_ADJUSTMENT    (closed lower bound).
 *      d. 3.9999%             → FAIL                (just below band).
 *      e. 0%                  → FAIL                (no conversions).
 *      f. 100%                → PASS                (every checkout).
 *      g. 5.5% + ε rounding   → PASS                (no float surprises).
 *   2. Custom thresholds (Korean-market adjusted target).
 *   3. Schema validation: rate must be a finite real in [0, 100];
 *      otherwise throws `ThresholdJudgmentError` with a structured
 *      `reason`.
 *   4. Judgment object shape — status, ratePercent, target, lower
 *      bound, gap, frozen.
 *   5. Purity guarantees — deterministic, non-mutating.
 *   6. Convenience predicates `isPass` / `needsAdjustment` / `isFail`.
 *   7. End-to-end with the conversion-rate calculator: rate = 5.5% from
 *      55 / 1000 → PASS; 4.0% from 40 / 1000 → NEEDS_ADJUSTMENT;
 *      3.9% from 39 / 1000 → FAIL.
 */
import { describe, expect, it } from 'vitest';

import { calculateConversionRate } from '../../src/funnel/conversion-rate.js';
import {
  DEFAULT_NEEDS_ADJUSTMENT_LOWER_BOUND_PERCENT,
  DEFAULT_NORTH_STAR_TARGET_PERCENT,
  ThresholdJudgmentError,
  evaluateConversionRateThreshold,
  isFail,
  isPass,
  needsAdjustment,
} from '../../src/funnel/threshold.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectThrows(fn: () => unknown): ThresholdJudgmentError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ThresholdJudgmentError);
  return caught as ThresholdJudgmentError;
}

// ---------------------------------------------------------------------------
// Threshold constants — the canonical Phase-0 values
// ---------------------------------------------------------------------------

describe('threshold constants', () => {
  it('exposes 5.5 as the default north-star target', () => {
    // The Seed pins the north-star metric to 5.5%+.  Any future change
    // to this constant must be deliberate — the assertion ensures a
    // single edit can't silently drift the target.
    expect(DEFAULT_NORTH_STAR_TARGET_PERCENT).toBe(5.5);
  });

  it('exposes 4.0 as the default lower bound of the NEEDS_ADJUSTMENT band', () => {
    expect(DEFAULT_NEEDS_ADJUSTMENT_LOWER_BOUND_PERCENT).toBe(4.0);
  });

  it('orders the bands consistently (lower < target)', () => {
    expect(DEFAULT_NEEDS_ADJUSTMENT_LOWER_BOUND_PERCENT).toBeLessThan(
      DEFAULT_NORTH_STAR_TARGET_PERCENT,
    );
  });
});

// ---------------------------------------------------------------------------
// Boundary cases — the 5.5% and 4.0% transitions
// ---------------------------------------------------------------------------

describe('evaluateConversionRateThreshold — boundary cases', () => {
  it('classifies exactly 5.5% as PASS (closed lower bound on the target)', () => {
    const judgment = evaluateConversionRateThreshold(5.5);
    expect(judgment.status).toBe('PASS');
    expect(judgment.ratePercent).toBe(5.5);
    expect(judgment.targetPercent).toBe(5.5);
    expect(judgment.gapPercent).toBe(0);
  });

  it('classifies 5.4999% as NEEDS_ADJUSTMENT (just below the target)', () => {
    const judgment = evaluateConversionRateThreshold(5.4999);
    expect(judgment.status).toBe('NEEDS_ADJUSTMENT');
    expect(judgment.gapPercent).toBeCloseTo(-0.0001, 10);
  });

  it('classifies exactly 4.0% as NEEDS_ADJUSTMENT (closed lower bound on the band)', () => {
    const judgment = evaluateConversionRateThreshold(4.0);
    expect(judgment.status).toBe('NEEDS_ADJUSTMENT');
  });

  it('classifies 3.9999% as FAIL (just below the band)', () => {
    const judgment = evaluateConversionRateThreshold(3.9999);
    expect(judgment.status).toBe('FAIL');
  });

  it('classifies 0% as FAIL (no conversions at all)', () => {
    const judgment = evaluateConversionRateThreshold(0);
    expect(judgment.status).toBe('FAIL');
    expect(judgment.gapPercent).toBe(-5.5);
  });

  it('classifies 100% as PASS', () => {
    const judgment = evaluateConversionRateThreshold(100);
    expect(judgment.status).toBe('PASS');
    expect(judgment.gapPercent).toBe(94.5);
  });

  it('classifies 5.5 + ε rounding noise as PASS (no float surprises)', () => {
    // Float arithmetic on some engines lands `0.1 + 0.2 + 5.2`
    // exactly on 5.5; on others on 5.500000000000001.  Either way the
    // classifier MUST return PASS — `rate >= target` holds in both
    // cases, and that is the property under test.
    const noisy = 0.1 + 0.2 + 5.2;
    expect(noisy).toBeGreaterThanOrEqual(5.5); // robust across engines
    const judgment = evaluateConversionRateThreshold(noisy);
    expect(judgment.status).toBe('PASS');

    // Also exercise an explicit just-above-target value so the
    // classifier's float robustness is asserted regardless of the
    // engine's rounding of the expression above.
    const justAbove = 5.5 + Number.EPSILON * 100;
    expect(justAbove).toBeGreaterThan(5.5);
    expect(evaluateConversionRateThreshold(justAbove).status).toBe('PASS');
  });
});

// ---------------------------------------------------------------------------
// Happy path — the three canonical bands
// ---------------------------------------------------------------------------

describe('evaluateConversionRateThreshold — band classification', () => {
  it.each([
    [10, 'PASS'],
    [5.5, 'PASS'],
    [5.49, 'NEEDS_ADJUSTMENT'],
    [4.5, 'NEEDS_ADJUSTMENT'],
    [4.0, 'NEEDS_ADJUSTMENT'],
    [3.99, 'FAIL'],
    [1.0, 'FAIL'],
    [0.0, 'FAIL'],
  ] as const)('%f%% → %s', (rate, expected) => {
    expect(evaluateConversionRateThreshold(rate).status).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Custom thresholds — Korean-market adjusted target
// ---------------------------------------------------------------------------

describe('evaluateConversionRateThreshold — custom thresholds', () => {
  it('respects a custom Korean-market adjusted target', () => {
    // Per the Seed exit condition, the team may adjust the target to a
    // Korean-market specific value.  The classifier must honour it.
    const judgment = evaluateConversionRateThreshold(4.5, {
      targetPercent: 4.0,
      needsAdjustmentLowerBoundPercent: 3.0,
    });
    expect(judgment.status).toBe('PASS');
    expect(judgment.targetPercent).toBe(4.0);
    expect(judgment.needsAdjustmentLowerBoundPercent).toBe(3.0);
    expect(judgment.gapPercent).toBe(0.5);
  });

  it('treats targetPercent === lowerBound as a binary PASS / FAIL classifier', () => {
    // Edge case: band width = 0.  Anything below target falls straight
    // into FAIL — there is no adjustment window.
    expect(
      evaluateConversionRateThreshold(5.5, {
        targetPercent: 5.5,
        needsAdjustmentLowerBoundPercent: 5.5,
      }).status,
    ).toBe('PASS');
    expect(
      evaluateConversionRateThreshold(5.499, {
        targetPercent: 5.5,
        needsAdjustmentLowerBoundPercent: 5.5,
      }).status,
    ).toBe('FAIL');
  });

  it('rejects a lowerBound > target (band inversion)', () => {
    const err = expectThrows(() =>
      evaluateConversionRateThreshold(5.0, {
        targetPercent: 5.0,
        needsAdjustmentLowerBoundPercent: 6.0,
      }),
    );
    expect(err.reason).toBe('invalid_thresholds');
  });

  it.each([
    ['target out of range high', { targetPercent: 101, needsAdjustmentLowerBoundPercent: 0 }],
    ['target negative', { targetPercent: -1, needsAdjustmentLowerBoundPercent: -2 }],
    ['lowerBound negative', { targetPercent: 5, needsAdjustmentLowerBoundPercent: -1 }],
    ['target NaN', { targetPercent: Number.NaN, needsAdjustmentLowerBoundPercent: 0 }],
  ] as const)('rejects %s', (_label, options) => {
    const err = expectThrows(() => evaluateConversionRateThreshold(5, options));
    expect(err.reason).toBe('invalid_thresholds');
  });
});

// ---------------------------------------------------------------------------
// Schema validation — input rate
// ---------------------------------------------------------------------------

describe('evaluateConversionRateThreshold — schema validation', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ] as const)('rejects %s rate', (_label, rate) => {
    const err = expectThrows(() => evaluateConversionRateThreshold(rate));
    expect(err.reason).toBe('not_finite');
  });

  it.each([
    ['negative rate', -0.01],
    ['rate above 100', 100.01],
  ] as const)('rejects %s', (_label, rate) => {
    const err = expectThrows(() => evaluateConversionRateThreshold(rate));
    expect(err.reason).toBe('out_of_range');
  });

  it.each([
    ['string', '5.5'],
    ['undefined', undefined],
    ['null', null],
    ['object', {}],
  ] as const)('rejects %s rate (not a number)', (_label, rate) => {
    const err = expectThrows(() =>
      evaluateConversionRateThreshold(rate as unknown as number),
    );
    expect(err.reason).toBe('not_a_number');
  });
});

// ---------------------------------------------------------------------------
// Judgment object shape
// ---------------------------------------------------------------------------

describe('evaluateConversionRateThreshold — judgment object shape', () => {
  it('reports the gap from the target (positive when above, negative when below)', () => {
    expect(evaluateConversionRateThreshold(7.5).gapPercent).toBe(2);
    expect(evaluateConversionRateThreshold(3.5).gapPercent).toBe(-2);
  });

  it('returns a frozen object — defence in depth against mutation', () => {
    const judgment = evaluateConversionRateThreshold(5.5);
    expect(Object.isFrozen(judgment)).toBe(true);
  });

  it('echoes the effective thresholds used for the decision', () => {
    const judgment = evaluateConversionRateThreshold(5.5);
    expect(judgment.targetPercent).toBe(DEFAULT_NORTH_STAR_TARGET_PERCENT);
    expect(judgment.needsAdjustmentLowerBoundPercent).toBe(
      DEFAULT_NEEDS_ADJUSTMENT_LOWER_BOUND_PERCENT,
    );
  });
});

// ---------------------------------------------------------------------------
// Purity guarantees
// ---------------------------------------------------------------------------

describe('evaluateConversionRateThreshold — purity', () => {
  it('is deterministic for the same input', () => {
    const a = evaluateConversionRateThreshold(5.5);
    const b = evaluateConversionRateThreshold(5.5);
    expect(a).toEqual(b);
  });

  it('does not mutate the options object', () => {
    const options = {
      targetPercent: 6.0,
      needsAdjustmentLowerBoundPercent: 4.0,
    };
    const snapshot = { ...options };
    evaluateConversionRateThreshold(5.0, options);
    expect(options).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Convenience predicates
// ---------------------------------------------------------------------------

describe('predicates isPass / needsAdjustment / isFail', () => {
  it('isPass is true only for PASS judgments', () => {
    expect(isPass(evaluateConversionRateThreshold(5.5))).toBe(true);
    expect(isPass(evaluateConversionRateThreshold(5.0))).toBe(false);
    expect(isPass(evaluateConversionRateThreshold(0))).toBe(false);
  });

  it('needsAdjustment is true only inside the band', () => {
    expect(needsAdjustment(evaluateConversionRateThreshold(5.0))).toBe(true);
    expect(needsAdjustment(evaluateConversionRateThreshold(5.5))).toBe(false);
    expect(needsAdjustment(evaluateConversionRateThreshold(3.5))).toBe(false);
  });

  it('isFail is true only for FAIL judgments', () => {
    expect(isFail(evaluateConversionRateThreshold(3.5))).toBe(true);
    expect(isFail(evaluateConversionRateThreshold(5.0))).toBe(false);
    expect(isFail(evaluateConversionRateThreshold(5.5))).toBe(false);
  });

  it('exactly one predicate is ever true for a given judgment', () => {
    const rates = [0, 1, 3.99, 4.0, 5.49, 5.5, 7.5, 100];
    for (const rate of rates) {
      const j = evaluateConversionRateThreshold(rate);
      const flags = [isPass(j), needsAdjustment(j), isFail(j)];
      expect(flags.filter(Boolean)).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end — pipes the conversion-rate calculator into the threshold judge
// ---------------------------------------------------------------------------

describe('end-to-end with calculateConversionRate', () => {
  it('PASSes at the canonical Phase-0 target (55 / 1000 = 5.5%)', () => {
    const ratePercent = calculateConversionRate({
      startedCount: 1000,
      completedCount: 55,
    });
    const judgment = evaluateConversionRateThreshold(ratePercent);
    expect(judgment.status).toBe('PASS');
    expect(judgment.ratePercent).toBe(5.5);
  });

  it('flags NEEDS_ADJUSTMENT at 4.0% (40 / 1000)', () => {
    const ratePercent = calculateConversionRate({
      startedCount: 1000,
      completedCount: 40,
    });
    expect(evaluateConversionRateThreshold(ratePercent).status).toBe(
      'NEEDS_ADJUSTMENT',
    );
  });

  it('FAILs at 3.9% (39 / 1000)', () => {
    const ratePercent = calculateConversionRate({
      startedCount: 1000,
      completedCount: 39,
    });
    expect(evaluateConversionRateThreshold(ratePercent).status).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// Error class shape
// ---------------------------------------------------------------------------

describe('ThresholdJudgmentError', () => {
  it('extends Error, names itself, and exposes reason + value', () => {
    const err = new ThresholdJudgmentError('out_of_range', 'bad rate', 105);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ThresholdJudgmentError');
    expect(err.reason).toBe('out_of_range');
    expect(err.value).toBe(105);
    expect(err.message).toContain('bad rate');
  });
});
