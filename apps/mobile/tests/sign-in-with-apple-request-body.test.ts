/**
 * Unit test — `apps/mobile/src/sign-in-with-apple-request-body.ts`
 * (Phase 4.5 — attach the stashed referral code to the Apple Sign In body).
 *
 * The unit under test is dependency-injected on its read side, so these
 * tests drive the present / absent / empty stash branches with an in-memory
 * stub reader — no React, no expo modules, no AsyncStorage backend.
 *
 * Asserts:
 *   - a non-empty stashed code is attached as `referral_code` (the core AC);
 *   - an organic signup (null stash) omits `referral_code` entirely;
 *   - an empty-string stash omits `referral_code` (defensive);
 *   - `identity_token` is always forwarded verbatim;
 *   - `full_name` / `email` are included when present, omitted when
 *     null / undefined / empty (re-auth preservation);
 *   - the stash is read exactly once per body build;
 *   - absent optional fields are OMITTED keys, never `null` / `undefined`.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  buildSignInWithAppleRequestBody,
  type StashedReferralCodeReader,
} from '../src/sign-in-with-apple-request-body';

/** A stub reader that always resolves to the given stash value. */
function readerReturning(value: string | null): StashedReferralCodeReader {
  return async (): Promise<string | null> => value;
}

const IDENTITY_TOKEN = 'eyJhbGciOiJSUzI1Nival.id.token';

describe('buildSignInWithAppleRequestBody (Phase 4.5)', () => {
  describe('referral_code attachment from the AsyncStorage stash', () => {
    it('attaches a non-empty stashed code as referral_code (core AC)', async () => {
      const body = await buildSignInWithAppleRequestBody(
        { identityToken: IDENTITY_TOKEN },
        readerReturning('Ab3xY-z9'),
      );
      expect(body.referral_code).toBe('Ab3xY-z9');
    });

    it('omits referral_code entirely on an organic signup (null stash)', async () => {
      const body = await buildSignInWithAppleRequestBody(
        { identityToken: IDENTITY_TOKEN },
        readerReturning(null),
      );
      expect('referral_code' in body).toBe(false);
      expect(body.referral_code).toBeUndefined();
    });

    it('omits referral_code when the stash holds an empty string', async () => {
      const body = await buildSignInWithAppleRequestBody(
        { identityToken: IDENTITY_TOKEN },
        readerReturning(''),
      );
      expect('referral_code' in body).toBe(false);
    });

    it('reads the stash exactly once per build', async () => {
      const read = vi.fn<[], Promise<string | null>>(async () => 'codeABCD');
      await buildSignInWithAppleRequestBody({ identityToken: IDENTITY_TOKEN }, read);
      expect(read).toHaveBeenCalledTimes(1);
    });
  });

  describe('identity_token is always forwarded', () => {
    it('carries the identity token verbatim', async () => {
      const body = await buildSignInWithAppleRequestBody(
        { identityToken: IDENTITY_TOKEN },
        readerReturning(null),
      );
      expect(body.identity_token).toBe(IDENTITY_TOKEN);
    });
  });

  describe('full_name / email (first-auth only) mapping', () => {
    it('includes full_name and email when present (first authorization)', async () => {
      const body = await buildSignInWithAppleRequestBody(
        {
          identityToken: IDENTITY_TOKEN,
          fullName: 'Jordan Kim',
          email: 'jordan@example.com',
        },
        readerReturning('codeABCD'),
      );
      expect(body.full_name).toBe('Jordan Kim');
      expect(body.email).toBe('jordan@example.com');
      expect(body.referral_code).toBe('codeABCD');
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
    ])('omits full_name and email when %s (re-auth)', async (_label, value) => {
      const body = await buildSignInWithAppleRequestBody(
        { identityToken: IDENTITY_TOKEN, fullName: value, email: value },
        readerReturning(null),
      );
      expect('full_name' in body).toBe(false);
      expect('email' in body).toBe(false);
    });
  });

  describe('wire-shape minimality', () => {
    it('an organic re-auth body is exactly { identity_token }', async () => {
      const body = await buildSignInWithAppleRequestBody(
        { identityToken: IDENTITY_TOKEN },
        readerReturning(null),
      );
      expect(Object.keys(body)).toEqual(['identity_token']);
    });

    it('serializes without any null values', async () => {
      const body = await buildSignInWithAppleRequestBody(
        { identityToken: IDENTITY_TOKEN, fullName: null, email: null },
        readerReturning(null),
      );
      expect(JSON.stringify(body)).toBe(
        JSON.stringify({ identity_token: IDENTITY_TOKEN }),
      );
    });
  });
});
