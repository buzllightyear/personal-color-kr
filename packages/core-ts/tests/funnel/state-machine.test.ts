/**
 * Unit tests — Glam Up 12단계 결제 깔때기 state machine (한국 변형).
 *
 * Verifies:
 *   - All 12 Korean-variant steps defined (order, naming, completeness)
 *   - Valid transitions (linear 1 → 2 → ... → 12, plus rating_gate skip exception)
 *   - Invalid transitions rejected (skip, reorder, replay)
 *   - Progress tracking (percent, step number, completed list)
 *   - Event log (append-only, immutable, ontology-aligned)
 *   - Terminal states (idle → started, last step → completed, abandon at any step)
 *   - Immutability (no mutation of prior instances)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  FUNNEL_STEPS_ORDERED,
  InvalidTransitionError,
  TOTAL_FUNNEL_STEPS,
  type FunnelStepId,
} from '../../src/funnel/types.js';
import {
  abandonFunnel,
  advanceStep,
  createFunnel,
  getProgress,
  isTransitionAllowed,
  skipStep,
  startFunnel,
} from '../../src/funnel/state-machine.js';

describe('FUNNEL_STEPS_ORDERED', () => {
  it('defines exactly 12 steps', () => {
    expect(FUNNEL_STEPS_ORDERED).toHaveLength(TOTAL_FUNNEL_STEPS);
    expect(TOTAL_FUNNEL_STEPS).toBe(12);
  });

  it('preserves the canonical Glam Up sequence with Korean variants in slots 10-12', () => {
    expect(FUNNEL_STEPS_ORDERED).toEqual([
      'welcome_hook',
      'value_props',
      'onboarding_priming', // v0.2: replaces social_proof_intro (priming for step 4)
      'rating_gate',
      'fake_loader',        // v0.2: moved from step 8; price_anchoring 폐기
      'scan_option_select',
      'diagnosis_input',    // v0.2: 셀카만 단독 (온보딩은 step 3로 분리)
      'fake_scan_animation',// v0.2: NEW — 24-point 시각 스캔 애니메이션
      'result_reveal',
      'referral_gate',      // KR variant: 1명 추천
      'social_evolution',   // KR variant (v0.2): UGC + 인플루언서 + social_proof 흡수
      'payment_model',      // KR variant: $12/월 or $59/연, 37일 무료체험
    ]);
  });

  it('has no duplicate step ids', () => {
    const set = new Set(FUNNEL_STEPS_ORDERED);
    expect(set.size).toBe(FUNNEL_STEPS_ORDERED.length);
  });
});

describe('createFunnel', () => {
  it('starts in idle terminal state with empty history', () => {
    const m = createFunnel();
    expect(m.state).toBe('idle');
    expect(m.history).toEqual([]);
    expect(m.completedSteps).toEqual([]);
  });

  it('returns an immutable instance (frozen)', () => {
    const m = createFunnel();
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.history)).toBe(true);
    expect(Object.isFrozen(m.completedSteps)).toBe(true);
  });
});

describe('startFunnel', () => {
  it('transitions idle → welcome_hook (step 1) and emits funnel_started + step_entered', () => {
    const m = startFunnel(createFunnel());
    expect(m.state).toBe('welcome_hook');
    expect(m.history).toHaveLength(2);
    expect(m.history[0]?.type).toBe('funnel_started');
    expect(m.history[1]?.type).toBe('step_entered');
    expect(m.history[1]?.state).toBe('welcome_hook');
    expect(m.history[1]?.stepNumber).toBe(1);
  });

  it('does not mutate the original instance', () => {
    const original = createFunnel();
    const started = startFunnel(original);
    expect(original.state).toBe('idle');
    expect(original.history).toEqual([]);
    expect(started).not.toBe(original);
  });

  it('rejects starting from any non-idle state', () => {
    const m = startFunnel(createFunnel());
    expect(() => startFunnel(m)).toThrow(InvalidTransitionError);
  });
});

describe('advanceStep — linear 1 → 12 progression', () => {
  it('walks all 12 steps in order, no skipping permitted', () => {
    let m = startFunnel(createFunnel());
    expect(m.state).toBe(FUNNEL_STEPS_ORDERED[0]);

    for (let i = 1; i < FUNNEL_STEPS_ORDERED.length; i++) {
      m = advanceStep(m);
      expect(m.state).toBe(FUNNEL_STEPS_ORDERED[i]);
    }

    // After step 12, advancing once more completes the funnel.
    m = advanceStep(m);
    expect(m.state).toBe('completed');
  });

  it('appends step_completed + step_entered events for each advance', () => {
    let m = startFunnel(createFunnel());
    const baseHistoryLen = m.history.length;
    m = advanceStep(m);

    // funnel_started + step_entered(1) + step_completed(1) + step_entered(2) = 4
    expect(m.history).toHaveLength(baseHistoryLen + 2);
    expect(m.history.at(-2)?.type).toBe('step_completed');
    expect(m.history.at(-2)?.state).toBe('welcome_hook');
    expect(m.history.at(-1)?.type).toBe('step_entered');
    expect(m.history.at(-1)?.state).toBe('value_props');
  });

  it('records each completed step in completedSteps', () => {
    let m = startFunnel(createFunnel());
    expect(m.completedSteps).toEqual([]);
    m = advanceStep(m);
    expect(m.completedSteps).toEqual(['welcome_hook']);
    m = advanceStep(m);
    expect(m.completedSteps).toEqual(['welcome_hook', 'value_props']);
  });

  it('emits funnel_completed after step 12 advances', () => {
    let m = startFunnel(createFunnel());
    for (let i = 1; i < FUNNEL_STEPS_ORDERED.length; i++) {
      m = advanceStep(m);
    }
    expect(m.state).toBe('payment_model');
    m = advanceStep(m);
    expect(m.state).toBe('completed');
    expect(m.history.at(-1)?.type).toBe('funnel_completed');
    expect(m.completedSteps).toHaveLength(TOTAL_FUNNEL_STEPS);
  });

  it('cannot advance from terminal states (idle, completed, abandoned)', () => {
    expect(() => advanceStep(createFunnel())).toThrow(InvalidTransitionError);

    let m = startFunnel(createFunnel());
    for (let i = 1; i < FUNNEL_STEPS_ORDERED.length; i++) {
      m = advanceStep(m);
    }
    m = advanceStep(m); // -> completed
    expect(() => advanceStep(m)).toThrow(InvalidTransitionError);

    const abandoned = abandonFunnel(startFunnel(createFunnel()));
    expect(() => advanceStep(abandoned)).toThrow(InvalidTransitionError);
  });

  it('returns a new instance, never mutates the previous one', () => {
    const m1 = startFunnel(createFunnel());
    const m2 = advanceStep(m1);
    expect(m1.state).toBe('welcome_hook');
    expect(m2.state).toBe('value_props');
    expect(m1).not.toBe(m2);
    expect(m1.history).not.toBe(m2.history);
  });
});

describe('skipStep — only allowed for rating_gate (step 4)', () => {
  function fastForwardTo(targetStepIndex: number) {
    let m = startFunnel(createFunnel());
    for (let i = 1; i <= targetStepIndex; i++) {
      m = advanceStep(m);
    }
    return m;
  }

  it('skips rating_gate (iOS native dismiss) and emits step_skipped', () => {
    // Step 4 = index 3.  Get to rating_gate by advancing from step 1 three times.
    const m = fastForwardTo(3);
    expect(m.state).toBe('rating_gate');
    const skipped = skipStep(m);
    expect(skipped.state).toBe('fake_loader'); // v0.2 step 5
    expect(skipped.history.at(-2)?.type).toBe('step_skipped');
    expect(skipped.history.at(-2)?.state).toBe('rating_gate');
    expect(skipped.history.at(-1)?.type).toBe('step_entered');
    expect(skipped.history.at(-1)?.state).toBe('fake_loader');
  });

  it('does NOT add rating_gate to completedSteps when skipped (it was skipped, not completed)', () => {
    const m = fastForwardTo(3);
    const skipped = skipStep(m);
    expect(skipped.completedSteps).not.toContain('rating_gate');
    expect(skipped.completedSteps).toEqual(['welcome_hook', 'value_props', 'onboarding_priming']);
  });

  it('rejects skipping any step other than rating_gate', () => {
    let m = startFunnel(createFunnel());
    expect(m.state).toBe('welcome_hook');
    expect(() => skipStep(m)).toThrow(InvalidTransitionError);

    m = advanceStep(m); // value_props
    expect(() => skipStep(m)).toThrow(InvalidTransitionError);

    // Skipping the KR variants is explicitly disallowed.
    const beforeReferral = fastForwardTo(9); // referral_gate (step 10)
    expect(beforeReferral.state).toBe('referral_gate');
    expect(() => skipStep(beforeReferral)).toThrow(InvalidTransitionError);
  });
});

describe('abandonFunnel', () => {
  it('moves to abandoned from any active step and emits funnel_abandoned', () => {
    const m = startFunnel(createFunnel());
    const abandoned = abandonFunnel(m);
    expect(abandoned.state).toBe('abandoned');
    expect(abandoned.history.at(-1)?.type).toBe('funnel_abandoned');
  });

  it('rejects abandoning from terminal states', () => {
    expect(() => abandonFunnel(createFunnel())).toThrow(InvalidTransitionError);
    const m1 = startFunnel(createFunnel());
    const abandoned = abandonFunnel(m1);
    expect(() => abandonFunnel(abandoned)).toThrow(InvalidTransitionError);
  });
});

describe('isTransitionAllowed', () => {
  it('allows idle → welcome_hook', () => {
    expect(isTransitionAllowed('idle', 'welcome_hook')).toBe(true);
  });

  it('allows each step → its immediate successor', () => {
    for (let i = 0; i < FUNNEL_STEPS_ORDERED.length - 1; i++) {
      const from = FUNNEL_STEPS_ORDERED[i] as FunnelStepId;
      const to = FUNNEL_STEPS_ORDERED[i + 1] as FunnelStepId;
      expect(isTransitionAllowed(from, to)).toBe(true);
    }
  });

  it('allows payment_model → completed', () => {
    expect(isTransitionAllowed('payment_model', 'completed')).toBe(true);
  });

  it('allows rating_gate → fake_loader (skip path, v0.2 step 5)', () => {
    expect(isTransitionAllowed('rating_gate', 'fake_loader')).toBe(true);
  });

  it('allows any active step → abandoned', () => {
    for (const step of FUNNEL_STEPS_ORDERED) {
      expect(isTransitionAllowed(step, 'abandoned')).toBe(true);
    }
  });

  it('rejects skipping steps (e.g. step 1 → step 3)', () => {
    expect(isTransitionAllowed('welcome_hook', 'onboarding_priming')).toBe(false);
    expect(isTransitionAllowed('welcome_hook', 'payment_model')).toBe(false);
  });

  it('rejects going backwards', () => {
    expect(isTransitionAllowed('value_props', 'welcome_hook')).toBe(false);
    expect(isTransitionAllowed('payment_model', 'referral_gate')).toBe(false);
  });

  it('rejects transitions out of terminal states', () => {
    expect(isTransitionAllowed('completed', 'welcome_hook')).toBe(false);
    expect(isTransitionAllowed('abandoned', 'welcome_hook')).toBe(false);
  });

  it('rejects idle → any non-step-1 state', () => {
    expect(isTransitionAllowed('idle', 'value_props')).toBe(false);
    expect(isTransitionAllowed('idle', 'completed')).toBe(false);
    expect(isTransitionAllowed('idle', 'abandoned')).toBe(false);
  });
});

describe('getProgress', () => {
  it('reports 0% on idle', () => {
    const p = getProgress(createFunnel());
    expect(p.state).toBe('idle');
    expect(p.stepNumber).toBeNull();
    expect(p.progressPercent).toBe(0);
    expect(p.isComplete).toBe(false);
    expect(p.isAbandoned).toBe(false);
    expect(p.completedSteps).toEqual([]);
  });

  it('reports stepNumber 1 and 0% completed on welcome_hook (entered, not completed)', () => {
    const m = startFunnel(createFunnel());
    const p = getProgress(m);
    expect(p.state).toBe('welcome_hook');
    expect(p.stepNumber).toBe(1);
    expect(p.progressPercent).toBe(0);
    expect(p.completedSteps).toEqual([]);
  });

  it('reports proportional progress as steps complete', () => {
    let m = startFunnel(createFunnel());
    m = advanceStep(m); // step 1 done, on step 2
    let p = getProgress(m);
    expect(p.stepNumber).toBe(2);
    expect(p.progressPercent).toBe(Math.round((1 / 12) * 100)); // 8

    // Complete through step 6.
    for (let i = 0; i < 5; i++) m = advanceStep(m); // now on step 7 (6 completed)
    p = getProgress(m);
    expect(p.stepNumber).toBe(7);
    expect(p.completedSteps).toHaveLength(6);
    expect(p.progressPercent).toBe(Math.round((6 / 12) * 100)); // 50
  });

  it('reports 100% on completed', () => {
    let m = startFunnel(createFunnel());
    for (let i = 1; i < FUNNEL_STEPS_ORDERED.length; i++) {
      m = advanceStep(m);
    }
    m = advanceStep(m); // -> completed
    const p = getProgress(m);
    expect(p.state).toBe('completed');
    expect(p.stepNumber).toBeNull();
    expect(p.progressPercent).toBe(100);
    expect(p.isComplete).toBe(true);
    expect(p.completedSteps).toHaveLength(TOTAL_FUNNEL_STEPS);
  });

  it('flags abandoned with isAbandoned=true and preserves partial completion count', () => {
    let m = startFunnel(createFunnel());
    m = advanceStep(m);
    m = advanceStep(m);
    const abandoned = abandonFunnel(m);
    const p = getProgress(abandoned);
    expect(p.state).toBe('abandoned');
    expect(p.stepNumber).toBeNull();
    expect(p.isAbandoned).toBe(true);
    expect(p.isComplete).toBe(false);
    expect(p.completedSteps).toEqual(['welcome_hook', 'value_props']);
    expect(p.progressPercent).toBe(Math.round((2 / 12) * 100)); // 17
  });
});

describe('event log invariants (PostHog payment_funnel_event)', () => {
  it('every event has a monotonically non-decreasing timestamp', () => {
    let m = startFunnel(createFunnel());
    for (let i = 1; i < 5; i++) m = advanceStep(m);
    const ts = m.history.map((e) => e.timestamp);
    for (let i = 1; i < ts.length; i++) {
      const prev = ts[i - 1];
      const curr = ts[i];
      expect(prev !== undefined && curr !== undefined).toBe(true);
      expect(curr).toBeGreaterThanOrEqual(prev as number);
    }
  });

  it('history is append-only — older snapshots remain unchanged after later transitions', () => {
    const m1 = startFunnel(createFunnel());
    const snapshot = m1.history;
    const m2 = advanceStep(m1);
    expect(snapshot).toHaveLength(2); // unchanged
    expect(m2.history.length).toBeGreaterThan(snapshot.length);
    // Prefix equality:
    for (let i = 0; i < snapshot.length; i++) {
      expect(m2.history[i]).toBe(snapshot[i]);
    }
  });

  it('emits stepNumber matching ontology (1..12) for step events', () => {
    let m = startFunnel(createFunnel());
    expect(m.history[1]?.stepNumber).toBe(1);
    m = advanceStep(m);
    expect(m.history.at(-1)?.stepNumber).toBe(2);
  });
});

describe('timestamp monotonicity under clock regression', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clamps to last timestamp if system clock goes backwards (e.g. NTP adjustment)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'));

    let m = startFunnel(createFunnel());
    const firstTs = m.history[0]?.timestamp ?? 0;

    // Simulate clock regression — 10 seconds back.
    vi.setSystemTime(new Date('2026-05-16T11:59:50Z'));
    m = advanceStep(m);

    const lastTs = m.history.at(-1)?.timestamp ?? 0;
    expect(lastTs).toBeGreaterThanOrEqual(firstTs);
  });
});
