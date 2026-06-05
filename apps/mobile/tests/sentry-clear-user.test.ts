/**
 * Unit test — `apps/mobile/src/clear-sentry-user.ts` :: `clearSentryUser`
 * (Phase 7.3).
 *
 * Pins the AC: "src/clear-sentry-user.ts exports clearSentryUser calling
 * Sentry.setUser(null) with try/catch".
 *
 * This is the sign-out-side mirror of `setSentryUser` and the mobile parallel
 * of the api Phase 7.2c `set_request_user` fail-open discipline. Three things
 * are asserted:
 *
 *   1. Happy path — `clearSentryUser()` calls `Sentry.setUser` exactly once
 *      with `null` (the SDK contract for fully dropping user context), and
 *      returns nothing.
 *   2. id-only discipline — `setUser` is invoked with `null`, never with a
 *      partial-PII object; the clear path sends no user data at all.
 *   3. Fail-open — a throwing `Sentry.setUser` is swallowed (never propagates),
 *      a single `console.warn` carrying the `sentry_clear_user_failed` marker
 *      is emitted, and the function still returns normally.
 *
 * Mocking strategy mirrors `tests/sentry-init.test.ts`:
 *   - `vi.mock('@sentry/react-native', ...)` replaces the native SDK with a
 *     `vi.fn()` spy for `setUser`, so vitest never resolves the native package
 *     (whose Objective-C-backed shim Node cannot parse) and we can assert the
 *     exact argument handed to the SDK.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spy for the native SDK's `setUser`. Declared via `vi.hoisted` so the
// `vi.mock` factory (hoisted to the top of the module) can close over it.
const { setUserSpy } = vi.hoisted(() => ({ setUserSpy: vi.fn() }));

vi.mock('@sentry/react-native', () => ({
  setUser: setUserSpy,
}));

async function loadModule(): Promise<typeof import('../src/clear-sentry-user')> {
  return await import('../src/clear-sentry-user');
}

describe('clear-sentry-user.ts — clearSentryUser fail-open + setUser(null)', () => {
  beforeEach(() => {
    vi.resetModules();
    setUserSpy.mockReset();
    vi.restoreAllMocks();
  });

  it('calls Sentry.setUser exactly once with null', async () => {
    const { clearSentryUser } = await loadModule();

    const result = clearSentryUser();

    expect(result).toBeUndefined();
    expect(setUserSpy).toHaveBeenCalledTimes(1);
    expect(setUserSpy).toHaveBeenCalledWith(null);
  });

  it('sends no user object — only null — preserving the id-only discipline', async () => {
    const { clearSentryUser } = await loadModule();

    clearSentryUser();

    const arg = setUserSpy.mock.calls[0][0];
    expect(arg).toBeNull();
    // Defensive: never a partial-PII object on the clear path.
    expect(arg).not.toEqual(expect.objectContaining({ id: expect.anything() }));
  });

  it('does not warn on the happy path', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { clearSentryUser } = await loadModule();
    clearSentryUser();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('fail-open: a throwing Sentry.setUser is swallowed and warns once with the marker', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setUserSpy.mockImplementation(() => {
      throw new Error('native setUser boom');
    });

    const { clearSentryUser, SENTRY_CLEAR_USER_FAILED_MARKER } = await loadModule();

    // Must NOT throw — fail-open contract.
    expect(() => clearSentryUser()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      SENTRY_CLEAR_USER_FAILED_MARKER,
    );
    expect(SENTRY_CLEAR_USER_FAILED_MARKER).toBe('sentry_clear_user_failed');
  });

  it('still returns normally (undefined) after a swallowed failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setUserSpy.mockImplementation(() => {
      throw new Error('boom');
    });

    const { clearSentryUser } = await loadModule();
    expect(clearSentryUser()).toBeUndefined();
  });
});
