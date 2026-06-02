/**
 * Unit tests — RatingPersistence (Sub-AC 8.2).
 *
 * Contract under test:
 *   - `RatingPersistedState` is an immutable value object.
 *   - `serializeRatingPersistedState` / `deserializeRatingPersistedState`
 *     are inverse operations and validate schema on both directions.
 *   - `InMemoryKeyValueStore` is a faithful async KV store.
 *   - `createRatingPersistence(store, options)` exposes a load/save/clear/
 *     recordPrompt façade that wraps the store in deterministic ways,
 *     re-raising underlying failures as `RatingPersistenceError`.
 *   - `recordPrompt` merges incoming events with the prior state without
 *     mutating it.
 *
 * Coverage matrix:
 *   1. Constants — DEFAULT_RATING_PERSISTENCE_KEY, RATING_PERSISTENCE_SCHEMA_VERSION,
 *      EMPTY_RATING_PERSISTED_STATE shape + frozen.
 *   2. `freezeRatingPersistedState`:
 *      a. Returns a NEW frozen object.
 *      b. Deduplicates + sorts promptedStages.
 *      c. Schema rejects bad inputs (timestamp, version, stage, history).
 *   3. Serialization round-trip:
 *      a. Empty state round-trips losslessly.
 *      b. Fully populated state round-trips losslessly.
 *      c. `deserialize(null)` and `deserialize('')` → empty state.
 *      d. Missing optional fields fill with neutral defaults.
 *      e. `deserialize` rejects malformed JSON.
 *      f. `deserialize` rejects non-object payloads.
 *      g. `deserialize` rejects unknown schemaVersion.
 *      h. `deserialize` rejects bad timestamps, versions, stages.
 *   4. `InMemoryKeyValueStore`:
 *      a. get → null on miss.
 *      b. set then get round-trip.
 *      c. removeItem clears.
 *      d. Constructor seeds initial data.
 *      e. snapshot returns a frozen copy.
 *      f. Rejects invalid keys / non-string values.
 *   5. `createRatingPersistence` façade:
 *      a. Construction validates store + key.
 *      b. load() on empty store → empty state.
 *      c. save() then load() round-trip.
 *      d. clear() empties.
 *      e. recordPrompt appends a new stage and updates last* fields.
 *      f. recordPrompt is idempotent for duplicate stages.
 *      g. recordPrompt rejects bad inputs.
 *      h. Underlying store failure → wrapped store_failure error.
 *      i. Custom key option is honoured.
 *      j. Façade object itself is frozen.
 *   6. Integration: load → mutate-locally → save reproduces the same
 *      blob byte-for-byte.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RATING_PERSISTENCE_KEY,
  EMPTY_RATING_PERSISTED_STATE,
  InMemoryKeyValueStore,
  RATING_PERSISTENCE_SCHEMA_VERSION,
  RatingPersistenceError,
  createRatingPersistence,
  deserializeRatingPersistedState,
  freezeRatingPersistedState,
  serializeRatingPersistedState,
  type KeyValueStore,
  type RatingPersistedState,
} from '../../src/funnel/rating-persistence.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function expectThrowsAsync(
  fn: () => Promise<unknown>,
): Promise<RatingPersistenceError> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RatingPersistenceError);
  return caught as RatingPersistenceError;
}

function expectThrows(fn: () => unknown): RatingPersistenceError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RatingPersistenceError);
  return caught as RatingPersistenceError;
}

const SAMPLE_STATE: RatingPersistedState = {
  lastPromptedAt: '2025-12-01T10:00:00.000Z',
  lastPromptedVersion: '1.4.2',
  lastPromptedStage: 3,
  promptedStages: [1, 3],
  schemaVersion: RATING_PERSISTENCE_SCHEMA_VERSION,
};

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

describe('rating-persistence constants', () => {
  it('exposes a stable default storage key', () => {
    expect(DEFAULT_RATING_PERSISTENCE_KEY).toBe('personal_color_kr:rating_gate:v1');
  });

  it('has a positive integer schema version', () => {
    expect(RATING_PERSISTENCE_SCHEMA_VERSION).toBe(1);
  });

  it('EMPTY_RATING_PERSISTED_STATE is a frozen empty record', () => {
    expect(Object.isFrozen(EMPTY_RATING_PERSISTED_STATE)).toBe(true);
    expect(Object.isFrozen(EMPTY_RATING_PERSISTED_STATE.promptedStages)).toBe(true);
    expect(EMPTY_RATING_PERSISTED_STATE).toEqual({
      lastPromptedAt: null,
      lastPromptedVersion: null,
      lastPromptedStage: null,
      promptedStages: [],
      schemaVersion: RATING_PERSISTENCE_SCHEMA_VERSION,
    });
  });
});

// ---------------------------------------------------------------------------
// 2. freezeRatingPersistedState
// ---------------------------------------------------------------------------

describe('freezeRatingPersistedState', () => {
  it('returns a NEW frozen object distinct from input', () => {
    const input: RatingPersistedState = {
      ...SAMPLE_STATE,
      promptedStages: [...SAMPLE_STATE.promptedStages],
    };
    const out = freezeRatingPersistedState(input);
    expect(out).not.toBe(input);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.promptedStages)).toBe(true);
  });

  it('deduplicates and sorts promptedStages', () => {
    const out = freezeRatingPersistedState({
      ...SAMPLE_STATE,
      promptedStages: [3, 1, 3, 1, 2],
    });
    expect(out.promptedStages).toEqual([1, 2, 3]);
  });

  it('rejects bogus timestamp', () => {
    const err = expectThrows(() =>
      freezeRatingPersistedState({
        ...SAMPLE_STATE,
        lastPromptedAt: 'not-a-date',
      }),
    );
    expect(err.reason).toBe('invalid_timestamp');
  });

  it('rejects bogus stage', () => {
    const err = expectThrows(() =>
      freezeRatingPersistedState({
        ...SAMPLE_STATE,
        lastPromptedStage: 7 as never,
      }),
    );
    expect(err.reason).toBe('invalid_stage');
  });

  it('rejects bogus promptedStages entry', () => {
    const err = expectThrows(() =>
      freezeRatingPersistedState({
        ...SAMPLE_STATE,
        promptedStages: [1, 9 as never],
      }),
    );
    expect(err.reason).toBe('invalid_stage');
  });

  it('rejects bogus version', () => {
    const err = expectThrows(() =>
      freezeRatingPersistedState({
        ...SAMPLE_STATE,
        lastPromptedVersion: '',
      }),
    );
    expect(err.reason).toBe('invalid_version');
  });

  it('rejects bogus schemaVersion', () => {
    const err = expectThrows(() =>
      freezeRatingPersistedState({
        ...SAMPLE_STATE,
        schemaVersion: 0,
      }),
    );
    expect(err.reason).toBe('invalid_state');
  });

  it('rejects non-object', () => {
    const err = expectThrows(() => freezeRatingPersistedState(null as never));
    expect(err.reason).toBe('invalid_state');
  });
});

// ---------------------------------------------------------------------------
// 3. serialize / deserialize round-trip
// ---------------------------------------------------------------------------

describe('serializeRatingPersistedState / deserializeRatingPersistedState', () => {
  it('round-trips the empty state', () => {
    const blob = serializeRatingPersistedState(EMPTY_RATING_PERSISTED_STATE);
    const restored = deserializeRatingPersistedState(blob);
    expect(restored).toEqual(EMPTY_RATING_PERSISTED_STATE);
  });

  it('round-trips a fully populated state', () => {
    const blob = serializeRatingPersistedState(SAMPLE_STATE);
    const restored = deserializeRatingPersistedState(blob);
    expect(restored.lastPromptedAt).toBe(SAMPLE_STATE.lastPromptedAt);
    expect(restored.lastPromptedVersion).toBe(SAMPLE_STATE.lastPromptedVersion);
    expect(restored.lastPromptedStage).toBe(SAMPLE_STATE.lastPromptedStage);
    expect(restored.promptedStages).toEqual([1, 3]);
    expect(restored.schemaVersion).toBe(RATING_PERSISTENCE_SCHEMA_VERSION);
    expect(Object.isFrozen(restored)).toBe(true);
  });

  it('serializes deterministically (same input → same blob)', () => {
    const blob1 = serializeRatingPersistedState(SAMPLE_STATE);
    const blob2 = serializeRatingPersistedState(SAMPLE_STATE);
    expect(blob1).toBe(blob2);
  });

  it('deserialize(null) returns the empty state', () => {
    expect(deserializeRatingPersistedState(null)).toEqual(EMPTY_RATING_PERSISTED_STATE);
  });

  it('deserialize("") returns the empty state', () => {
    expect(deserializeRatingPersistedState('')).toEqual(EMPTY_RATING_PERSISTED_STATE);
  });

  it('fills missing optional fields with neutral defaults', () => {
    const partial = JSON.stringify({
      schemaVersion: RATING_PERSISTENCE_SCHEMA_VERSION,
    });
    const restored = deserializeRatingPersistedState(partial);
    expect(restored.lastPromptedAt).toBeNull();
    expect(restored.lastPromptedVersion).toBeNull();
    expect(restored.lastPromptedStage).toBeNull();
    expect(restored.promptedStages).toEqual([]);
  });

  it('defaults missing schemaVersion to current and accepts the payload', () => {
    const partial = JSON.stringify({ lastPromptedStage: 2 });
    const restored = deserializeRatingPersistedState(partial);
    expect(restored.schemaVersion).toBe(RATING_PERSISTENCE_SCHEMA_VERSION);
    expect(restored.lastPromptedStage).toBe(2);
  });

  it('rejects malformed JSON', () => {
    const err = expectThrows(() => deserializeRatingPersistedState('{not json'));
    expect(err.reason).toBe('invalid_json');
  });

  it('rejects non-object JSON (array)', () => {
    const err = expectThrows(() =>
      deserializeRatingPersistedState(JSON.stringify([1, 2, 3])),
    );
    expect(err.reason).toBe('invalid_json');
  });

  it('rejects non-object JSON (string)', () => {
    const err = expectThrows(() =>
      deserializeRatingPersistedState(JSON.stringify('hello')),
    );
    expect(err.reason).toBe('invalid_json');
  });

  it('rejects unsupported schemaVersion', () => {
    const err = expectThrows(() =>
      deserializeRatingPersistedState(JSON.stringify({ schemaVersion: 99 })),
    );
    expect(err.reason).toBe('unsupported_schema');
  });

  it('rejects payload with bogus timestamp', () => {
    const err = expectThrows(() =>
      deserializeRatingPersistedState(
        JSON.stringify({
          schemaVersion: RATING_PERSISTENCE_SCHEMA_VERSION,
          lastPromptedAt: 'NaN-Day',
        }),
      ),
    );
    expect(err.reason).toBe('invalid_timestamp');
  });

  it('rejects payload with bogus stage', () => {
    const err = expectThrows(() =>
      deserializeRatingPersistedState(
        JSON.stringify({
          schemaVersion: RATING_PERSISTENCE_SCHEMA_VERSION,
          lastPromptedStage: 99,
        }),
      ),
    );
    expect(err.reason).toBe('invalid_stage');
  });

  it('rejects payload with bogus promptedStages entry', () => {
    const err = expectThrows(() =>
      deserializeRatingPersistedState(
        JSON.stringify({
          schemaVersion: RATING_PERSISTENCE_SCHEMA_VERSION,
          promptedStages: [1, 'oops'],
        }),
      ),
    );
    expect(err.reason).toBe('invalid_stage');
  });

  it('rejects non-string raw', () => {
    const err = expectThrows(() => deserializeRatingPersistedState(42 as never));
    expect(err.reason).toBe('invalid_json');
  });
});

// ---------------------------------------------------------------------------
// 4. InMemoryKeyValueStore
// ---------------------------------------------------------------------------

describe('InMemoryKeyValueStore', () => {
  it('returns null on miss', async () => {
    const store = new InMemoryKeyValueStore();
    expect(await store.getItem('missing')).toBeNull();
  });

  it('round-trips set → get', async () => {
    const store = new InMemoryKeyValueStore();
    await store.setItem('k', 'v');
    expect(await store.getItem('k')).toBe('v');
  });

  it('removeItem clears the entry', async () => {
    const store = new InMemoryKeyValueStore({ k: 'v' });
    await store.removeItem('k');
    expect(await store.getItem('k')).toBeNull();
  });

  it('seeds initial data via constructor', async () => {
    const store = new InMemoryKeyValueStore({ a: '1', b: '2' });
    expect(await store.getItem('a')).toBe('1');
    expect(await store.getItem('b')).toBe('2');
  });

  it('ignores non-string initial values', async () => {
    const store = new InMemoryKeyValueStore({
      a: '1',
      b: 2 as unknown as string,
    });
    expect(await store.getItem('a')).toBe('1');
    expect(await store.getItem('b')).toBeNull();
  });

  it('snapshot returns a frozen copy', () => {
    const store = new InMemoryKeyValueStore({ a: '1' });
    const snap = store.snapshot();
    expect(snap).toEqual({ a: '1' });
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('rejects empty / non-string key', async () => {
    const store = new InMemoryKeyValueStore();
    const err = await expectThrowsAsync(() => store.getItem(''));
    expect(err.reason).toBe('invalid_key');
    const err2 = await expectThrowsAsync(() => store.setItem('', 'x'));
    expect(err2.reason).toBe('invalid_key');
    const err3 = await expectThrowsAsync(() => store.removeItem(''));
    expect(err3.reason).toBe('invalid_key');
  });

  it('rejects non-string value on set', async () => {
    const store = new InMemoryKeyValueStore();
    const err = await expectThrowsAsync(() =>
      store.setItem('k', 12 as unknown as string),
    );
    expect(err.reason).toBe('invalid_state');
  });
});

// ---------------------------------------------------------------------------
// 5. createRatingPersistence façade
// ---------------------------------------------------------------------------

describe('createRatingPersistence', () => {
  it('rejects a non-object store', () => {
    const err = expectThrows(() => createRatingPersistence(null as never));
    expect(err.reason).toBe('invalid_store');
  });

  it('rejects a store missing required methods', () => {
    const err = expectThrows(() =>
      createRatingPersistence({
        getItem: async () => null,
        setItem: async () => undefined,
        // removeItem missing
      } as unknown as KeyValueStore),
    );
    expect(err.reason).toBe('invalid_store');
  });

  it('rejects an empty custom key', () => {
    const err = expectThrows(() =>
      createRatingPersistence(new InMemoryKeyValueStore(), { key: '' }),
    );
    expect(err.reason).toBe('invalid_key');
  });

  it('load() on empty store returns the empty state', async () => {
    const store = new InMemoryKeyValueStore();
    const persistence = createRatingPersistence(store);
    const state = await persistence.load();
    expect(state).toEqual(EMPTY_RATING_PERSISTED_STATE);
  });

  it('save() then load() round-trip preserves all fields', async () => {
    const store = new InMemoryKeyValueStore();
    const persistence = createRatingPersistence(store);
    const written = await persistence.save(SAMPLE_STATE);
    expect(Object.isFrozen(written)).toBe(true);

    const reloaded = await persistence.load();
    expect(reloaded.lastPromptedAt).toBe(SAMPLE_STATE.lastPromptedAt);
    expect(reloaded.lastPromptedVersion).toBe(SAMPLE_STATE.lastPromptedVersion);
    expect(reloaded.lastPromptedStage).toBe(SAMPLE_STATE.lastPromptedStage);
    expect(reloaded.promptedStages).toEqual([1, 3]);
  });

  it('clear() empties the underlying store', async () => {
    const store = new InMemoryKeyValueStore();
    const persistence = createRatingPersistence(store);
    await persistence.save(SAMPLE_STATE);
    await persistence.clear();
    expect(await store.getItem(DEFAULT_RATING_PERSISTENCE_KEY)).toBeNull();
    expect(await persistence.load()).toEqual(EMPTY_RATING_PERSISTED_STATE);
  });

  it('recordPrompt updates last* fields and appends to history', async () => {
    const store = new InMemoryKeyValueStore();
    const persistence = createRatingPersistence(store);

    const first = await persistence.recordPrompt({
      stage: 1,
      promptedAt: '2025-12-01T08:00:00.000Z',
      appVersion: '1.0.0',
    });
    expect(first.lastPromptedStage).toBe(1);
    expect(first.lastPromptedAt).toBe('2025-12-01T08:00:00.000Z');
    expect(first.lastPromptedVersion).toBe('1.0.0');
    expect(first.promptedStages).toEqual([1]);

    const second = await persistence.recordPrompt({
      stage: 3,
      promptedAt: '2025-12-02T08:00:00.000Z',
      appVersion: '1.1.0',
    });
    expect(second.lastPromptedStage).toBe(3);
    expect(second.lastPromptedAt).toBe('2025-12-02T08:00:00.000Z');
    expect(second.lastPromptedVersion).toBe('1.1.0');
    expect(second.promptedStages).toEqual([1, 3]);

    // Verify it was actually written through to the store.
    const raw = await store.getItem(DEFAULT_RATING_PERSISTENCE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.lastPromptedStage).toBe(3);
    expect(parsed.promptedStages).toEqual([1, 3]);
  });

  it('recordPrompt is idempotent for duplicate stages', async () => {
    const store = new InMemoryKeyValueStore();
    const persistence = createRatingPersistence(store);
    await persistence.recordPrompt({
      stage: 2,
      promptedAt: '2025-12-01T08:00:00.000Z',
      appVersion: '1.0.0',
    });
    const after = await persistence.recordPrompt({
      stage: 2,
      promptedAt: '2025-12-02T08:00:00.000Z',
      appVersion: '1.0.1',
    });
    expect(after.promptedStages).toEqual([2]);
    expect(after.lastPromptedAt).toBe('2025-12-02T08:00:00.000Z');
    expect(after.lastPromptedVersion).toBe('1.0.1');
  });

  it('recordPrompt rejects invalid stage', async () => {
    const persistence = createRatingPersistence(new InMemoryKeyValueStore());
    const err = await expectThrowsAsync(() =>
      persistence.recordPrompt({
        stage: 9 as never,
        promptedAt: '2025-12-01T08:00:00.000Z',
        appVersion: '1.0.0',
      }),
    );
    expect(err.reason).toBe('invalid_stage');
  });

  it('recordPrompt rejects invalid timestamp', async () => {
    const persistence = createRatingPersistence(new InMemoryKeyValueStore());
    const err = await expectThrowsAsync(() =>
      persistence.recordPrompt({
        stage: 1,
        promptedAt: 'yesterday',
        appVersion: '1.0.0',
      }),
    );
    expect(err.reason).toBe('invalid_timestamp');
  });

  it('recordPrompt rejects invalid version', async () => {
    const persistence = createRatingPersistence(new InMemoryKeyValueStore());
    const err = await expectThrowsAsync(() =>
      persistence.recordPrompt({
        stage: 1,
        promptedAt: '2025-12-01T08:00:00.000Z',
        appVersion: '',
      }),
    );
    expect(err.reason).toBe('invalid_version');
  });

  it('recordPrompt rejects non-object input', async () => {
    const persistence = createRatingPersistence(new InMemoryKeyValueStore());
    const err = await expectThrowsAsync(() => persistence.recordPrompt(null as never));
    expect(err.reason).toBe('invalid_state');
  });

  it('wraps underlying store failures as store_failure', async () => {
    const failingStore: KeyValueStore = {
      async getItem() {
        throw new Error('disk full');
      },
      async setItem() {
        throw new Error('disk full');
      },
      async removeItem() {
        throw new Error('disk full');
      },
    };
    const persistence = createRatingPersistence(failingStore);

    const loadErr = await expectThrowsAsync(() => persistence.load());
    expect(loadErr.reason).toBe('store_failure');

    const saveErr = await expectThrowsAsync(() => persistence.save(SAMPLE_STATE));
    expect(saveErr.reason).toBe('store_failure');

    const clearErr = await expectThrowsAsync(() => persistence.clear());
    expect(clearErr.reason).toBe('store_failure');
  });

  it('honours a custom storage key', async () => {
    const store = new InMemoryKeyValueStore();
    const persistence = createRatingPersistence(store, {
      key: 'tenant_42:rating_gate',
    });
    await persistence.save(SAMPLE_STATE);
    expect(await store.getItem('tenant_42:rating_gate')).not.toBeNull();
    expect(await store.getItem(DEFAULT_RATING_PERSISTENCE_KEY)).toBeNull();
  });

  it('returned façade object is frozen', () => {
    const persistence = createRatingPersistence(new InMemoryKeyValueStore());
    expect(Object.isFrozen(persistence)).toBe(true);
  });

  it('save() validates the state before writing', async () => {
    const store = new InMemoryKeyValueStore();
    const persistence = createRatingPersistence(store);
    const err = await expectThrowsAsync(() =>
      persistence.save({
        ...SAMPLE_STATE,
        lastPromptedAt: 'not-iso',
      }),
    );
    expect(err.reason).toBe('invalid_timestamp');
    // Store must remain untouched.
    expect(await store.getItem(DEFAULT_RATING_PERSISTENCE_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Integration — full load → mutate → save cycle
// ---------------------------------------------------------------------------

describe('rating-persistence integration', () => {
  it('load → recordPrompt → load reproduces the same state byte-for-byte', async () => {
    const store = new InMemoryKeyValueStore();
    const persistence = createRatingPersistence(store);

    await persistence.recordPrompt({
      stage: 1,
      promptedAt: '2025-12-01T08:00:00.000Z',
      appVersion: '1.0.0',
    });
    const blobAfterFirst = await store.getItem(DEFAULT_RATING_PERSISTENCE_KEY);

    // Re-create façade as if app restarted on a new launch.
    const persistence2 = createRatingPersistence(store);
    const reloaded = await persistence2.load();
    expect(reloaded.lastPromptedStage).toBe(1);

    // Saving the reloaded state back yields an identical byte stream.
    await persistence2.save(reloaded);
    expect(await store.getItem(DEFAULT_RATING_PERSISTENCE_KEY)).toBe(blobAfterFirst);
  });

  it('survives a clear() and re-record cycle', async () => {
    const store = new InMemoryKeyValueStore();
    const persistence = createRatingPersistence(store);

    await persistence.recordPrompt({
      stage: 4,
      promptedAt: '2025-12-01T08:00:00.000Z',
      appVersion: '1.0.0',
    });
    await persistence.clear();
    expect(await persistence.load()).toEqual(EMPTY_RATING_PERSISTED_STATE);

    const restored = await persistence.recordPrompt({
      stage: 2,
      promptedAt: '2025-12-02T08:00:00.000Z',
      appVersion: '1.0.1',
    });
    expect(restored.promptedStages).toEqual([2]);
    expect(restored.lastPromptedStage).toBe(2);
  });
});
