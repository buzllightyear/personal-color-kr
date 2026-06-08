/**
 * Unit tests for the subscription plan-config module — Sub-AC 16a.
 *
 * Verified invariants:
 *   - getPlanConfig('monthly') returns price=$12, billingInterval='monthly', currency='USD'
 *   - getPlanConfig('annual')  returns price=$59, billingInterval='annual',  currency='USD'
 *   - Annual trialDays = 37 (7 + 30)
 *   - Monthly trialDays = 0
 *   - Annual trialBreakdown: baseTrialDays=7, annualBonusDays=30
 *   - Monthly trialBreakdown: baseTrialDays=0, annualBonusDays=0
 *   - planType field echoes the input
 *   - Return value is frozen (immutable)
 *   - Unknown plan type throws UnknownPlanTypeError
 *   - PLAN_CATALOGUE is a frozen catalogue covering both plan types
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPlanConfig,
  PLAN_CATALOGUE,
  UnknownPlanTypeError,
  type PlanConfig,
} from '../../src/subscription/plan-config.js';

// ---------------------------------------------------------------------------
// Exact value assertions — monthly
// ---------------------------------------------------------------------------

describe('getPlanConfig("monthly")', () => {
  let config: PlanConfig;

  beforeEach(() => {
    config = getPlanConfig('monthly');
  });

  it('returns price $12 USD', () => {
    expect(config.price).toBe(12);
  });

  it('returns currency USD', () => {
    expect(config.currency).toBe('USD');
  });

  it('returns billingInterval "monthly"', () => {
    expect(config.billingInterval).toBe('monthly');
  });

  it('returns planType "monthly"', () => {
    expect(config.planType).toBe('monthly');
  });

  it('returns trialDays 0 (no free trial for monthly)', () => {
    expect(config.trialDays).toBe(0);
  });

  it('returns trialBreakdown with both components 0', () => {
    expect(config.trialBreakdown).toEqual({
      baseTrialDays: 0,
      annualBonusDays: 0,
    });
  });

  it('returns a frozen object (immutable)', () => {
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('returns a frozen trialBreakdown (immutable)', () => {
    expect(Object.isFrozen(config.trialBreakdown)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Exact value assertions — annual
// ---------------------------------------------------------------------------

describe('getPlanConfig("annual")', () => {
  let config: PlanConfig;

  beforeEach(() => {
    config = getPlanConfig('annual');
  });

  it('returns price $59 USD', () => {
    expect(config.price).toBe(59);
  });

  it('returns currency USD', () => {
    expect(config.currency).toBe('USD');
  });

  it('returns billingInterval "annual"', () => {
    expect(config.billingInterval).toBe('annual');
  });

  it('returns planType "annual"', () => {
    expect(config.planType).toBe('annual');
  });

  it('returns trialDays 37 (7 base + 30 bonus)', () => {
    expect(config.trialDays).toBe(37);
  });

  it('returns trialBreakdown.baseTrialDays = 7', () => {
    expect(config.trialBreakdown.baseTrialDays).toBe(7);
  });

  it('returns trialBreakdown.annualBonusDays = 30', () => {
    expect(config.trialBreakdown.annualBonusDays).toBe(30);
  });

  it('trialBreakdown components sum to trialDays', () => {
    const { baseTrialDays, annualBonusDays } = config.trialBreakdown;
    expect(baseTrialDays + annualBonusDays).toBe(config.trialDays);
  });

  it('returns a frozen object (immutable)', () => {
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('returns a frozen trialBreakdown (immutable)', () => {
    expect(Object.isFrozen(config.trialBreakdown)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guard — unknown plan type throws
// ---------------------------------------------------------------------------

describe('getPlanConfig — unknown plan type', () => {
  it('throws UnknownPlanTypeError for an arbitrary string', () => {
    expect(() => getPlanConfig('lifetime' as never)).toThrowError(UnknownPlanTypeError);
  });

  it('throws UnknownPlanTypeError for an empty string', () => {
    expect(() => getPlanConfig('' as never)).toThrowError(UnknownPlanTypeError);
  });

  it('throws UnknownPlanTypeError for undefined', () => {
    expect(() => getPlanConfig(undefined as never)).toThrowError(UnknownPlanTypeError);
  });

  it('throws UnknownPlanTypeError for null', () => {
    expect(() => getPlanConfig(null as never)).toThrowError(UnknownPlanTypeError);
  });

  it('error message includes the received value', () => {
    let error: UnknownPlanTypeError | undefined;
    try {
      getPlanConfig('bad_plan' as never);
    } catch (e) {
      error = e as UnknownPlanTypeError;
    }
    expect(error).toBeInstanceOf(UnknownPlanTypeError);
    expect(error?.message).toMatch(/bad_plan/);
    expect(error?.received).toBe('bad_plan');
  });
});

// ---------------------------------------------------------------------------
// PLAN_CATALOGUE — frozen catalogue integrity
// ---------------------------------------------------------------------------

describe('PLAN_CATALOGUE', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(PLAN_CATALOGUE)).toBe(true);
  });

  it('contains both plan types', () => {
    expect(PLAN_CATALOGUE).toHaveProperty('monthly');
    expect(PLAN_CATALOGUE).toHaveProperty('annual');
  });

  it('monthly entry matches getPlanConfig("monthly")', () => {
    expect(PLAN_CATALOGUE.monthly).toEqual(getPlanConfig('monthly'));
  });

  it('annual entry matches getPlanConfig("annual")', () => {
    expect(PLAN_CATALOGUE.annual).toEqual(getPlanConfig('annual'));
  });
});

// ---------------------------------------------------------------------------
// Cross-plan invariants
// ---------------------------------------------------------------------------

describe('cross-plan invariants', () => {
  it('annual price is less than 12 * monthly price (annual is a discount)', () => {
    const monthly = getPlanConfig('monthly');
    const annual = getPlanConfig('annual');
    expect(annual.price).toBeLessThan(monthly.price * 12);
  });

  it('both plans use USD currency', () => {
    expect(getPlanConfig('monthly').currency).toBe('USD');
    expect(getPlanConfig('annual').currency).toBe('USD');
  });
});
