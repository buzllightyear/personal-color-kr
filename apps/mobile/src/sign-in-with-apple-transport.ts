/**
 * `createSignInWithAppleTransport(config)` — the real `fetch`-backed transport
 * for `POST /v1/auth/sign-in-with-apple`, adapting the server's JSON response
 * down to the {@link SignInHttpResponse} shape `submitSignInWithApple` consumes.
 *
 * Why a separate factory (mirrors `createDiagnosisTransport` /
 * `createReferralMeTransport`):
 *   `submitSignInWithApple` owns the clear-stash-on-200 + Sentry-correlation
 *   sequencing against an INJECTED transport, so the pure sequencing stays
 *   testable without a live HTTP client. This module is that transport for the
 *   app runtime: it assembles the JSON POST, and on a 200 surfaces the inline
 *   `user.id` (for Sentry) AND the `access_token` (for Keychain persistence in
 *   `run-sign-in.ts`) on the response. On any non-2xx it returns just the
 *   status so the orchestrator can branch to an error state — it does NOT throw
 *   on an HTTP error (a rejected Apple token is a normal 401, not an exception),
 *   reserving thrown errors for genuine transport failures (network drop).
 */
import { getApiBaseUrl } from './config/api-base-url';
import type { SignInWithAppleRequestBody } from './sign-in-with-apple-request-body';
import type {
  SignInHttpResponse,
  SignInWithAppleTransport,
} from './submit-sign-in-with-apple';

/** The relative path of the Apple Sign In endpoint under the `/v1` prefix. */
export const SIGN_IN_WITH_APPLE_PATH = '/v1/auth/sign-in-with-apple' as const;

/**
 * The JSON body `POST /v1/auth/sign-in-with-apple` returns on success,
 * snake_case 1:1 with the server's `api.schemas.auth.SignInWithAppleResponse`
 * Pydantic model. Only the fields this transport reads are declared.
 */
export interface SignInWithAppleWireResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly user: {
    readonly id: string;
  };
}

/**
 * The minimal slice of the WHATWG `fetch` contract this module relies on for
 * the JSON POST. Declared locally so the factory is testable with a tiny stub
 * (and does not couple the test to RN's global `fetch` typing).
 */
export type SignInFetchLike = (
  input: string,
  init: {
    readonly method: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body: string;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Configuration for {@link createSignInWithAppleTransport}.
 *
 * `baseUrl` defaults to {@link getApiBaseUrl}; `fetchImpl` defaults to the
 * runtime global `fetch` and is overridable in tests.
 */
export interface SignInWithAppleTransportConfig {
  readonly baseUrl?: string;
  readonly fetchImpl?: SignInFetchLike;
}

/**
 * Build a real `fetch`-backed {@link SignInWithAppleTransport} for
 * `POST /v1/auth/sign-in-with-apple`.
 *
 * The returned transport `JSON.stringify`s the request body, POSTs it against
 * `${baseUrl}${SIGN_IN_WITH_APPLE_PATH}`, and adapts the result:
 *   - HTTP 200 → `{ status, userId: user.id, accessToken: access_token }`.
 *   - any non-2xx → `{ status }` alone (no token; the orchestrator branches to
 *     an error state). The transport does NOT throw on an HTTP error — only on
 *     a genuine transport failure (network drop), which the orchestrator's
 *     try/catch maps to a generic error.
 *
 * @param config - base URL / fetch overrides.
 * @returns a transport suitable for `submitSignInWithApple`.
 */
export function createSignInWithAppleTransport(
  config: SignInWithAppleTransportConfig = {},
): SignInWithAppleTransport {
  const baseUrl = config.baseUrl ?? getApiBaseUrl();
  const fetchImpl: SignInFetchLike = config.fetchImpl ?? globalThis.fetch;

  return async (body: SignInWithAppleRequestBody): Promise<SignInHttpResponse> => {
    const response = await fetchImpl(`${baseUrl}${SIGN_IN_WITH_APPLE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { status: response.status };
    }

    const wire = (await response.json()) as SignInWithAppleWireResponse;
    return {
      status: response.status,
      userId: wire.user.id,
      accessToken: wire.access_token,
    };
  };
}
