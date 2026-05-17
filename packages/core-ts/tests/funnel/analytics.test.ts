/**
 * Unit tests — funnel analytics / event emission module.
 *
 * Sub-AC 3: Single module that fires `step_view`, `step_cta_click`, and
 * `step_drop` events for each of the 12 Glam Up funnel steps (한국 변형).
 *
 * The module wraps a pluggable `AnalyticsSink` (PostHog in production, vi.fn
 * in tests) and produces immutable, fully-typed event payloads carrying the
 * minimal contract every downstream consumer (PostHog, internal dashboards,
 * funnel north-star metric calculation) relies on:
 *
 *   - type            — 'step_view' | 'step_cta_click' | 'step_drop'
 *   - stepId          — canonical FunnelStepId (1..12)
 *   - stepNumber      — 1..12, matching FUNNEL_STEPS_ORDERED
 *   - timestamp       — injectable `now` clock for test determinism
 *   - sessionId       — passed-through session identifier
 *   - variantTag      — 'kr_variant' for steps 10/11/12, null otherwise
 *
 * Event-type-specific fields:
 *   - step_cta_click  — ctaAction, ctaVariant, ctaLabel
 *   - step_drop       — reason (optional)
 *
 * Invariants under test:
 *   1. All three event types exist, are exported, and produce the expected
 *      payload shape (assertion-level test of every property).
 *   2. Every step (1..12) can emit all three event types.
 *   3. Korean-variant steps (10/11/12) carry `variantTag: 'kr_variant'`;
 *      all others carry `variantTag: null`.
 *   4. CTA-click payload mirrors the FUNNEL_SCREENS source of truth — no
 *      drift between screen renderer and analytics.
 *   5. Events are forwarded to the injected sink in order, exactly once.
 *   6. Events are frozen (defence-in-depth immutability).
 *   7. `now` is injectable; falls back to Date.now() when omitted.
 *   8. Unknown step ids throw — fail loudly so analytics never reports a
 *      ghost step number to PostHog.
 *   9. CTAs not belonging to the supplied step are rejected (prevents
 *      analytics drift between renderer and emitter).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FUNNEL_STEPS_ORDERED,
  TOTAL_FUNNEL_STEPS,
  type FunnelStepId,
} from '../../src/funnel/types.js';
import {
  FUNNEL_SCREENS,
  type FunnelCta,
} from '../../src/funnel/screens.js';
import {
  FUNNEL_ANALYTICS_EVENT_TYPES,
  createFunnelAnalytics,
  type AnalyticsSink,
  type FunnelAnalyticsEvent,
  type StepCtaClickEvent,
  type StepDropEvent,
  type StepViewEvent,
} from '../../src/funnel/analytics.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const FIXED_NOW = 1_715_000_000_000; // 2024-05-06T11:33:20Z, deterministic
const SESSION_ID = 'sess_test_01';

function makeAnalytics(now: number = FIXED_NOW) {
  const sink = makeMockSink();
  const analytics = createFunnelAnalytics({
    sink,
    sessionId: SESSION_ID,
    now: () => now,
  });
  return { analytics, sink };
}

const KR_VARIANT_STEPS: ReadonlySet<FunnelStepId> = new Set<FunnelStepId>([
  'referral_gate',
  'social_evolution',
  'payment_model',
]);

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

describe('FUNNEL_ANALYTICS_EVENT_TYPES', () => {
  it('exports the three required analytics event types in stable order', () => {
    expect(FUNNEL_ANALYTICS_EVENT_TYPES).toEqual([
      'step_view',
      'step_cta_click',
      'step_drop',
    ]);
  });

  it('is frozen — consumers cannot mutate the analytics contract', () => {
    expect(Object.isFrozen(FUNNEL_ANALYTICS_EVENT_TYPES)).toBe(true);
  });
});

describe('createFunnelAnalytics — initialization', () => {
  it('returns an object exposing emitStepView, emitStepCtaClick, emitStepDrop', () => {
    const { analytics } = makeAnalytics();
    expect(typeof analytics.emitStepView).toBe('function');
    expect(typeof analytics.emitStepCtaClick).toBe('function');
    expect(typeof analytics.emitStepDrop).toBe('function');
  });

  it('does NOT emit any event during construction (lazy/eager separation)', () => {
    const { sink } = makeAnalytics();
    expect(sink.captured).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// step_view
// ---------------------------------------------------------------------------

describe('emitStepView — payload assertion', () => {
  it('produces a step_view event with the full required payload shape', () => {
    const { analytics, sink } = makeAnalytics();
    const event = analytics.emitStepView('welcome_hook');

    const expected: StepViewEvent = {
      type: 'step_view',
      stepId: 'welcome_hook',
      stepNumber: 1,
      timestamp: FIXED_NOW,
      sessionId: SESSION_ID,
      variantTag: null,
    };
    expect(event).toEqual(expected);
    expect(sink.captured).toHaveLength(1);
    expect(sink.captured[0]).toBe(event);
  });

  it('emits step_view with kr_variant tag for the three Korean-variant steps', () => {
    const { analytics } = makeAnalytics();
    for (const stepId of FUNNEL_STEPS_ORDERED) {
      const event = analytics.emitStepView(stepId);
      const expectedTag = KR_VARIANT_STEPS.has(stepId) ? 'kr_variant' : null;
      expect(event.variantTag).toBe(expectedTag);
    }
  });

  it('emits a step_view for every one of the 12 steps with correct stepNumber', () => {
    const { analytics, sink } = makeAnalytics();
    for (const stepId of FUNNEL_STEPS_ORDERED) {
      analytics.emitStepView(stepId);
    }
    expect(sink.captured).toHaveLength(TOTAL_FUNNEL_STEPS);
    sink.captured.forEach((evt, idx) => {
      expect(evt.type).toBe('step_view');
      expect(evt.stepId).toBe(FUNNEL_STEPS_ORDERED[idx]);
      expect(evt.stepNumber).toBe(idx + 1);
    });
  });

  it('returns frozen events (defence-in-depth immutability)', () => {
    const { analytics } = makeAnalytics();
    const event = analytics.emitStepView('welcome_hook');
    expect(Object.isFrozen(event)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// step_cta_click
// ---------------------------------------------------------------------------

describe('emitStepCtaClick — payload assertion', () => {
  it('produces a step_cta_click event with full CTA metadata', () => {
    const { analytics, sink } = makeAnalytics();
    const cta: FunnelCta = FUNNEL_SCREENS.welcome_hook.ctas[0] as FunnelCta;
    const event = analytics.emitStepCtaClick('welcome_hook', cta);

    const expected: StepCtaClickEvent = {
      type: 'step_cta_click',
      stepId: 'welcome_hook',
      stepNumber: 1,
      timestamp: FIXED_NOW,
      sessionId: SESSION_ID,
      variantTag: null,
      ctaAction: cta.action,
      ctaVariant: cta.variant,
      ctaLabel: cta.label,
    };
    expect(event).toEqual(expected);
    expect(sink.captured).toEqual([event]);
  });

  it('captures the dismiss CTA from rating_gate as ctaVariant=dismiss + action=skip', () => {
    const { analytics } = makeAnalytics();
    const dismissCta = FUNNEL_SCREENS.rating_gate.ctas.find(
      (c) => c.variant === 'dismiss',
    );
    expect(dismissCta).toBeDefined();
    const event = analytics.emitStepCtaClick('rating_gate', dismissCta as FunnelCta);
    expect(event.ctaAction).toBe('skip');
    expect(event.ctaVariant).toBe('dismiss');
    expect(event.stepNumber).toBe(4);
    expect(event.variantTag).toBeNull();
  });

  it('captures the annual-payment CTA from payment_model (KR variant)', () => {
    const { analytics } = makeAnalytics();
    const annualCta = FUNNEL_SCREENS.payment_model.ctas.find(
      (c) => c.action === 'select_annual',
    );
    expect(annualCta).toBeDefined();
    const event = analytics.emitStepCtaClick(
      'payment_model',
      annualCta as FunnelCta,
    );
    expect(event.ctaAction).toBe('select_annual');
    expect(event.stepNumber).toBe(12);
    expect(event.variantTag).toBe('kr_variant');
  });

  it('emits a step_cta_click for each step using its first CTA', () => {
    const { analytics, sink } = makeAnalytics();
    for (const stepId of FUNNEL_STEPS_ORDERED) {
      const cta = FUNNEL_SCREENS[stepId].ctas[0] as FunnelCta;
      analytics.emitStepCtaClick(stepId, cta);
    }
    expect(sink.captured).toHaveLength(TOTAL_FUNNEL_STEPS);
    sink.captured.forEach((evt, idx) => {
      expect(evt.type).toBe('step_cta_click');
      expect(evt.stepId).toBe(FUNNEL_STEPS_ORDERED[idx]);
      expect(evt.stepNumber).toBe(idx + 1);
    });
  });

  it('rejects a CTA that does not belong to the supplied step (prevents drift)', () => {
    const { analytics } = makeAnalytics();
    // welcome_hook never has a `select_annual` CTA — that belongs to step 12.
    const annualCta = FUNNEL_SCREENS.payment_model.ctas.find(
      (c) => c.action === 'select_annual',
    ) as FunnelCta;
    expect(() =>
      analytics.emitStepCtaClick('welcome_hook', annualCta),
    ).toThrow(/cta .* not registered on step welcome_hook/i);
  });

  it('returns frozen events', () => {
    const { analytics } = makeAnalytics();
    const cta = FUNNEL_SCREENS.welcome_hook.ctas[0] as FunnelCta;
    const event = analytics.emitStepCtaClick('welcome_hook', cta);
    expect(Object.isFrozen(event)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// step_drop
// ---------------------------------------------------------------------------

describe('emitStepDrop — payload assertion', () => {
  it('produces a step_drop event with default reason="user_abandon"', () => {
    const { analytics, sink } = makeAnalytics();
    const event = analytics.emitStepDrop('fake_loader');

    const expected: StepDropEvent = {
      type: 'step_drop',
      stepId: 'fake_loader',
      stepNumber: 8,
      timestamp: FIXED_NOW,
      sessionId: SESSION_ID,
      variantTag: null,
      reason: 'user_abandon',
    };
    expect(event).toEqual(expected);
    expect(sink.captured).toEqual([event]);
  });

  it('passes through a custom reason string', () => {
    const { analytics } = makeAnalytics();
    const event = analytics.emitStepDrop('referral_gate', 'share_dialog_closed');
    expect(event.reason).toBe('share_dialog_closed');
    expect(event.stepNumber).toBe(10);
    expect(event.variantTag).toBe('kr_variant');
  });

  it('emits a step_drop for every one of the 12 steps with correct stepNumber', () => {
    const { analytics, sink } = makeAnalytics();
    for (const stepId of FUNNEL_STEPS_ORDERED) {
      analytics.emitStepDrop(stepId);
    }
    expect(sink.captured).toHaveLength(TOTAL_FUNNEL_STEPS);
    sink.captured.forEach((evt, idx) => {
      expect(evt.type).toBe('step_drop');
      expect(evt.stepId).toBe(FUNNEL_STEPS_ORDERED[idx]);
      expect(evt.stepNumber).toBe(idx + 1);
    });
  });

  it('returns frozen events', () => {
    const { analytics } = makeAnalytics();
    const event = analytics.emitStepDrop('value_props');
    expect(Object.isFrozen(event)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting invariants
// ---------------------------------------------------------------------------

describe('sink contract', () => {
  it('forwards events to the sink in call order, exactly once', () => {
    const { analytics, sink } = makeAnalytics();
    const v = analytics.emitStepView('welcome_hook');
    const c = analytics.emitStepCtaClick(
      'welcome_hook',
      FUNNEL_SCREENS.welcome_hook.ctas[0] as FunnelCta,
    );
    const d = analytics.emitStepDrop('welcome_hook', 'manual_test');
    expect(sink.captured).toEqual([v, c, d]);
  });

  it('threads timestamps from the injected clock', () => {
    let t = 1000;
    const sink = makeMockSink();
    const analytics = createFunnelAnalytics({
      sink,
      sessionId: SESSION_ID,
      now: () => t++,
    });
    analytics.emitStepView('welcome_hook');
    analytics.emitStepView('value_props');
    analytics.emitStepView('social_proof_intro');
    expect(sink.captured.map((e) => e.timestamp)).toEqual([1000, 1001, 1002]);
  });

  it('threads the sessionId into every event', () => {
    const sink = makeMockSink();
    const analytics = createFunnelAnalytics({
      sink,
      sessionId: 'sess_unique_42',
      now: () => FIXED_NOW,
    });
    analytics.emitStepView('welcome_hook');
    analytics.emitStepCtaClick(
      'welcome_hook',
      FUNNEL_SCREENS.welcome_hook.ctas[0] as FunnelCta,
    );
    analytics.emitStepDrop('welcome_hook');
    expect(sink.captured.every((e) => e.sessionId === 'sess_unique_42')).toBe(true);
  });

  it('rejects an unknown step id (loud failure — no ghost analytics)', () => {
    const { analytics } = makeAnalytics();
    expect(() =>
      analytics.emitStepView('not_a_real_step' as FunnelStepId),
    ).toThrow(/unknown funnel step id/i);
    expect(() =>
      analytics.emitStepDrop('also_fake' as FunnelStepId),
    ).toThrow(/unknown funnel step id/i);
  });
});

describe('default clock fallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses Date.now() when `now` is not provided', () => {
    vi.useFakeTimers();
    const FAKE = new Date('2026-05-16T09:00:00Z').getTime();
    vi.setSystemTime(FAKE);

    const sink = makeMockSink();
    const analytics = createFunnelAnalytics({ sink, sessionId: SESSION_ID });
    const event = analytics.emitStepView('welcome_hook');
    expect(event.timestamp).toBe(FAKE);
  });
});

describe('every step × every event type — full 12 × 3 matrix', () => {
  it('emits a coherent payload for all 36 (step, event-type) combinations', () => {
    const { analytics, sink } = makeAnalytics();
    for (const stepId of FUNNEL_STEPS_ORDERED) {
      analytics.emitStepView(stepId);
      analytics.emitStepCtaClick(
        stepId,
        FUNNEL_SCREENS[stepId].ctas[0] as FunnelCta,
      );
      analytics.emitStepDrop(stepId);
    }
    expect(sink.captured).toHaveLength(TOTAL_FUNNEL_STEPS * 3);

    // Each step contributes exactly 3 events, in the expected order.
    FUNNEL_STEPS_ORDERED.forEach((stepId, idx) => {
      const slice = sink.captured.slice(idx * 3, idx * 3 + 3);
      const types = slice.map((e) => e.type);
      expect(types).toEqual(['step_view', 'step_cta_click', 'step_drop']);
      for (const evt of slice) {
        expect(evt.stepId).toBe(stepId);
        expect(evt.stepNumber).toBe(idx + 1);
        expect(evt.sessionId).toBe(SESSION_ID);
        const expectedTag = KR_VARIANT_STEPS.has(stepId) ? 'kr_variant' : null;
        expect(evt.variantTag).toBe(expectedTag);
      }
    });
  });
});
