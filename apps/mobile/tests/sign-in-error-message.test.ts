/**
 * Unit test — `signInErrorMessage` (network-vs-rejection sign-in copy).
 */
import { describe, expect, it } from 'vitest';

import {
  SIGN_IN_NETWORK_MESSAGE,
  SIGN_IN_REJECTED_MESSAGE,
  signInErrorMessage,
} from '../src/sign-in-error-message';

describe('signInErrorMessage', () => {
  it('returns the connectivity copy when no HTTP response completed (httpStatus null)', () => {
    expect(signInErrorMessage(null)).toBe(SIGN_IN_NETWORK_MESSAGE);
    expect(signInErrorMessage(null)).toContain('연결');
  });

  it('returns the rejection copy when the backend returned a status', () => {
    expect(signInErrorMessage(401)).toBe(SIGN_IN_REJECTED_MESSAGE);
    expect(signInErrorMessage(500)).toBe(SIGN_IN_REJECTED_MESSAGE);
    expect(signInErrorMessage(401)).toContain('로그인에 실패');
  });

  it('gives the two cases distinct copy (so the user can tell them apart)', () => {
    expect(signInErrorMessage(null)).not.toBe(signInErrorMessage(401));
  });
});
