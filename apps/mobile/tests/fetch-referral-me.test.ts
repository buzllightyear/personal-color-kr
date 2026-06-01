/**
 * Unit test — `fetch-referral-me.ts` (Phase 4.5).
 *
 * Two surfaces:
 *   1. `fetchReferralMe(transport)` — maps the snake_case wire body to the
 *      camelCase client value object (the share handlers consume `shareUrl`).
 *   2. `createReferralMeTransport(config)` — the real `fetch`-backed transport:
 *      hits `${baseUrl}/v1/referrals/me`, forwards a Bearer token only when
 *      present, and rejects on non-2xx so the soft-gate caller can swallow it.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createReferralMeTransport,
  fetchReferralMe,
  REFERRALS_ME_PATH,
  type FetchLike,
  type ReferralMeWireResponse,
} from '../src/fetch-referral-me';

const WIRE: ReferralMeWireResponse = {
  referral_code: 'abc12345',
  share_url: 'https://pcolor.example/r/abc12345',
  friend_used_count: 3,
};

function okResponse(body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

describe('fetchReferralMe — wire → camel projection', () => {
  it('maps referral_code / share_url / friend_used_count to camelCase', async () => {
    const result = await fetchReferralMe(() => Promise.resolve(WIRE));
    expect(result).toEqual({
      referralCode: 'abc12345',
      shareUrl: 'https://pcolor.example/r/abc12345',
      friendUsedCount: 3,
    });
  });

  it('surfaces the server share_url as shareUrl (single source of truth)', async () => {
    const { shareUrl } = await fetchReferralMe(() => Promise.resolve(WIRE));
    expect(shareUrl).toBe('https://pcolor.example/r/abc12345');
  });

  it('propagates a transport rejection to the caller', async () => {
    await expect(
      fetchReferralMe(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });
});

describe('createReferralMeTransport — real fetch wiring', () => {
  it('GETs the referrals/me path against the configured base URL', async () => {
    const fetchImpl = vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>(() =>
      okResponse(WIRE),
    );
    const transport = createReferralMeTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    const body = await transport();

    expect(body).toEqual(WIRE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe(`https://api.example.com${REFERRALS_ME_PATH}`);
    expect(init?.method).toBe('GET');
  });

  it('forwards a Bearer Authorization header when an access token is supplied', async () => {
    const fetchImpl = vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>(() =>
      okResponse(WIRE),
    );
    const transport = createReferralMeTransport({
      baseUrl: 'https://api.example.com',
      accessToken: 'jwt-token',
      fetchImpl,
    });
    await transport();
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [, init] = call!;
    expect(init?.headers?.Authorization).toBe('Bearer jwt-token');
  });

  it('omits the Authorization header when no token is supplied', async () => {
    const fetchImpl = vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>(() =>
      okResponse(WIRE),
    );
    const transport = createReferralMeTransport({
      baseUrl: 'https://api.example.com',
      accessToken: null,
      fetchImpl,
    });
    await transport();
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [, init] = call!;
    expect(init?.headers?.Authorization).toBeUndefined();
  });

  it('rejects on a non-2xx response so the soft-gate caller can swallow it', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });
    const transport = createReferralMeTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await expect(transport()).rejects.toThrow('401');
  });
});
