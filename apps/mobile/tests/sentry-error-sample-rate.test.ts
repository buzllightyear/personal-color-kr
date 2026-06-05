/**
 * Unit test — `apps/mobile/src/sentry.ts` :: error `sampleRate` invariant
 * (Phase 7.3).
 *
 * Pins the AC: "Error sampleRate remains default 1.0 across all profiles".
 *
 * Where {@link ../src/sentry!TRACES_SAMPLE_RATE_BY_PROFILE} *downsamples*
 * transactions per profile (`0.0` for the two development profiles, `0.1` for
 * `preview`/`production`), the error capture rate is the orthogonal, invariant
 * axis: crashes and errors are NEVER downsampled. This mirrors the api Phase
 * 7.2/7.2c contract where `traces_sample_rate` varies by environment but the
 * error `sample_rate` is fixed at `1.0`.
 *
 * Two complementary guarantees are pinned here:
 *
 *   1. The exported {@link ../src/sentry!ERROR_SAMPLE_RATE} constant is exactly
 *      `1.0` (the single source of truth the init seam reads from).
 *   2. For EVERY EAS build profile — `development-simulator`, `development`,
 *      `preview`, `production` — the params handed to `Sentry.init` carry
 *      `sampleRate === 1.0`, independent of that profile's `tracesSampleRate`.
 *      This is the behavioural assertion that would catch any future drift that
 *      tied the error rate to the (per-profile) trace rate.
 *
 * Mocking strategy mirrors `tests/sentry-init.test.ts`:
 *   - `vi.mock('@sentry/react-native', ...)` swaps the native SDK for a
 *     `vi.fn()` spy so vitest never resolves the Objective-C-backed native
 *     shim and we can inspect the exact init params.
 *   - `vi.mock('expo-constants', ...)` exposes a mutable `extra` holder so each
 *     case can set the DSN + build profile the runtime would observe.
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

// Spy for the native SDK's `init`. Hoisted so the (hoisted) `vi.mock` factory
// can close over it.
const { initSpy } = vi.hoisted(() => ({ initSpy: vi.fn() }));

vi.mock('@sentry/react-native', () => ({
  init: initSpy,
}));

async function loadModule(): Promise<typeof import('../src/sentry')> {
  return await import('../src/sentry');
}

const ALL_PROFILES = [
  'development-simulator',
  'development',
  'preview',
  'production',
] as const;

describe('sentry.ts — error sampleRate is a fixed 1.0 across all profiles', () => {
  beforeEach(() => {
    vi.resetModules();
    initSpy.mockReset();
    mockExpoConfig = null;
    vi.restoreAllMocks();
  });

  it('exports ERROR_SAMPLE_RATE as exactly 1.0', async () => {
    const { ERROR_SAMPLE_RATE } = await loadModule();
    expect(ERROR_SAMPLE_RATE).toBe(1.0);
  });

  it.each(ALL_PROFILES)(
    'passes sampleRate 1.0 to Sentry.init for the %s profile',
    async (profile) => {
      setMockExtra({
        sentryDsnMobile: 'https://k@o0.ingest.sentry.io/0',
        easBuildProfile: profile,
      });

      const { initSentry } = await loadModule();
      expect(initSentry()).toBe(true);

      const params = initSpy.mock.calls[0][0];
      expect(params.environment).toBe(profile);
      // The error sampleRate is the invariant axis: always 1.0…
      expect(params.sampleRate).toBe(1.0);
    },
  );

  it('keeps the error sampleRate at 1.0 even where tracesSampleRate is downsampled to 0.0', async () => {
    // The two development profiles trace at 0.0 — proving the error rate is NOT
    // coupled to the trace rate.
    setMockExtra({
      sentryDsnMobile: 'https://k@o0.ingest.sentry.io/0',
      easBuildProfile: 'development',
    });

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(true);

    const params = initSpy.mock.calls[0][0];
    expect(params.tracesSampleRate).toBe(0.0);
    expect(params.sampleRate).toBe(1.0);
  });

  it('keeps the error sampleRate at 1.0 even where tracesSampleRate is 0.1', async () => {
    setMockExtra({
      sentryDsnMobile: 'https://k@o0.ingest.sentry.io/0',
      easBuildProfile: 'production',
    });

    const { initSentry } = await loadModule();
    expect(initSentry()).toBe(true);

    const params = initSpy.mock.calls[0][0];
    expect(params.tracesSampleRate).toBe(0.1);
    expect(params.sampleRate).toBe(1.0);
  });

  it('sources the init sampleRate from the exported ERROR_SAMPLE_RATE constant', async () => {
    setMockExtra({
      sentryDsnMobile: 'https://k@o0.ingest.sentry.io/0',
      easBuildProfile: 'preview',
    });

    const mod = await loadModule();
    expect(mod.initSentry()).toBe(true);

    const params = initSpy.mock.calls[0][0];
    expect(params.sampleRate).toBe(mod.ERROR_SAMPLE_RATE);
  });
});
