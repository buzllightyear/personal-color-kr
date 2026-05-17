/**
 * Smoke test — `apps/mobile/src/config/vendor-keys.ts` runtime accessor.
 *
 * Verifies Sub-AC 8.3: "Runtime access via Constants.expoConfig.extra
 * exposes the three keys correctly, verified by a test that mocks
 * expo-constants and asserts the three keys are retrievable through the
 * Constants.expoConfig.extra accessor."
 *
 * The three keys forwarded into `extra` by `app.config.ts` (Sub-AC 8.2) are:
 *   1. `posthogApiKey`
 *   2. `posthogHost`
 *   3. `superwallApiKey`
 *
 * `falApiKey` is INTENTIONALLY absent — it is server-side only. A regression
 * case below asserts the accessor refuses to surface it even when a malicious
 * or accidentally-added `falApiKey` field is present in the mocked manifest.
 *
 * Mocking strategy:
 *   - `vi.mock('expo-constants', ...)` replaces the module with a factory
 *     that returns a default export whose `expoConfig.extra` is sourced from
 *     a mutable holder. Each test rewrites the holder via the exported
 *     `__setMockExtra` / `__setMockExpoConfig` helpers and then re-imports
 *     the accessor — this exercises the same code path the real Expo runtime
 *     follows (read `Constants.expoConfig.extra`) without spinning up Expo.
 *   - `vi.resetModules()` runs in `beforeEach` so the mocked default export
 *     reads the *current* holder state rather than the value captured at
 *     module-evaluation time.
 *
 * What this test asserts:
 *   1. With a fully-populated mocked `extra`, `getVendorKeys()` returns the
 *      three vendor keys exactly as provided.
 *   2. The returned object is frozen (defence against accidental mutation
 *      of a shared singleton in a long-lived runtime).
 *   3. When `expoConfig` is `null` (Expo Go classic-manifest fallback, or
 *      a non-Expo test environment), the accessor degrades to `undefined`
 *      values rather than throwing.
 *   4. When `extra` itself is missing / non-object, the accessor returns
 *      `undefined` for every field rather than crashing.
 *   5. Non-string values (numbers, booleans, `null`, objects) are coerced
 *      to `undefined` — vendor SDKs all expect string keys and a
 *      wrong-typed value is more harmful than a missing one.
 *   6. A spurious `falApiKey` in the mocked `extra` is NEVER surfaced by
 *      the accessor (security invariant: server-side-only secret must not
 *      be reachable via the client-side runtime accessor).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable holder consulted by the mocked `expo-constants` factory. Tests
// rewrite this via the helpers below and then re-import the accessor.
let mockExpoConfig: { extra?: unknown } | null = null;

function setMockExpoConfig(value: { extra?: unknown } | null): void {
  mockExpoConfig = value;
}

function setMockExtra(extra: unknown): void {
  mockExpoConfig = { extra };
}

vi.mock('expo-constants', () => {
  return {
    default: {
      get expoConfig() {
        return mockExpoConfig;
      },
    },
  };
});

async function loadAccessor(): Promise<typeof import('../src/config/vendor-keys')> {
  // Re-import after `vi.resetModules()` so the accessor reads the *current*
  // mock state rather than a stale snapshot captured at first import.
  return await import('../src/config/vendor-keys');
}

describe('vendor-keys.ts — Constants.expoConfig.extra runtime accessor', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExpoConfig = null;
  });

  it('retrieves the three vendor keys from a fully-populated extra block', async () => {
    setMockExtra({
      posthogApiKey: 'phc_test_posthog',
      posthogHost: 'https://us.i.posthog.com',
      superwallApiKey: 'pk_test_superwall',
    });

    const { getVendorKeys } = await loadAccessor();
    const keys = getVendorKeys();

    expect(keys.posthogApiKey).toBe('phc_test_posthog');
    expect(keys.posthogHost).toBe('https://us.i.posthog.com');
    expect(keys.superwallApiKey).toBe('pk_test_superwall');
  });

  it('returns a frozen object (immutability contract)', async () => {
    setMockExtra({
      posthogApiKey: 'phc_a',
      posthogHost: 'https://us.i.posthog.com',
      superwallApiKey: 'pk_b',
    });

    const { getVendorKeys } = await loadAccessor();
    const keys = getVendorKeys();

    expect(Object.isFrozen(keys)).toBe(true);
  });

  it('exposes exactly the three documented vendor key properties', async () => {
    setMockExtra({
      posthogApiKey: 'phc_a',
      posthogHost: 'https://us.i.posthog.com',
      superwallApiKey: 'pk_b',
    });

    const { getVendorKeys } = await loadAccessor();
    const keys = getVendorKeys();

    // Spec: the accessor MUST expose these three keys (the contract under test).
    expect(Object.prototype.hasOwnProperty.call(keys, 'posthogApiKey')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(keys, 'posthogHost')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(keys, 'superwallApiKey')).toBe(true);
    // And only those three — anything extra would mean the shape drifted from
    // the `app.config.ts` `extra` contract.
    expect(Object.keys(keys).sort()).toEqual(
      ['posthogApiKey', 'posthogHost', 'superwallApiKey'].sort(),
    );
  });

  it('degrades to undefined fields when expoConfig is null (classic manifest / non-Expo runtime)', async () => {
    setMockExpoConfig(null);

    const { getVendorKeys } = await loadAccessor();
    const keys = getVendorKeys();

    expect(keys.posthogApiKey).toBeUndefined();
    expect(keys.posthogHost).toBeUndefined();
    expect(keys.superwallApiKey).toBeUndefined();
  });

  it('degrades to undefined fields when extra is missing entirely', async () => {
    setMockExpoConfig({}); // expoConfig exists but no .extra field

    const { getVendorKeys } = await loadAccessor();
    const keys = getVendorKeys();

    expect(keys.posthogApiKey).toBeUndefined();
    expect(keys.posthogHost).toBeUndefined();
    expect(keys.superwallApiKey).toBeUndefined();
  });

  it('degrades to undefined fields when extra is non-object (defence-in-depth)', async () => {
    for (const bogus of [null, 'a string', 42, true, ['arr']]) {
      setMockExtra(bogus);
      vi.resetModules();
      const { getVendorKeys } = await loadAccessor();
      const keys = getVendorKeys();
      expect(keys.posthogApiKey, `for extra=${JSON.stringify(bogus)}`).toBeUndefined();
      expect(keys.posthogHost).toBeUndefined();
      expect(keys.superwallApiKey).toBeUndefined();
    }
  });

  it('coerces non-string values to undefined (vendor SDKs require strings)', async () => {
    setMockExtra({
      posthogApiKey: 12345, // number
      posthogHost: null, // null
      superwallApiKey: { nested: 'pk_b' }, // object
    });

    const { getVendorKeys } = await loadAccessor();
    const keys = getVendorKeys();

    expect(keys.posthogApiKey).toBeUndefined();
    expect(keys.posthogHost).toBeUndefined();
    expect(keys.superwallApiKey).toBeUndefined();
  });

  it('preserves partial population (placeholder onboarding flow)', async () => {
    // Only PostHog is configured locally — Superwall is still on its
    // placeholder. The accessor must surface the populated key and report
    // the missing one as undefined, NOT throw.
    setMockExtra({
      posthogApiKey: 'phc_partial',
      posthogHost: 'https://us.i.posthog.com',
      // superwallApiKey deliberately omitted
    });

    const { getVendorKeys } = await loadAccessor();
    const keys = getVendorKeys();

    expect(keys.posthogApiKey).toBe('phc_partial');
    expect(keys.posthogHost).toBe('https://us.i.posthog.com');
    expect(keys.superwallApiKey).toBeUndefined();
  });

  it('never surfaces falApiKey, even if present in the mocked manifest (security invariant)', async () => {
    // Simulate a regression where a future contributor accidentally forwards
    // FAL_API_KEY through `app.config.ts`. The runtime accessor must still
    // refuse to expose it on the typed `VendorKeys` shape.
    setMockExtra({
      posthogApiKey: 'phc_a',
      posthogHost: 'https://us.i.posthog.com',
      superwallApiKey: 'pk_b',
      // The server-side-only secret leaks into `extra` — should be ignored.
      falApiKey: 'fal_test_keyid:fal_test_secret',
    });

    const { getVendorKeys } = await loadAccessor();
    const keys = getVendorKeys();
    const allValues = Object.values(keys);

    // Property-level: no `falApiKey` member.
    expect(Object.prototype.hasOwnProperty.call(keys, 'falApiKey')).toBe(false);
    // Defence-in-depth: no field of the typed shape holds the FAL value
    // under any other name (i.e. no value-level smuggling).
    expect(allValues).not.toContain('fal_test_keyid:fal_test_secret');
  });

  it('re-reads Constants.expoConfig on every call (no module-load memoisation)', async () => {
    setMockExtra({
      posthogApiKey: 'phc_first',
      posthogHost: 'https://us.i.posthog.com',
      superwallApiKey: 'pk_b',
    });

    const { getVendorKeys } = await loadAccessor();
    const first = getVendorKeys();
    expect(first.posthogApiKey).toBe('phc_first');

    // Mutate the mock holder without re-importing the accessor — the same
    // imported function must observe the new value, proving it reads fresh
    // rather than memoising at module load.
    setMockExtra({
      posthogApiKey: 'phc_rotated',
      posthogHost: 'https://us.i.posthog.com',
      superwallApiKey: 'pk_b',
    });
    const second = getVendorKeys();
    expect(second.posthogApiKey).toBe('phc_rotated');
  });
});
