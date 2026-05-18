/**
 * Unit tests — paywall / checkout trigger module (Sub-AC 2.4).
 *
 * The module validates entry conditions from the final Glam Up funnel step
 * (`payment_model`, step 12) and, only on success, initiates the Korean
 * payment handoff.  Failure modes MUST short-circuit before the gateway is
 * invoked — this is the "conditional invocation" contract.
 *
 * Coverage matrix:
 *   1. Pricing catalogue mirrors FUNNEL_SCREENS source of truth.
 *   2. Annual plan trial = 7 + 30 = 37 days; monthly plan trial = 0.
 *   3. Gateway IS invoked exactly once when all guards pass.
 *   4. Gateway is NOT invoked when:
 *        a. Machine is in `idle`, `completed`, `abandoned`, or any non-step-12 step.
 *        b. A required prior step is missing from `completedSteps`.
 *        c. Plan id is not 'monthly' / 'annual'.
 *   5. `rating_gate` (step 4) is allowed to be skipped — no error raised
 *      when it is absent from `completedSteps`.
 *   6. Request reaching the gateway is frozen, carries the right plan
 *      pricing, sessionId, timestamp, and handoff id.
 *   7. Result returned to the caller mirrors the gateway response,
 *      defensively frozen.
 *   8. Errors carry the structured `reason` discriminator + details.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  FUNNEL_STEPS_ORDERED,
  type FunnelMachine,
  type FunnelStepId,
} from '../../src/funnel/types.js';
import { FUNNEL_SCREENS } from '../../src/funnel/screens.js';
import {
  CheckoutGuardError,
  PAYMENT_PLAN_CATALOGUE,
  getPlanPricing,
  triggerCheckout,
  type CheckoutHandoffRequest,
  type CheckoutHandoffResult,
  type PaymentGateway,
  type PaymentPlanId,
} from '../../src/funnel/checkout.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_715_000_000_000; // 2024-05-06T11:33:20Z
const SESSION_ID = 'sess_checkout_01';
const FIXED_HANDOFF_ID = 'chk_test_handoff_01';

function makeMachine(
  state: FunnelMachine['state'],
  completedSteps: readonly FunnelStepId[] = [],
): FunnelMachine {
  return Object.freeze({
    state,
    history: Object.freeze([]),
    completedSteps: Object.freeze([...completedSteps]),
  });
}

/** All eleven preceding non-skippable steps, with rating_gate explicitly excluded. */
const ALL_PRIOR_STEPS_NO_SKIP: readonly FunnelStepId[] = FUNNEL_STEPS_ORDERED.filter(
  (s) => s !== 'payment_model',
);

/** Prior steps when the user skipped rating_gate (legal per Seed). */
const PRIOR_STEPS_RATING_SKIPPED: readonly FunnelStepId[] = FUNNEL_STEPS_ORDERED.filter(
  (s) => s !== 'payment_model' && s !== 'rating_gate',
);

function machineAtPayment(
  completedSteps: readonly FunnelStepId[] = ALL_PRIOR_STEPS_NO_SKIP,
): FunnelMachine {
  return makeMachine('payment_model', completedSteps);
}

interface MockGateway extends PaymentGateway {
  readonly initiate: PaymentGateway['initiate'] & {
    readonly mock: {
      readonly calls: ReadonlyArray<readonly [CheckoutHandoffRequest]>;
    };
  } & {
    (req: CheckoutHandoffRequest): CheckoutHandoffResult;
  };
}

function makeMockGateway(
  override: Partial<CheckoutHandoffResult> = {},
): MockGateway {
  const initiate = vi.fn((req: CheckoutHandoffRequest): CheckoutHandoffResult => {
    return Object.freeze({
      handoffId: req.handoffId,
      status: 'initiated',
      redirectUrl: 'https://pay.kr.example.com/handoff',
      providerRef: 'toss_ref_001',
      ...override,
    });
  }) as unknown as MockGateway['initiate'];
  return { initiate };
}

function triggerWithDefaults(overrides: {
  machine?: FunnelMachine;
  plan?: PaymentPlanId;
  gateway?: MockGateway;
} = {}) {
  const machine = overrides.machine ?? machineAtPayment();
  const gateway: MockGateway = overrides.gateway ?? makeMockGateway();
  return {
    gateway,
    result: triggerCheckout({
      machine,
      plan: overrides.plan ?? 'annual',
      sessionId: SESSION_ID,
      gateway,
      now: () => FIXED_NOW,
      handoffIdProvider: () => FIXED_HANDOFF_ID,
    }),
  };
}

// ---------------------------------------------------------------------------
// Pricing catalogue — mirrors FUNNEL_SCREENS source of truth
// ---------------------------------------------------------------------------

describe('PAYMENT_PLAN_CATALOGUE', () => {
  it('exposes exactly the two Korean-variant plans: monthly + annual', () => {
    expect(Object.keys(PAYMENT_PLAN_CATALOGUE).sort()).toEqual([
      'annual',
      'monthly',
    ]);
  });

  it('mirrors FUNNEL_SCREENS.payment_model.metadata for both plans', () => {
    const meta = FUNNEL_SCREENS.payment_model.metadata as Readonly<{
      monthlyUsd: number;
      annualUsd: number;
      freeTrialDays: number;
      trialBreakdown: {
        baseTrialDays: number;
        annualBonusDays: number;
      };
    }>;

    expect(PAYMENT_PLAN_CATALOGUE.monthly.priceUsd).toBe(meta.monthlyUsd);
    expect(PAYMENT_PLAN_CATALOGUE.annual.priceUsd).toBe(meta.annualUsd);
    expect(PAYMENT_PLAN_CATALOGUE.annual.trialDays).toBe(meta.freeTrialDays);
    expect(PAYMENT_PLAN_CATALOGUE.annual.trialBreakdown.baseTrialDays).toBe(
      meta.trialBreakdown.baseTrialDays,
    );
    expect(PAYMENT_PLAN_CATALOGUE.annual.trialBreakdown.annualBonusDays).toBe(
      meta.trialBreakdown.annualBonusDays,
    );
  });

  it('annual plan = $59 with 7 + 30 = 37-day free trial (Korean variant)', () => {
    const annual = PAYMENT_PLAN_CATALOGUE.annual;
    expect(annual.planId).toBe('annual');
    expect(annual.billingCadence).toBe('annual');
    expect(annual.priceUsd).toBe(59);
    expect(annual.currencyCode).toBe('USD');
    expect(annual.trialDays).toBe(37);
    expect(annual.trialBreakdown.baseTrialDays).toBe(7);
    expect(annual.trialBreakdown.annualBonusDays).toBe(30);
    expect(
      annual.trialBreakdown.baseTrialDays + annual.trialBreakdown.annualBonusDays,
    ).toBe(annual.trialDays);
  });

  it('monthly plan = $12 with no trial (only annual carries the 37-day bonus)', () => {
    const monthly = PAYMENT_PLAN_CATALOGUE.monthly;
    expect(monthly.planId).toBe('monthly');
    expect(monthly.billingCadence).toBe('monthly');
    expect(monthly.priceUsd).toBe(12);
    expect(monthly.trialDays).toBe(0);
    expect(monthly.trialBreakdown.baseTrialDays).toBe(0);
    expect(monthly.trialBreakdown.annualBonusDays).toBe(0);
  });

  it('is deeply frozen — consumers cannot mutate the catalogue', () => {
    expect(Object.isFrozen(PAYMENT_PLAN_CATALOGUE)).toBe(true);
    expect(Object.isFrozen(PAYMENT_PLAN_CATALOGUE.monthly)).toBe(true);
    expect(Object.isFrozen(PAYMENT_PLAN_CATALOGUE.annual)).toBe(true);
    expect(Object.isFrozen(PAYMENT_PLAN_CATALOGUE.annual.trialBreakdown)).toBe(
      true,
    );
  });
});

describe('getPlanPricing', () => {
  it('returns the same frozen entry as the catalogue for monthly', () => {
    expect(getPlanPricing('monthly')).toBe(PAYMENT_PLAN_CATALOGUE.monthly);
  });
  it('returns the same frozen entry as the catalogue for annual', () => {
    expect(getPlanPricing('annual')).toBe(PAYMENT_PLAN_CATALOGUE.annual);
  });
});

// ---------------------------------------------------------------------------
// Success path — gateway invoked exactly once with the right payload
// ---------------------------------------------------------------------------

describe('triggerCheckout — happy path (annual plan)', () => {
  it('invokes gateway.initiate exactly once when all guards pass', () => {
    const { gateway } = triggerWithDefaults({ plan: 'annual' });
    expect(gateway.initiate).toHaveBeenCalledTimes(1);
  });

  it('hands the gateway a frozen request with the annual pricing record', () => {
    const { gateway } = triggerWithDefaults({ plan: 'annual' });
    const req = gateway.initiate.mock.calls[0]?.[0] as CheckoutHandoffRequest;

    expect(req.handoffId).toBe(FIXED_HANDOFF_ID);
    expect(req.sessionId).toBe(SESSION_ID);
    expect(req.initiatedAt).toBe(FIXED_NOW);
    expect(req.plan).toBe(PAYMENT_PLAN_CATALOGUE.annual);
    expect(Object.isFrozen(req)).toBe(true);
  });

  it('hands the gateway the monthly pricing record when plan = monthly', () => {
    const { gateway } = triggerWithDefaults({ plan: 'monthly' });
    const req = gateway.initiate.mock.calls[0]?.[0] as CheckoutHandoffRequest;
    expect(req.plan).toBe(PAYMENT_PLAN_CATALOGUE.monthly);
    expect(req.plan.priceUsd).toBe(12);
  });

  it('returns a frozen result that mirrors the gateway response', () => {
    const gateway = makeMockGateway({
      handoffId: 'overridden_id',
      status: 'initiated',
      redirectUrl: 'https://pay.kr.example.com/x',
      providerRef: 'toss_xyz',
    });
    const result = triggerCheckout({
      machine: machineAtPayment(),
      plan: 'annual',
      sessionId: SESSION_ID,
      gateway,
      now: () => FIXED_NOW,
      handoffIdProvider: () => FIXED_HANDOFF_ID,
    });

    expect(result.response.handoffId).toBe('overridden_id');
    expect(result.response.status).toBe('initiated');
    expect(result.response.redirectUrl).toBe('https://pay.kr.example.com/x');
    expect(result.response.providerRef).toBe('toss_xyz');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.response)).toBe(true);
  });

  it('accepts rating_gate having been skipped (single skippable step)', () => {
    const machine = machineAtPayment(PRIOR_STEPS_RATING_SKIPPED);
    const gateway = makeMockGateway();
    expect(() =>
      triggerCheckout({
        machine,
        plan: 'annual',
        sessionId: SESSION_ID,
        gateway,
        now: () => FIXED_NOW,
        handoffIdProvider: () => FIXED_HANDOFF_ID,
      }),
    ).not.toThrow();
    expect(gateway.initiate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Conditional invocation — gateway must NOT fire on guard failure
// ---------------------------------------------------------------------------

describe('triggerCheckout — funnel_not_on_payment_step guard', () => {
  const NON_PAYMENT_STATES: readonly FunnelMachine['state'][] = [
    'idle',
    'completed',
    'abandoned',
    'welcome_hook',
    'value_props',
    'onboarding_priming',
    'rating_gate',
    'fake_loader',
    'scan_option_select',
    'diagnosis_input',
    'fake_scan_animation',
    'result_reveal',
    'referral_gate',
    'social_evolution',
  ];

  it.each(NON_PAYMENT_STATES)(
    'throws CheckoutGuardError and does NOT call gateway when machine is in "%s"',
    (state) => {
      const machine = makeMachine(state, ALL_PRIOR_STEPS_NO_SKIP);
      const gateway = makeMockGateway();

      let caught: unknown;
      try {
        triggerCheckout({
          machine,
          plan: 'annual',
          sessionId: SESSION_ID,
          gateway,
          now: () => FIXED_NOW,
          handoffIdProvider: () => FIXED_HANDOFF_ID,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(CheckoutGuardError);
      const err = caught as CheckoutGuardError;
      expect(err.reason).toBe('funnel_not_on_payment_step');
      expect(err.details).toMatchObject({
        currentState: state,
        requiredState: 'payment_model',
      });
      // The whole point of Sub-AC 2.4: gateway untouched on guard failure.
      expect(gateway.initiate).not.toHaveBeenCalled();
    },
  );
});

describe('triggerCheckout — required_step_not_completed guard', () => {
  it('throws and does NOT call gateway when an early step is missing', () => {
    // Drop `welcome_hook` (step 1) — must trip the guard.
    const completed = ALL_PRIOR_STEPS_NO_SKIP.filter((s) => s !== 'welcome_hook');
    const machine = machineAtPayment(completed);
    const gateway = makeMockGateway();

    expect(() =>
      triggerCheckout({
        machine,
        plan: 'annual',
        sessionId: SESSION_ID,
        gateway,
        now: () => FIXED_NOW,
        handoffIdProvider: () => FIXED_HANDOFF_ID,
      }),
    ).toThrow(CheckoutGuardError);
    expect(gateway.initiate).not.toHaveBeenCalled();
  });

  it('lists every missing step in details.missing', () => {
    const completed = ALL_PRIOR_STEPS_NO_SKIP.filter(
      (s) => s !== 'welcome_hook' && s !== 'value_props',
    );
    const machine = machineAtPayment(completed);
    const gateway = makeMockGateway();

    let caught: unknown;
    try {
      triggerCheckout({
        machine,
        plan: 'annual',
        sessionId: SESSION_ID,
        gateway,
        now: () => FIXED_NOW,
        handoffIdProvider: () => FIXED_HANDOFF_ID,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CheckoutGuardError);
    const err = caught as CheckoutGuardError;
    expect(err.reason).toBe('required_step_not_completed');
    expect(err.details.missing).toEqual(
      expect.arrayContaining(['welcome_hook', 'value_props']),
    );
    expect(gateway.initiate).not.toHaveBeenCalled();
  });

  it('does NOT raise when only the skippable rating_gate is missing', () => {
    const machine = machineAtPayment(PRIOR_STEPS_RATING_SKIPPED);
    const gateway = makeMockGateway();
    expect(() =>
      triggerCheckout({
        machine,
        plan: 'monthly',
        sessionId: SESSION_ID,
        gateway,
        now: () => FIXED_NOW,
        handoffIdProvider: () => FIXED_HANDOFF_ID,
      }),
    ).not.toThrow();
    expect(gateway.initiate).toHaveBeenCalledTimes(1);
  });

  it('with EMPTY completedSteps (machine forced to payment_model) — throws, no gateway call', () => {
    const machine = machineAtPayment([]);
    const gateway = makeMockGateway();
    expect(() =>
      triggerCheckout({
        machine,
        plan: 'annual',
        sessionId: SESSION_ID,
        gateway,
        now: () => FIXED_NOW,
        handoffIdProvider: () => FIXED_HANDOFF_ID,
      }),
    ).toThrow(CheckoutGuardError);
    expect(gateway.initiate).not.toHaveBeenCalled();
  });
});

describe('triggerCheckout — invalid_plan guard', () => {
  it('throws and does NOT call gateway for an unknown plan id', () => {
    const machine = machineAtPayment();
    const gateway = makeMockGateway();

    let caught: unknown;
    try {
      triggerCheckout({
        machine,
        // intentional wrong type — guard must catch at runtime
        plan: 'lifetime' as unknown as PaymentPlanId,
        sessionId: SESSION_ID,
        gateway,
        now: () => FIXED_NOW,
        handoffIdProvider: () => FIXED_HANDOFF_ID,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CheckoutGuardError);
    const err = caught as CheckoutGuardError;
    expect(err.reason).toBe('invalid_plan');
    expect(err.details).toMatchObject({
      received: 'lifetime',
      allowed: ['monthly', 'annual'],
    });
    expect(gateway.initiate).not.toHaveBeenCalled();
  });

  it('checks invalid_plan BEFORE state — fails fast on argument errors', () => {
    // Even on a wildly invalid machine, plan check trips first.
    const machine = makeMachine('idle', []);
    const gateway = makeMockGateway();
    let caught: unknown;
    try {
      triggerCheckout({
        machine,
        plan: '' as unknown as PaymentPlanId,
        sessionId: SESSION_ID,
        gateway,
        now: () => FIXED_NOW,
        handoffIdProvider: () => FIXED_HANDOFF_ID,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as CheckoutGuardError).reason).toBe('invalid_plan');
    expect(gateway.initiate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Defaults — clock + handoff id providers
// ---------------------------------------------------------------------------

describe('triggerCheckout — defaults', () => {
  it('uses Date.now and a default id provider when none are supplied', () => {
    const machine = machineAtPayment();
    const gateway = makeMockGateway();
    const before = Date.now();
    triggerCheckout({
      machine,
      plan: 'monthly',
      sessionId: SESSION_ID,
      gateway,
    });
    const after = Date.now();

    const req = gateway.initiate.mock.calls[0]?.[0] as CheckoutHandoffRequest;
    expect(req.initiatedAt).toBeGreaterThanOrEqual(before);
    expect(req.initiatedAt).toBeLessThanOrEqual(after);
    expect(req.handoffId).toMatch(/^chk_[a-z0-9]+_[a-z0-9]+$/);
  });
});

// ---------------------------------------------------------------------------
// Error class shape
// ---------------------------------------------------------------------------

describe('CheckoutGuardError', () => {
  it('extends Error, names itself, and freezes its details', () => {
    const err = new CheckoutGuardError('invalid_plan', 'bad', { x: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CheckoutGuardError');
    expect(err.reason).toBe('invalid_plan');
    expect(err.details).toEqual({ x: 1 });
    expect(Object.isFrozen(err.details)).toBe(true);
  });
});
