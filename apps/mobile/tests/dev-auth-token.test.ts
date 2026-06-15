/**
 * Unit test — `dev-auth-token.ts` (throwaway dev-JWT env seam).
 *
 * Verifies the null-when-absent contract the diagnosis call site relies on to
 * decide "skip the real call, render the static teaser".
 */
import { afterEach, describe, expect, it } from 'vitest';

import { DEV_AUTH_TOKEN_ENV_KEY, getDevAuthToken } from '../src/config/dev-auth-token';

const ORIGINAL = process.env[DEV_AUTH_TOKEN_ENV_KEY];

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env[DEV_AUTH_TOKEN_ENV_KEY];
  } else {
    process.env[DEV_AUTH_TOKEN_ENV_KEY] = ORIGINAL;
  }
});

describe('getDevAuthToken', () => {
  it('returns the token when the env var is set', () => {
    process.env[DEV_AUTH_TOKEN_ENV_KEY] = 'jwt-dev-token';
    expect(getDevAuthToken()).toBe('jwt-dev-token');
  });

  it('returns null when the env var is unset', () => {
    delete process.env[DEV_AUTH_TOKEN_ENV_KEY];
    expect(getDevAuthToken()).toBeNull();
  });

  it('returns null when the env var is blank', () => {
    process.env[DEV_AUTH_TOKEN_ENV_KEY] = '';
    expect(getDevAuthToken()).toBeNull();
  });
});
