/**
 * Unit test — `apps/mobile/src/sentry.ts` :: `initSentry` (Phase 7.3).
 *
 * Pins the AC: "src/sentry.ts exports initSentry with env-aware DSN and
 * tracesSampleRate per profile and try/catch fail-open with console.warn".
 *
 * This mirrors the api Phase 7.2/7.2c Sentry init contract on the mobile side:
 *
 *   1. Env-aware DSN — the DSN is read from the Expo runtime manifest
 *      (`Constants.expoConfig.extra.sentryDsnMobile`, injected by
 *      `app.config.ts` from the `SENTRY_DSN_MOBILE` EAS Secret). When it is
 *      absent/empty the init is a *fail-open no-op* (single `console.warn`,
 *      returns `false`) — the build-time fail-fast for a production DSN lives
 *      in `app.config.ts`, never in the runtime path, so the app always
 *      renders even if observability is unconfigured.
 *   2. tracesSampleRate per profile — derived from
 *      `Constants.expoConfig.extra.easBuildProfile`: `0.0` for the two
 *      development profiles, `0.1` for `preview`/`production`. The error
 *      `sampleRate` is always `1.0` (never downsampled).
 *   3. environment tag — derived directly from the build profile, one of
 *      `development-simulator` / `development` / `preview` / `production`.
 *   4. try/catch fail-open — any throw from `Sentry.init` (or while reading
 *      the manifest) is swallowed with a `console.warn` and `initSentry`
 *      returns `false`; it never propagates, so a Sentry SDK failure can
 *      never crash app mount.
 *
 * Mocking strategy:
 *   - `vi.mock('@sentry/react-native', ...)` replaces the native SDK with a
 *     `vi.fn()` spy for `init`, so vitest never resolves the native package
 *     (whose Objective-C-backed shim Node cannot parse) and we can assert the
 *     exact init params.
 *   - `vi.mock('expo-constants', ...)` exposes a mutable `extra` holder, the
 *     same technique `tests/vendor-keys.test.ts` uses, so each case can set
 *     the DSN + build profile the runtime would see.
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

// Spy for the native SDK's `init`. Declared as a hoisted holder so the
// `vi.mock` factory (hoisted to the top of the module) can close over it.
const { initSpy } = vi.hoisted(() => ({ initSpy: vi.fn() }));

vi.mock('@sentry/react-native', () => ({
  init: initSpy,
}));

async function loadModule(): Promise<typeof import('../src/sentry')> {
  return await import('../src/sentry');
}

describe('sentry.ts — initSentry env-aware init + fail-open', () => {
  beforeEach(() => {
    vi.resetModules();
    initSpy.mockReset();
    mockExpoConfig = null;
    vi.restoreAllMocks();
  });

  it('initializes with the DSN and production tracesSampleRate 0.1', async () => {
    setMockExtra({
      sentryDsnMobile: 'https://examplePublicKey@o0.ingest.sentry.io/0',
      easBuildProfile: 'production',
    });

    const { initSentry } = await loadModule();
    const result = initSentry();

    expect(result).toBe(true);
    expect(initSpy).toHaveBeenCalledTimes(1);
    const params = initSpy.mock.calls[0][0];
    expect(params.dsn).toBe('https://examplePublicKey@o0.ingest.sentry.io/0');
    expect(params.environment).toBe('production');
    expect(params.tracesSampleRate).toBe(0.1);
    // Errors are never downsampled.
    expect(params.sampleRate).toBe(1.0);
  });

  it('uses tracesSampleRate 0.1 for the preview profile', async () => {
    setMockExtra({
      sentryDsnMobile: 'https://k@o0.ingest.sentry.io/1',
      easBuildProfile: 'preview',
    });

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(true);
    const params = initSpy.mock.calls[0][0];
    expect(params.environment).toBe('preview');
    expect(params.tracesSampleRate).toBe(0.1);
  });

  it('uses tracesSampleRate 0.0 for the development profile', async () => {
    setMockExtra({
      sentryDsnMobile: 'https://k@o0.ingest.sentry.io/2',
      easBuildProfile: 'development',
    });

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(true);
    const params = initSpy.mock.calls[0][0];
    expect(params.environment).toBe('development');
    expect(params.tracesSampleRate).toBe(0.0);
  });

  it('uses tracesSampleRate 0.0 for the development-simulator profile', async () => {
    setMockExtra({
      sentryDsnMobile: 'https://k@o0.ingest.sentry.io/3',
      easBuildProfile: 'development-simulator',
    });

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(true);
    const params = initSpy.mock.calls[0][0];
    expect(params.environment).toBe('development-simulator');
    expect(params.tracesSampleRate).toBe(0.0);
  });

  it('falls back to the development profile when easBuildProfile is absent', async () => {
    setMockExtra({
      sentryDsnMobile: 'https://k@o0.ingest.sentry.io/4',
      // easBuildProfile intentionally omitted
    });

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(true);
    const params = initSpy.mock.calls[0][0];
    expect(params.environment).toBe('development');
    expect(params.tracesSampleRate).toBe(0.0);
  });

  it('fail-open no-op (warn, no init, returns false) when DSN is absent', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setMockExtra({ easBuildProfile: 'development' });

    const { initSentry } = await loadModule();
    const result = initSentry();

    expect(result).toBe(false);
    expect(initSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('sentry_init_skipped', expect.anything());
  });

  it('fail-open no-op when DSN is an empty string', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setMockExtra({ sentryDsnMobile: '', easBuildProfile: 'preview' });

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(false);
    expect(initSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('fail-open no-op when expoConfig is null (classic manifest / non-Expo runtime)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockExpoConfig = null;

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(false);
    expect(initSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('try/catch fail-open: a throwing Sentry.init is swallowed and returns false', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initSpy.mockImplementation(() => {
      throw new Error('native init boom');
    });
    setMockExtra({
      sentryDsnMobile: 'https://k@o0.ingest.sentry.io/5',
      easBuildProfile: 'production',
    });

    const { initSentry } = await loadModule();
    // Must NOT throw — fail-open contract.
    expect(() => initSentry()).not.toThrow();
    expect(initSentry()).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('sentry_init_failed', expect.anything());
  });

  it('coerces a non-string DSN to a fail-open no-op (defence-in-depth)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setMockExtra({ sentryDsnMobile: 12345, easBuildProfile: 'production' });

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(false);
    expect(initSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('exposes the per-profile traces-sample-rate mapping for sibling reuse', async () => {
    const { TRACES_SAMPLE_RATE_BY_PROFILE, ERROR_SAMPLE_RATE } = await loadModule();
    expect(TRACES_SAMPLE_RATE_BY_PROFILE).toEqual({
      'development-simulator': 0.0,
      development: 0.0,
      preview: 0.1,
      production: 0.1,
    });
    expect(ERROR_SAMPLE_RATE).toBe(1.0);
  });
});
