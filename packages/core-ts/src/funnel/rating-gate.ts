/**
 * Sub-AC 8.1 — RatingGateService (iOS 별점 게이트 4단계 트리거).
 *
 * Pure functional service that tracks user action counters and decides
 * WHEN to surface the iOS `SKStoreReviewController` native rating
 * dialog.  Apple caps the dialog to three prompts per 365-day window
 * AND deduplicates internally — so the host app must call the API at
 * the *right moments* rather than every session.  This module encodes
 * those moments as four staged triggers ordered from low engagement to
 * high engagement:
 *
 *     stage 1  — app launched ≥ 5 times                (early hook)
 *     stage 2  — diagnoses completed ≥ 3               (engaged user)
 *     stage 3  — shares completed ≥ 1                  (advocate signal)
 *     stage 4  — payment completed ≥ 1                 (committed user)
 *
 * The 4-stage ladder maps to the Seed's `rating_event` concept:
 *
 *     rating_event [object]: iOS 별점 게이트 (4단계 SKStoreReviewController)
 *
 * It also keeps the funnel state-machine free of side-effects: the
 * state machine treats `rating_gate` (funnel step 4) as a dismissable
 * dialog; this service is what calculates *whether* that dialog (or any
 * later SKStoreReviewController call site) should fire on a given user
 * action.
 *
 * Design choices:
 *   - Counters are immutable `RatingActionCounters` snapshots.  Every
 *     mutator (`incrementAction`) returns a NEW frozen instance.
 *   - The trigger evaluator is a pure function — same input → same
 *     output, no globals, no `Date.now()`.  Time is irrelevant; Apple's
 *     SDK handles the 365-day cap.
 *   - `alreadyPromptedStages` lets the caller suppress stages already
 *     fired so the highest unprompted satisfied stage is returned —
 *     making the service idempotent across app sessions when the host
 *     persists prompt state on disk.
 *   - Schema validation runs on every public entry point; rejects
 *     surface as `RatingGateError` with a structured `reason` so call
 *     sites branch on the discriminator, not the error message.
 *   - Defence-in-depth: every returned record (counters, decision,
 *     condition list) is `Object.freeze`d at construction time.
 */

// ---------------------------------------------------------------------------
// Public contract — actions, counters, stages
// ---------------------------------------------------------------------------

/**
 * Discrete user action that contributes to one or more trigger
 * conditions.  Names match the rating_event concept verbatim so
 * dashboards and analytics replays line up across modules.
 */
export const RATING_ACTION_TYPES = Object.freeze([
  'app_launched',
  'diagnosis_completed',
  'share_completed',
  'payment_completed',
] as const);

export type RatingActionType = (typeof RATING_ACTION_TYPES)[number];

/**
 * Append-only counter snapshot.  Treat as a value object — every
 * mutation produces a new frozen instance via {@link incrementAction}.
 */
export interface RatingActionCounters {
  readonly app_launched: number;
  readonly diagnosis_completed: number;
  readonly share_completed: number;
  readonly payment_completed: number;
}

/**
 * Identifies one of the four staged triggers.  Ordered semantically
 * from least to most engaged so callers can pick the highest satisfied
 * stage.
 */
export type RatingTriggerStage = 1 | 2 | 3 | 4;

/** All four stages in canonical order. */
export const RATING_TRIGGER_STAGES: readonly RatingTriggerStage[] = Object.freeze(
  [1, 2, 3, 4] as const,
);

/**
 * Declarative trigger condition: a stage fires once every entry in
 * `minimums` is met by the counter snapshot.  Missing counter keys are
 * treated as 0 minimums (irrelevant for that stage).
 */
export interface RatingTriggerCondition {
  readonly stage: RatingTriggerStage;
  readonly label: string;
  readonly minimums: Readonly<Partial<Record<RatingActionType, number>>>;
}

/**
 * Canonical 4-stage ladder used by the iOS rating gate.  Frozen at
 * module load so consumers cannot mutate the contract.
 *
 * Tuning:
 *   - Stage 1 ("habit-forming"):  5 app launches.
 *   - Stage 2 ("engaged"):        3 completed diagnoses (any category).
 *   - Stage 3 ("advocate"):       1 share completed.
 *   - Stage 4 ("committed"):      1 paid checkout completed.
 *
 * The thresholds are intentionally low so the SDK's own 3-per-year cap
 * is the real ceiling — the service exists to *order* the asks, not
 * impose its own quota.
 */
export const DEFAULT_RATING_TRIGGER_CONDITIONS: readonly RatingTriggerCondition[] =
  Object.freeze([
    Object.freeze({
      stage: 1 as RatingTriggerStage,
      label: 'habit_forming',
      minimums: Object.freeze({ app_launched: 5 }),
    }),
    Object.freeze({
      stage: 2 as RatingTriggerStage,
      label: 'engaged',
      minimums: Object.freeze({ diagnosis_completed: 3 }),
    }),
    Object.freeze({
      stage: 3 as RatingTriggerStage,
      label: 'advocate',
      minimums: Object.freeze({ share_completed: 1 }),
    }),
    Object.freeze({
      stage: 4 as RatingTriggerStage,
      label: 'committed',
      minimums: Object.freeze({ payment_completed: 1 }),
    }),
  ]);

/**
 * Initial / zero-state snapshot.  Frozen — callers must not mutate.
 */
export const ZERO_RATING_COUNTERS: RatingActionCounters = Object.freeze({
  app_launched: 0,
  diagnosis_completed: 0,
  share_completed: 0,
  payment_completed: 0,
});

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export type RatingGateErrorReason =
  | 'unknown_action'
  | 'invalid_amount'
  | 'invalid_counter'
  | 'invalid_stage'
  | 'invalid_conditions';

export class RatingGateError extends Error {
  public override readonly name = 'RatingGateError';
  public readonly reason: RatingGateErrorReason;
  public readonly value: unknown;

  constructor(reason: RatingGateErrorReason, message: string, value: unknown) {
    super(message);
    this.reason = reason;
    this.value = value;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isFiniteInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  );
}

function validateAction(action: unknown): asserts action is RatingActionType {
  if (typeof action !== 'string') {
    throw new RatingGateError(
      'unknown_action',
      `action must be a string, got ${typeof action}`,
      action,
    );
  }
  if (!RATING_ACTION_TYPES.includes(action as RatingActionType)) {
    throw new RatingGateError(
      'unknown_action',
      `action must be one of ${RATING_ACTION_TYPES.join(', ')} (got "${action}")`,
      action,
    );
  }
}

function validateAmount(amount: unknown): asserts amount is number {
  if (!isFiniteInteger(amount)) {
    throw new RatingGateError(
      'invalid_amount',
      `amount must be a finite integer (got ${String(amount)})`,
      amount,
    );
  }
  if (amount < 1) {
    throw new RatingGateError(
      'invalid_amount',
      `amount must be >= 1 (got ${amount})`,
      amount,
    );
  }
}

function validateCounters(counters: unknown): asserts counters is RatingActionCounters {
  if (counters === null || typeof counters !== 'object') {
    throw new RatingGateError(
      'invalid_counter',
      `counters must be an object, got ${counters === null ? 'null' : typeof counters}`,
      counters,
    );
  }
  for (const key of RATING_ACTION_TYPES) {
    const value = (counters as Record<string, unknown>)[key];
    if (!isFiniteInteger(value) || (value as number) < 0) {
      throw new RatingGateError(
        'invalid_counter',
        `counters.${key} must be a non-negative integer (got ${String(value)})`,
        value,
      );
    }
  }
}

function isRatingStage(value: unknown): value is RatingTriggerStage {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function validateStages(stages: unknown): asserts stages is readonly RatingTriggerStage[] {
  if (!Array.isArray(stages)) {
    throw new RatingGateError(
      'invalid_stage',
      `alreadyPromptedStages must be an array (got ${typeof stages})`,
      stages,
    );
  }
  for (const stage of stages) {
    if (!isRatingStage(stage)) {
      throw new RatingGateError(
        'invalid_stage',
        `alreadyPromptedStages entries must be 1|2|3|4 (got ${String(stage)})`,
        stage,
      );
    }
  }
}

function validateConditions(
  conditions: unknown,
): asserts conditions is readonly RatingTriggerCondition[] {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new RatingGateError(
      'invalid_conditions',
      'conditions must be a non-empty array',
      conditions,
    );
  }
  const seenStages = new Set<RatingTriggerStage>();
  for (const cond of conditions) {
    if (cond === null || typeof cond !== 'object') {
      throw new RatingGateError(
        'invalid_conditions',
        'each condition must be an object',
        cond,
      );
    }
    const stage = (cond as RatingTriggerCondition).stage;
    if (!isRatingStage(stage)) {
      throw new RatingGateError(
        'invalid_conditions',
        `condition.stage must be 1|2|3|4 (got ${String(stage)})`,
        stage,
      );
    }
    if (seenStages.has(stage)) {
      throw new RatingGateError(
        'invalid_conditions',
        `duplicate stage in conditions: ${stage}`,
        stage,
      );
    }
    seenStages.add(stage);
    const minimums = (cond as RatingTriggerCondition).minimums;
    if (minimums === null || typeof minimums !== 'object') {
      throw new RatingGateError(
        'invalid_conditions',
        `condition.minimums must be an object (stage ${stage})`,
        minimums,
      );
    }
    for (const [k, v] of Object.entries(minimums)) {
      if (!RATING_ACTION_TYPES.includes(k as RatingActionType)) {
        throw new RatingGateError(
          'invalid_conditions',
          `condition.minimums has unknown action "${k}" (stage ${stage})`,
          k,
        );
      }
      if (!isFiniteInteger(v) || (v as number) < 0) {
        throw new RatingGateError(
          'invalid_conditions',
          `condition.minimums.${k} must be a non-negative integer (got ${String(v)})`,
          v,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Counter mutation — returns a NEW frozen instance
// ---------------------------------------------------------------------------

/**
 * Returns a NEW frozen {@link RatingActionCounters} with the given
 * action incremented by `amount` (default 1).  The original snapshot
 * is unchanged.
 */
export function incrementAction(
  counters: RatingActionCounters,
  action: RatingActionType,
  amount = 1,
): RatingActionCounters {
  validateCounters(counters);
  validateAction(action);
  validateAmount(amount);

  return Object.freeze({
    app_launched: counters.app_launched + (action === 'app_launched' ? amount : 0),
    diagnosis_completed:
      counters.diagnosis_completed +
      (action === 'diagnosis_completed' ? amount : 0),
    share_completed:
      counters.share_completed + (action === 'share_completed' ? amount : 0),
    payment_completed:
      counters.payment_completed +
      (action === 'payment_completed' ? amount : 0),
  }) satisfies RatingActionCounters;
}

// ---------------------------------------------------------------------------
// Trigger evaluation
// ---------------------------------------------------------------------------

/**
 * Decision returned by {@link evaluateRatingTrigger}.  Frozen so the
 * caller cannot accidentally mutate the audit trail.
 */
export interface RatingTriggerDecision {
  /** True iff at least one stage is satisfied AND not yet prompted. */
  readonly shouldPrompt: boolean;
  /**
   * Highest satisfied stage that has NOT yet been prompted, or null
   * when no fresh stage is available.  The host should call
   * `SKStoreReviewController.requestReview()` for this stage and then
   * record it in `alreadyPromptedStages` for the next evaluation.
   */
  readonly stage: RatingTriggerStage | null;
  /** All stages whose minimums are met by the current counters. */
  readonly satisfiedStages: readonly RatingTriggerStage[];
  /** Echoed counters for traceability. */
  readonly counters: RatingActionCounters;
  /** Echoed prompt history for traceability. */
  readonly alreadyPromptedStages: readonly RatingTriggerStage[];
}

export interface EvaluateRatingTriggerOptions {
  /** Override the canonical 4-stage ladder (test-only / experiments). */
  readonly conditions?: readonly RatingTriggerCondition[];
  /** Stages the host has already prompted in prior sessions. */
  readonly alreadyPromptedStages?: readonly RatingTriggerStage[];
}

function meetsMinimums(
  counters: RatingActionCounters,
  minimums: Readonly<Partial<Record<RatingActionType, number>>>,
): boolean {
  for (const action of RATING_ACTION_TYPES) {
    const required = minimums[action] ?? 0;
    if (counters[action] < required) {
      return false;
    }
  }
  return true;
}

/**
 * Pure trigger evaluator.  Walks the (optionally custom) stage ladder
 * and returns the highest stage whose minimums are met by `counters`
 * AND that has not yet been prompted.  Same input → same frozen
 * output.
 */
export function evaluateRatingTrigger(
  counters: RatingActionCounters,
  options?: EvaluateRatingTriggerOptions,
): RatingTriggerDecision {
  validateCounters(counters);

  const conditions = options?.conditions ?? DEFAULT_RATING_TRIGGER_CONDITIONS;
  validateConditions(conditions);

  const promptedRaw = options?.alreadyPromptedStages ?? [];
  validateStages(promptedRaw);
  const promptedSet = new Set<RatingTriggerStage>(promptedRaw);

  // Sort conditions by ascending stage so satisfiedStages is canonical.
  const orderedConditions = [...conditions].sort((a, b) => a.stage - b.stage);

  const satisfiedStages: RatingTriggerStage[] = [];
  for (const cond of orderedConditions) {
    if (meetsMinimums(counters, cond.minimums)) {
      satisfiedStages.push(cond.stage);
    }
  }

  // Pick the HIGHEST satisfied stage not yet prompted.  Walking the
  // satisfied list in reverse keeps the selection deterministic.
  let selected: RatingTriggerStage | null = null;
  for (let i = satisfiedStages.length - 1; i >= 0; i -= 1) {
    const stage = satisfiedStages[i] as RatingTriggerStage;
    if (!promptedSet.has(stage)) {
      selected = stage;
      break;
    }
  }

  return Object.freeze({
    shouldPrompt: selected !== null,
    stage: selected,
    satisfiedStages: Object.freeze([...satisfiedStages]),
    counters: Object.freeze({ ...counters }),
    alreadyPromptedStages: Object.freeze([...promptedRaw]),
  }) satisfies RatingTriggerDecision;
}

// ---------------------------------------------------------------------------
// Stateful façade — RatingGateService
// ---------------------------------------------------------------------------

/**
 * Thin stateful façade over the pure helpers above.  Useful for host
 * apps that want a single object to hold counters + prompt history
 * across a session, while still serializing both to disk between
 * launches via {@link RatingGateService.snapshot}.
 *
 * Mutation contract:
 *   - `track(action)` mutates internal state by reassignment to NEW
 *     frozen objects (so observable state is still immutable per
 *     snapshot).
 *   - `evaluate()` is read-only.
 *   - `markPrompted(stage)` records that the host actually invoked
 *     SKStoreReviewController for `stage`.
 */
export interface RatingGateSnapshot {
  readonly counters: RatingActionCounters;
  readonly alreadyPromptedStages: readonly RatingTriggerStage[];
}

export interface RatingGateService {
  /** Increment one action by `amount` (default 1).  Returns latest snapshot. */
  track(action: RatingActionType, amount?: number): RatingGateSnapshot;
  /** Pure read of the current decision. */
  evaluate(): RatingTriggerDecision;
  /** Record that the host fired SKStoreReviewController for `stage`. */
  markPrompted(stage: RatingTriggerStage): RatingGateSnapshot;
  /** Frozen view of current state — safe to persist to disk. */
  snapshot(): RatingGateSnapshot;
}

export interface CreateRatingGateServiceOptions {
  readonly initialCounters?: RatingActionCounters;
  readonly initialPromptedStages?: readonly RatingTriggerStage[];
  readonly conditions?: readonly RatingTriggerCondition[];
}

export function createRatingGateService(
  options?: CreateRatingGateServiceOptions,
): RatingGateService {
  const conditions = options?.conditions ?? DEFAULT_RATING_TRIGGER_CONDITIONS;
  validateConditions(conditions);

  let counters: RatingActionCounters = options?.initialCounters
    ? (validateCounters(options.initialCounters),
      Object.freeze({ ...options.initialCounters }))
    : ZERO_RATING_COUNTERS;

  const initialStages = options?.initialPromptedStages ?? [];
  validateStages(initialStages);
  let prompted: readonly RatingTriggerStage[] = Object.freeze([...initialStages]);

  function makeSnapshot(): RatingGateSnapshot {
    return Object.freeze({
      counters,
      alreadyPromptedStages: prompted,
    }) satisfies RatingGateSnapshot;
  }

  return Object.freeze({
    track(action: RatingActionType, amount = 1): RatingGateSnapshot {
      counters = incrementAction(counters, action, amount);
      return makeSnapshot();
    },
    evaluate(): RatingTriggerDecision {
      return evaluateRatingTrigger(counters, {
        conditions,
        alreadyPromptedStages: prompted,
      });
    },
    markPrompted(stage: RatingTriggerStage): RatingGateSnapshot {
      if (!isRatingStage(stage)) {
        throw new RatingGateError(
          'invalid_stage',
          `stage must be 1|2|3|4 (got ${String(stage)})`,
          stage,
        );
      }
      if (!prompted.includes(stage)) {
        prompted = Object.freeze([...prompted, stage]);
      }
      return makeSnapshot();
    },
    snapshot() {
      return makeSnapshot();
    },
  }) satisfies RatingGateService;
}
