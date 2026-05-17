/**
 * Paywall / checkout trigger module — Glam Up 12단계 결제 깔때기 (한국 변형).
 *
 * Sub-AC 2.4 — single module that:
 *   1. Validates funnel entry conditions at the final step (`payment_model`).
 *   2. Conditionally initiates the Korean payment handoff via an injected
 *      {@link PaymentGateway} (Toss / KakaoPay / NicePay-style adapter).
 *
 * Seed-derived invariants enforced (each verified by a test):
 *   - Trigger only fires when the funnel machine is positioned on
 *     `payment_model` (step 12).  Any other state aborts the handoff with
 *     {@link CheckoutGuardError} and the gateway is NEVER invoked.
 *   - All preceding non-skippable steps (1, 2, 3, 5, 6, 7, 8, 9, 10, 11)
 *     must appear in `completedSteps`.  Step 4 (`rating_gate`) is the
 *     single allowed skip (iOS native dialog) per the state-machine rules.
 *   - Plan must be `monthly` ($12) or `annual` ($59 + 37-day free trial).
 *   - Pricing derives from `FUNNEL_SCREENS.payment_model.metadata` to keep
 *     screen renderer and checkout aligned (single source of truth).
 *   - Annual plan trial is exactly 7 (base) + 30 (annual bonus) = 37 days.
 *   - Currency is USD per the Korean-variant payment model in the Seed.
 *   - The gateway is called with a frozen handoff request — defence-in-depth
 *     against accidental downstream mutation.
 *   - On any guard failure: gateway.initiate is invoked zero times.
 *   - On valid call: gateway.initiate is invoked exactly once.
 */
import {
  FUNNEL_STEPS_ORDERED,
  type FunnelMachine,
  type FunnelStepId,
} from './types.js';
import { FUNNEL_SCREENS } from './screens.js';

// ---------------------------------------------------------------------------
// Plan + pricing — derived from FUNNEL_SCREENS.payment_model.metadata
// ---------------------------------------------------------------------------

export type PaymentPlanId = 'monthly' | 'annual';

export type BillingCadence = 'monthly' | 'annual';

export interface TrialBreakdown {
  readonly baseTrialDays: number;   // 7 for annual, 0 for monthly
  readonly annualBonusDays: number; // 30 for annual, 0 for monthly
}

/**
 * Frozen pricing record for one plan.  Mirrors the
 * `FUNNEL_SCREENS.payment_model.metadata` source of truth.
 */
export interface PaymentPlanPricing {
  readonly planId: PaymentPlanId;
  readonly billingCadence: BillingCadence;
  readonly priceUsd: number;
  readonly currencyCode: 'USD';
  readonly trialDays: number;
  readonly trialBreakdown: TrialBreakdown;
}

/**
 * Pulls the canonical metadata out of `FUNNEL_SCREENS.payment_model`.
 * Centralised here so any future copy/price change in screens.ts flows
 * straight through without touching this module.
 */
function readPaymentMetadata(): {
  monthlyUsd: number;
  annualUsd: number;
  freeTrialDays: number;
  trialBreakdown: TrialBreakdown;
} {
  const meta = FUNNEL_SCREENS.payment_model.metadata as Readonly<{
    monthlyUsd: number;
    annualUsd: number;
    freeTrialDays: number;
    trialBreakdown: TrialBreakdown;
  }>;

  return {
    monthlyUsd: meta.monthlyUsd,
    annualUsd: meta.annualUsd,
    freeTrialDays: meta.freeTrialDays,
    trialBreakdown: Object.freeze({
      baseTrialDays: meta.trialBreakdown.baseTrialDays,
      annualBonusDays: meta.trialBreakdown.annualBonusDays,
    }),
  };
}

/**
 * Frozen catalogue keyed by plan id.  Re-computed once at module load from
 * the FUNNEL_SCREENS source of truth.
 */
export const PAYMENT_PLAN_CATALOGUE: Readonly<
  Record<PaymentPlanId, PaymentPlanPricing>
> = (() => {
  const meta = readPaymentMetadata();
  const monthly: PaymentPlanPricing = Object.freeze({
    planId: 'monthly',
    billingCadence: 'monthly',
    priceUsd: meta.monthlyUsd,
    currencyCode: 'USD',
    trialDays: 0,
    trialBreakdown: Object.freeze({
      baseTrialDays: 0,
      annualBonusDays: 0,
    }),
  });
  const annual: PaymentPlanPricing = Object.freeze({
    planId: 'annual',
    billingCadence: 'annual',
    priceUsd: meta.annualUsd,
    currencyCode: 'USD',
    trialDays: meta.freeTrialDays,
    trialBreakdown: meta.trialBreakdown,
  });
  return Object.freeze({ monthly, annual });
})();

export function getPlanPricing(plan: PaymentPlanId): PaymentPlanPricing {
  // Exhaustive over PaymentPlanId — no undefined path.
  return PAYMENT_PLAN_CATALOGUE[plan];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type CheckoutGuardReason =
  | 'funnel_not_on_payment_step'
  | 'required_step_not_completed'
  | 'invalid_plan';

/**
 * Thrown when the funnel state does not satisfy the entry conditions for
 * checkout.  Carries a structured `reason` so callers can branch on the
 * failure mode without parsing the message.
 */
export class CheckoutGuardError extends Error {
  public override readonly name = 'CheckoutGuardError';
  public readonly reason: CheckoutGuardReason;
  public readonly details: Readonly<Record<string, unknown>>;

  constructor(
    reason: CheckoutGuardReason,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.reason = reason;
    this.details = Object.freeze({ ...details });
  }
}

// ---------------------------------------------------------------------------
// Gateway contract — Korean payment handoff abstraction
// ---------------------------------------------------------------------------

/**
 * Request sent to the Korean payment gateway (Toss/KakaoPay/NicePay-style).
 * Frozen before reaching the gateway.
 */
export interface CheckoutHandoffRequest {
  readonly handoffId: string;
  readonly sessionId: string;
  readonly plan: PaymentPlanPricing;
  readonly initiatedAt: number; // ms epoch
}

export type HandoffStatus = 'initiated' | 'failed';

/**
 * Gateway response after the handoff is initiated.
 * `redirectUrl` and `providerRef` are gateway-specific and optional.
 */
export interface CheckoutHandoffResult {
  readonly handoffId: string;
  readonly status: HandoffStatus;
  readonly redirectUrl: string | null;
  readonly providerRef: string | null;
}

/**
 * Single-method interface so any Korean payment provider can be wired in
 * (and unit tests can pass a `vi.fn`).
 */
export interface PaymentGateway {
  initiate(request: CheckoutHandoffRequest): CheckoutHandoffResult;
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export interface TriggerCheckoutOptions {
  readonly machine: FunnelMachine;
  readonly plan: PaymentPlanId;
  readonly sessionId: string;
  readonly gateway: PaymentGateway;
  /** Injectable clock; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Injectable id generator; defaults to a timestamp-derived id. */
  readonly handoffIdProvider?: () => string;
}

export interface TriggerCheckoutResult {
  readonly request: CheckoutHandoffRequest;
  readonly response: CheckoutHandoffResult;
}

/**
 * Step IDs that MUST appear in `completedSteps` before checkout fires.
 * Excludes `rating_gate` because it is the lone skippable step in the
 * Glam Up Korean-variant funnel.  Excludes `payment_model` itself because
 * the trigger runs WHILE the user is on step 12, before completion.
 */
const REQUIRED_PRIOR_STEPS: readonly FunnelStepId[] = FUNNEL_STEPS_ORDERED.filter(
  (s) => s !== 'rating_gate' && s !== 'payment_model',
);

function isPlanId(value: unknown): value is PaymentPlanId {
  return value === 'monthly' || value === 'annual';
}

function defaultHandoffId(now: number): string {
  // Deterministic-when-clock-is-injected, unique-enough in prod.
  // No external crypto dep keeps the module pure-node + browser portable.
  return `chk_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Validates entry conditions and, only on success, hands off to the
 * injected Korean payment gateway.
 *
 * On guard failure, throws {@link CheckoutGuardError} and the gateway is
 * NOT invoked — verified by the conditional-invocation tests.
 */
export function triggerCheckout(
  options: TriggerCheckoutOptions,
): TriggerCheckoutResult {
  const { machine, plan, sessionId, gateway } = options;
  const clock: () => number = options.now ?? Date.now;
  const idProvider: () => string =
    options.handoffIdProvider ?? (() => defaultHandoffId(clock()));

  // ---- Guard 1: plan validity ------------------------------------------
  if (!isPlanId(plan)) {
    throw new CheckoutGuardError(
      'invalid_plan',
      `Unknown payment plan: ${String(plan)}`,
      { received: plan, allowed: ['monthly', 'annual'] },
    );
  }

  // ---- Guard 2: machine on the final funnel step -----------------------
  if (machine.state !== 'payment_model') {
    throw new CheckoutGuardError(
      'funnel_not_on_payment_step',
      `Checkout can only trigger from payment_model (step 12); current state: ${machine.state}`,
      { currentState: machine.state, requiredState: 'payment_model' },
    );
  }

  // ---- Guard 3: every required prior step completed --------------------
  const completed = new Set<FunnelStepId>(machine.completedSteps);
  const missing = REQUIRED_PRIOR_STEPS.filter((s) => !completed.has(s));
  if (missing.length > 0) {
    throw new CheckoutGuardError(
      'required_step_not_completed',
      `Required funnel steps not completed before checkout: ${missing.join(', ')}`,
      { missing, requiredPriorSteps: REQUIRED_PRIOR_STEPS },
    );
  }

  // ---- All guards passed — invoke gateway exactly once -----------------
  const initiatedAt = clock();
  const request: CheckoutHandoffRequest = Object.freeze({
    handoffId: idProvider(),
    sessionId,
    plan: getPlanPricing(plan),
    initiatedAt,
  });
  const response = gateway.initiate(request);

  return Object.freeze({
    request,
    response: Object.freeze({
      handoffId: response.handoffId,
      status: response.status,
      redirectUrl: response.redirectUrl,
      providerRef: response.providerRef,
    }),
  });
}
