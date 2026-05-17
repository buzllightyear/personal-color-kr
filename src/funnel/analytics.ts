/**
 * Funnel analytics / event emission module — Glam Up 12단계 결제 깔때기 (한국 변형).
 *
 * Single source of truth for the three PostHog-bound funnel telemetry events:
 *
 *   - `step_view`        — fires when a user lands on a step
 *   - `step_cta_click`   — fires when a user taps a CTA on a step
 *   - `step_drop`        — fires when a user drops off at a step
 *
 * Wraps an injectable {@link AnalyticsSink} so the module is unit-testable
 * (vi.fn sink) and provider-agnostic in production (PostHog, mixpanel, an
 * in-house warehouse, etc.).  Time is injected via `now` for deterministic
 * tests; falls back to `Date.now()` when omitted.
 *
 * Design choices:
 *   - Events are frozen — defence-in-depth against accidental mutation
 *     before they reach the wire.
 *   - `variantTag` is read from `FUNNEL_SCREENS` so renderer and analytics
 *     can never drift — single source of truth wins.
 *   - CTA-click payloads validate the supplied CTA belongs to the step;
 *     a stray click on the wrong step throws loudly instead of polluting
 *     the funnel north-star metric.
 *   - Unknown step ids throw loudly so analytics never reports ghost steps.
 */
import {
  FUNNEL_STEPS_ORDERED,
  type FunnelStepId,
} from './types.js';
import {
  FUNNEL_SCREENS,
  type FunnelCta,
  type FunnelCtaAction,
  type FunnelCtaVariant,
  type FunnelVariantTag,
} from './screens.js';

// ---------------------------------------------------------------------------
// Public contract — event types
// ---------------------------------------------------------------------------

/**
 * The three telemetry events emitted per the funnel analytics spec.
 * Order is part of the contract — downstream PostHog dashboards rely on it.
 */
export const FUNNEL_ANALYTICS_EVENT_TYPES = Object.freeze([
  'step_view',
  'step_cta_click',
  'step_drop',
] as const);

export type FunnelAnalyticsEventType =
  (typeof FUNNEL_ANALYTICS_EVENT_TYPES)[number];

/**
 * Fields every funnel analytics event carries.  Mapped to PostHog event
 * properties 1:1.
 */
interface FunnelAnalyticsBasePayload {
  readonly stepId: FunnelStepId;
  readonly stepNumber: number;            // 1..12
  readonly timestamp: number;             // ms epoch
  readonly sessionId: string;
  readonly variantTag: FunnelVariantTag | null;
}

export interface StepViewEvent extends FunnelAnalyticsBasePayload {
  readonly type: 'step_view';
}

export interface StepCtaClickEvent extends FunnelAnalyticsBasePayload {
  readonly type: 'step_cta_click';
  readonly ctaAction: FunnelCtaAction;
  readonly ctaVariant: FunnelCtaVariant;
  readonly ctaLabel: string;
}

export interface StepDropEvent extends FunnelAnalyticsBasePayload {
  readonly type: 'step_drop';
  readonly reason: string;
}

export type FunnelAnalyticsEvent =
  | StepViewEvent
  | StepCtaClickEvent
  | StepDropEvent;

/**
 * Pluggable sink — PostHog client in prod, a vi.fn / array recorder in tests.
 * Single method keeps the integration surface tiny and substitutable.
 */
export interface AnalyticsSink {
  capture(event: FunnelAnalyticsEvent): void;
}

export interface CreateFunnelAnalyticsOptions {
  readonly sink: AnalyticsSink;
  readonly sessionId: string;
  /** Injectable clock; defaults to `Date.now`. */
  readonly now?: () => number;
}

export interface FunnelAnalytics {
  emitStepView(stepId: FunnelStepId): StepViewEvent;
  emitStepCtaClick(stepId: FunnelStepId, cta: FunnelCta): StepCtaClickEvent;
  emitStepDrop(stepId: FunnelStepId, reason?: string): StepDropEvent;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const STEP_INDEX: ReadonlyMap<FunnelStepId, number> = new Map(
  FUNNEL_STEPS_ORDERED.map((step, idx) => [step, idx]),
);

function lookupStep(stepId: FunnelStepId): {
  stepNumber: number;
  variantTag: FunnelVariantTag | null;
} {
  const idx = STEP_INDEX.get(stepId);
  if (idx === undefined) {
    throw new Error(`Unknown funnel step id: ${String(stepId)}`);
  }
  // FUNNEL_SCREENS is exhaustive over FunnelStepId, but be defensive.
  const screen = FUNNEL_SCREENS[stepId];
  return {
    stepNumber: idx + 1,
    variantTag: screen.variantTag,
  };
}

function assertCtaBelongsToStep(stepId: FunnelStepId, cta: FunnelCta): void {
  const screen = FUNNEL_SCREENS[stepId];
  const match = screen.ctas.find(
    (c) =>
      c.action === cta.action &&
      c.variant === cta.variant &&
      c.label === cta.label,
  );
  if (!match) {
    throw new Error(
      `CTA {action: ${cta.action}, variant: ${cta.variant}} not registered on step ${stepId}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Creates a funnel analytics emitter bound to the supplied sink + session.
 * Every emit method also forwards to the sink, so callers can either:
 *   - use the returned event object directly (rare — mostly tests), or
 *   - rely on the sink wiring (production path).
 */
export function createFunnelAnalytics(
  options: CreateFunnelAnalyticsOptions,
): FunnelAnalytics {
  const clock: () => number = options.now ?? Date.now;
  const { sink, sessionId } = options;

  function baseFields(stepId: FunnelStepId): FunnelAnalyticsBasePayload {
    const { stepNumber, variantTag } = lookupStep(stepId);
    return {
      stepId,
      stepNumber,
      timestamp: clock(),
      sessionId,
      variantTag,
    };
  }

  function emitStepView(stepId: FunnelStepId): StepViewEvent {
    const event: StepViewEvent = Object.freeze({
      type: 'step_view',
      ...baseFields(stepId),
    });
    sink.capture(event);
    return event;
  }

  function emitStepCtaClick(
    stepId: FunnelStepId,
    cta: FunnelCta,
  ): StepCtaClickEvent {
    // Validates stepId first (lookupStep throws on unknown), then CTA membership.
    const base = baseFields(stepId);
    assertCtaBelongsToStep(stepId, cta);

    const event: StepCtaClickEvent = Object.freeze({
      type: 'step_cta_click',
      ...base,
      ctaAction: cta.action,
      ctaVariant: cta.variant,
      ctaLabel: cta.label,
    });
    sink.capture(event);
    return event;
  }

  function emitStepDrop(
    stepId: FunnelStepId,
    reason: string = 'user_abandon',
  ): StepDropEvent {
    const event: StepDropEvent = Object.freeze({
      type: 'step_drop',
      ...baseFields(stepId),
      reason,
    });
    sink.capture(event);
    return event;
  }

  return Object.freeze({
    emitStepView,
    emitStepCtaClick,
    emitStepDrop,
  });
}
