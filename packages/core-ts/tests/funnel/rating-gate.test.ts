/**
 * Unit tests — RatingGateService (Sub-AC 8.1).
 *
 * Contract under test:
 *   - A pure counter mutator `incrementAction` that returns NEW frozen
 *     snapshots without mutating the input.
 *   - A pure trigger evaluator `evaluateRatingTrigger` that classifies
 *     a counter snapshot against the canonical 4-stage ladder
 *     (DEFAULT_RATING_TRIGGER_CONDITIONS) and returns the highest
 *     satisfied-but-not-yet-prompted stage.
 *   - A stateful façade `createRatingGateService` that ties counters,
 *     prompt history, and conditions together for host apps.
 *   - Schema validation: actions, amounts, counters, stages, and
 *     conditions all reject malformed input with a structured
 *     `RatingGateError` reason.
 *
 * Coverage matrix:
 *   1. RATING_ACTION_TYPES exposes the canonical 4 actions in order.
 *   2. DEFAULT_RATING_TRIGGER_CONDITIONS:
 *      a. 4 stages, each with a distinct stage id 1..4.
 *      b. Stage 1 = 5 app launches.
 *      c. Stage 2 = 3 diagnoses.
 *      d. Stage 3 = 1 share.
 *      e. Stage 4 = 1 payment.
 *      f. The whole structure is frozen.
 *   3. ZERO_RATING_COUNTERS is the zero snapshot and is frozen.
 *   4. `incrementAction`:
 *      a. Returns a NEW frozen object (purity).
 *      b. Bumps only the targeted counter.
 *      c. Honours custom `amount`.
 *      d. Rejects unknown actions / non-int / zero / negative / NaN.
 *   5. `evaluateRatingTrigger`:
 *      a. Empty counters → shouldPrompt=false, stage=null.
 *      b. Stage 1 only when ≥5 launches.
 *      c. Lower bound: exactly 5 launches → stage 1; 4 launches → no.
 *      d. Highest satisfied unprompted stage wins (3 of 4 satisfied →
 *         stage 3).
 *      e. `alreadyPromptedStages` suppresses returned stages.
 *      f. When ALL satisfied stages are already prompted → stage=null.
 *      g. Multiple simultaneously-met stages: deterministic ordering.
 *      h. Custom conditions override the default ladder.
 *      i. Output is frozen.
 *      j. Schema rejects: non-object counters, negative counters,
 *         non-integer counters, bad stage values, malformed conditions
 *         (empty, duplicate stage, unknown action, negative minimum).
 *   6. `createRatingGateService` façade:
 *      a. Empty service → empty decision.
 *      b. `track` increments counters and the next `evaluate` reflects
 *         the change.
 *      c. `markPrompted` suppresses the corresponding stage on the
 *         next `evaluate`.
 *      d. `markPrompted` is idempotent.
 *      e. `snapshot()` returns frozen state with counters + history.
 *      f. Initial counters / prompted stages are honoured.
 *      g. Invalid initial inputs throw RatingGateError.
 *      h. Service object itself is frozen.
 *   7. Cross-module: realistic 12-step funnel scenario — user launches
 *      app, completes 3 diagnoses, shares once, pays — collects every
 *      stage in order.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RATING_TRIGGER_CONDITIONS,
  RATING_ACTION_TYPES,
  RATING_TRIGGER_STAGES,
  RatingGateError,
  ZERO_RATING_COUNTERS,
  createRatingGateService,
  evaluateRatingTrigger,
  incrementAction,
  type RatingActionCounters,
  type RatingTriggerCondition,
  type RatingTriggerStage,
} from '../../src/funnel/rating-gate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectThrows(fn: () => unknown): RatingGateError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RatingGateError);
  return caught as RatingGateError;
}

function makeCounters(
  partial: Partial<RatingActionCounters> = {},
): RatingActionCounters {
  return Object.freeze({
    app_launched: 0,
    diagnosis_completed: 0,
    share_completed: 0,
    payment_completed: 0,
    ...partial,
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('RATING_ACTION_TYPES', () => {
  it('exposes the 4 canonical actions in canonical order', () => {
    expect(RATING_ACTION_TYPES).toEqual([
      'app_launched',
      'diagnosis_completed',
      'share_completed',
      'payment_completed',
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(RATING_ACTION_TYPES)).toBe(true);
  });
});

describe('RATING_TRIGGER_STAGES', () => {
  it('exposes 1..4 in order', () => {
    expect(RATING_TRIGGER_STAGES).toEqual([1, 2, 3, 4]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(RATING_TRIGGER_STAGES)).toBe(true);
  });
});

describe('DEFAULT_RATING_TRIGGER_CONDITIONS', () => {
  it('declares exactly 4 stages', () => {
    expect(DEFAULT_RATING_TRIGGER_CONDITIONS).toHaveLength(4);
  });

  it('lists stages 1..4 each exactly once', () => {
    const stages = DEFAULT_RATING_TRIGGER_CONDITIONS.map((c) => c.stage).sort();
    expect(stages).toEqual([1, 2, 3, 4]);
  });

  it('Stage 1 = 5 app launches (habit forming)', () => {
    const stage1 = DEFAULT_RATING_TRIGGER_CONDITIONS.find((c) => c.stage === 1);
    expect(stage1?.minimums).toEqual({ app_launched: 5 });
    expect(stage1?.label).toBe('habit_forming');
  });

  it('Stage 2 = 3 diagnoses (engaged)', () => {
    const stage2 = DEFAULT_RATING_TRIGGER_CONDITIONS.find((c) => c.stage === 2);
    expect(stage2?.minimums).toEqual({ diagnosis_completed: 3 });
    expect(stage2?.label).toBe('engaged');
  });

  it('Stage 3 = 1 share (advocate)', () => {
    const stage3 = DEFAULT_RATING_TRIGGER_CONDITIONS.find((c) => c.stage === 3);
    expect(stage3?.minimums).toEqual({ share_completed: 1 });
    expect(stage3?.label).toBe('advocate');
  });

  it('Stage 4 = 1 payment (committed)', () => {
    const stage4 = DEFAULT_RATING_TRIGGER_CONDITIONS.find((c) => c.stage === 4);
    expect(stage4?.minimums).toEqual({ payment_completed: 1 });
    expect(stage4?.label).toBe('committed');
  });

  it('every condition + its minimums are frozen', () => {
    expect(Object.isFrozen(DEFAULT_RATING_TRIGGER_CONDITIONS)).toBe(true);
    for (const cond of DEFAULT_RATING_TRIGGER_CONDITIONS) {
      expect(Object.isFrozen(cond)).toBe(true);
      expect(Object.isFrozen(cond.minimums)).toBe(true);
    }
  });
});

describe('ZERO_RATING_COUNTERS', () => {
  it('is the all-zero snapshot', () => {
    expect(ZERO_RATING_COUNTERS).toEqual({
      app_launched: 0,
      diagnosis_completed: 0,
      share_completed: 0,
      payment_completed: 0,
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ZERO_RATING_COUNTERS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// incrementAction
// ---------------------------------------------------------------------------

describe('incrementAction', () => {
  it('returns a NEW frozen instance (purity)', () => {
    const before = makeCounters();
    const after = incrementAction(before, 'app_launched');
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    // Original snapshot untouched.
    expect(before.app_launched).toBe(0);
  });

  it('bumps only the targeted counter', () => {
    const before = makeCounters();
    const after = incrementAction(before, 'diagnosis_completed');
    expect(after.diagnosis_completed).toBe(1);
    expect(after.app_launched).toBe(0);
    expect(after.share_completed).toBe(0);
    expect(after.payment_completed).toBe(0);
  });

  it('honours a custom positive amount', () => {
    const after = incrementAction(makeCounters(), 'app_launched', 3);
    expect(after.app_launched).toBe(3);
  });

  it('chains additively (immutable updates)', () => {
    let c = makeCounters();
    for (let i = 0; i < 5; i += 1) c = incrementAction(c, 'app_launched');
    expect(c.app_launched).toBe(5);
  });

  it('rejects unknown actions', () => {
    const err = expectThrows(() =>
      incrementAction(makeCounters(), 'fake_action' as never),
    );
    expect(err.reason).toBe('unknown_action');
  });

  it('rejects non-string actions', () => {
    const err = expectThrows(() => incrementAction(makeCounters(), 42 as never));
    expect(err.reason).toBe('unknown_action');
  });

  it('rejects amount <= 0', () => {
    expect(
      expectThrows(() => incrementAction(makeCounters(), 'app_launched', 0)).reason,
    ).toBe('invalid_amount');
    expect(
      expectThrows(() => incrementAction(makeCounters(), 'app_launched', -1)).reason,
    ).toBe('invalid_amount');
  });

  it('rejects non-integer / NaN / Infinity amount', () => {
    expect(
      expectThrows(() => incrementAction(makeCounters(), 'app_launched', 1.5)).reason,
    ).toBe('invalid_amount');
    expect(
      expectThrows(() => incrementAction(makeCounters(), 'app_launched', NaN)).reason,
    ).toBe('invalid_amount');
    expect(
      expectThrows(() => incrementAction(makeCounters(), 'app_launched', Infinity))
        .reason,
    ).toBe('invalid_amount');
  });

  it('rejects malformed counter snapshots', () => {
    expect(
      expectThrows(() =>
        incrementAction(null as unknown as RatingActionCounters, 'app_launched'),
      ).reason,
    ).toBe('invalid_counter');
    expect(
      expectThrows(() =>
        incrementAction(
          { app_launched: -1 } as unknown as RatingActionCounters,
          'app_launched',
        ),
      ).reason,
    ).toBe('invalid_counter');
    expect(
      expectThrows(() =>
        incrementAction(
          {
            app_launched: 1.5,
            diagnosis_completed: 0,
            share_completed: 0,
            payment_completed: 0,
          } as RatingActionCounters,
          'app_launched',
        ),
      ).reason,
    ).toBe('invalid_counter');
  });
});

// ---------------------------------------------------------------------------
// evaluateRatingTrigger
// ---------------------------------------------------------------------------

describe('evaluateRatingTrigger', () => {
  it('empty counters → no prompt', () => {
    const decision = evaluateRatingTrigger(ZERO_RATING_COUNTERS);
    expect(decision.shouldPrompt).toBe(false);
    expect(decision.stage).toBeNull();
    expect(decision.satisfiedStages).toEqual([]);
  });

  it('Stage 1 fires at exactly 5 app launches (closed lower bound)', () => {
    const decision = evaluateRatingTrigger(makeCounters({ app_launched: 5 }));
    expect(decision.shouldPrompt).toBe(true);
    expect(decision.stage).toBe(1);
    expect(decision.satisfiedStages).toEqual([1]);
  });

  it('Stage 1 does NOT fire at 4 launches', () => {
    const decision = evaluateRatingTrigger(makeCounters({ app_launched: 4 }));
    expect(decision.shouldPrompt).toBe(false);
    expect(decision.stage).toBeNull();
  });

  it('Stage 2 satisfied at 3 diagnoses', () => {
    const decision = evaluateRatingTrigger(makeCounters({ diagnosis_completed: 3 }));
    expect(decision.satisfiedStages).toContain(2);
    expect(decision.stage).toBe(2);
  });

  it('Stage 3 satisfied at 1 share', () => {
    const decision = evaluateRatingTrigger(makeCounters({ share_completed: 1 }));
    expect(decision.satisfiedStages).toContain(3);
    expect(decision.stage).toBe(3);
  });

  it('Stage 4 satisfied at 1 payment', () => {
    const decision = evaluateRatingTrigger(makeCounters({ payment_completed: 1 }));
    expect(decision.satisfiedStages).toContain(4);
    expect(decision.stage).toBe(4);
  });

  it('picks the HIGHEST satisfied unprompted stage', () => {
    const decision = evaluateRatingTrigger(
      makeCounters({
        app_launched: 10,
        diagnosis_completed: 5,
        share_completed: 1,
      }),
    );
    expect(decision.satisfiedStages).toEqual([1, 2, 3]);
    expect(decision.stage).toBe(3);
  });

  it('suppresses already-prompted stages and falls back to next highest', () => {
    const decision = evaluateRatingTrigger(
      makeCounters({
        app_launched: 10,
        diagnosis_completed: 5,
        share_completed: 1,
      }),
      { alreadyPromptedStages: [3] },
    );
    expect(decision.stage).toBe(2);
    expect(decision.shouldPrompt).toBe(true);
  });

  it('returns stage=null when every satisfied stage is already prompted', () => {
    const decision = evaluateRatingTrigger(
      makeCounters({
        app_launched: 10,
        diagnosis_completed: 5,
      }),
      { alreadyPromptedStages: [1, 2] },
    );
    expect(decision.stage).toBeNull();
    expect(decision.shouldPrompt).toBe(false);
    expect(decision.satisfiedStages).toEqual([1, 2]);
  });

  it('all four stages simultaneously satisfied → selects stage 4', () => {
    const decision = evaluateRatingTrigger(
      makeCounters({
        app_launched: 5,
        diagnosis_completed: 3,
        share_completed: 1,
        payment_completed: 1,
      }),
    );
    expect(decision.satisfiedStages).toEqual([1, 2, 3, 4]);
    expect(decision.stage).toBe(4);
  });

  it('honours custom conditions', () => {
    const customConditions: RatingTriggerCondition[] = [
      {
        stage: 1,
        label: 'one_launch',
        minimums: { app_launched: 1 },
      },
      {
        stage: 2,
        label: 'two_launches',
        minimums: { app_launched: 2 },
      },
    ];
    const decision = evaluateRatingTrigger(makeCounters({ app_launched: 1 }), {
      conditions: customConditions,
    });
    expect(decision.stage).toBe(1);
    expect(decision.satisfiedStages).toEqual([1]);
  });

  it('returns a frozen decision', () => {
    const decision = evaluateRatingTrigger(ZERO_RATING_COUNTERS);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.satisfiedStages)).toBe(true);
    expect(Object.isFrozen(decision.counters)).toBe(true);
    expect(Object.isFrozen(decision.alreadyPromptedStages)).toBe(true);
  });

  it('is deterministic — same input → same output', () => {
    const counters = makeCounters({ app_launched: 5, diagnosis_completed: 3 });
    const a = evaluateRatingTrigger(counters);
    const b = evaluateRatingTrigger(counters);
    expect(a).toEqual(b);
  });

  it('rejects non-object counters', () => {
    expect(
      expectThrows(() => evaluateRatingTrigger(null as unknown as RatingActionCounters))
        .reason,
    ).toBe('invalid_counter');
  });

  it('rejects negative counter values', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger({
          ...ZERO_RATING_COUNTERS,
          app_launched: -1,
        } as RatingActionCounters),
      ).reason,
    ).toBe('invalid_counter');
  });

  it('rejects non-integer counter values', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger({
          ...ZERO_RATING_COUNTERS,
          app_launched: 1.5,
        } as RatingActionCounters),
      ).reason,
    ).toBe('invalid_counter');
  });

  it('rejects alreadyPromptedStages with invalid entries', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger(ZERO_RATING_COUNTERS, {
          alreadyPromptedStages: [9 as unknown as RatingTriggerStage],
        }),
      ).reason,
    ).toBe('invalid_stage');
  });

  it('rejects non-array alreadyPromptedStages', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger(ZERO_RATING_COUNTERS, {
          alreadyPromptedStages: 'nope' as unknown as readonly RatingTriggerStage[],
        }),
      ).reason,
    ).toBe('invalid_stage');
  });

  it('rejects empty custom conditions', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger(ZERO_RATING_COUNTERS, { conditions: [] }),
      ).reason,
    ).toBe('invalid_conditions');
  });

  it('rejects custom conditions with duplicate stages', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger(ZERO_RATING_COUNTERS, {
          conditions: [
            { stage: 1, label: 'a', minimums: { app_launched: 1 } },
            { stage: 1, label: 'b', minimums: { app_launched: 2 } },
          ],
        }),
      ).reason,
    ).toBe('invalid_conditions');
  });

  it('rejects custom conditions with unknown action keys', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger(ZERO_RATING_COUNTERS, {
          conditions: [
            {
              stage: 1,
              label: 'bad',
              minimums: { not_a_real_action: 1 } as never,
            },
          ],
        }),
      ).reason,
    ).toBe('invalid_conditions');
  });

  it('rejects custom conditions with non-integer minimum', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger(ZERO_RATING_COUNTERS, {
          conditions: [{ stage: 1, label: 'bad', minimums: { app_launched: 1.5 } }],
        }),
      ).reason,
    ).toBe('invalid_conditions');
  });

  it('rejects custom conditions with negative minimum', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger(ZERO_RATING_COUNTERS, {
          conditions: [{ stage: 1, label: 'bad', minimums: { app_launched: -1 } }],
        }),
      ).reason,
    ).toBe('invalid_conditions');
  });

  it('rejects malformed condition entry (non-object)', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger(ZERO_RATING_COUNTERS, {
          conditions: [null as unknown as RatingTriggerCondition],
        }),
      ).reason,
    ).toBe('invalid_conditions');
  });

  it('rejects condition with bad stage id', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger(ZERO_RATING_COUNTERS, {
          conditions: [{ stage: 9 as RatingTriggerStage, label: 'x', minimums: {} }],
        }),
      ).reason,
    ).toBe('invalid_conditions');
  });

  it('rejects condition with non-object minimums', () => {
    expect(
      expectThrows(() =>
        evaluateRatingTrigger(ZERO_RATING_COUNTERS, {
          conditions: [
            {
              stage: 1,
              label: 'x',
              minimums: 'oops' as unknown as Record<string, number>,
            },
          ],
        }),
      ).reason,
    ).toBe('invalid_conditions');
  });
});

// ---------------------------------------------------------------------------
// createRatingGateService (stateful façade)
// ---------------------------------------------------------------------------

describe('createRatingGateService', () => {
  it('starts at zero and reports no prompt', () => {
    const service = createRatingGateService();
    const decision = service.evaluate();
    expect(decision.shouldPrompt).toBe(false);
    expect(service.snapshot().counters).toEqual(ZERO_RATING_COUNTERS);
    expect(service.snapshot().alreadyPromptedStages).toEqual([]);
  });

  it('track() advances counters and re-evaluates', () => {
    const service = createRatingGateService();
    for (let i = 0; i < 5; i += 1) service.track('app_launched');
    const decision = service.evaluate();
    expect(decision.shouldPrompt).toBe(true);
    expect(decision.stage).toBe(1);
  });

  it('track() returns the latest frozen snapshot', () => {
    const service = createRatingGateService();
    const snap = service.track('app_launched');
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap.counters.app_launched).toBe(1);
  });

  it('markPrompted() suppresses the matching stage in subsequent decisions', () => {
    const service = createRatingGateService();
    for (let i = 0; i < 5; i += 1) service.track('app_launched');
    service.markPrompted(1);
    expect(service.evaluate().stage).toBeNull();
    expect(service.snapshot().alreadyPromptedStages).toEqual([1]);
  });

  it('markPrompted() is idempotent', () => {
    const service = createRatingGateService();
    service.markPrompted(2);
    service.markPrompted(2);
    expect(service.snapshot().alreadyPromptedStages).toEqual([2]);
  });

  it('markPrompted() rejects bad stage ids', () => {
    const service = createRatingGateService();
    expect(
      expectThrows(() => service.markPrompted(9 as RatingTriggerStage)).reason,
    ).toBe('invalid_stage');
  });

  it('honours initial counters', () => {
    const service = createRatingGateService({
      initialCounters: makeCounters({ app_launched: 5 }),
    });
    expect(service.evaluate().stage).toBe(1);
  });

  it('honours initial prompted stages', () => {
    const service = createRatingGateService({
      initialCounters: makeCounters({ app_launched: 5 }),
      initialPromptedStages: [1],
    });
    expect(service.evaluate().stage).toBeNull();
  });

  it('honours custom conditions', () => {
    const service = createRatingGateService({
      conditions: [{ stage: 1, label: 'cheap', minimums: { app_launched: 1 } }],
    });
    service.track('app_launched');
    expect(service.evaluate().stage).toBe(1);
  });

  it('rejects invalid initial counters at construction time', () => {
    expect(
      expectThrows(() =>
        createRatingGateService({
          initialCounters: { app_launched: -1 } as unknown as RatingActionCounters,
        }),
      ).reason,
    ).toBe('invalid_counter');
  });

  it('rejects invalid initial prompted stages at construction time', () => {
    expect(
      expectThrows(() =>
        createRatingGateService({
          initialPromptedStages: [9 as RatingTriggerStage],
        }),
      ).reason,
    ).toBe('invalid_stage');
  });

  it('rejects invalid custom conditions at construction time', () => {
    expect(
      expectThrows(() =>
        createRatingGateService({
          conditions: [],
        }),
      ).reason,
    ).toBe('invalid_conditions');
  });

  it('the service object is frozen', () => {
    const service = createRatingGateService();
    expect(Object.isFrozen(service)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end realistic scenario
// ---------------------------------------------------------------------------

describe('end-to-end — full funnel journey', () => {
  it('walks through every stage as the user progresses', () => {
    const service = createRatingGateService();

    // (a) Cold opens: no prompt until 5 launches.
    for (let i = 0; i < 4; i += 1) service.track('app_launched');
    expect(service.evaluate().shouldPrompt).toBe(false);

    // 5th launch reaches stage 1.
    service.track('app_launched');
    expect(service.evaluate().stage).toBe(1);
    service.markPrompted(1);
    expect(service.evaluate().stage).toBeNull();

    // (b) User runs 3 diagnoses → stage 2.
    for (let i = 0; i < 3; i += 1) service.track('diagnosis_completed');
    expect(service.evaluate().stage).toBe(2);
    service.markPrompted(2);

    // (c) Share invite → stage 3.
    service.track('share_completed');
    expect(service.evaluate().stage).toBe(3);
    service.markPrompted(3);

    // (d) Payment completed → stage 4.
    service.track('payment_completed');
    expect(service.evaluate().stage).toBe(4);
    service.markPrompted(4);

    // (e) All four stages now exhausted.
    const final = service.evaluate();
    expect(final.shouldPrompt).toBe(false);
    expect(final.satisfiedStages).toEqual([1, 2, 3, 4]);
    expect(final.alreadyPromptedStages).toEqual([1, 2, 3, 4]);
  });
});
