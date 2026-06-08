/**
 * Unit tests for the free trial duration calculator — Sub-AC 16b.
 *
 * Verified invariants:
 *   - calculate_trial_days('annual')  → 37  (7-day connect + 30-day full)
 *   - calculate_trial_days('monthly') → 0   (no free trial)
 *   - calculate_trial_days(unknown)   → throws UnknownPlanTypeError
 *   - Named constants: ANNUAL_CONNECTION_TRIAL_DAYS=7, ANNUAL_FULL_TRIAL_DAYS=30, total=37
 *   - Return type is a non-negative integer for all valid plan types
 */
import { describe, expect, it } from 'vitest';
import {
  ANNUAL_CONNECTION_TRIAL_DAYS,
  ANNUAL_FULL_TRIAL_DAYS,
  ANNUAL_TOTAL_TRIAL_DAYS,
  MONTHLY_TRIAL_DAYS,
  calculate_trial_days,
} from '../../src/subscription/trial-calculator.js';
import { UnknownPlanTypeError } from '../../src/subscription/plan-config.js';

// ---------------------------------------------------------------------------
// Core behaviour — annual plan
// ---------------------------------------------------------------------------

describe('calculate_trial_days("annual")', () => {
  it('returns 37', () => {
    expect(calculate_trial_days('annual')).toBe(37);
  });

  it('returns a non-negative integer', () => {
    const result = calculate_trial_days('annual');
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('equals ANNUAL_CONNECTION_TRIAL_DAYS + ANNUAL_FULL_TRIAL_DAYS', () => {
    expect(calculate_trial_days('annual')).toBe(
      ANNUAL_CONNECTION_TRIAL_DAYS + ANNUAL_FULL_TRIAL_DAYS,
    );
  });

  it('equals the exported ANNUAL_TOTAL_TRIAL_DAYS constant', () => {
    expect(calculate_trial_days('annual')).toBe(ANNUAL_TOTAL_TRIAL_DAYS);
  });
});

// ---------------------------------------------------------------------------
// Core behaviour — monthly plan
// ---------------------------------------------------------------------------

describe('calculate_trial_days("monthly")', () => {
  it('returns 0', () => {
    expect(calculate_trial_days('monthly')).toBe(0);
  });

  it('returns a non-negative integer', () => {
    const result = calculate_trial_days('monthly');
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('equals the exported MONTHLY_TRIAL_DAYS constant', () => {
    expect(calculate_trial_days('monthly')).toBe(MONTHLY_TRIAL_DAYS);
  });
});

// ---------------------------------------------------------------------------
// Boundary values — invalid / unknown plan types
// ---------------------------------------------------------------------------

describe('calculate_trial_days — boundary values (unknown plan types)', () => {
  it('throws UnknownPlanTypeError for an arbitrary string', () => {
    expect(() => calculate_trial_days('lifetime' as never)).toThrowError(UnknownPlanTypeError);
  });

  it('throws UnknownPlanTypeError for an empty string', () => {
    expect(() => calculate_trial_days('' as never)).toThrowError(UnknownPlanTypeError);
  });

  it('throws UnknownPlanTypeError for undefined', () => {
    expect(() => calculate_trial_days(undefined as never)).toThrowError(UnknownPlanTypeError);
  });

  it('throws UnknownPlanTypeError for null', () => {
    expect(() => calculate_trial_days(null as never)).toThrowError(UnknownPlanTypeError);
  });

  it('throws UnknownPlanTypeError for a numeric value', () => {
    expect(() => calculate_trial_days(12 as never)).toThrowError(UnknownPlanTypeError);
  });

  it('error message contains the unrecognised value', () => {
    let caught: UnknownPlanTypeError | undefined;
    try {
      calculate_trial_days('unknown_plan' as never);
    } catch (e) {
      caught = e as UnknownPlanTypeError;
    }
    expect(caught).toBeInstanceOf(UnknownPlanTypeError);
    expect(caught?.message).toMatch(/unknown_plan/);
  });
});

// ---------------------------------------------------------------------------
// Named constants
// ---------------------------------------------------------------------------

describe('exported named constants', () => {
  it('ANNUAL_CONNECTION_TRIAL_DAYS is 7', () => {
    expect(ANNUAL_CONNECTION_TRIAL_DAYS).toBe(7);
  });

  it('ANNUAL_FULL_TRIAL_DAYS is 30', () => {
    expect(ANNUAL_FULL_TRIAL_DAYS).toBe(30);
  });

  it('ANNUAL_TOTAL_TRIAL_DAYS is 37', () => {
    expect(ANNUAL_TOTAL_TRIAL_DAYS).toBe(37);
  });

  it('MONTHLY_TRIAL_DAYS is 0', () => {
    expect(MONTHLY_TRIAL_DAYS).toBe(0);
  });

  it('ANNUAL_CONNECTION_TRIAL_DAYS + ANNUAL_FULL_TRIAL_DAYS equals ANNUAL_TOTAL_TRIAL_DAYS', () => {
    expect(ANNUAL_CONNECTION_TRIAL_DAYS + ANNUAL_FULL_TRIAL_DAYS).toBe(ANNUAL_TOTAL_TRIAL_DAYS);
  });
});

// ---------------------------------------------------------------------------
// Cross-plan invariants
// ---------------------------------------------------------------------------

describe('cross-plan invariants', () => {
  it('annual trial is strictly greater than monthly trial', () => {
    expect(calculate_trial_days('annual')).toBeGreaterThan(calculate_trial_days('monthly'));
  });

  it('both valid plan types return non-negative integers', () => {
    for (const plan of ['monthly', 'annual'] as const) {
      const days = calculate_trial_days(plan);
      expect(Number.isInteger(days)).toBe(true);
      expect(days).toBeGreaterThanOrEqual(0);
    }
  });
});
