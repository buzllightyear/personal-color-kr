/**
 * Sub-AC 2.5 — End-to-end orchestrator for the Glam Up 12단계 결제 깔때기
 * (한국 변형).
 *
 * Single module that wires together every other funnel building-block into
 * one cohesive, externally-driven flow:
 *
 *   ┌──────────────────────┐
 *   │      Orchestrator    │
 *   ├──────────────────────┤
 *   │ state-machine.ts     │  ← canonical 1 → … → 12 transition rules
 *   │ screens.ts           │  ← Korean-variant copy / CTAs / metadata
 *   │ analytics.ts         │  ← step_view / step_cta_click / step_drop
 *   │ checkout.ts          │  ← paywall guard + Korean payment handoff
 *   └──────────────────────┘
 *
 * Why a thin orchestrator (and not "let each call site stitch them"):
 *   - Single source of truth for the event sequence — auto-emits step_view
 *     on every step entry, step_cta_click on every CTA, step_drop on every
 *     abandon. Call sites cannot forget an event.
 *   - Defends Seed invariants: 12-step skip/reorder ban, rating_gate-only
 *     skip exception, payment trigger only on step 12.
 *   - Provides a single seam to unit-/integration-test the whole Korean
 *     variant flow (the runnable integration test in
 *     `tests/funnel/orchestrator.test.ts`).
 *
 * Immutability contract:
 *   - All exposed state (machine snapshot, event log, progress) is frozen.
 *   - Internal `machine` field is replaced (not mutated) on every transition,
 *     matching the pure-functional state-machine semantics.
 *
 * Korean-variant fidelity (verified by the integration test):
 *   - The full canonical sequence 1 → 12 is reachable via orchestrator API.
 *   - Steps 10 / 11 / 12 carry `variantTag: 'kr_variant'` on their analytics
 *     payloads (asserted at every emission site).
 *   - The annual plan trial = 7 + 30 = 37 days flows from screens.ts →
 *     checkout.ts → orchestrator handoff result unchanged.
 *   - Skipping `rating_gate` (the lone iOS-native dialog) does NOT block
 *     checkout downstream.
 */
import {
  FUNNEL_STEPS_ORDERED,
  TOTAL_FUNNEL_STEPS,
  type FunnelMachine,
  type FunnelProgress,
  type FunnelStepId,
} from './types.js';
import {
  abandonFunnel,
  advanceStep,
  createFunnel,
  getProgress,
  skipStep,
  startFunnel,
} from './state-machine.js';
import {
  FUNNEL_SCREENS,
  renderStep,
  type FunnelCta,
  type FunnelScreen,
} from './screens.js';
import {
  createFunnelAnalytics,
  type AnalyticsSink,
  type FunnelAnalytics,
  type FunnelAnalyticsEvent,
} from './analytics.js';
import {
  triggerCheckout,
  type PaymentGateway,
  type PaymentPlanId,
  type TriggerCheckoutResult,
} from './checkout.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * CTA actions that simply advance the funnel one step.  Pulled from the
 * `FunnelCtaAction` union; intentionally enumerated here so a future new
 * action type fails the compile until orchestrator semantics are decided.
 */
const ADVANCE_ACTIONS: ReadonlySet<FunnelCta['action']> = new Set<
  FunnelCta['action']
>([
  'advance',
  'submit_rating',
  'select_scan_personal_color',
  'select_scan_secondary',
  'upload_selfie',
  'auto_advance',
  'unlock_result',
  'share_referral',
]);

/**
 * Options to construct an orchestrator.  All collaborators are injected so
 * the orchestrator stays pure and easy to test.
 */
export interface CreateFunnelOrchestratorOptions {
  readonly sessionId: string;
  readonly analyticsSink: AnalyticsSink;
  readonly paymentGateway: PaymentGateway;
  /** Injectable clock — defaults to `Date.now`. */
  readonly now?: () => number;
  /** Injectable handoff-id provider for the checkout module. */
  readonly handoffIdProvider?: () => string;
}

/**
 * Public façade returned by {@link createFunnelOrchestrator}.  Every method
 * is intentionally narrow so the orchestrator's contract is the entire 12-
 * step Korean-variant flow surface — no escape hatches.
 */
export interface FunnelOrchestrator {
  /** Current frozen machine snapshot. */
  readonly machine: FunnelMachine;
  /** Current frozen progress projection. */
  readonly progress: FunnelProgress;
  /**
   * Current step screen, or `null` when the machine is in a terminal state
   * (`idle`, `completed`, `abandoned`).
   */
  readonly currentScreen: FunnelScreen | null;
  /** Append-only log of every analytics event the orchestrator has emitted. */
  readonly events: readonly FunnelAnalyticsEvent[];

  /**
   * Transition `idle → welcome_hook` and emit `step_view` for step 1.
   * Throws if the orchestrator has already been started.
   */
  start(): void;

  /**
   * Activate a CTA on the current step.  Validates that the CTA belongs to
   * the current screen, emits `step_cta_click`, then performs the right
   * machine transition:
   *
   *   - `skip`            → `skipStep` (only valid for `rating_gate`)
   *   - `select_monthly` / `select_annual` → no transition; caller is
   *     expected to call {@link triggerPayment} next
   *   - everything else   → `advanceStep`
   *
   * On every step entry caused by this call, `step_view` is emitted for the
   * newly entered step.  When the machine transitions to `completed` (after
   * step 12) no `step_view` is emitted — there's no step to view.
   */
  selectCta(cta: FunnelCta): void;

  /**
   * Skip the current step.  Equivalent to calling {@link selectCta} with the
   * step's `dismiss`-variant CTA, but throws a clearer error if the current
   * step is not skippable (anything other than `rating_gate`).
   */
  skipCurrentStep(): void;

  /**
   * Abandon the funnel from any active step.  Emits `step_drop` first, then
   * transitions the machine to `abandoned`.  No-ops are not allowed: calling
   * this from a terminal state throws.
   */
  abandon(reason?: string): void;

  /**
   * Initiate the Korean payment handoff for the given plan.  Must be called
   * while the machine is on `payment_model` (step 12).  Performs:
   *
   *   1. Emits `step_cta_click` for the matching CTA on `payment_model`.
   *   2. Calls the underlying {@link triggerCheckout} (which validates
   *      machine state, completed prior steps, and plan id).
   *   3. On gateway success (`status: 'initiated'`), advances the machine
   *      to `completed`.  On gateway failure, leaves the machine on
   *      `payment_model` so the user can retry.
   *
   * Any {@link CheckoutGuardError} thrown by the checkout module propagates
   * untouched — callers can distinguish failure modes via `err.reason`.
   */
  triggerPayment(plan: PaymentPlanId): TriggerCheckoutResult;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isStepId(state: FunnelMachine['state']): state is FunnelStepId {
  return state in FUNNEL_SCREENS;
}

function ctaForPlan(plan: PaymentPlanId): FunnelCta {
  const action: FunnelCta['action'] =
    plan === 'monthly' ? 'select_monthly' : 'select_annual';
  const cta = FUNNEL_SCREENS.payment_model.ctas.find((c) => c.action === action);
  if (!cta) {
    // Defensive: should be impossible because both CTAs are registered in
    // screens.ts and the type system rejects plans outside monthly|annual.
    throw new Error(
      `payment_model screen is missing CTA for plan "${plan}"`,
    );
  }
  return cta;
}

function findCtaOnScreen(
  screen: FunnelScreen,
  cta: FunnelCta,
): FunnelCta | undefined {
  return screen.ctas.find(
    (c) =>
      c.action === cta.action &&
      c.variant === cta.variant &&
      c.label === cta.label,
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct a stateful orchestrator instance.  The instance keeps its
 * internal pointer to the latest frozen `FunnelMachine` and re-emits
 * the event sequence (`step_view`, `step_cta_click`, `step_drop`) on every
 * transition so callers do not need to remember which event fires where.
 */
export function createFunnelOrchestrator(
  options: CreateFunnelOrchestratorOptions,
): FunnelOrchestrator {
  const clock: () => number = options.now ?? Date.now;

  const analytics: FunnelAnalytics = createFunnelAnalytics({
    sink: options.analyticsSink,
    sessionId: options.sessionId,
    now: clock,
  });

  // Mutable bindings — the *bindings* are reassigned to new frozen snapshots
  // on every transition.  The underlying data structures themselves are
  // never mutated (state-machine returns new frozen instances).
  let machine: FunnelMachine = createFunnel();
  const eventLog: FunnelAnalyticsEvent[] = [];

  // Wrap the analytics emitters so the orchestrator's own `events` log
  // mirrors what reached the sink.  The sink-side call still happens inside
  // createFunnelAnalytics — we are NOT double-dispatching to the sink here.
  function recordViewIfStep(): void {
    if (isStepId(machine.state)) {
      const evt = analytics.emitStepView(machine.state);
      eventLog.push(evt);
    }
  }

  function recordCtaClick(stepId: FunnelStepId, cta: FunnelCta): void {
    const evt = analytics.emitStepCtaClick(stepId, cta);
    eventLog.push(evt);
  }

  function recordDrop(stepId: FunnelStepId, reason: string): void {
    const evt = analytics.emitStepDrop(stepId, reason);
    eventLog.push(evt);
  }

  function snapshotProgress(): FunnelProgress {
    return getProgress(machine);
  }

  function currentScreen(): FunnelScreen | null {
    if (!isStepId(machine.state)) return null;
    return renderStep(machine.state);
  }

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  function start(): void {
    if (machine.state !== 'idle') {
      throw new Error(
        `Cannot start orchestrator: machine already in state "${machine.state}"`,
      );
    }
    machine = startFunnel(machine);
    recordViewIfStep();
  }

  function selectCta(cta: FunnelCta): void {
    if (!isStepId(machine.state)) {
      throw new Error(
        `selectCta requires an active funnel step; current state: ${machine.state}`,
      );
    }
    const currentStepId = machine.state;
    const screen = renderStep(currentStepId);
    const match = findCtaOnScreen(screen, cta);
    if (!match) {
      throw new Error(
        `CTA {action: ${cta.action}, variant: ${cta.variant}} not registered on step ${currentStepId}`,
      );
    }

    // Emit BEFORE the transition so the click is recorded against the step
    // the user was on at the moment of interaction.
    recordCtaClick(currentStepId, match);

    // Payment-plan CTAs do NOT auto-advance.  The caller drives the handoff
    // via `triggerPayment(plan)`, which is where the gateway invocation +
    // post-success advance to `completed` actually happens.
    if (match.action === 'select_monthly' || match.action === 'select_annual') {
      return;
    }

    if (match.action === 'skip') {
      machine = skipStep(machine);
    } else if (ADVANCE_ACTIONS.has(match.action)) {
      machine = advanceStep(machine);
    } else {
      // Should be unreachable given the union types, but fail loudly.
      throw new Error(`Unhandled CTA action: ${match.action as string}`);
    }

    recordViewIfStep();
  }

  function skipCurrentStep(): void {
    if (!isStepId(machine.state)) {
      throw new Error(
        `skipCurrentStep requires an active funnel step; current state: ${machine.state}`,
      );
    }
    const screen = renderStep(machine.state);
    const dismissCta = screen.ctas.find((c) => c.variant === 'dismiss');
    if (!dismissCta) {
      throw new Error(
        `Step ${machine.state} is not skippable (no dismiss-variant CTA)`,
      );
    }
    selectCta(dismissCta);
  }

  function abandon(reason: string = 'user_abandon'): void {
    if (!isStepId(machine.state)) {
      throw new Error(
        `abandon requires an active funnel step; current state: ${machine.state}`,
      );
    }
    recordDrop(machine.state, reason);
    machine = abandonFunnel(machine);
  }

  function triggerPayment(plan: PaymentPlanId): TriggerCheckoutResult {
    // Emit the matching CTA click first so the funnel analytics record the
    // user's plan selection even when the gateway later rejects the call.
    if (machine.state === 'payment_model') {
      recordCtaClick('payment_model', ctaForPlan(plan));
    }

    // Delegate guard + handoff to the checkout module — single source of
    // truth for payment-step entry conditions.
    const result = triggerCheckout({
      machine,
      plan,
      sessionId: options.sessionId,
      gateway: options.paymentGateway,
      now: clock,
      ...(options.handoffIdProvider !== undefined
        ? { handoffIdProvider: options.handoffIdProvider }
        : {}),
    });

    // On gateway success, fold the funnel forward to `completed`.  On
    // failure leave the machine on `payment_model` so the user can retry
    // (and emit no additional analytics — `step_view` only fires on entry).
    if (result.response.status === 'initiated') {
      machine = advanceStep(machine);
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Façade
  // -----------------------------------------------------------------------

  // Use a getter-based object so consumers always see the latest snapshot
  // without needing to re-call a method.  Frozen at the outer level; nested
  // values are already frozen by their respective constructors.
  const orchestrator: FunnelOrchestrator = Object.freeze({
    get machine() {
      return machine;
    },
    get progress() {
      return snapshotProgress();
    },
    get currentScreen() {
      return currentScreen();
    },
    get events(): readonly FunnelAnalyticsEvent[] {
      return Object.freeze([...eventLog]);
    },
    start,
    selectCta,
    skipCurrentStep,
    abandon,
    triggerPayment,
  });

  return orchestrator;
}

// ---------------------------------------------------------------------------
// Convenience: a canonical Korean-variant happy-path runner
// ---------------------------------------------------------------------------

/**
 * Drives an orchestrator through the canonical happy-path sequence:
 *
 *   start → 1 → 2 → 3 → 4 (skipped or submitted) → 5 → 6 → 7 → 8 → 9 →
 *   10 → 11 → 12 → triggerPayment(plan)
 *
 * The chosen path is parameterised by `ratingChoice`:
 *   - `'submit'` activates the `submit_rating` CTA (advance)
 *   - `'skip'`   activates the `dismiss` CTA (state-machine `skipStep`)
 *
 * Returns the orchestrator (already at `completed` on success) plus the
 * gateway handoff result for assertion.  All Korean-variant invariants are
 * exercised: the 12-step sequence, the dismiss-variant skip path, the
 * Korean payment handoff with monthly/annual pricing.
 */
export function runCanonicalKoreanFlow(
  orchestrator: FunnelOrchestrator,
  config: {
    readonly ratingChoice: 'submit' | 'skip';
    readonly plan: PaymentPlanId;
  },
): TriggerCheckoutResult {
  if (orchestrator.machine.state !== 'idle') {
    throw new Error(
      `runCanonicalKoreanFlow requires an idle orchestrator; got ${orchestrator.machine.state}`,
    );
  }
  orchestrator.start();

  // FUNNEL_STEPS_ORDERED.length is the 12-step constant.
  for (let i = 0; i < TOTAL_FUNNEL_STEPS; i += 1) {
    const stepId = FUNNEL_STEPS_ORDERED[i] as FunnelStepId;
    const screen = FUNNEL_SCREENS[stepId];

    if (stepId === 'payment_model') {
      // Last step is paid; orchestrator.triggerPayment drives the final
      // transition + records analytics.
      return orchestrator.triggerPayment(config.plan);
    }

    if (stepId === 'rating_gate' && config.ratingChoice === 'skip') {
      orchestrator.skipCurrentStep();
      continue;
    }
    if (stepId === 'rating_gate' && config.ratingChoice === 'submit') {
      const submit = screen.ctas.find((c) => c.action === 'submit_rating');
      if (!submit) throw new Error('rating_gate missing submit_rating CTA');
      orchestrator.selectCta(submit);
      continue;
    }

    // Primary CTA — the first one — drives the canonical advance at every
    // other step.  All steps are required to have at least one CTA.
    const primaryCta = screen.ctas[0];
    if (!primaryCta) {
      throw new Error(`Step ${stepId} has no CTAs to advance with`);
    }
    orchestrator.selectCta(primaryCta);
  }

  // Unreachable: payment_model is the terminal iteration and always returns.
  throw new Error('runCanonicalKoreanFlow: loop exited without triggering payment');
}
