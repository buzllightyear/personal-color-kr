/**
 * Unit test — `apps/mobile/src/providers/postHogConfig.ts`.
 *
 * Verifies Sub-AC 7.2:
 *   "Implement a config-reader function (e.g., `getPostHogConfig()` in
 *    `apps/mobile/src/providers/postHogConfig.ts`) that extracts and validates
 *    `apiKey`/`host` from `Constants.expoConfig.extra`, throwing a descriptive
 *    error when missing; include a unit test covering valid config, missing
 *    key, and missing host cases."
 *
 * Why a separate "throwing" config reader on top of the "degrading" accessor:
 *   - `src/config/vendor-keys.ts` (`getVendorKeys()`) is the runtime-safe
 *     accessor used everywhere screens, providers, and the funnel might read
 *     vendor keys without a configured `.env` — it degrades to `undefined`
 *     so the app still mounts during the placeholder onboarding flow.
 *   - `getPostHogConfig()` is the *strict* validator used by callers that
 *     CANNOT proceed without a fully-configured PostHog setup (e.g. an
 *     explicit "validate vendor config on app boot" check, or a developer
 *     smoke screen). It surfaces a typed, descriptive error so the failure
 *     mode at startup is loud and unambiguous instead of silently producing
 *     a broken client.
 *
 * Field-naming reconciliation:
 *   The AC describes the keys as `apiKey`/`host`. The Expo `extra` block
 *   wired in Sub-AC 8.2 uses FLAT field names `posthogApiKey`/`posthogHost`,
 *   and the typed accessor `getVendorKeys()` exposes them as such. The
 *   config-reader bridges the two namespaces: it reads the flat
 *   `posthogApiKey`/`posthogHost` fields from the manifest and returns a
 *   narrow `{ apiKey, host }` shape — the same shape the
 *   `posthog-react-native` constructor consumes (`new PostHog(apiKey, { host })`).
 *
 * What this test asserts:
 *   1. Valid config: with both `posthogApiKey` and `posthogHost` populated,
 *      `getPostHogConfig()` returns `{ apiKey, host }` exactly as provided.
 *   2. The returned object is frozen (immutability contract, mirroring
 *      `getVendorKeys()`).
 *   3. Missing key: when `posthogApiKey` is absent, the function throws a
 *      `PostHogConfigError` whose `reason === 'missing_api_key'` and whose
 *      message names the offending env var (`POSTHOG_API_KEY`) so a
 *      developer reading the stack trace can fix it in one step.
 *   4. Missing host: when `posthogHost` is absent, the function throws a
 *      `PostHogConfigError` whose `reason === 'missing_host'` and whose
 *      message names `POSTHOG_HOST`.
 *   5. Empty-string key/host are treated the same as missing (defence
 *      against developers leaving an `=""` placeholder in `.env`).
 *   6. `expoConfig === null` (vitest node env / classic-manifest fallback)
 *      propagates as a `missing_api_key` error — the contract is "throw if
 *      anything is missing", and a null manifest is the maximally-missing
 *      case.
 *
 * Mocking strategy:
 *   - `vi.mock('expo-constants', ...)`: same mutable-holder pattern used by
 *     `vendor-keys.test.ts` and `posthog-provider.test.ts`. The mocked
 *     default export reads `mockExpoConfig` via a getter so tests can rewrite
 *     it between cases.
 *   - `vi.resetModules()` runs in `beforeEach` so the config-reader module is
 *     re-loaded fresh each test (avoids any caller-side memoisation leaking
 *     between cases).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
// Lazy module loader.
//
// Re-imports the module under test after `vi.resetModules()` so each test
// observes a freshly-initialized module-level state.
// ---------------------------------------------------------------------------
async function loadConfigReader(): Promise<
  typeof import('../src/providers/postHogConfig')
> {
  return await import('../src/providers/postHogConfig');
}

describe('getPostHogConfig() — strict Constants.expoConfig.extra validator', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExpoConfig = null;
  });

  it('returns { apiKey, host } when both posthog fields are populated in extra', async () => {
    setMockExtra({
      posthogApiKey: 'phc_test_valid_config',
      posthogHost: 'https://us.i.posthog.com',
      superwallApiKey: 'pk_unused_here',
    });

    const { getPostHogConfig } = await loadConfigReader();
    const config = getPostHogConfig();

    expect(config.apiKey).toBe('phc_test_valid_config');
    expect(config.host).toBe('https://us.i.posthog.com');
    // The returned shape exposes ONLY the two documented fields — anything
    // extra would mean the bridge drifted from the `posthog-react-native`
    // constructor's argument shape (`new PostHog(apiKey, { host })`).
    expect(Object.keys(config).sort()).toEqual(['apiKey', 'host']);
  });

  it('returns a frozen object (immutability contract)', async () => {
    setMockExtra({
      posthogApiKey: 'phc_frozen_check',
      posthogHost: 'https://us.i.posthog.com',
    });

    const { getPostHogConfig } = await loadConfigReader();
    const config = getPostHogConfig();

    expect(Object.isFrozen(config)).toBe(true);
  });

  it('throws PostHogConfigError with reason=missing_api_key when posthogApiKey is absent', async () => {
    // Onboarding-placeholder state: developer set HOST but not API_KEY.
    setMockExtra({
      // posthogApiKey deliberately omitted
      posthogHost: 'https://us.i.posthog.com',
    });

    const { getPostHogConfig, PostHogConfigError } = await loadConfigReader();

    expect(() => getPostHogConfig()).toThrow(PostHogConfigError);

    try {
      getPostHogConfig();
      throw new Error('expected getPostHogConfig() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostHogConfigError);
      const e = err as InstanceType<typeof PostHogConfigError>;
      expect(e.reason).toBe('missing_api_key');
      // The error message must name the offending env var so a developer
      // can resolve it without re-reading the source.
      expect(e.message).toMatch(/POSTHOG_API_KEY/);
    }
  });

  it('throws PostHogConfigError with reason=missing_host when posthogHost is absent', async () => {
    setMockExtra({
      posthogApiKey: 'phc_valid_but_no_host',
      // posthogHost deliberately omitted
    });

    const { getPostHogConfig, PostHogConfigError } = await loadConfigReader();

    expect(() => getPostHogConfig()).toThrow(PostHogConfigError);

    try {
      getPostHogConfig();
      throw new Error('expected getPostHogConfig() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostHogConfigError);
      const e = err as InstanceType<typeof PostHogConfigError>;
      expect(e.reason).toBe('missing_host');
      expect(e.message).toMatch(/POSTHOG_HOST/);
    }
  });

  it('treats an empty-string apiKey as missing (defence against `=""` placeholders)', async () => {
    setMockExtra({
      posthogApiKey: '',
      posthogHost: 'https://us.i.posthog.com',
    });

    const { getPostHogConfig, PostHogConfigError } = await loadConfigReader();

    try {
      getPostHogConfig();
      throw new Error('expected getPostHogConfig() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostHogConfigError);
      const e = err as InstanceType<typeof PostHogConfigError>;
      expect(e.reason).toBe('missing_api_key');
    }
  });

  it('treats an empty-string host as missing (defence against `=""` placeholders)', async () => {
    setMockExtra({
      posthogApiKey: 'phc_valid',
      posthogHost: '',
    });

    const { getPostHogConfig, PostHogConfigError } = await loadConfigReader();

    try {
      getPostHogConfig();
      throw new Error('expected getPostHogConfig() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostHogConfigError);
      const e = err as InstanceType<typeof PostHogConfigError>;
      expect(e.reason).toBe('missing_host');
    }
  });

  it('throws missing_api_key when expoConfig itself is null (no manifest at all)', async () => {
    // vitest node env / classic-manifest fallback: there is no manifest, so
    // every key is missing — the contract surfaces the api key error first
    // (it is the more critical secret and the one a developer must fix first).
    setMockExpoConfig(null);

    const { getPostHogConfig, PostHogConfigError } = await loadConfigReader();

    try {
      getPostHogConfig();
      throw new Error('expected getPostHogConfig() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostHogConfigError);
      const e = err as InstanceType<typeof PostHogConfigError>;
      expect(e.reason).toBe('missing_api_key');
    }
  });

  it('throws missing_api_key when extra is missing entirely', async () => {
    setMockExpoConfig({}); // expoConfig exists but no .extra field

    const { getPostHogConfig, PostHogConfigError } = await loadConfigReader();

    try {
      getPostHogConfig();
      throw new Error('expected getPostHogConfig() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostHogConfigError);
      const e = err as InstanceType<typeof PostHogConfigError>;
      expect(e.reason).toBe('missing_api_key');
    }
  });

  it('coerces non-string posthogApiKey to missing (vendor SDKs require strings)', async () => {
    // Defence-in-depth: a contributor accidentally writes a number into
    // `.env`. The typed accessor coerces non-strings to `undefined`; the
    // config-reader must report this as "missing" rather than passing the
    // wrong-typed value through.
    setMockExtra({
      posthogApiKey: 12345 as unknown as string,
      posthogHost: 'https://us.i.posthog.com',
    });

    const { getPostHogConfig, PostHogConfigError } = await loadConfigReader();

    try {
      getPostHogConfig();
      throw new Error('expected getPostHogConfig() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostHogConfigError);
      const e = err as InstanceType<typeof PostHogConfigError>;
      expect(e.reason).toBe('missing_api_key');
    }
  });
});
