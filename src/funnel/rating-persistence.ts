/**
 * Sub-AC 8.2 — RatingPersistence (iOS UserDefaults / RN AsyncStorage abstraction).
 *
 * The iOS rating ladder (Sub-AC 8.1) is *idempotent*: once stage N has
 * been surfaced to the user via `SKStoreReviewController.requestReview()`,
 * we should not ask again on the next launch.  Apple already enforces a
 * 3-prompts-per-365-day cap, but the host app must still remember which
 * stage was last prompted so the funnel does not re-ask immediately
 * after relaunch — and so we can suppress prompts when the user is
 * still on the same app version that already declined.
 *
 * This module is a thin, platform-agnostic persistence layer that:
 *
 *   1. Models the persisted record as an immutable
 *      `RatingPersistedState` value object containing:
 *        • lastPromptedAt   — ISO-8601 timestamp of the last request
 *        • lastPromptedVersion — semver string of the app version that
 *          surfaced the dialog (so we re-arm on version bumps)
 *        • lastPromptedStage  — 1 | 2 | 3 | 4 | null
 *        • promptedStages     — accumulated history (subset of 1..4)
 *
 *   2. Abstracts the underlying KV store behind a 3-method async
 *      interface — `KeyValueStore` — that maps cleanly onto either
 *      iOS `UserDefaults` (sync, wrapped in `Promise.resolve`) or React
 *      Native `AsyncStorage` (already async).
 *
 *   3. Provides pure (de)serialization helpers — `serializeRatingPersistedState`
 *      and `deserializeRatingPersistedState` — so the underlying KV
 *      can store a single JSON blob under one key.  Backwards-compatible
 *      defaults are applied for missing optional fields.
 *
 *   4. Exposes a façade `createRatingPersistence(store, options)` with
 *      `load`, `save`, `clear`, and `recordPrompt` so call sites do not
 *      have to assemble the JSON envelope themselves.
 *
 *   5. Includes an `InMemoryKeyValueStore` reference implementation used
 *      by tests AND host apps that want an ephemeral fallback on
 *      platforms without `UserDefaults`/`AsyncStorage`.
 *
 * All public outputs are `Object.freeze`d.  Schema rejects surface as
 * `RatingPersistenceError` with a discriminated `reason` so callers can
 * branch on machine-readable codes instead of error message strings.
 *
 * NOTE: This module is intentionally *decoupled* from
 * {@link RatingGateService} — it only deals with the *persistence* side
 * of the rating-event concept.  Callers wire the two together at the
 * application boundary.
 */

import type { RatingTriggerStage } from './rating-gate.js';

// ---------------------------------------------------------------------------
// Storage key + version
// ---------------------------------------------------------------------------

/**
 * Single storage key under which the whole envelope is persisted.  Kept
 * stable across releases — schema changes must use `schemaVersion`
 * inside the envelope instead.
 */
export const DEFAULT_RATING_PERSISTENCE_KEY =
  'personal_color_kr:rating_gate:v1' as const;

/**
 * Current envelope schema version.  Bump this when the serialized shape
 * changes in a non-backwards-compatible way; deserialize will then
 * reject older payloads with `reason: 'unsupported_schema'`.
 */
export const RATING_PERSISTENCE_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The four canonical stages that may be prompted, mirroring the ladder
 * in {@link DEFAULT_RATING_TRIGGER_CONDITIONS}.  Re-exported indirectly
 * via the `RatingTriggerStage` import so this module remains in sync
 * with rating-gate.ts without a value-level dependency.
 */
export type RatingPromptStage = RatingTriggerStage;

/**
 * Immutable record describing what we last persisted about the rating
 * gate.  All fields are optional in serialized form but always present
 * after `deserializeRatingPersistedState` so callers do not need to
 * null-check; missing fields are filled with neutral defaults.
 */
export interface RatingPersistedState {
  /** ISO-8601 timestamp of the most recent prompt attempt, or null. */
  readonly lastPromptedAt: string | null;
  /** App version (semver-ish string) at the time of the prompt. */
  readonly lastPromptedVersion: string | null;
  /** Stage that produced the last prompt (1..4), or null. */
  readonly lastPromptedStage: RatingPromptStage | null;
  /** Full history of stages prompted so far (subset of 1..4). */
  readonly promptedStages: readonly RatingPromptStage[];
  /** Envelope schema version — currently always 1. */
  readonly schemaVersion: number;
}

/**
 * Async KV-store contract that both iOS `UserDefaults` (wrapped) and RN
 * `AsyncStorage` satisfy.  Keep it minimal — only three methods are
 * needed.  All methods MAY throw / reject; the persistence façade will
 * wrap underlying errors into {@link RatingPersistenceError}.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Zero/empty state used as a default after `clear` or on cold start. */
export const EMPTY_RATING_PERSISTED_STATE: RatingPersistedState = Object.freeze({
  lastPromptedAt: null,
  lastPromptedVersion: null,
  lastPromptedStage: null,
  promptedStages: Object.freeze([]),
  schemaVersion: RATING_PERSISTENCE_SCHEMA_VERSION,
}) satisfies RatingPersistedState;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type RatingPersistenceErrorReason =
  | 'invalid_key'
  | 'invalid_store'
  | 'invalid_state'
  | 'invalid_timestamp'
  | 'invalid_version'
  | 'invalid_stage'
  | 'invalid_json'
  | 'unsupported_schema'
  | 'store_failure';

export class RatingPersistenceError extends Error {
  public override readonly name = 'RatingPersistenceError';
  public readonly reason: RatingPersistenceErrorReason;
  public readonly value: unknown;
  public override readonly cause?: unknown;

  constructor(
    reason: RatingPersistenceErrorReason,
    message: string,
    value: unknown,
    cause?: unknown,
  ) {
    super(message);
    this.reason = reason;
    this.value = value;
    if (cause !== undefined) {
      this.cause = cause;
    }
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

function isRatingStage(value: unknown): value is RatingPromptStage {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function validateKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new RatingPersistenceError(
      'invalid_key',
      `key must be a non-empty string (got ${String(key)})`,
      key,
    );
  }
}

function validateStore(store: unknown): asserts store is KeyValueStore {
  if (store === null || typeof store !== 'object') {
    throw new RatingPersistenceError(
      'invalid_store',
      `store must be an object (got ${store === null ? 'null' : typeof store})`,
      store,
    );
  }
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    if (typeof (store as Record<string, unknown>)[method] !== 'function') {
      throw new RatingPersistenceError(
        'invalid_store',
        `store.${method} must be a function`,
        store,
      );
    }
  }
}

const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function validateTimestamp(value: unknown): asserts value is string | null {
  if (value === null) return;
  if (typeof value !== 'string' || !ISO_TIMESTAMP_RE.test(value)) {
    throw new RatingPersistenceError(
      'invalid_timestamp',
      `timestamp must be an ISO-8601 string or null (got ${String(value)})`,
      value,
    );
  }
  // Defence-in-depth: must also parse as a real Date.
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new RatingPersistenceError(
      'invalid_timestamp',
      `timestamp must parse as a Date (got "${value}")`,
      value,
    );
  }
}

function validateVersion(value: unknown): asserts value is string | null {
  if (value === null) return;
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new RatingPersistenceError(
      'invalid_version',
      `version must be a 1..64 char string or null (got ${String(value)})`,
      value,
    );
  }
}

function validateOptionalStage(
  value: unknown,
): asserts value is RatingPromptStage | null {
  if (value === null) return;
  if (!isRatingStage(value)) {
    throw new RatingPersistenceError(
      'invalid_stage',
      `stage must be 1|2|3|4 or null (got ${String(value)})`,
      value,
    );
  }
}

function validateStages(
  value: unknown,
): asserts value is readonly RatingPromptStage[] {
  if (!Array.isArray(value)) {
    throw new RatingPersistenceError(
      'invalid_stage',
      `promptedStages must be an array (got ${typeof value})`,
      value,
    );
  }
  const seen = new Set<RatingPromptStage>();
  for (const stage of value) {
    if (!isRatingStage(stage)) {
      throw new RatingPersistenceError(
        'invalid_stage',
        `promptedStages entries must be 1|2|3|4 (got ${String(stage)})`,
        stage,
      );
    }
    seen.add(stage);
  }
  // Drop duplicates silently — we want idempotent recording.
  if (seen.size !== value.length) {
    // Replace caller's array with a deduped view via a thrown re-assign
    // is too magical; instead, validateStages just checks types and we
    // dedupe at normalization time.
  }
}

function normalizeStages(
  stages: readonly RatingPromptStage[],
): readonly RatingPromptStage[] {
  const seen = new Set<RatingPromptStage>();
  for (const s of stages) seen.add(s);
  return Object.freeze([...seen].sort((a, b) => a - b));
}

function validateState(state: unknown): asserts state is RatingPersistedState {
  if (state === null || typeof state !== 'object') {
    throw new RatingPersistenceError(
      'invalid_state',
      `state must be an object (got ${state === null ? 'null' : typeof state})`,
      state,
    );
  }
  const s = state as RatingPersistedState;
  validateTimestamp(s.lastPromptedAt);
  validateVersion(s.lastPromptedVersion);
  validateOptionalStage(s.lastPromptedStage);
  validateStages(s.promptedStages);
  if (
    !isFiniteInteger(s.schemaVersion) ||
    s.schemaVersion < 1
  ) {
    throw new RatingPersistenceError(
      'invalid_state',
      `schemaVersion must be a positive integer (got ${String(s.schemaVersion)})`,
      s.schemaVersion,
    );
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — freezing + normalization
// ---------------------------------------------------------------------------

/**
 * Returns a NEW frozen state with promptedStages deduped/sorted and
 * envelope schema version pinned to the current value.  The original
 * input is untouched.
 */
export function freezeRatingPersistedState(
  state: RatingPersistedState,
): RatingPersistedState {
  validateState(state);
  return Object.freeze({
    lastPromptedAt: state.lastPromptedAt,
    lastPromptedVersion: state.lastPromptedVersion,
    lastPromptedStage: state.lastPromptedStage,
    promptedStages: normalizeStages(state.promptedStages),
    schemaVersion: state.schemaVersion,
  }) satisfies RatingPersistedState;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Encodes `state` as the canonical JSON envelope that lives under one
 * KV key.  Throws `RatingPersistenceError` on schema failure so callers
 * never write malformed data.
 */
export function serializeRatingPersistedState(
  state: RatingPersistedState,
): string {
  const frozen = freezeRatingPersistedState(state);
  return JSON.stringify({
    schemaVersion: frozen.schemaVersion,
    lastPromptedAt: frozen.lastPromptedAt,
    lastPromptedVersion: frozen.lastPromptedVersion,
    lastPromptedStage: frozen.lastPromptedStage,
    promptedStages: [...frozen.promptedStages],
  });
}

/**
 * Decodes a JSON envelope produced by {@link serializeRatingPersistedState}.
 *
 * - `null` / empty string → returns {@link EMPTY_RATING_PERSISTED_STATE}.
 * - Missing optional fields → filled with neutral defaults.
 * - Unknown schemaVersion → `RatingPersistenceError('unsupported_schema')`.
 * - Malformed JSON / wrong types → `RatingPersistenceError('invalid_json')`
 *   or the relevant field-level reason.
 */
export function deserializeRatingPersistedState(
  raw: string | null,
): RatingPersistedState {
  if (raw === null || raw === '') {
    return EMPTY_RATING_PERSISTED_STATE;
  }
  if (typeof raw !== 'string') {
    throw new RatingPersistenceError(
      'invalid_json',
      `raw payload must be a string or null (got ${typeof raw})`,
      raw,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new RatingPersistenceError(
      'invalid_json',
      `payload is not valid JSON: ${(err as Error).message}`,
      raw,
      err,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RatingPersistenceError(
      'invalid_json',
      'payload must decode to a JSON object',
      parsed,
    );
  }

  const obj = parsed as Record<string, unknown>;

  const schemaVersion =
    obj.schemaVersion ?? RATING_PERSISTENCE_SCHEMA_VERSION;
  if (!isFiniteInteger(schemaVersion) || (schemaVersion as number) < 1) {
    throw new RatingPersistenceError(
      'invalid_state',
      `schemaVersion must be a positive integer (got ${String(schemaVersion)})`,
      schemaVersion,
    );
  }
  if ((schemaVersion as number) !== RATING_PERSISTENCE_SCHEMA_VERSION) {
    throw new RatingPersistenceError(
      'unsupported_schema',
      `unsupported schemaVersion ${String(schemaVersion)} (current: ${RATING_PERSISTENCE_SCHEMA_VERSION})`,
      schemaVersion,
    );
  }

  const lastPromptedAt = obj.lastPromptedAt ?? null;
  const lastPromptedVersion = obj.lastPromptedVersion ?? null;
  const lastPromptedStage = obj.lastPromptedStage ?? null;
  const promptedStages = Array.isArray(obj.promptedStages)
    ? (obj.promptedStages as RatingPromptStage[])
    : [];

  const candidate: RatingPersistedState = {
    lastPromptedAt: lastPromptedAt as string | null,
    lastPromptedVersion: lastPromptedVersion as string | null,
    lastPromptedStage: lastPromptedStage as RatingPromptStage | null,
    promptedStages,
    schemaVersion: schemaVersion as number,
  };

  return freezeRatingPersistedState(candidate);
}

// ---------------------------------------------------------------------------
// In-memory reference store (used by tests and as a fallback)
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory `KeyValueStore` for tests, SSR, and fallback paths
 * on platforms without `UserDefaults`/`AsyncStorage`.  All operations
 * resolve asynchronously to mimic the real adapters.
 */
export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly data: Map<string, string>;

  constructor(initial?: Readonly<Record<string, string>>) {
    this.data = new Map();
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        if (typeof v === 'string') {
          this.data.set(k, v);
        }
      }
    }
  }

  async getItem(key: string): Promise<string | null> {
    validateKey(key);
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    validateKey(key);
    if (typeof value !== 'string') {
      throw new RatingPersistenceError(
        'invalid_state',
        `value must be a string (got ${typeof value})`,
        value,
      );
    }
    this.data.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    validateKey(key);
    this.data.delete(key);
  }

  /** Test-only helper: snapshot the entire backing map. */
  snapshot(): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries(this.data.entries()));
  }
}

// ---------------------------------------------------------------------------
// Façade — createRatingPersistence
// ---------------------------------------------------------------------------

export interface RatingPersistence {
  /** Load the persisted state.  Returns the empty state if missing. */
  load(): Promise<RatingPersistedState>;
  /** Persist a full state object.  Returns the frozen value written. */
  save(state: RatingPersistedState): Promise<RatingPersistedState>;
  /** Remove the persisted state entirely (e.g. account reset). */
  clear(): Promise<void>;
  /**
   * Merge a new prompt event into the existing persisted state and
   * write it back.  Returns the frozen post-write state.  Pure-ish:
   * does not mutate any input.
   */
  recordPrompt(input: RecordPromptInput): Promise<RatingPersistedState>;
}

export interface RecordPromptInput {
  readonly stage: RatingPromptStage;
  readonly promptedAt: string;
  readonly appVersion: string;
}

export interface CreateRatingPersistenceOptions {
  /** Override the storage key (e.g. for multi-tenant testing). */
  readonly key?: string;
}

/**
 * Factory wiring a {@link KeyValueStore} + storage key into a
 * persistence façade.  All methods catch underlying store rejections
 * and re-raise them as `RatingPersistenceError(reason='store_failure')`
 * so call sites only need to handle one error type.
 */
export function createRatingPersistence(
  store: KeyValueStore,
  options?: CreateRatingPersistenceOptions,
): RatingPersistence {
  validateStore(store);
  const key = options?.key ?? DEFAULT_RATING_PERSISTENCE_KEY;
  validateKey(key);

  async function safeGet(): Promise<string | null> {
    try {
      return await store.getItem(key);
    } catch (err) {
      throw new RatingPersistenceError(
        'store_failure',
        `store.getItem(${key}) failed: ${(err as Error).message}`,
        key,
        err,
      );
    }
  }
  async function safeSet(value: string): Promise<void> {
    try {
      await store.setItem(key, value);
    } catch (err) {
      throw new RatingPersistenceError(
        'store_failure',
        `store.setItem(${key}) failed: ${(err as Error).message}`,
        key,
        err,
      );
    }
  }
  async function safeRemove(): Promise<void> {
    try {
      await store.removeItem(key);
    } catch (err) {
      throw new RatingPersistenceError(
        'store_failure',
        `store.removeItem(${key}) failed: ${(err as Error).message}`,
        key,
        err,
      );
    }
  }

  return Object.freeze({
    async load(): Promise<RatingPersistedState> {
      const raw = await safeGet();
      return deserializeRatingPersistedState(raw);
    },
    async save(state: RatingPersistedState): Promise<RatingPersistedState> {
      const frozen = freezeRatingPersistedState(state);
      await safeSet(serializeRatingPersistedState(frozen));
      return frozen;
    },
    async clear(): Promise<void> {
      await safeRemove();
    },
    async recordPrompt(
      input: RecordPromptInput,
    ): Promise<RatingPersistedState> {
      if (input === null || typeof input !== 'object') {
        throw new RatingPersistenceError(
          'invalid_state',
          `recordPrompt input must be an object`,
          input,
        );
      }
      validateOptionalStage(input.stage);
      validateTimestamp(input.promptedAt);
      validateVersion(input.appVersion);
      if (input.stage === null) {
        throw new RatingPersistenceError(
          'invalid_stage',
          `recordPrompt requires a concrete stage (got null)`,
          input.stage,
        );
      }
      if (input.promptedAt === null) {
        throw new RatingPersistenceError(
          'invalid_timestamp',
          `recordPrompt requires a concrete promptedAt (got null)`,
          input.promptedAt,
        );
      }
      if (input.appVersion === null) {
        throw new RatingPersistenceError(
          'invalid_version',
          `recordPrompt requires a concrete appVersion (got null)`,
          input.appVersion,
        );
      }

      const prior = deserializeRatingPersistedState(await safeGet());
      const merged: RatingPersistedState = {
        lastPromptedAt: input.promptedAt,
        lastPromptedVersion: input.appVersion,
        lastPromptedStage: input.stage,
        promptedStages: normalizeStages([
          ...prior.promptedStages,
          input.stage,
        ]),
        schemaVersion: RATING_PERSISTENCE_SCHEMA_VERSION,
      };
      const frozen = freezeRatingPersistedState(merged);
      await safeSet(serializeRatingPersistedState(frozen));
      return frozen;
    },
  }) satisfies RatingPersistence;
}
