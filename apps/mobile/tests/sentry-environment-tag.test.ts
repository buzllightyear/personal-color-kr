/**
 * Unit test — `apps/mobile/src/sentry.ts` :: Sentry `environment` tag (Phase 7.3).
 *
 * Pins the AC: "Sentry environment tag matches EAS build profile name exactly".
 *
 * This is the dedicated guard for the `sentryEnvironment` ontology concept:
 *
 *   > sentryEnvironment — Sentry environment tag derived directly from
 *   > easBuildProfile value, one of `development-simulator` / `development` /
 *   > `preview` / `production`.
 *
 * Where the broader `sentry-init.test.ts` asserts the *full* init contract
 * (DSN, tracesSampleRate, fail-open), this file isolates ONE invariant: the
 * `environment` passed to `Sentry.init(...)` is byte-for-byte the active EAS
 * build profile — never a remapped alias, never lower-cased, never trimmed,
 * never collapsed (e.g. `development-simulator` must NOT degrade to
 * `development`). Issues in Sentry are grouped by this tag, so any drift
 * between the build profile name and the environment tag would silently
 * mis-bucket crash reports.
 *
 * Mocking strategy mirrors `sentry-init.test.ts`:
 *   - `vi.mock('@sentry/react-native', ...)` replaces the native SDK `init`
 *     with a `vi.fn()` spy so vitest never resolves the Objective-C-backed
 *     native shim, and we can read back the exact `environment` argument.
 *   - `vi.mock('expo-constants', ...)` exposes a mutable `extra` holder so
 *     each case sets the build profile the runtime would observe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable holder consulted by the mocked `expo-constants` default export.
let mockExpoConfig: { extra?: unknown } | null = null;

function setMockExtra(extra: unknown): void {
  mockExpoConfig = { extra };
}

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));

// Spy for the native SDK's `init`. Hoisted so the `vi.mock` factory (itself
// hoisted to module top) can close over it.
const { initSpy } = vi.hoisted(() => ({ initSpy: vi.fn() }));

vi.mock('@sentry/react-native', () => ({
  init: initSpy,
}));

async function loadModule(): Promise<typeof import('../src/sentry')> {
  return await import('../src/sentry');
}

/**
 * The complete, closed set of EAS build profiles (see `eas.json`). The Sentry
 * `environment` tag must equal exactly one of these strings, verbatim.
 */
const EAS_BUILD_PROFILES = [
  'development-simulator',
  'development',
  'preview',
  'production',
] as const;

const VALID_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

describe('sentry.ts — environment tag matches the EAS build profile exactly', () => {
  beforeEach(() => {
    vi.resetModules();
    initSpy.mockReset();
    mockExpoConfig = null;
    vi.restoreAllMocks();
  });

  it.each(EAS_BUILD_PROFILES)(
    'sets environment === "%s" verbatim from the build profile',
    async (profile) => {
      setMockExtra({ sentryDsnMobile: VALID_DSN, easBuildProfile: profile });

      const { initSentry } = await loadModule();
      expect(initSentry()).toBe(true);

      expect(initSpy).toHaveBeenCalledTimes(1);
      const params = initSpy.mock.calls[0][0];
      // Strict equality — no aliasing, casing, or trimming applied.
      expect(params.environment).toBe(profile);
    },
  );

  it('does NOT collapse development-simulator into development', async () => {
    setMockExtra({
      sentryDsnMobile: VALID_DSN,
      easBuildProfile: 'development-simulator',
    });

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(true);

    const params = initSpy.mock.calls[0][0];
    expect(params.environment).toBe('development-simulator');
    expect(params.environment).not.toBe('development');
  });

  it('emits an environment tag that is always one of the four known profiles', async () => {
    for (const profile of EAS_BUILD_PROFILES) {
      vi.resetModules();
      initSpy.mockReset();
      setMockExtra({ sentryDsnMobile: VALID_DSN, easBuildProfile: profile });

      const { initSentry } = await loadModule();
      expect(initSentry()).toBe(true);
      const params = initSpy.mock.calls[0][0];
      expect(EAS_BUILD_PROFILES).toContain(params.environment);
    }
  });

  it('falls back to the development profile name when easBuildProfile is absent', async () => {
    setMockExtra({ sentryDsnMobile: VALID_DSN /* easBuildProfile omitted */ });

    const { initSentry, DEFAULT_EAS_BUILD_PROFILE } = await loadModule();
    expect(initSentry()).toBe(true);

    const params = initSpy.mock.calls[0][0];
    // The fallback environment tag must still be a real, exact profile name.
    expect(params.environment).toBe(DEFAULT_EAS_BUILD_PROFILE);
    expect(params.environment).toBe('development');
  });

  it('ignores an unknown profile string and tags the safe development fallback', async () => {
    setMockExtra({
      sentryDsnMobile: VALID_DSN,
      easBuildProfile: 'staging', // not a real EAS profile
    });

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(true);

    const params = initSpy.mock.calls[0][0];
    expect(params.environment).toBe('development');
    expect(EAS_BUILD_PROFILES).toContain(params.environment);
  });

  it('keeps the environment tag consistent with resolveEasBuildProfile', async () => {
    setMockExtra({ sentryDsnMobile: VALID_DSN, easBuildProfile: 'preview' });

    const { initSentry, resolveEasBuildProfile } = await loadModule();
    expect(initSentry()).toBe(true);

    const params = initSpy.mock.calls[0][0];
    // The init-time environment tag must equal what the exported resolver
    // computes for the same manifest — no divergent second code path.
    expect(params.environment).toBe(
      resolveEasBuildProfile({ easBuildProfile: 'preview' }),
    );
  });
});
