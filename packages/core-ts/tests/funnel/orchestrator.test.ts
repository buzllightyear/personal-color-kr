/**
 * Integration tests — Sub-AC 2.5 orchestrator.
 *
 * These tests treat the orchestrator as the single seam through which the
 * entire Glam Up 12-step Korean-variant flow is exercised end-to-end.
 * Unlike the unit tests for state-machine / screens / analytics / checkout,
 * NO mocks are stubbed for the internal collaborators — only the two
 * legitimate external boundaries (`AnalyticsSink`, `PaymentGateway`) are
 * mocked, exactly as production code would inject them.
 *
 * Coverage matrix:
 *   1. Canonical happy path: idle → 1 → ... → 12 → completed
 *   2. Skip-rating-gate variant: idle → 1 → 2 → 3 → 4(skipped) → ... → 12 → completed
 *   3. Monthly plan handoff carries $12 / 0-day trial
 *   4. Annual plan handoff carries $59 / 37-day trial (Korean variant)
 *   5. Analytics sequence is exactly:
 *        - 12× step_view (one per step, in order)
 *        - 12× step_cta_click (one per step, matching the CTA chosen)
 *        - 0× step_drop on the happy path
 *   6. KR variant tag (`kr_variant`) on steps 10/11/12 propagates through
 *      every analytics event emitted for those steps.
 *   7. Gateway is invoked exactly once on the happy path.
 *   8. Abandon mid-flow emits step_drop and transitions to `abandoned`.
 *   9. CheckoutGuardError propagates from triggerPayment when machine is
 *      not on payment_model — and the gateway is NEVER invoked.
 *  10. CTAs not registered on the current screen are rejected.
 *  11. Skipping a non-skippable step raises a clear error.
 *  12. State immutability: every machine snapshot returned is frozen and
 *      previous snapshots are not mutated when a transition runs.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  FUNNEL_STEPS_ORDERED,
  TOTAL_FUNNEL_STEPS,
  type FunnelStepId,
} from '../../src/funnel/types.js';
import { FUNNEL_SCREENS, type FunnelCta } from '../../src/funnel/screens.js';
import {
  CheckoutGuardError,
  PAYMENT_PLAN_CATALOGUE,
  type CheckoutHandoffRequest,
  type CheckoutHandoffResult,
  type PaymentGateway,
} from '../../src/funnel/checkout.js';
import type {
  AnalyticsSink,
  FunnelAnalyticsEvent,
  StepCtaClickEvent,
  StepDropEvent,
  StepViewEvent,
} from '../../src/funnel/analytics.js';
import {
  createFunnelOrchestrator,
  runCanonicalKoreanFlow,
} from '../../src/funnel/orchestrator.js';

// ---------------------------------------------------------------------------
// Test harness — mocks for the two external boundaries
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_715_000_000_000;
const SESSION_ID = 'sess_orch_01';
const FIXED_HANDOFF_ID = 'chk_test_handoff';

function makeMockSink(): AnalyticsSink & {
  readonly captured: readonly FunnelAnalyticsEvent[];
} {
  const captured: FunnelAnalyticsEvent[] = [];
  return {
    capture(event: FunnelAnalyticsEvent) {
      captured.push(event);
    },
    get captured(): readonly FunnelAnalyticsEvent[] {
      return captured;
    },
  };
}

interface MockGateway extends PaymentGateway {
  readonly initiate: PaymentGateway['initiate'] & {
    readonly mock: {
      readonly calls: ReadonlyArray<readonly [CheckoutHandoffRequest]>;
    };
  };
}

function makeMockGateway(override: Partial<CheckoutHandoffResult> = {}): MockGateway {
  const initiate = vi.fn(
    (req: CheckoutHandoffRequest): CheckoutHandoffResult =>
      Object.freeze({
        handoffId: req.handoffId,
        status: 'initiated',
        redirectUrl: 'https://pay.kr.example.com/handoff',
        providerRef: 'toss_ref_001',
        ...override,
      }),
  ) as unknown as MockGateway['initiate'];
  return { initiate };
}

function makeOrchestrator(
  opts: {
    sink?: ReturnType<typeof makeMockSink>;
    gateway?: MockGateway;
  } = {},
) {
  const sink = opts.sink ?? makeMockSink();
  const gateway = opts.gateway ?? makeMockGateway();
  const orchestrator = createFunnelOrchestrator({
    sessionId: SESSION_ID,
    analyticsSink: sink,
    paymentGateway: gateway,
    now: () => FIXED_NOW,
    handoffIdProvider: () => FIXED_HANDOFF_ID,
  });
  return { orchestrator, sink, gateway };
}

const KR_VARIANT_STEPS: ReadonlySet<FunnelStepId> = new Set<FunnelStepId>([
  'referral_gate',
  'social_evolution',
  'payment_model',
]);

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

describe('createFunnelOrchestrator — initialization', () => {
  it('starts in idle with no events and a null current screen', () => {
    const { orchestrator, sink } = makeOrchestrator();
    expect(orchestrator.machine.state).toBe('idle');
    expect(orchestrator.currentScreen).toBeNull();
    expect(orchestrator.events).toEqual([]);
    expect(sink.captured).toEqual([]);
  });

  it('exposes a frozen façade — methods cannot be replaced', () => {
    const { orchestrator } = makeOrchestrator();
    expect(Object.isFrozen(orchestrator)).toBe(true);
  });

  it('does NOT call the gateway on construction', () => {
    const { gateway } = makeOrchestrator();
    expect(gateway.initiate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

describe('orchestrator.start', () => {
  it('transitions idle → welcome_hook and emits step_view for step 1', () => {
    const { orchestrator, sink } = makeOrchestrator();
    orchestrator.start();
    expect(orchestrator.machine.state).toBe('welcome_hook');
    expect(orchestrator.currentScreen?.stepId).toBe('welcome_hook');
    expect(sink.captured).toHaveLength(1);
    const view = sink.captured[0] as StepViewEvent;
    expect(view.type).toBe('step_view');
    expect(view.stepNumber).toBe(1);
    expect(view.variantTag).toBeNull();
    expect(view.sessionId).toBe(SESSION_ID);
  });

  it('throws when called twice', () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.start();
    expect(() => orchestrator.start()).toThrow(/already in state/i);
  });

  it('throws when called from a terminal non-idle state', () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.start();
    orchestrator.abandon('user_quit');
    expect(() => orchestrator.start()).toThrow(/already in state "abandoned"/i);
  });
});

// ---------------------------------------------------------------------------
// Canonical 12-step happy path (annual plan, rating submitted)
// ---------------------------------------------------------------------------

describe('orchestrator — canonical 12-step happy path (annual plan)', () => {
  it('completes the full Korean-variant flow and lands in `completed`', () => {
    const { orchestrator, sink, gateway } = makeOrchestrator();
    const result = runCanonicalKoreanFlow(orchestrator, {
      ratingChoice: 'submit',
      plan: 'annual',
    });

    expect(orchestrator.machine.state).toBe('completed');
    expect(orchestrator.currentScreen).toBeNull();
    expect(orchestrator.progress.isComplete).toBe(true);
    expect(orchestrator.progress.progressPercent).toBe(100);
    expect(orchestrator.progress.completedSteps).toEqual(FUNNEL_STEPS_ORDERED);

    // Gateway called exactly once with annual pricing record
    expect(gateway.initiate).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe('initiated');
    expect(result.request.plan).toBe(PAYMENT_PLAN_CATALOGUE.annual);
    expect(result.request.plan.priceUsd).toBe(59);
    expect(result.request.plan.trialDays).toBe(37);
    expect(result.request.plan.trialBreakdown.baseTrialDays).toBe(7);
    expect(result.request.plan.trialBreakdown.annualBonusDays).toBe(30);
    expect(result.request.sessionId).toBe(SESSION_ID);

    // Analytics: 12 step_view + 12 step_cta_click, zero step_drop
    const types = sink.captured.map((e) => e.type);
    const viewCount = types.filter((t) => t === 'step_view').length;
    const clickCount = types.filter((t) => t === 'step_cta_click').length;
    const dropCount = types.filter((t) => t === 'step_drop').length;
    expect(viewCount).toBe(TOTAL_FUNNEL_STEPS);
    expect(clickCount).toBe(TOTAL_FUNNEL_STEPS);
    expect(dropCount).toBe(0);

    // Orchestrator-side event log mirrors the sink one-for-one
    expect(orchestrator.events.map((e) => e.type)).toEqual(types);
  });

  it('emits step_view in canonical 1..12 order before any later step_view', () => {
    const { orchestrator, sink } = makeOrchestrator();
    runCanonicalKoreanFlow(orchestrator, {
      ratingChoice: 'submit',
      plan: 'annual',
    });
    const viewSteps = sink.captured
      .filter((e): e is StepViewEvent => e.type === 'step_view')
      .map((e) => e.stepId);
    expect(viewSteps).toEqual(FUNNEL_STEPS_ORDERED);
  });

  it('tags kr_variant on every analytics event for steps 10/11/12', () => {
    const { orchestrator, sink } = makeOrchestrator();
    runCanonicalKoreanFlow(orchestrator, {
      ratingChoice: 'submit',
      plan: 'annual',
    });
    for (const evt of sink.captured) {
      const expected = KR_VARIANT_STEPS.has(evt.stepId) ? 'kr_variant' : null;
      expect(evt.variantTag).toBe(expected);
    }
  });

  it('records a step_cta_click for the chosen CTA on each step', () => {
    const { orchestrator, sink } = makeOrchestrator();
    runCanonicalKoreanFlow(orchestrator, {
      ratingChoice: 'submit',
      plan: 'annual',
    });
    const clicks = sink.captured.filter(
      (e): e is StepCtaClickEvent => e.type === 'step_cta_click',
    );
    expect(clicks).toHaveLength(TOTAL_FUNNEL_STEPS);
    // For non-rating/non-payment steps the first CTA is taken.
    // For rating_gate, the submit_rating CTA is taken.
    // For payment_model, the select_annual CTA is taken.
    clicks.forEach((click, idx) => {
      const stepId = FUNNEL_STEPS_ORDERED[idx] as FunnelStepId;
      expect(click.stepId).toBe(stepId);
      if (stepId === 'rating_gate') {
        expect(click.ctaAction).toBe('submit_rating');
      } else if (stepId === 'payment_model') {
        expect(click.ctaAction).toBe('select_annual');
      } else {
        const expectedFirstCta = FUNNEL_SCREENS[stepId].ctas[0] as FunnelCta;
        expect(click.ctaAction).toBe(expectedFirstCta.action);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Skip-rating-gate variant
// ---------------------------------------------------------------------------

describe('orchestrator — skip-rating-gate happy path', () => {
  it('still reaches `completed` with rating_gate skipped (the lone skippable step)', () => {
    const { orchestrator, sink, gateway } = makeOrchestrator();
    runCanonicalKoreanFlow(orchestrator, {
      ratingChoice: 'skip',
      plan: 'monthly',
    });

    expect(orchestrator.machine.state).toBe('completed');
    expect(gateway.initiate).toHaveBeenCalledTimes(1);

    // rating_gate is NOT in completedSteps when skipped
    expect(orchestrator.machine.completedSteps).not.toContain('rating_gate');
    expect(orchestrator.machine.completedSteps).toContain('welcome_hook');
    expect(orchestrator.machine.completedSteps).toContain('payment_model');

    // The rating_gate click event still fires (dismiss CTA) for analytics
    const clicks = sink.captured.filter(
      (e): e is StepCtaClickEvent => e.type === 'step_cta_click',
    );
    const ratingClick = clicks.find((c) => c.stepId === 'rating_gate');
    expect(ratingClick).toBeDefined();
    expect(ratingClick?.ctaAction).toBe('skip');
    expect(ratingClick?.ctaVariant).toBe('dismiss');
  });

  it('monthly plan: $12 / 0-day trial reaches the gateway', () => {
    const { orchestrator, gateway } = makeOrchestrator();
    const result = runCanonicalKoreanFlow(orchestrator, {
      ratingChoice: 'skip',
      plan: 'monthly',
    });

    expect(result.request.plan).toBe(PAYMENT_PLAN_CATALOGUE.monthly);
    expect(result.request.plan.priceUsd).toBe(12);
    expect(result.request.plan.trialDays).toBe(0);
    expect(result.request.plan.trialBreakdown.baseTrialDays).toBe(0);
    expect(result.request.plan.trialBreakdown.annualBonusDays).toBe(0);
    expect(gateway.initiate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Manual sequence walk — every screen is reachable, every snapshot frozen
// ---------------------------------------------------------------------------

describe('orchestrator — manual step-by-step walk', () => {
  it('exposes the matching screen at every step entry', () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.start();
    expect(orchestrator.currentScreen?.stepNumber).toBe(1);

    for (let i = 0; i < TOTAL_FUNNEL_STEPS - 1; i += 1) {
      const stepId = FUNNEL_STEPS_ORDERED[i] as FunnelStepId;
      expect(orchestrator.currentScreen?.stepId).toBe(stepId);

      // Take the first CTA, except rating_gate which we'll skip
      if (stepId === 'rating_gate') {
        orchestrator.skipCurrentStep();
      } else {
        const cta = FUNNEL_SCREENS[stepId].ctas[0] as FunnelCta;
        orchestrator.selectCta(cta);
      }

      const nextStepId = FUNNEL_STEPS_ORDERED[i + 1] as FunnelStepId;
      expect(orchestrator.machine.state).toBe(nextStepId);
      expect(orchestrator.currentScreen?.stepId).toBe(nextStepId);
    }
  });

  it('keeps every machine snapshot frozen and never mutates the previous one', () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.start();
    const before = orchestrator.machine;
    expect(Object.isFrozen(before)).toBe(true);
    const beforeHistoryLen = before.history.length;
    const beforeCompletedLen = before.completedSteps.length;

    orchestrator.selectCta(FUNNEL_SCREENS.welcome_hook.ctas[0] as FunnelCta);
    const after = orchestrator.machine;

    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    // Previous snapshot untouched
    expect(before.history.length).toBe(beforeHistoryLen);
    expect(before.completedSteps.length).toBe(beforeCompletedLen);
    expect(before.state).toBe('welcome_hook');
    expect(after.state).toBe('value_props');
  });
});

// ---------------------------------------------------------------------------
// Abandon
// ---------------------------------------------------------------------------

describe('orchestrator.abandon', () => {
  it('emits step_drop and transitions to abandoned', () => {
    const { orchestrator, sink } = makeOrchestrator();
    orchestrator.start();
    orchestrator.selectCta(FUNNEL_SCREENS.welcome_hook.ctas[0] as FunnelCta);
    // Now on value_props (step 2)
    expect(orchestrator.machine.state).toBe('value_props');

    orchestrator.abandon('share_dialog_closed');
    expect(orchestrator.machine.state).toBe('abandoned');
    expect(orchestrator.currentScreen).toBeNull();
    expect(orchestrator.progress.isAbandoned).toBe(true);

    const drop = sink.captured.find((e): e is StepDropEvent => e.type === 'step_drop');
    expect(drop).toBeDefined();
    expect(drop?.stepId).toBe('value_props');
    expect(drop?.stepNumber).toBe(2);
    expect(drop?.reason).toBe('share_dialog_closed');
  });

  it('defaults reason to "user_abandon" when none is supplied', () => {
    const { orchestrator, sink } = makeOrchestrator();
    orchestrator.start();
    orchestrator.abandon();
    const drop = sink.captured.find((e): e is StepDropEvent => e.type === 'step_drop');
    expect(drop?.reason).toBe('user_abandon');
  });

  it('throws when called from a terminal state', () => {
    const { orchestrator } = makeOrchestrator();
    expect(() => orchestrator.abandon()).toThrow(/active funnel step/i);
  });
});

// ---------------------------------------------------------------------------
// triggerPayment — guard propagation + gateway invocation contract
// ---------------------------------------------------------------------------

describe('orchestrator.triggerPayment', () => {
  it('throws CheckoutGuardError when machine is not on payment_model — gateway untouched', () => {
    const { orchestrator, gateway } = makeOrchestrator();
    orchestrator.start();
    // Still on welcome_hook (step 1)
    expect(() => orchestrator.triggerPayment('annual')).toThrow(CheckoutGuardError);
    expect(gateway.initiate).not.toHaveBeenCalled();
  });

  it('on gateway failure, does NOT advance the machine past payment_model', () => {
    const failingGateway = makeMockGateway({
      status: 'failed',
      redirectUrl: null,
      providerRef: null,
    });
    const { orchestrator } = makeOrchestrator({ gateway: failingGateway });

    runCanonicalKoreanFlow(orchestrator, {
      ratingChoice: 'submit',
      plan: 'annual',
    });

    // Gateway was called but reported failure → still on payment_model
    expect(failingGateway.initiate).toHaveBeenCalledTimes(1);
    expect(orchestrator.machine.state).toBe('payment_model');
    expect(orchestrator.progress.isComplete).toBe(false);
  });

  it('emits step_cta_click for select_monthly when plan=monthly is selected', () => {
    const { orchestrator, sink } = makeOrchestrator();
    // Walk to payment_model manually
    orchestrator.start();
    for (let i = 0; i < TOTAL_FUNNEL_STEPS - 1; i += 1) {
      const stepId = FUNNEL_STEPS_ORDERED[i] as FunnelStepId;
      if (stepId === 'rating_gate') {
        orchestrator.skipCurrentStep();
      } else {
        const cta = FUNNEL_SCREENS[stepId].ctas[0] as FunnelCta;
        orchestrator.selectCta(cta);
      }
    }
    expect(orchestrator.machine.state).toBe('payment_model');

    orchestrator.triggerPayment('monthly');

    const monthlyClick = sink.captured.find(
      (e): e is StepCtaClickEvent =>
        e.type === 'step_cta_click' && e.stepId === 'payment_model',
    );
    expect(monthlyClick).toBeDefined();
    expect(monthlyClick?.ctaAction).toBe('select_monthly');
    expect(monthlyClick?.ctaVariant).toBe('secondary');
    expect(monthlyClick?.variantTag).toBe('kr_variant');
  });
});

// ---------------------------------------------------------------------------
// Defensive validation
// ---------------------------------------------------------------------------

describe('orchestrator — defensive validation', () => {
  it('rejects a CTA that does not belong to the current step', () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.start();
    // welcome_hook is step 1; payment_model.ctas[0] does not belong here
    const wrongCta = FUNNEL_SCREENS.payment_model.ctas[0] as FunnelCta;
    expect(() => orchestrator.selectCta(wrongCta)).toThrow(
      /not registered on step welcome_hook/i,
    );
  });

  it('selectCta throws from a terminal state', () => {
    const { orchestrator } = makeOrchestrator();
    expect(() =>
      orchestrator.selectCta(FUNNEL_SCREENS.welcome_hook.ctas[0] as FunnelCta),
    ).toThrow(/active funnel step/i);
  });

  it('skipCurrentStep throws when step is not skippable', () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.start();
    // welcome_hook is not skippable
    expect(() => orchestrator.skipCurrentStep()).toThrow(/not skippable/i);
  });

  it('skipCurrentStep throws from a terminal state', () => {
    const { orchestrator } = makeOrchestrator();
    expect(() => orchestrator.skipCurrentStep()).toThrow(/active funnel step/i);
  });
});

// ---------------------------------------------------------------------------
// runCanonicalKoreanFlow guards
// ---------------------------------------------------------------------------

describe('runCanonicalKoreanFlow', () => {
  it('refuses to run on an orchestrator that has already started', () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.start();
    expect(() =>
      runCanonicalKoreanFlow(orchestrator, {
        ratingChoice: 'submit',
        plan: 'annual',
      }),
    ).toThrow(/requires an idle orchestrator/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting analytics ordering invariant — defends Seed north-star metric
// ---------------------------------------------------------------------------

describe('orchestrator — analytics ordering invariant', () => {
  it('per-step ordering is always step_view → step_cta_click → (next step) step_view', () => {
    const { orchestrator, sink } = makeOrchestrator();
    runCanonicalKoreanFlow(orchestrator, {
      ratingChoice: 'submit',
      plan: 'annual',
    });

    // The first event must be a view of step 1
    expect(sink.captured[0]?.type).toBe('step_view');
    expect(sink.captured[0]?.stepId).toBe('welcome_hook');

    // After each click (except the last one on payment_model), the next event
    // must be a view of the next step.
    for (let i = 0; i < sink.captured.length - 1; i += 1) {
      const curr = sink.captured[i];
      const next = sink.captured[i + 1];
      if (!curr || !next) continue;
      if (curr.type === 'step_cta_click' && curr.stepId !== 'payment_model') {
        expect(next.type).toBe('step_view');
        // The view step must be the canonical successor
        const currIdx = FUNNEL_STEPS_ORDERED.indexOf(curr.stepId);
        const expectedNext = FUNNEL_STEPS_ORDERED[currIdx + 1] as FunnelStepId;
        expect(next.stepId).toBe(expectedNext);
      }
    }
  });
});
