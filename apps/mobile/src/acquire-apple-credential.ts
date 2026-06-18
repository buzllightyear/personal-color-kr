/**
 * `acquireAppleCredential(deps)` — the native Sign in with Apple seam.
 *
 * Wraps `expo-apple-authentication` and resolves an {@link AppleSignInCredential}
 * (the camelCase shape `submitSignInWithApple` consumes) — or `null` when no
 * usable credential was obtained. It owns ONLY the native-call → credential
 * mapping; the backend round-trip and token persistence live in `run-sign-in.ts`.
 *
 * Resolution contract:
 *   - Apple auth unavailable (pre-iOS-13 / non-Apple platform) → `null`.
 *   - User cancels the system sheet (`ERR_REQUEST_CANCELED`)     → `null`.
 *   - The credential carries no `identityToken`                  → `null`.
 *   - Any other native failure                                   → rethrown,
 *     so the caller can surface a "sign-in failed" state (a cancel is silent,
 *     a genuine error is not).
 *
 * Apple only ships `fullName` / `email` on the *first* authorization per its UX
 * contract; re-auth credentials omit them. Absent/blank values are dropped from
 * the returned credential (conditional spread under `exactOptionalPropertyTypes`)
 * so the wire body for a re-auth is just `{ identity_token }` — matching the
 * server's re-auth preservation rule where an omitted field must not clobber an
 * existing `display_name`.
 *
 * Why dependency-injected:
 *   `expo-apple-authentication` is a native module — unavailable in the vitest
 *   node env (aliased to a stub). Injecting `isAvailable` / `signIn` lets the
 *   pure mapping be unit-tested deterministically without the native module or
 *   a system sheet.
 */
import * as AppleAuthentication from 'expo-apple-authentication';

import type { AppleSignInCredential } from './sign-in-with-apple-request-body';

/** Error code Apple surfaces on the thrown error's `.code` when the user cancels. */
export const APPLE_SIGN_IN_CANCELED_CODE = 'ERR_REQUEST_CANCELED' as const;

/** The name components Apple returns (only on the first authorization). */
export interface AppleNativeFullName {
  readonly givenName?: string | null;
  readonly familyName?: string | null;
}

/**
 * Minimal structural shape of the native `AppleAuthenticationCredential` this
 * module reads. Declared locally (rather than referencing the native type) so
 * the injectable seam stays decoupled from the heavy native typings and the
 * unit test can supply a tiny literal.
 */
export interface AppleNativeCredential {
  readonly identityToken: string | null;
  readonly fullName?: AppleNativeFullName | null;
  readonly email?: string | null;
}

/** Minimal slice of `expo-apple-authentication` this module drives — injectable. */
export interface AcquireAppleCredentialDeps {
  readonly isAvailable?: () => Promise<boolean>;
  readonly signIn?: () => Promise<AppleNativeCredential>;
}

/** Hangul syllable + jamo range — used to pick Korean vs. Western name order. */
const HANGUL_ONLY = /^[ᄀ-ᇿ㄰-㆏가-힣]+$/u;

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Format Apple's `{ givenName, familyName }` into a single display string.
 *
 * Korean names (both parts Hangul) read family-first with no separator
 * (`홍` + `길동` → `홍길동`); everything else uses the Western given-first,
 * space-separated order (`John` + `Appleseed` → `John Appleseed`). Returns the
 * single present part when only one is supplied, or `null` when both are blank.
 */
export function formatAppleFullName(
  fullName: AppleNativeFullName | null | undefined,
): string | null {
  if (fullName == null) {
    return null;
  }
  const given = clean(fullName.givenName);
  const family = clean(fullName.familyName);
  if (given === null && family === null) {
    return null;
  }
  if (given === null) {
    return family;
  }
  if (family === null) {
    return given;
  }
  if (HANGUL_ONLY.test(given) && HANGUL_ONLY.test(family)) {
    return `${family}${given}`;
  }
  return `${given} ${family}`;
}

const defaultSignIn = (): Promise<AppleNativeCredential> =>
  AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

function isUserCancel(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === APPLE_SIGN_IN_CANCELED_CODE
  );
}

/**
 * Launch the native Sign in with Apple flow and resolve an
 * {@link AppleSignInCredential}, or `null` when no usable credential was
 * obtained (unavailable / user cancel / no identity token).
 *
 * @param deps - optional `expo-apple-authentication` overrides (default to the
 *   real `isAvailableAsync` / `signInAsync` with FULL_NAME + EMAIL scopes).
 * @throws the underlying native error for any non-cancel failure.
 */
export async function acquireAppleCredential(
  deps: AcquireAppleCredentialDeps = {},
): Promise<AppleSignInCredential | null> {
  const isAvailable = deps.isAvailable ?? AppleAuthentication.isAvailableAsync;
  const signIn = deps.signIn ?? defaultSignIn;

  if (!(await isAvailable())) {
    return null;
  }

  let native: AppleNativeCredential;
  try {
    native = await signIn();
  } catch (error: unknown) {
    if (isUserCancel(error)) {
      return null;
    }
    throw error;
  }

  const identityToken = clean(native.identityToken);
  if (identityToken === null) {
    return null;
  }

  const fullName = formatAppleFullName(native.fullName);
  const email = clean(native.email);
  return {
    identityToken,
    ...(fullName !== null ? { fullName } : {}),
    ...(email !== null ? { email } : {}),
  };
}
