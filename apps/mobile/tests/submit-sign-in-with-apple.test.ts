/**
 * Unit test — `apps/mobile/src/submit-sign-in-with-apple.ts`
 * (Phase 4.5 — clear the stashed referral code after a successful
 * Apple Sign In, ontology `stashed_referral_code` "cleanup after
 * attribution").
 *
 * The unit under test is dependency-injected on every side effect — the
 * stash read, the HTTP transport, and the stash clear — so these tests
 * drive the success / failure branches with in-memory stubs: no React, no
 * expo modules, no AsyncStorage backend, and no live HTTP client.
 *
 * Asserts (the core AC and its guards):
 *   - on HTTP 200 the stash is cleared exactly once (the core AC);
 *   - on a non-200 status (4xx / 5xx) the stash is NOT cleared, so the code
 *     survives for a later retry / sign-in;
 *   - the request body the transport receives carries the stashed
 *     `referral_code` (the build step is wired through);
 *   - the stash is read once and BEFORE the transport is invoked, and the
 *     clear (when it happens) runs AFTER the transport resolves;
 *   - an organic 200 (nothing stashed) still calls clear (idempotent no-op),
 *     so the contract is "clear on 200", not "clear only when a code was
 *     sent";
 *   - the transport's response is returned verbatim to the caller.
 */
import { describe, expect, it, vi } from 'vitest';

// `submit-sign-in-with-apple.ts` now transitively imports
// `src/set-sentry-user.ts`, which statically imports the native
// `@sentry/react-native` SDK (whose Objective-C-backed shim Node cannot
// resolve under vitest). Replace it with an inert spy so these Phase 4.5
// cleanup tests load the module without touching the native bridge — the
// Sentry-on-success behaviour itself is asserted in
// `submit-sign-in-with-apple-sets-sentry-user.test.ts`.
vi.mock('@sentry/react-native', () => ({ setUser: vi.fn() }));

import {
  submitSignInWithApple,
  type SignInWithAppleTransport,
} from '../src/submit-sign-in-with-apple';
import type { StashedReferralCodeReader } from '../src/sign-in-with-apple-request-body';

const IDENTITY_TOKEN = 'eyJhbGciOiJSUzI1Nival.id.token';

/** A stub stash reader that always resolves to the given value. */
function readerReturning(value: string | null): StashedReferralCodeReader {
  return async (): Promise<string | null> => value;
}

/** A stub transport that always resolves to the given HTTP status. */
function transportWithStatus(status: number): SignInWithAppleTransport {
  return async () => ({ status });
}

describe('submitSignInWithApple (Phase 4.5 — cleanup after attribution)', () => {
  describe('clear-on-HTTP-200 (core AC)', () => {
    it('clears the stash exactly once on a 200 response', async () => {
      const clearStash = vi.fn(async (): Promise<void> => undefined);
      await submitSignInWithApple(
        { identityToken: IDENTITY_TOKEN },
        transportWithStatus(200),
        { readStash: readerReturning('Ab3xY-z9'), clearStash },
      );
      expect(clearStash).toHaveBeenCalledTimes(1);
    });

    it('clears on an organic 200 (nothing stashed) — clear is idempotent', async () => {
      const clearStash = vi.fn(async (): Promise<void> => undefined);
      await submitSignInWithApple(
        { identityToken: IDENTITY_TOKEN },
        transportWithStatus(200),
        { readStash: readerReturning(null), clearStash },
      );
      expect(clearStash).toHaveBeenCalledTimes(1);
    });
  });

  describe('non-200 leaves the stash intact', () => {
    it.each([
      ['401 unauthorized', 401],
      ['409 conflict', 409],
      ['500 server error', 500],
    ])('does NOT clear the stash on %s', async (_label, status) => {
      const clearStash = vi.fn(async (): Promise<void> => undefined);
      await submitSignInWithApple(
        { identityToken: IDENTITY_TOKEN },
        transportWithStatus(status),
        { readStash: readerReturning('Ab3xY-z9'), clearStash },
      );
      expect(clearStash).not.toHaveBeenCalled();
    });
  });

  describe('request body wiring', () => {
    it('forwards a body carrying the stashed referral_code to the transport', async () => {
      const transport = vi.fn<
        Parameters<SignInWithAppleTransport>,
        ReturnType<SignInWithAppleTransport>
      >(async () => ({ status: 200 }));
      await submitSignInWithApple({ identityToken: IDENTITY_TOKEN }, transport, {
        readStash: readerReturning('codeABCD'),
        clearStash: async () => undefined,
      });
      expect(transport).toHaveBeenCalledTimes(1);
      const body = transport.mock.calls[0]?.[0];
      expect(body?.identity_token).toBe(IDENTITY_TOKEN);
      expect(body?.referral_code).toBe('codeABCD');
    });
  });

  describe('ordering', () => {
    it('reads the stash before transport, clears after transport resolves', async () => {
      const order: string[] = [];
      const readStash: StashedReferralCodeReader = async () => {
        order.push('read');
        return 'codeABCD';
      };
      const transport: SignInWithAppleTransport = async () => {
        order.push('transport');
        return { status: 200 };
      };
      const clearStash = async (): Promise<void> => {
        order.push('clear');
      };
      await submitSignInWithApple({ identityToken: IDENTITY_TOKEN }, transport, {
        readStash,
        clearStash,
      });
      expect(order).toEqual(['read', 'transport', 'clear']);
    });
  });

  describe('return value', () => {
    it('returns the transport response verbatim', async () => {
      const response = await submitSignInWithApple(
        { identityToken: IDENTITY_TOKEN },
        transportWithStatus(200),
        { readStash: readerReturning(null), clearStash: async () => undefined },
      );
      expect(response).toEqual({ status: 200 });
    });
  });
});
