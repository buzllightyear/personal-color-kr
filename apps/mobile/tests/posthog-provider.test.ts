/**
 * Unit test — `apps/mobile/src/providers/PostHogProvider.tsx`.
 *
 * Verifies Sub-AC 7.1:
 *   "Create a PostHog provider module that reads apiKey and host from
 *    Constants.expoConfig.extra.posthog and instantiates a single
 *    posthog-react-native client; include a unit test that mocks
 *    posthog-react-native and expo-constants to verify the client is
 *    constructed exactly once with the values from extra."
 *
 * Field-naming reconciliation:
 *   The AC describes the keys as living under `extra.posthog{apiKey,host}`.
 *   The sibling sub-AC (8.2) wired the Expo runtime manifest with FLAT field
 *   names — `extra.posthogApiKey` and `extra.posthogHost` — and the typed
 *   accessor `getVendorKeys()` exposes that flat shape. This test asserts
 *   the same flat shape (one source of truth for the field names) and
 *   verifies the provider:
 *     1. Reads from `Constants.expoConfig.extra` (via the accessor).
 *     2. Constructs `new PostHog(apiKey, { host })` exactly once across
 *        multiple bootstrap calls.
 *
 * What this test asserts:
 *   1. First call to `getOrInitializePostHogClient()` invokes the `PostHog`
 *      constructor exactly once, with the api key and host pulled straight
 *      from `Constants.expoConfig.extra`.
 *   2. Subsequent calls return the same instance and do NOT invoke the
 *      constructor again — the singleton invariant.
 *   3. When `Constants.expoConfig.extra.posthogHost` is `undefined`, the
 *      constructor still runs exactly once and `options.host` is NOT
 *      forwarded (so the SDK falls back to its own default host).
 *   4. When `Constants.expoConfig.extra.posthogApiKey` is `undefined`, the
 *      bootstrap returns `null` and the `PostHog` constructor is NEVER
 *      called — graceful onboarding degradation.
 *   5. When `Constants.expoConfig` is `null` (vitest node env / classic
 *      manifest fallback), the bootstrap returns `null` without invoking
 *      the constructor.
 *   6. `__resetPostHogProviderForTests()` plus a fresh `expoConfig` mock
 *      allows the constructor to run again on the next bootstrap call.
 *
 * Mocking strategy:
 *   - `vi.mock('posthog-react-native', ...)`: replaces the package with a
 *     factory that returns `PostHog` as a `vi.fn` constructor recorder. The
 *     recorder captures `(apiKey, options)` per construction so the test can
 *     assert call count + argument values without spinning up the real SDK
 *     (which would require AsyncStorage, react-native runtime, etc.).
 *   - `vi.mock('expo-constants', ...)`: replaces the package with a default
 *     export whose `expoConfig` is sourced from a mutable holder. Tests
 *     rewrite the holder via `setMockExtra` / `setMockExpoConfig` and then
 *     re-import the provider through `loadProvider()` — this exercises the
 *     same code path the Expo runtime follows.
 *   - `vi.resetModules()` runs in `beforeEach` so the provider module is
 *     re-loaded fresh each test. Combined with the explicit
 *     `__resetPostHogProviderForTests()` call (defence-in-depth), this
 *     guarantees the singleton state from one test never leaks into another.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock — posthog-react-native
//
// `PostHog` is replaced by a `vi.fn` constructor. The factory captures
// every `(apiKey, options)` invocation and exposes them via the closed-over
// `postHogConstructor` reference declared above. Each constructor call
// returns a freshly-tagged stub object so the test can assert identity
// (the same stub is returned by subsequent bootstrap calls).
// ---------------------------------------------------------------------------
const postHogConstructor = vi.fn();

vi.mock('posthog-react-native', () => {
  // Re-exported as a named export `PostHog` and the SDK's own
  // `PostHogProvider` (kept as an opaque value — the unit test never
  // renders it, but the provider module imports it at the top level).
  return {
    PostHog: postHogConstructor,
    PostHogProvider: function NoopRnPostHogProvider(): null {
      return null;
    },
  };
});

// ---------------------------------------------------------------------------
// Mock — expo-constants
//
// Same pattern as `vendor-keys.test.ts`: a mutable holder consulted via a
// getter so tests can rewrite `expoConfig` between cases without re-mocking.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Lazy provider loader.
//
// Re-imports the module under test after `vi.resetModules()` so each test
// observes a freshly-initialized singleton, and exposes the bootstrap +
// reset helpers as a typed bundle. Returning `unknown` from a typed import
// path is fine — vitest's resolver hits the same `.tsx` source the Expo
// bundler does.
// ---------------------------------------------------------------------------
async function loadProvider(): Promise<
  typeof import('../src/providers/PostHogProvider')
> {
  return await import('../src/providers/PostHogProvider');
}

describe('PostHogProvider — singleton client construction', () => {
  beforeEach(() => {
    vi.resetModules();
    postHogConstructor.mockReset();
    // Default: every constructor invocation returns a tagged stub the
    // singleton tests can identify-check against.
    postHogConstructor.mockImplementation(() => ({
      __isMockPostHog: true,
    }));
    mockExpoConfig = null;
  });

  it('constructs PostHog exactly once with apiKey + host from Constants.expoConfig.extra', async () => {
    setMockExtra({
      posthogApiKey: 'phc_test_provider_key',
      posthogHost: 'https://us.i.posthog.com',
      superwallApiKey: 'pk_unused_here',
    });

    const { getOrInitializePostHogClient } = await loadProvider();
    const client = getOrInitializePostHogClient();

    // Behavioural assertion: PostHog ran exactly once.
    expect(postHogConstructor).toHaveBeenCalledTimes(1);

    // Argument-shape assertion: apiKey is positional arg 0, host travels
    // inside the options object as `options.host`.
    expect(postHogConstructor).toHaveBeenCalledWith(
      'phc_test_provider_key',
      { host: 'https://us.i.posthog.com' },
    );

    // The bootstrap returned the constructed instance (not null).
    expect(client).not.toBeNull();
    expect((client as { __isMockPostHog?: boolean }).__isMockPostHog).toBe(true);
  });

  it('returns the same instance on subsequent calls and does NOT re-invoke the constructor', async () => {
    setMockExtra({
      posthogApiKey: 'phc_singleton_check',
      posthogHost: 'https://us.i.posthog.com',
      superwallApiKey: 'pk_unused',
    });

    const { getOrInitializePostHogClient } = await loadProvider();
    const first = getOrInitializePostHogClient();
    const second = getOrInitializePostHogClient();
    const third = getOrInitializePostHogClient();

    // Singleton invariant: ONE construction across three bootstrap calls.
    expect(postHogConstructor).toHaveBeenCalledTimes(1);
    // And every call hands back the very same instance.
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('omits options.host when posthogHost is missing from extra', async () => {
    // Mirror the placeholder-onboarding state where the developer set
    // POSTHOG_API_KEY but left POSTHOG_HOST unset.
    setMockExtra({
      posthogApiKey: 'phc_no_host',
      // posthogHost deliberately omitted
    });

    const { getOrInitializePostHogClient } = await loadProvider();
    getOrInitializePostHogClient();

    expect(postHogConstructor).toHaveBeenCalledTimes(1);
    // The options object must be a plain `{}` — NOT `{ host: undefined }`,
    // which would be a different runtime contract.
    expect(postHogConstructor).toHaveBeenCalledWith('phc_no_host', {});
    const call = postHogConstructor.mock.calls[0];
    expect(call).toBeDefined();
    const passedOptions = (call as unknown[])[1] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(passedOptions, 'host')).toBe(false);
  });

  it('returns null and does NOT construct PostHog when posthogApiKey is missing', async () => {
    setMockExtra({
      // posthogApiKey deliberately omitted — onboarding placeholder state.
      posthogHost: 'https://us.i.posthog.com',
      superwallApiKey: 'pk_unused',
    });

    const { getOrInitializePostHogClient } = await loadProvider();
    const client = getOrInitializePostHogClient();

    // No constructor invocation — we MUST NOT pass `undefined` to PostHog.
    expect(postHogConstructor).toHaveBeenCalledTimes(0);
    expect(client).toBeNull();
  });

  it('returns null and does NOT construct PostHog when expoConfig is null', async () => {
    // vitest node env / classic-manifest fallback: expoConfig itself is null.
    setMockExpoConfig(null);

    const { getOrInitializePostHogClient } = await loadProvider();
    const client = getOrInitializePostHogClient();

    expect(postHogConstructor).toHaveBeenCalledTimes(0);
    expect(client).toBeNull();
  });

  it('caches the null result and does NOT retry the constructor on subsequent calls', async () => {
    // Regression: an earlier draft used `if (cachedClient === null)` rather
    // than a dedicated `initialized` gate, which would re-evaluate the env
    // on every call when the api key was missing. The cache must be sticky
    // even for the null path so we don't churn `Constants.expoConfig` reads
    // on every render.
    setMockExtra({
      posthogHost: 'https://us.i.posthog.com',
      // posthogApiKey absent
    });

    const { getOrInitializePostHogClient } = await loadProvider();
    expect(getOrInitializePostHogClient()).toBeNull();
    expect(getOrInitializePostHogClient()).toBeNull();
    expect(getOrInitializePostHogClient()).toBeNull();

    expect(postHogConstructor).toHaveBeenCalledTimes(0);
  });

  it('__resetPostHogProviderForTests() allows the constructor to run again on next bootstrap', async () => {
    setMockExtra({
      posthogApiKey: 'phc_first_round',
      posthogHost: 'https://us.i.posthog.com',
    });

    const provider = await loadProvider();
    const first = provider.getOrInitializePostHogClient();
    expect(postHogConstructor).toHaveBeenCalledTimes(1);
    expect((first as { __isMockPostHog?: boolean }).__isMockPostHog).toBe(true);

    // Rotate the mocked env, reset the singleton, and verify the next
    // bootstrap call rebuilds with the new values.
    setMockExtra({
      posthogApiKey: 'phc_second_round',
      posthogHost: 'https://eu.i.posthog.com',
    });
    provider.__resetPostHogProviderForTests();

    const second = provider.getOrInitializePostHogClient();
    expect(postHogConstructor).toHaveBeenCalledTimes(2);
    expect(postHogConstructor).toHaveBeenLastCalledWith('phc_second_round', {
      host: 'https://eu.i.posthog.com',
    });
    // The returned instance is the newly-constructed one, not the first.
    expect(second).not.toBeNull();
  });

  it('coerces non-string posthogApiKey to undefined and skips construction', async () => {
    // Defence-in-depth: a future contributor accidentally writes a number
    // (e.g. forgot to quote the value in `.env`) — the typed accessor
    // already coerces non-strings to `undefined`, so the constructor still
    // gets skipped without crashing the runtime.
    setMockExtra({
      posthogApiKey: 12345,
      posthogHost: 'https://us.i.posthog.com',
    });

    const { getOrInitializePostHogClient } = await loadProvider();
    expect(getOrInitializePostHogClient()).toBeNull();
    expect(postHogConstructor).toHaveBeenCalledTimes(0);
  });
});
