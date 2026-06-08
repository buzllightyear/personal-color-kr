/**
 * Subscription plan pricing config module — Sub-AC 16a.
 *
 * Single source of truth for plan prices, billing intervals, and currency.
 * Derived directly from the Seed pricing constraints:
 *   - Monthly: $12 / month, no free trial
 *   - Annual:  $59 / year, 7-day base trial + 30-day bonus = 37-day total trial
 *
 * Usage:
 *   const config = getPlanConfig('monthly');  // → { price: 12, ... }
 *   const config = getPlanConfig('annual');   // → { price: 59, trialDays: 37, ... }
 *
 * Invariants enforced (each verified by a unit test):
 *   - Monthly plan price is exactly $12 USD.
 *   - Annual plan price is exactly $59 USD.
 *   - Monthly billing interval is 'monthly'.
 *   - Annual billing interval is 'annual'.
 *   - Currency is always 'USD'.
 *   - Monthly plan has zero free-trial days.
 *   - Annual plan free-trial days = baseTrialDays(7) + annualBonusDays(30) = 37.
 *   - getPlanConfig throws for an unknown plan type (type-guard).
 */

// ---------------------------------------------------------------------------
// Plan type
// ---------------------------------------------------------------------------

/** Valid subscription plan identifiers. */
export type PlanType = 'monthly' | 'annual';

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

/** Breakdown of a free-trial period.  Both fields are 0 for monthly plans. */
export interface TrialBreakdown {
  readonly baseTrialDays: number;
  readonly annualBonusDays: number;
}

/**
 * Frozen pricing configuration for one subscription plan.
 *
 * Returned by {@link getPlanConfig}.
 */
export interface PlanConfig {
  /** Plan identifier. */
  readonly planType: PlanType;
  /** Recurring charge amount in USD. */
  readonly price: number;
  /** ISO 4217 currency code — always 'USD' per Seed constraint. */
  readonly currency: 'USD';
  /** Billing recurrence period. */
  readonly billingInterval: 'monthly' | 'annual';
  /** Total free-trial days before first charge (0 for monthly). */
  readonly trialDays: number;
  /** Per-component trial breakdown (both zero for monthly). */
  readonly trialBreakdown: TrialBreakdown;
}

// ---------------------------------------------------------------------------
// Constants (Seed-derived, immutable)
// ---------------------------------------------------------------------------

const MONTHLY_PRICE_USD = 12 as const;
const ANNUAL_PRICE_USD = 59 as const;

const ANNUAL_BASE_TRIAL_DAYS = 7 as const;
const ANNUAL_BONUS_TRIAL_DAYS = 30 as const;
const ANNUAL_TOTAL_TRIAL_DAYS = ANNUAL_BASE_TRIAL_DAYS + ANNUAL_BONUS_TRIAL_DAYS; // 37

// ---------------------------------------------------------------------------
// Catalogue (module-level frozen singletons)
// ---------------------------------------------------------------------------

const MONTHLY_CONFIG: PlanConfig = Object.freeze({
  planType: 'monthly' as const,
  price: MONTHLY_PRICE_USD,
  currency: 'USD' as const,
  billingInterval: 'monthly' as const,
  trialDays: 0,
  trialBreakdown: Object.freeze({
    baseTrialDays: 0,
    annualBonusDays: 0,
  }),
});

const ANNUAL_CONFIG: PlanConfig = Object.freeze({
  planType: 'annual' as const,
  price: ANNUAL_PRICE_USD,
  currency: 'USD' as const,
  billingInterval: 'annual' as const,
  trialDays: ANNUAL_TOTAL_TRIAL_DAYS,
  trialBreakdown: Object.freeze({
    baseTrialDays: ANNUAL_BASE_TRIAL_DAYS,
    annualBonusDays: ANNUAL_BONUS_TRIAL_DAYS,
  }),
});

/**
 * Frozen catalogue keyed by plan type.
 * Use {@link getPlanConfig} for safe, typed access with unknown-input guard.
 */
export const PLAN_CATALOGUE: Readonly<Record<PlanType, PlanConfig>> = Object.freeze({
  monthly: MONTHLY_CONFIG,
  annual: ANNUAL_CONFIG,
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when an unknown plan type is passed to {@link getPlanConfig}. */
export class UnknownPlanTypeError extends Error {
  public override readonly name = 'UnknownPlanTypeError';
  public readonly received: unknown;

  constructor(received: unknown) {
    super(
      `Unknown plan type: ${String(received)}. Allowed values: 'monthly' | 'annual'`,
    );
    this.received = received;
  }
}

// ---------------------------------------------------------------------------
// Public API — getPlanConfig (AC spec: get_plan_config)
// ---------------------------------------------------------------------------

/**
 * Returns the frozen {@link PlanConfig} for the given plan type.
 *
 * AC spec name: `get_plan_config(plan_type)`
 *
 * @param planType - 'monthly' | 'annual'
 * @returns Frozen pricing config with price, currency, billing interval, and trial details.
 * @throws {UnknownPlanTypeError} if planType is not a recognised PlanType.
 *
 * @example
 * getPlanConfig('monthly')
 * // → { planType: 'monthly', price: 12, currency: 'USD', billingInterval: 'monthly', trialDays: 0, ... }
 *
 * getPlanConfig('annual')
 * // → { planType: 'annual', price: 59, currency: 'USD', billingInterval: 'annual', trialDays: 37, ... }
 */
export function getPlanConfig(planType: PlanType): PlanConfig;
export function getPlanConfig(planType: unknown): PlanConfig;
export function getPlanConfig(planType: unknown): PlanConfig {
  if (planType !== 'monthly' && planType !== 'annual') {
    throw new UnknownPlanTypeError(planType);
  }
  return PLAN_CATALOGUE[planType];
}
