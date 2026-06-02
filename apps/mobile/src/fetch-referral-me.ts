/**
 * `fetch-referral-me.ts` — the mobile API client for `GET /v1/referrals/me`
 * (Phase 4.5). This is the single seam between the FastAPI referrals surface
 * and the mobile referral-gate share handlers.
 *
 * Responsibility:
 *   The server is the *single source of truth* for the referral `share_url`
 *   (`REFERRAL_BASE_URL` + the user's fixed code — assembled server-side). The
 *   mobile client therefore carries NO `REFERRAL_BASE_URL` constant and never
 *   assembles the URL itself; it asks the server for it. This module:
 *     1. defines the wire shape the FastAPI `ReferralMeResponse` emits
 *        (snake_case 1:1 with `api.schemas.referrals.ReferralMeResponse`);
 *     2. maps it to a client-facing camelCase value object; and
 *     3. provides a real `fetch`-backed transport factory so the route can
 *        wire an actual `GET ${baseUrl}/v1/referrals/me` against the backend.
 *
 * Why dependency injection (transport seam):
 *   Mirrors the sibling `submit-sign-in-with-apple.ts` stance: the pure
 *   mapping (`fetchReferralMe`) takes an injected transport so the wire →
 *   camel projection is unit-testable without a live HTTP client, expo
 *   modules, or a running backend. The real transport (`createReferralMe
 *   Transport`) is a thin factory over global `fetch`, itself testable via an
 *   injected `fetchImpl`.
 *
 * Scope discipline:
 *   - No attribution logic here — that is server-side. This module only reads
 *     the authenticated user's referral surface.
 *   - Auth is forwarded as a `Bearer` header only when an access token is
 *     supplied; the broader auth-session token store is a separate concern
 *     (the sign-in flow that mints/persists the JWT is not yet wired into the
 *     app), so the token is injected rather than read here.
 */
import { getApiBaseUrl } from './config/api-base-url';

/**
 * The JSON body `GET /v1/referrals/me` returns, snake_case 1:1 with the
 * server's `api.schemas.referrals.ReferralMeResponse` Pydantic model. This is
 * the wire contract — keep the field names in lock-step with that schema.
 */
export interface ReferralMeWireResponse {
  readonly referral_code: string;
  readonly share_url: string;
  readonly friend_used_count: number;
}

/**
 * Client-facing camelCase projection of {@link ReferralMeWireResponse}.
 *
 * `shareUrl` is the server-assembled full share URL (single source of truth
 * lives server-side); `referralCode` is the user's per-user fixed 8-char
 * code; `friendUsedCount` is the live count of attributed referees.
 */
export interface ReferralMe {
  readonly referralCode: string;
  readonly shareUrl: string;
  readonly friendUsedCount: number;
}

/**
 * The injectable network seam: perform the authenticated
 * `GET /v1/referrals/me` and resolve to its parsed wire body. Injected so the
 * `fetchReferralMe` mapper is testable without a real HTTP client, and so the
 * route can wire a real `fetch` at the call site.
 */
export type ReferralMeTransport = () => Promise<ReferralMeWireResponse>;

/**
 * Map the snake_case wire body to the client-facing camelCase value object.
 *
 * Pure projection — no I/O of its own; the network call is delegated to the
 * injected {@link ReferralMeTransport}.
 *
 * @param transport - injectable seam performing the actual GET.
 * @returns the camelCase referral surface (code, server share URL, count).
 */
export async function fetchReferralMe(
  transport: ReferralMeTransport,
): Promise<ReferralMe> {
  const wire = await transport();
  return {
    referralCode: wire.referral_code,
    shareUrl: wire.share_url,
    friendUsedCount: wire.friend_used_count,
  };
}

/** The relative path of the referrals-me endpoint under the `/v1` prefix. */
export const REFERRALS_ME_PATH = '/v1/referrals/me' as const;

/**
 * The minimal slice of the WHATWG `fetch` contract this module relies on,
 * declared locally so the factory is testable with a tiny stub (and does not
 * couple the test to RN's global `fetch` typing).
 */
export type FetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Configuration for {@link createReferralMeTransport}.
 *
 * `baseUrl` defaults to {@link getApiBaseUrl}; `accessToken` is the backend
 * JWT forwarded as a `Bearer` header (omitted when `null`/absent — the
 * auth-session store that mints it is wired separately); `fetchImpl` defaults
 * to the runtime global `fetch` and is overridable in tests.
 */
export interface ReferralMeTransportConfig {
  readonly baseUrl?: string;
  readonly accessToken?: string | null;
  readonly fetchImpl?: FetchLike;
}

/**
 * Build a real `fetch`-backed {@link ReferralMeTransport} for
 * `GET /v1/referrals/me`.
 *
 * The returned transport issues the GET against `${baseUrl}${REFERRALS_ME_PATH}`,
 * attaching `Authorization: Bearer <token>` only when an access token is
 * supplied, and rejects on a non-2xx status so the caller's silent-degradation
 * guard can swallow auth/network failures without blocking the share flow.
 *
 * @param config - base URL / access token / fetch overrides.
 * @returns a transport suitable for {@link fetchReferralMe}.
 */
export function createReferralMeTransport(
  config: ReferralMeTransportConfig = {},
): ReferralMeTransport {
  const baseUrl = config.baseUrl ?? getApiBaseUrl();
  const accessToken = config.accessToken ?? null;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  return async (): Promise<ReferralMeWireResponse> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (accessToken !== null && accessToken.length > 0) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const response = await fetchImpl(`${baseUrl}${REFERRALS_ME_PATH}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) {
      throw new Error(`GET ${REFERRALS_ME_PATH} failed with status ${response.status}`);
    }
    return (await response.json()) as ReferralMeWireResponse;
  };
}
