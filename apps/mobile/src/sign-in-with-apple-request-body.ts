/**
 * `buildSignInWithAppleRequestBody(credential)` — assembles the JSON body
 * the mobile client POSTs to `POST /v1/auth/sign-in-with-apple`, attaching
 * the stashed referral code for referee → referrer attribution (Phase 4.5,
 * ontology `stashed_referral_code`).
 *
 * Why this module exists:
 *   A referral code captured from an inbound `/r/:code` deep link is parked
 *   in AsyncStorage (`referral-storage.ts`) long before the user reaches
 *   Apple Sign In — they may browse the whole funnel first. At sign-in time
 *   the client must read that stashed code back and forward it on the wire
 *   so the server can attribute the referee to the referrer. This module is
 *   the thin, pure glue that performs exactly that read-and-attach step,
 *   producing the request body without owning the network call itself.
 *
 *   Keeping the body assembly in a standalone, dependency-injected function
 *   — rather than inlining the AsyncStorage read into whatever issues the
 *   `fetch` — makes the "which fields land on the wire, and when is the
 *   referral code attached vs. omitted" decision unit-testable without a
 *   real AsyncStorage backend, expo modules, or a live HTTP client.
 *
 * Wire contract (must mirror the server's `SignInWithAppleRequest` Pydantic
 * model, which is the single validation seam):
 *   - `identity_token` — required; the Apple ID token (JWT) the client
 *     received from Sign In with Apple.
 *   - `full_name` — optional; present only on Apple's *first* authorization.
 *   - `email` — optional; present only on the first authorization / when
 *     the user opts to share it.
 *   - `referral_code` — optional; the referrer's 8-char URL-safe code from
 *     the AsyncStorage stash. Organic sign-ups (nothing stashed) omit it.
 *
 * Scope discipline:
 *   - Snake_case keys match the server schema verbatim — this client emits
 *     the same wire shape the FastAPI handler validates, no rename layer.
 *   - Absent fields are *omitted* from the body (not sent as `null`), so an
 *     organic sign-up posts `{ identity_token }` alone. This keeps the body
 *     minimal and is why the type uses optional properties under the repo's
 *     `exactOptionalPropertyTypes` setting (assigned via conditional spread,
 *     never an explicit `undefined`).
 *   - This module performs *no* attribution logic — validity, self-referral
 *     and already-attributed guards all live server-side. The client merely
 *     forwards whatever it stashed; the server silently skips an invalid or
 *     self / duplicate code so sign-in always succeeds.
 *   - Clearing the stash after a successful attribution
 *     (cleanup-after-attribution) is the caller's responsibility via
 *     `clearStashedReferralCode` — it is deliberately *not* done here so the
 *     body builder stays free of side effects on the stash it reads.
 */
import { readStashedReferralCode } from './storage/referral-storage';

/**
 * The Apple Sign In credential fields the client obtained from the native
 * Sign In with Apple flow, in client-facing camelCase. Mapped to the
 * server's snake_case wire shape by {@link buildSignInWithAppleRequestBody}.
 *
 * `fullName` / `email` are `string | null | undefined`: Apple supplies them
 * only on the first authorization, so re-auth credentials carry `null` /
 * absent values. Empty or null values are treated as "omit this field."
 */
export interface AppleSignInCredential {
  readonly identityToken: string;
  readonly fullName?: string | null | undefined;
  readonly email?: string | null | undefined;
}

/**
 * The exact JSON body POSTed to `POST /v1/auth/sign-in-with-apple`.
 *
 * Snake_case keys mirror the server's `SignInWithAppleRequest` Pydantic
 * model 1:1. Optional fields are *omitted* from the serialized body when
 * absent (never sent as an explicit `null`), which is why they are declared
 * as optional properties rather than `string | null`.
 */
export interface SignInWithAppleRequestBody {
  readonly identity_token: string;
  readonly full_name?: string;
  readonly email?: string;
  readonly referral_code?: string;
}

/**
 * Read side of the referral stash, injectable so tests can drive the
 * present / absent / empty-code branches without a real AsyncStorage
 * backend. Defaults to the real {@link readStashedReferralCode}.
 */
export type StashedReferralCodeReader = () => Promise<string | null>;

/**
 * Build the Apple Sign In request body, attaching the stashed referral code
 * (when one is present) as the `referral_code` field.
 *
 * The stash is read exactly once. A non-empty stashed code is attached; a
 * `null` stash (organic signup, or a previously-cleared code) or an empty
 * string is omitted, so the body for an organic sign-up is just
 * `{ identity_token, ... }` with no `referral_code` key.
 *
 * `full_name` / `email` are likewise included only when the credential
 * carries a non-empty value (Apple ships them only on first authorization),
 * matching the server's re-auth preservation contract where an omitted
 * field must not clobber an existing value.
 *
 * @param credential - the Apple Sign In credential fields (camelCase).
 * @param readStash - injectable stash reader (defaults to the AsyncStorage
 *   wrapper). Override in tests.
 * @returns the snake_case request body ready to `JSON.stringify` and POST.
 */
export async function buildSignInWithAppleRequestBody(
  credential: AppleSignInCredential,
  readStash: StashedReferralCodeReader = readStashedReferralCode,
): Promise<SignInWithAppleRequestBody> {
  const stashedCode = await readStash();
  return {
    identity_token: credential.identityToken,
    ...(credential.fullName != null && credential.fullName.length > 0
      ? { full_name: credential.fullName }
      : {}),
    ...(credential.email != null && credential.email.length > 0
      ? { email: credential.email }
      : {}),
    ...(stashedCode !== null && stashedCode.length > 0
      ? { referral_code: stashedCode }
      : {}),
  };
}
