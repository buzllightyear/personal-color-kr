/**
 * Expo dynamic configuration — personal-color-kr.
 *
 * This file is loaded by the Expo CLI at config-resolution time (i.e. when
 * `expo start`, `expo prebuild`, EAS Build, etc. evaluate the project's
 * configuration). It is NOT bundled into the runtime app binary — Expo
 * snapshots its return value into the build manifest.
 *
 * Responsibilities owned by this file:
 *   1. Load the monorepo-root `.env` file into `process.env` BEFORE any
 *      config field is evaluated, so downstream sub-ACs (e.g. the `extra`
 *      block wiring) can read vendor keys from `process.env` deterministically.
 *   2. Re-export the static Expo configuration that previously lived in
 *      `app.json`. Both files are read by Expo; values returned here override
 *      `app.json` on conflict, but we keep `app.json` as the source-of-truth
 *      for static fields and only extend it from this dynamic config.
 *
 * Path-resolution contract for the .env file:
 *   - This file lives at `apps/mobile/app.config.ts` in the workspace.
 *   - The `.env` file lives at the monorepo root: `<workspace>/.env`.
 *   - Therefore the relative path from this file to `.env` is `../../.env`.
 *   - We resolve it via `path.resolve(__dirname, '../../.env')` so the
 *     resolution is independent of the working directory the CLI was
 *     invoked from (which is *not* always `apps/mobile`).
 *
 * Why eagerly call `dotenv.config()` at module-evaluation time:
 *   Expo evaluates this module ONCE per CLI invocation, before reading the
 *   exported default. Side-effecting at import time guarantees `process.env`
 *   is populated by the time the `extra` block (and any other env-reading
 *   field) is evaluated. The test in `tests/app-config.test.ts` exercises
 *   this same code path so the contract is enforced in CI.
 */
import * as path from 'node:path';

import dotenv from 'dotenv';

/**
 * Absolute filesystem path to the monorepo-root `.env`.
 *
 * Exported so the smoke test can assert that path resolution lands at the
 * workspace root and not, e.g., at `apps/mobile/.env`.
 */
export const ROOT_ENV_PATH: string = path.resolve(__dirname, '../../.env');

/**
 * Vendor credential keys that MUST be present in `process.env` after the
 * root `.env` is loaded. Kept in the source module (not in the test file)
 * so the contract lives next to the loader and stays in sync.
 *
 * Note: `FAL_API_KEY` is loaded into `process.env` but is intentionally
 * NOT forwarded to the Expo `extra` block — it is server-side only.
 */
export const REQUIRED_ENV_KEYS: ReadonlyArray<string> = Object.freeze([
  'POSTHOG_API_KEY',
  'POSTHOG_HOST',
  'SUPERWALL_API_KEY',
  'FAL_API_KEY',
]);

/**
 * Load the monorepo-root `.env` into `process.env`.
 *
 * Pure side effect on `process.env`. Returns the resolved path and the
 * parsed key/value map so callers (notably the vitest smoke test) can
 * verify what was loaded without re-reading the file.
 *
 * Behaviour:
 *   - If the file is missing or unreadable, `dotenv.config()` returns an
 *     `error` field; we surface it via the return value rather than
 *     throwing, so Expo CLI does not crash for developers who haven't yet
 *     populated their `.env` (the placeholder values in `.env.example` are
 *     the documented onboarding path).
 *   - `override: false` (dotenv default) preserves any value the developer
 *     has explicitly exported in their shell, matching the principle of
 *     least surprise.
 */
export function loadRootEnv(): {
  readonly path: string;
  readonly parsed: Readonly<Record<string, string>>;
  readonly error?: Error;
} {
  const result = dotenv.config({ path: ROOT_ENV_PATH });
  return {
    path: ROOT_ENV_PATH,
    parsed: Object.freeze({ ...(result.parsed ?? {}) }),
    ...(result.error ? { error: result.error } : {}),
  };
}

// Eagerly populate `process.env` at module-evaluation time so any downstream
// field in the exported config (notably the `extra` block, wired in a sibling
// sub-AC) can read vendor keys from `process.env` synchronously.
loadRootEnv();

/**
 * Shape of the `extra` block we forward into the Expo runtime manifest.
 *
 * Only vendor credentials that are SAFE to bundle into the mobile app
 * binary are listed here. The Fal.ai key is deliberately NOT a field on
 * this type — that constraint is encoded in the type system (no
 * `falApiKey` member) so a future contributor cannot accidentally add
 * it without also editing this shape.
 *
 * Each field is `string | undefined` because the developer's local `.env`
 * may not yet be populated (placeholder onboarding flow). Real validation
 * of the values is the job of sibling sub-ACs (regex for Superwall, live
 * auth smoke for PostHog).
 */
export interface ExpoExtraVendorKeys {
  readonly posthogApiKey: string | undefined;
  readonly posthogHost: string | undefined;
  readonly superwallApiKey: string | undefined;
}

/**
 * Build the `extra` block from the current `process.env` snapshot.
 *
 * Factored out so the unit test can call it deterministically after
 * mutating `process.env`, rather than re-importing the whole config
 * module (which would re-run the eager `loadRootEnv()` side effect).
 *
 * Security contract — DO NOT add `FAL_API_KEY` here:
 *   - `FAL_API_KEY` is server-side only. Forwarding it via `extra` would
 *     embed it in the Expo runtime manifest, which is bundled with the
 *     mobile app binary and readable by anyone who unpacks the IPA/APK.
 *   - That's enforced by:
 *       (a) the `ExpoExtraVendorKeys` type omitting `falApiKey`,
 *       (b) the sibling test asserting the returned object has no
 *           `falApiKey` property and no value matching `process.env.FAL_API_KEY`.
 */
export function buildExtraVendorKeys(): ExpoExtraVendorKeys {
  return Object.freeze({
    posthogApiKey: process.env.POSTHOG_API_KEY,
    posthogHost: process.env.POSTHOG_HOST,
    superwallApiKey: process.env.SUPERWALL_API_KEY,
  });
}

/**
 * Expo configuration. Static fields are inherited from `app.json` via the
 * `config` parameter — we extend rather than replace so this file owns only
 * the dynamic concerns (env loading, `extra` block wiring).
 *
 * Typed as `Record<string, unknown>` to avoid a hard dependency on
 * `expo/config` types, which are not always reachable through pnpm's strict
 * resolution from this workspace. Expo's CLI validates the returned shape
 * at runtime.
 *
 * The `extra` block is the canonical Expo channel for runtime config
 * surfaced to the app via `expo-constants` (`Constants.expoConfig.extra`).
 * Sibling sub-ACs read these values from `core-ts`'s PostHogClient wrapper
 * setup and (in Phase 2.5) the Superwall SDK init.
 */
/**
 * iOS bundle identifier — must match the bundle ID registered in Apple
 * Developer / App Store Connect for sandbox subscription product testing.
 *
 * Phase 2.5 contract:
 *   - ASC sandbox subscription product ID `com.personalcolorkr.monthly.premium`
 *     belongs to subscription group `personal_color_premium`, which is owned
 *     by this bundle identifier.
 *   - Changing this value invalidates the ASC product link (sandbox testers
 *     would no longer see the IAP) and breaks the Superwall dashboard
 *     paywall<->product mapping. Treat as load-bearing.
 *
 * Exported so a sibling test (`tests/app-config-ios-bundle.test.ts`, when
 * added) can pin the contract from the test side without re-parsing the
 * exported config object.
 */
export const IOS_BUNDLE_IDENTIFIER: string = 'com.personalcolorkr.app';

/**
 * Expo runtime version — pinned to the Expo SDK 51 series so OTA updates
 * served via EAS Update only land on dev clients whose native binary
 * matches the JS bundle's native module ABI. Phase 2.5 is the first phase
 * that links a native module (@superwall/react-native-superwall), so OTA
 * mismatches would now manifest as native crashes rather than benign JS
 * errors — pinning the runtime version is the cheapest mitigation.
 */
export const EXPO_RUNTIME_VERSION: string = '51.0.0';

export default function defineExpoConfig({
  config,
}: {
  readonly config: Record<string, unknown>;
}): Record<string, unknown> {
  const existingExtra =
    typeof config.extra === 'object' && config.extra !== null
      ? (config.extra as Record<string, unknown>)
      : {};
  return {
    ...config,
    name: 'personal-color-kr',
    slug: 'personal-color-kr',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'personal-color-kr',
    platforms: ['ios', 'android', 'web'],
    // expo-dev-client is the runtime that replaces Expo Go for Phase 2.5+ —
    // it is what lets the custom dev client load native modules
    // (@superwall/react-native-superwall) that Expo Go cannot link. Adding
    // the plugin here ensures `expo prebuild` and EAS Build inject the
    // necessary native scaffolding into the generated ios/ project.
    plugins: ['expo-router', 'expo-dev-client'],
    runtimeVersion: EXPO_RUNTIME_VERSION,
    ios: {
      bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
      // StoreKit subscription products are exercised in the iOS sandbox
      // environment when running on a real device (simulator does not
      // exercise the full receipt validation surface). The simulator build
      // still loads the Superwall SDK and renders the paywall UI — only
      // the purchase tap path needs a device.
      supportsTablet: false,
    },
    experiments: { typedRoutes: false },
    extra: {
      ...existingExtra,
      ...buildExtraVendorKeys(),
    },
  };
}
