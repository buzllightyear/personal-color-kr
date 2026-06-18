/**
 * Unit test — `run-sign-in.ts` (Sign in with Apple orchestrator).
 *
 * Drives `runSignIn` through injected `acquire` / `signIn` / `persistToken`
 * seams to pin every branch of the outcome contract: cancel (null credential),
 * native-error, network-error, non-200 auth rejection, persist-failure, and the
 * happy path (token persisted → `signed_in`).
 */
import { describe, expect, it, vi } from 'vitest';

// `run-sign-in.ts` transitively imports `submit-sign-in-with-apple.ts` →
// `set-sentry-user.ts`, which statically imports the native
// `@sentry/react-native` SDK (whose Flow `import typeof` syntax rollup cannot
// parse in the node test env). The orchestrator's `signIn` seam is injected
// whole in these tests, so the default Sentry path is never exercised — replace
// the native module with an inert spy purely so the import graph loads.
vi.mock('@sentry/react-native', () => ({ setUser: vi.fn() }));

import { runSignIn } from '../src/run-sign-in';
import type { AppleSignInCredential } from '../src/sign-in-with-apple-request-body';

const CREDENTIAL: AppleSignInCredential = { identityToken: 'eyJ.apple.jwt' };

describe('runSignIn', () => {
  it('returns canceled (no sign-in, no persist) when no credential is obtained', async () => {
    const signIn = vi.fn();
    const persistToken = vi.fn();
    const result = await runSignIn({
      acquire: () => Promise.resolve(null),
      signIn,
      persistToken,
    });
    expect(result).toEqual({ status: 'canceled' });
    expect(signIn).not.toHaveBeenCalled();
    expect(persistToken).not.toHaveBeenCalled();
  });

  it('returns error (httpStatus null) when credential acquisition throws', async () => {
    const result = await runSignIn({
      acquire: () => Promise.reject(new Error('apple native failure')),
      signIn: vi.fn(),
      persistToken: vi.fn(),
    });
    expect(result).toEqual({ status: 'error', httpStatus: null });
  });

  it('returns error (httpStatus null) on a transport/network failure', async () => {
    const result = await runSignIn({
      acquire: () => Promise.resolve(CREDENTIAL),
      signIn: () => Promise.reject(new Error('network down')),
      persistToken: vi.fn(),
    });
    expect(result).toEqual({ status: 'error', httpStatus: null });
  });

  it('returns error with the server status on a non-200 auth rejection', async () => {
    const persistToken = vi.fn();
    const result = await runSignIn({
      acquire: () => Promise.resolve(CREDENTIAL),
      signIn: () => Promise.resolve({ status: 401 }),
      persistToken,
    });
    expect(result).toEqual({ status: 'error', httpStatus: 401 });
    expect(persistToken).not.toHaveBeenCalled();
  });

  it('returns error when a 200 carries no access token', async () => {
    const result = await runSignIn({
      acquire: () => Promise.resolve(CREDENTIAL),
      signIn: () => Promise.resolve({ status: 200, userId: 'u1' }),
      persistToken: vi.fn(),
    });
    expect(result).toEqual({ status: 'error', httpStatus: 200 });
  });

  it('persists the token and returns signed_in with the stringified userId', async () => {
    const persistToken = vi.fn().mockResolvedValue(undefined);
    const result = await runSignIn({
      acquire: () => Promise.resolve(CREDENTIAL),
      signIn: () =>
        Promise.resolve({
          status: 200,
          userId: 'user-123',
          accessToken: 'eyJ.backend.jwt',
        }),
      persistToken,
    });
    expect(persistToken).toHaveBeenCalledWith('eyJ.backend.jwt');
    expect(result).toEqual({ status: 'signed_in', userId: 'user-123' });
  });

  it('returns error when persisting the token fails', async () => {
    const result = await runSignIn({
      acquire: () => Promise.resolve(CREDENTIAL),
      signIn: () =>
        Promise.resolve({ status: 200, userId: 'u1', accessToken: 'eyJ.backend.jwt' }),
      persistToken: () => Promise.reject(new Error('keychain unavailable')),
    });
    expect(result).toEqual({ status: 'error', httpStatus: 200 });
  });
});
