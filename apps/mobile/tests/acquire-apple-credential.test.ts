/**
 * Unit test — `acquire-apple-credential.ts` (native Sign in with Apple seam).
 *
 * The native `expo-apple-authentication` is aliased to an inert stub in
 * `vitest.config.ts`; here we drive `acquireAppleCredential` through its
 * injected `isAvailable` / `signIn` deps to pin the unavailable, user-cancel,
 * real-error, missing-token, and success → `AppleSignInCredential` mappings
 * deterministically — and exercise the Korean-vs-Western name formatter.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  acquireAppleCredential,
  APPLE_SIGN_IN_CANCELED_CODE,
  formatAppleFullName,
} from '../src/acquire-apple-credential';

const AVAILABLE = () => Promise.resolve(true);

function canceledError(): Error & { code: string } {
  const error = new Error('The user canceled the authorization attempt') as Error & {
    code: string;
  };
  error.code = APPLE_SIGN_IN_CANCELED_CODE;
  return error;
}

describe('formatAppleFullName', () => {
  it('returns null when both name parts are absent', () => {
    expect(formatAppleFullName(null)).toBeNull();
    expect(formatAppleFullName({ givenName: null, familyName: null })).toBeNull();
    expect(formatAppleFullName({ givenName: '  ', familyName: '' })).toBeNull();
  });

  it('joins a Korean name family-first with no separator (홍 + 길동 → 홍길동)', () => {
    expect(formatAppleFullName({ givenName: '길동', familyName: '홍' })).toBe('홍길동');
  });

  it('joins a Western name given-first, space-separated', () => {
    expect(formatAppleFullName({ givenName: 'John', familyName: 'Appleseed' })).toBe(
      'John Appleseed',
    );
  });

  it('returns the single present part when only one is supplied', () => {
    expect(formatAppleFullName({ givenName: '길동', familyName: null })).toBe('길동');
    expect(formatAppleFullName({ givenName: null, familyName: 'Appleseed' })).toBe(
      'Appleseed',
    );
  });
});

describe('acquireAppleCredential', () => {
  it('returns null and never calls signIn when Apple auth is unavailable', async () => {
    const signIn = vi.fn();
    const result = await acquireAppleCredential({
      isAvailable: () => Promise.resolve(false),
      signIn,
    });
    expect(result).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('returns null when the user cancels the authorization', async () => {
    const result = await acquireAppleCredential({
      isAvailable: AVAILABLE,
      signIn: () => Promise.reject(canceledError()),
    });
    expect(result).toBeNull();
  });

  it('rethrows a non-cancel native error so the caller can surface it', async () => {
    const failure = new Error('apple servers unreachable');
    await expect(
      acquireAppleCredential({
        isAvailable: AVAILABLE,
        signIn: () => Promise.reject(failure),
      }),
    ).rejects.toThrow('apple servers unreachable');
  });

  it('returns null when the credential carries no identity token', async () => {
    const result = await acquireAppleCredential({
      isAvailable: AVAILABLE,
      signIn: () =>
        Promise.resolve({ identityToken: null, fullName: null, email: null }),
    });
    expect(result).toBeNull();
  });

  it('maps a first-authorization credential (token + name + email)', async () => {
    const result = await acquireAppleCredential({
      isAvailable: AVAILABLE,
      signIn: () =>
        Promise.resolve({
          identityToken: 'eyJ.apple.jwt',
          fullName: { givenName: '길동', familyName: '홍' },
          email: 'hong@example.com',
        }),
    });
    expect(result).toEqual({
      identityToken: 'eyJ.apple.jwt',
      fullName: '홍길동',
      email: 'hong@example.com',
    });
  });

  it('omits fullName / email on a re-auth credential (token only)', async () => {
    const result = await acquireAppleCredential({
      isAvailable: AVAILABLE,
      signIn: () =>
        Promise.resolve({
          identityToken: 'eyJ.reauth.jwt',
          fullName: null,
          email: null,
        }),
    });
    expect(result).toEqual({ identityToken: 'eyJ.reauth.jwt' });
    expect(result).not.toHaveProperty('fullName');
    expect(result).not.toHaveProperty('email');
  });
});
