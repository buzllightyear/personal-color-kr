/**
 * Unit test — `apps/mobile/src/submit-sign-in-with-apple.ts` :: the Phase 7.3
 * Sentry-correlation seam on the Apple Sign In success path.
 *
 * Pins the AC: "submit-sign-in-with-apple.ts calls setSentryUser(String(userId))
 * on the auth success path".
 *
 * The orchestration function is dependency-injected on every side effect — the
 * stash read, the HTTP transport, the stash clear, AND now the Sentry
 * `setUser` seam — so these tests drive the success / failure branches with
 * in-memory stubs: no React, no expo modules, no AsyncStorage backend, no live
 * HTTP client, and (via the injected `setUser`) no native `@sentry/react-native`
 * SDK.
 *
 * Asserts the Seed-locked semantics layered on top of the clear-on-200
 * contract:
 *   - on HTTP 200 with a `userId`, `setUser` is called exactly once with the
 *     id-only object `{ id: String(userId) }` (the core AC) — numeric ids are
 *     stringified;
 *   - the id-only discipline holds — only `id` reaches the seam, no PII;
 *   - on a non-200 status the user is NOT correlated (no `setUser`), so a
 *     failed sign-in never attaches a user to the scope;
 *   - a 200 that carries no `userId` skips correlation rather than sending a
 *     bogus `"undefined"` id;
 *   - the default seam (no override) resolves to the real `setSentryUser`,
 *     which is id-only and fail-open (asserted against the mocked native SDK).
 *
 * `@sentry/react-native` is mocked wholesale so the default-seam assertion
 * exercises the real `setSentryUser` without resolving the native shim.
 */
import { describe, expect, it, vi } from 'vitest';

const { setUserSpy } = vi.hoisted(() => ({ setUserSpy: vi.fn() }));

vi.mock('@sentry/react-native', () => ({ setUser: setUserSpy }));

import {
  submitSignInWithApple,
  type SignInHttpResponse,
  type SignInWithAppleTransport,
} from '../src/submit-sign-in-with-apple';
import type { SentryUserPayload } from '../src/set-sentry-user';
import type { StashedReferralCodeReader } from '../src/sign-in-with-apple-request-body';

const IDENTITY_TOKEN = 'eyJhbGciOiJSUzI1Nival.id.token';

/** A stub stash reader that always resolves to the given value. */
function readerReturning(value: string | null): StashedReferralCodeReader {
  return async (): Promise<string | null> => value;
}

/** A stub transport that always resolves to the given response shape. */
function transportReturning(response: SignInHttpResponse): SignInWithAppleTransport {
  return async () => response;
}

/** Default DI overrides that keep every side effect inert and in-memory. */
function inertDeps(setUser: (user: SentryUserPayload) => void) {
  return {
    readStash: readerReturning(null),
    clearStash: async (): Promise<void> => undefined,
    setUser,
  };
}

describe('submitSignInWithApple (Phase 7.3 — id-only Sentry correlation on success)', () => {
  it('calls setUser exactly once with { id: String(userId) } on a 200', async () => {
    const setUser = vi.fn<[SentryUserPayload], void>();

    await submitSignInWithApple(
      { identityToken: IDENTITY_TOKEN },
      transportReturning({ status: 200, userId: '4815' }),
      inertDeps(setUser),
    );

    expect(setUser).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith({ id: '4815' });
  });

  it('stringifies a numeric userId (String(userId)) before correlating', async () => {
    const setUser = vi.fn<[SentryUserPayload], void>();

    await submitSignInWithApple(
      { identityToken: IDENTITY_TOKEN },
      transportReturning({ status: 200, userId: 162342 }),
      inertDeps(setUser),
    );

    expect(setUser).toHaveBeenCalledTimes(1);
    const arg = setUser.mock.calls[0]?.[0];
    expect(arg).toEqual({ id: '162342' });
    expect(Object.keys(arg ?? {})).toEqual(['id']);
  });

  it('does NOT correlate the user on a non-200 response', async () => {
    const setUser = vi.fn<[SentryUserPayload], void>();

    await submitSignInWithApple(
      { identityToken: IDENTITY_TOKEN },
      transportReturning({ status: 401, userId: '4815' }),
      inertDeps(setUser),
    );

    expect(setUser).not.toHaveBeenCalled();
  });

  it('skips correlation on a 200 that carries no userId (no bogus "undefined" id)', async () => {
    const setUser = vi.fn<[SentryUserPayload], void>();

    await submitSignInWithApple(
      { identityToken: IDENTITY_TOKEN },
      transportReturning({ status: 200 }),
      inertDeps(setUser),
    );

    expect(setUser).not.toHaveBeenCalled();
  });

  it('defaults to the real setSentryUser (id-only, against the mocked native SDK)', async () => {
    setUserSpy.mockReset();

    // No `setUser` override → the default real `setSentryUser` runs and, being
    // id-only + fail-open, forwards exactly `{ id }` to the (mocked) native SDK.
    await submitSignInWithApple(
      { identityToken: IDENTITY_TOKEN },
      transportReturning({ status: 200, userId: '999' }),
      {
        readStash: readerReturning(null),
        clearStash: async () => undefined,
      },
    );

    expect(setUserSpy).toHaveBeenCalledTimes(1);
    expect(setUserSpy).toHaveBeenCalledWith({ id: '999' });
  });
});
