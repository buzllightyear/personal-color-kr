/**
 * Free trial duration calculator — Sub-AC 16b.
 *
 * Single responsibility: given a plan type, return the total number of free-trial
 * days before the subscriber is first charged.
 *
 * Business rules (Seed constraints):
 *   - annual  → 37 days total (7-day connection trial + 30-day full trial)
 *   - monthly → 0  days (no free trial)
 *
 * The calculation deliberately delegates to the canonical plan config so there is
 * one source of truth for pricing / trial data (plan-config.ts).  This file adds
 * only the named `calculate_trial_days` surface required by Sub-AC 16b.
 */

import { getPlanConfig, type PlanType } from './plan-config.js';

// ---------------------------------------------------------------------------
// Domain constants (re-exported for tests / callers that want named access)
// ---------------------------------------------------------------------------

/** Trial days awarded for the "connection" phase of an annual subscription. */
export const ANNUAL_CONNECTION_TRIAL_DAYS = 7 as const;

/** Additional full-access trial days awarded after the connection phase. */
export const ANNUAL_FULL_TRIAL_DAYS = 30 as const;

/** Total free-trial days for an annual subscription (7 + 30). */
export const ANNUAL_TOTAL_TRIAL_DAYS =
  ANNUAL_CONNECTION_TRIAL_DAYS + ANNUAL_FULL_TRIAL_DAYS; // 37

/** Free-trial days for a monthly subscription (none). */
export const MONTHLY_TRIAL_DAYS = 0 as const;

// ---------------------------------------------------------------------------
// Public API — calculate_trial_days (AC spec name)
// ---------------------------------------------------------------------------

/**
 * Returns the total number of free-trial days for the given subscription plan.
 *
 * AC spec name: `calculate_trial_days(plan_type)`
 *
 * | plan_type | return value | breakdown                                  |
 * |-----------|--------------|--------------------------------------------|
 * | 'annual'  |      37      | 7-day connection trial + 30-day full trial |
 * | 'monthly' |       0      | no free trial                              |
 *
 * @param planType - 'monthly' | 'annual'
 * @returns Total free-trial days (non-negative integer).
 * @throws {UnknownPlanTypeError} if planType is not a recognised PlanType.
 *         (Forwarded from {@link getPlanConfig}.)
 *
 * @example
 * calculate_trial_days('annual')  // → 37
 * calculate_trial_days('monthly') // → 0
 */
export function calculate_trial_days(planType: PlanType): number;
export function calculate_trial_days(planType: unknown): number;
export function calculate_trial_days(planType: unknown): number {
  // Delegate to getPlanConfig — it owns the guard and throws UnknownPlanTypeError
  // for any unrecognised input, satisfying the boundary-value requirement.
  const config = getPlanConfig(planType as PlanType);
  return config.trialDays;
}
