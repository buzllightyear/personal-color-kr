/**
 * Unit test — `apps/mobile/src/set-sentry-user.ts` :: `setSentryUser`
 * (Phase 7.3).
 *
 * Pins the AC: "src/set-sentry-user.ts exports setSentryUser accepting an
 * id-only payload with try/catch fail-open".
 *
 * This is the sign-in-side seam (called from the Apple Sign In success path)
 * and the mobile parallel of the api Phase 7.2c `set_request_user` discipline.
 * Four things are asserted:
 *
 *   1. Happy path — `setSentryUser({ id })` calls `Sentry.setUser` exactly once
 *      with `{ id }` (the numeric user id stringified), and returns nothing.
 *   2. id-only discipline — the object handed to `setUser` carries the single
 *      `id` key and NOTHING else; no email / username / PII ever reaches Sentry,
 *      even when the caller's payload object would (defensively) carry extras.
 *   3. Fail-open — a throwing `Sentry.setUser` is swallowed (never propagates),
 *      a single `console.warn` carrying the `sentry_set_user_failed` marker is
 *      emitted, and the function still returns normally.
 *   4. No-warn happy path — the breadcrumb fires ONLY on failure.
 *
 * Mocking strategy mirrors `tests/sentry-clear-user.test.ts`:
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

async function loadModule(): Promise<typeof import('../src/set-sentry-user')> {
  return await import('../src/set-sentry-user');
}

describe('set-sentry-user.ts — setSentryUser fail-open + id-only setUser', () => {
  beforeEach(() => {
    vi.resetModules();
    setUserSpy.mockReset();
    vi.restoreAllMocks();
  });

  it('calls Sentry.setUser exactly once with the id-only object', async () => {
    const { setSentryUser } = await loadModule();

    const result = setSentryUser({ id: '4815' });

    expect(result).toBeUndefined();
    expect(setUserSpy).toHaveBeenCalledTimes(1);
    expect(setUserSpy).toHaveBeenCalledWith({ id: '4815' });
  });

  it('forwards ONLY the id — never any other PII field', async () => {
    const { setSentryUser } = await loadModule();

    // Even if a caller hands an over-broad object, only `id` may reach Sentry.
    setSentryUser({
      id: '2342',
      // @ts-expect-error — payload type is id-only; extras must be stripped.
      email: 'leak@example.com',
      username: 'leaky',
    });

    const arg = setUserSpy.mock.calls[0][0];
    expect(arg).toEqual({ id: '2342' });
    expect(Object.keys(arg)).toEqual(['id']);
    expect(arg).not.toHaveProperty('email');
    expect(arg).not.toHaveProperty('username');
  });

  it('does not warn on the happy path', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { setSentryUser } = await loadModule();
    setSentryUser({ id: '1' });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('fail-open: a throwing Sentry.setUser is swallowed and warns once with the marker', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setUserSpy.mockImplementation(() => {
      throw new Error('native setUser boom');
    });

    const { setSentryUser, SENTRY_SET_USER_FAILED_MARKER } = await loadModule();

    // Must NOT throw — fail-open contract.
    expect(() => setSentryUser({ id: '7' })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(SENTRY_SET_USER_FAILED_MARKER);
    expect(SENTRY_SET_USER_FAILED_MARKER).toBe('sentry_set_user_failed');
  });

  it('still returns normally (undefined) after a swallowed failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setUserSpy.mockImplementation(() => {
      throw new Error('boom');
    });

    const { setSentryUser } = await loadModule();
    expect(setSentryUser({ id: '9' })).toBeUndefined();
  });
});
