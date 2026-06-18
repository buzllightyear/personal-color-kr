/**
 * Vitest stub for `expo-apple-authentication` (a native module vite/rollup
 * cannot parse in the node test env).
 *
 * `src/acquire-apple-credential.ts` imports the module for `signInAsync` /
 * `isAvailableAsync` and the `AppleAuthenticationScope` enum; the
 * `AppleSignInButton` component imports the native `AppleAuthenticationButton`
 * (+ its `*Type` / `*Style` enums). The real Apple Sign In flow is unit-tested
 * through `acquireAppleCredential`'s injected deps, so this stub only needs to
 * make the imports resolve, expose the enum surface, and render the button as
 * an inert host element so its testID / onPress are findable in screen tests.
 */
import * as React from 'react';

export const AppleAuthenticationScope = {
  FULL_NAME: 0,
  EMAIL: 1,
} as const;

export const AppleAuthenticationButtonType = {
  SIGN_IN: 0,
  CONTINUE: 1,
  SIGN_UP: 2,
} as const;

export const AppleAuthenticationButtonStyle = {
  WHITE: 0,
  WHITE_OUTLINE: 1,
  BLACK: 2,
} as const;

/** Apple's user-cancel error code, surfaced on the thrown error's `.code`. */
export const APPLE_CANCELED_CODE = 'ERR_REQUEST_CANCELED' as const;

export async function isAvailableAsync(): Promise<boolean> {
  return false;
}

export async function signInAsync(): Promise<{
  identityToken: string | null;
  fullName: { givenName: string | null; familyName: string | null } | null;
  email: string | null;
}> {
  return { identityToken: null, fullName: null, email: null };
}

type ButtonProps = Record<string, unknown> & { children?: React.ReactNode };

export function AppleAuthenticationButton(props: ButtonProps): React.ReactElement {
  return React.createElement('AppleAuthenticationButton', props, props?.children);
}
AppleAuthenticationButton.displayName = 'AppleAuthenticationButton';
