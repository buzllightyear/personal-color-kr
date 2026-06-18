/**
 * Unit test — `sign-in-with-apple-transport.ts` (real fetch adapter).
 *
 * Drives `createSignInWithAppleTransport` through an injected `fetchImpl` to pin
 * the JSON POST shape (path, headers, serialized body) and the response
 * adaptation: a 200 surfaces `userId` + `accessToken`; a non-2xx returns just
 * the status (no throw, no token).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createSignInWithAppleTransport,
  SIGN_IN_WITH_APPLE_PATH,
} from '../src/sign-in-with-apple-transport';

const BODY = { identity_token: 'eyJ.apple.jwt' } as const;

function okResponse(json: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(json) };
}
function errResponse(status: number) {
  return { ok: false, status, json: () => Promise.resolve({ detail: 'nope' }) };
}

describe('createSignInWithAppleTransport', () => {
  it('POSTs the JSON body to the /v1 auth path with json headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        access_token: 'eyJ.backend.jwt',
        token_type: 'bearer',
        expires_in: 86_400,
        user: { id: 'user-123' },
      }),
    );
    const transport = createSignInWithAppleTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await transport(BODY);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.example.com${SIGN_IN_WITH_APPLE_PATH}`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify(BODY));
  });

  it('adapts a 200 into status + userId + accessToken', async () => {
    const transport = createSignInWithAppleTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: () =>
        Promise.resolve(
          okResponse({
            access_token: 'eyJ.backend.jwt',
            token_type: 'bearer',
            expires_in: 86_400,
            user: { id: 'user-123' },
          }),
        ),
    });
    expect(await transport(BODY)).toEqual({
      status: 200,
      userId: 'user-123',
      accessToken: 'eyJ.backend.jwt',
    });
  });

  it('returns just the status on a non-2xx (no token, no throw)', async () => {
    const transport = createSignInWithAppleTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: () => Promise.resolve(errResponse(401)),
    });
    const result = await transport(BODY);
    expect(result).toEqual({ status: 401 });
    expect(result).not.toHaveProperty('accessToken');
  });
});
