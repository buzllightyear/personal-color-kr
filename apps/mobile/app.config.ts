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
 * Fallback EAS build profile used when `EAS_BUILD_PROFILE` is absent from
 * `process.env` — i.e. for local `expo start` / `expo prebuild` invocations
 * and for vitest runs, neither of which set the EAS-injected env var.
 *
 * Phase 7.3 contract:
 *   - During an EAS Build, the CLI injects `EAS_BUILD_PROFILE` with the name
 *     of the profile being built (`development`, `development-simulator`,
 *     `preview`, or `production`) — see `eas.json`'s `build.*` profiles.
 *   - Off-EAS (local dev, CI unit tests) the var is unset, so we default to
 *     `'development'`. This keeps the Sentry `environment` tag (derived from
 *     this value in a sibling sub-AC) deterministic and never `undefined`.
 */
export const DEFAULT_EAS_BUILD_PROFILE: string = 'development';

/**
 * Resolve the active EAS build profile name from `process.env`.
 *
 * Reads `EAS_BUILD_PROFILE` (injected by EAS Build at build time) and falls
 * back to {@link DEFAULT_EAS_BUILD_PROFILE} when it is unset or an empty/
 * whitespace-only string. Factored out (rather than inlined into the `extra`
 * block) so the unit test can exercise the fallback branch deterministically
 * by mutating `process.env` without re-running the module's eager
 * `loadRootEnv()` side effect.
 *
 * The value is forwarded to the Expo runtime manifest via
 * `extra.easBuildProfile`, where the app reads it through `expo-constants`
 * (`Constants.expoConfig.extra.easBuildProfile`) to tag the Sentry
 * environment.
 */
export function resolveEasBuildProfile(): string {
  const raw = process.env.EAS_BUILD_PROFILE;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw;
  }
  return DEFAULT_EAS_BUILD_PROFILE;
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
export const IOS_BUNDLE_IDENTIFIER: string = 'com.method.pov';

/**
 * Expo runtime version — pinned to the Expo SDK 54 series so OTA updates
 * served via EAS Update only land on dev clients whose native binary
 * matches the JS bundle's native module ABI. The SDK 51 → 54 upgrade bumped
 * every native module (RN 0.74 → 0.81, New Architecture), so the runtime
 * version MUST advance in lock-step — otherwise an OTA JS bundle built against
 * the SDK 54 native ABI could land on a stale SDK 51 binary and crash natively.
 */
export const EXPO_RUNTIME_VERSION: string = '54.0.0';

/**
 * Module specifier for the Sentry Expo config plugin.
 *
 * `@sentry/react-native` ships its Expo config plugin under the `/expo`
 * subpath. Registering it here is what makes `expo prebuild` / EAS Build wire
 * full native crash symbolication into the generated native projects:
 *   - installs the native Sentry SDK into the `ios/` (and `android/`) project,
 *   - registers the build phase that uploads JS source maps + iOS dSYMs to
 *     Sentry so native stack traces are symbolicated server-side,
 *   - stamps the Sentry release/dist identifiers onto the build.
 *
 * The actual source-map / dSYM upload is guarded at build time by the presence
 * of `SENTRY_AUTH_TOKEN` (an EAS Secret) — without it the plugin no-ops the
 * upload step, so local `expo prebuild` runs do not fail for developers who
 * lack the token.
 */
export const SENTRY_EXPO_PLUGIN_NAME: string = '@sentry/react-native/expo';

/**
 * Sentry organization slug the symbolication artifacts upload to.
 *
 * Resolved from the `SENTRY_ORG` env var (set per-profile in `eas.json` →
 * `method-c3` for the provisioned org), falling back to the
 * `TODO_SENTRY_ORG_SLUG` placeholder off-build (vitest / local without the
 * var). Driving it from env — rather than hardcoding — keeps the placeholder
 * the test suite pins while letting the real slug flow in only at build time
 * (mirrors the `SENTRY_DSN_MOBILE` / `EXPO_PUBLIC_API_BASE_URL` pattern), and
 * `SENTRY_ORG` is also the var sentry-cli reads for the upload. When the
 * placeholder is still in effect, `isSentryProvisioned()` is `false` so the
 * production-DSN gate stays inert.
 */
export const SENTRY_ORG_SLUG: string =
  process.env.SENTRY_ORG ?? 'TODO_SENTRY_ORG_SLUG';

/**
 * Sentry project slug for the mobile app.
 *
 * Resolved from the `SENTRY_PROJECT` env var (`eas.json` → `react-native`, the
 * slug Sentry auto-assigned the React Native project), falling back to
 * `pck-mobile` off-build. Same env-driven rationale as {@link SENTRY_ORG_SLUG};
 * `SENTRY_PROJECT` is also the var sentry-cli reads for the upload.
 */
export const SENTRY_PROJECT_SLUG: string =
  process.env.SENTRY_PROJECT ?? 'pck-mobile';

/**
 * Build the `[pluginName, options]` tuple for the Sentry Expo config plugin.
 *
 * Factored out (rather than inlined into the `plugins` array) so the unit test
 * can pin the org/project slugs and tuple shape without re-parsing the whole
 * resolved config object.
 */
export function buildSentryPluginEntry(): readonly [
  string,
  Readonly<Record<string, unknown>>,
] {
  return [
    SENTRY_EXPO_PLUGIN_NAME,
    Object.freeze({
      organization: SENTRY_ORG_SLUG,
      project: SENTRY_PROJECT_SLUG,
    }),
  ] as const;
}

/**
 * EAS build profile name that gates the production-only build-time assertions.
 *
 * Only the `production` profile ships to TestFlight / the App Store, so it is
 * the only profile for which a missing Sentry DSN is a hard error — preview and
 * development builds tolerate a missing DSN (Sentry init no-ops at runtime).
 */
export const PRODUCTION_EAS_BUILD_PROFILE: string = 'production';

/**
 * `process.env` key carrying the Sentry DSN for the mobile project.
 *
 * Injected as an EAS Secret across all four build profiles (never committed to
 * the repo), mirroring the api's `SENTRY_DSN_API` pattern from Phase 7.2. The
 * native crash-symbolication plugin and the runtime Sentry init both read it
 * from here.
 */
export const SENTRY_DSN_MOBILE_ENV_KEY: string = 'SENTRY_DSN_MOBILE';

/**
 * Detect whether config resolution is running inside a real EAS Build.
 *
 * EAS Build injects `EAS_BUILD=true` into the build environment. Local
 * `expo start` / `expo prebuild` and the vitest suite do NOT set it. The
 * production build-time fail-fast ({@link assertProductionSentryDsn}) is gated
 * on this marker so that:
 *   - a genuine production EAS Build with a missing DSN fails fast (the Phase
 *     7.3 contract — no blind, crash-observability-less TestFlight binary), but
 *   - a developer running `EAS_BUILD_PROFILE=production expo start` locally, and
 *     the unit-test suite (which sets the profile to `production` to exercise
 *     downstream wiring), are NOT crashed by the gate.
 *
 * @param env - environment map to read; defaults to `process.env`. Injectable
 *   so the unit test can exercise both branches deterministically.
 */
export function isEasBuild(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.EAS_BUILD === 'true';
}

/**
 * Build-time fail-fast: a `production` build MUST carry a Sentry DSN.
 *
 * Pure assertion encoding the Phase 7.3 sub-AC contract verbatim — it throws
 * iff `profile === 'production'` AND `SENTRY_DSN_MOBILE` is absent, empty, or
 * whitespace-only. Non-production profiles are always allowed to proceed (their
 * runtime Sentry init simply no-ops when the DSN is absent).
 *
 * Kept separate from {@link isEasBuild} so the rule itself is unit-testable in
 * isolation, while {@link defineExpoConfig} only *invokes* it inside a real EAS
 * Build (see {@link isEasBuild}).
 *
 * Sentry-provisioning escape hatch:
 *   The gate only enforces the DSN requirement once Sentry is actually
 *   provisioned — i.e. once `SENTRY_ORG_SLUG` is no longer the
 *   `TODO_SENTRY_*` placeholder. Before that, the entire Sentry integration
 *   is inert (the config plugin points at a placeholder org; runtime
 *   `Sentry.init` no-ops without a DSN), so requiring a DSN would be a
 *   chicken-and-egg block on the FIRST production / TestFlight build. The gate
 *   RE-ARMS automatically the moment a real org slug is filled in — exactly
 *   when crash observability becomes an expectation rather than a future TODO.
 *
 * @param profile - the resolved EAS build profile name.
 * @param env - environment map to read the DSN from; defaults to `process.env`.
 * @param sentryProvisioned - whether Sentry is set up (org slug is real);
 *   defaults to {@link isSentryProvisioned} reading the module `SENTRY_ORG_SLUG`.
 * @throws Error when a production build with Sentry PROVISIONED lacks `SENTRY_DSN_MOBILE`.
 */
export function assertProductionSentryDsn(
  profile: string,
  env: Record<string, string | undefined> = process.env,
  sentryProvisioned: boolean = isSentryProvisioned(),
): void {
  if (profile !== PRODUCTION_EAS_BUILD_PROFILE) {
    return;
  }
  // Sentry not yet provisioned → the DSN requirement does not apply (the whole
  // Sentry integration is inert until a real org slug lands). This unblocks the
  // first TestFlight beta; the gate re-arms once Sentry is wired up.
  if (!sentryProvisioned) {
    return;
  }
  const dsn = env[SENTRY_DSN_MOBILE_ENV_KEY];
  if (typeof dsn !== 'string' || dsn.trim().length === 0) {
    throw new Error(
      `[app.config] Production EAS Build (profile="${PRODUCTION_EAS_BUILD_PROFILE}") ` +
        `requires ${SENTRY_DSN_MOBILE_ENV_KEY} to be set, but it is missing or empty. ` +
        `It is injected as an EAS Secret — shipping a production TestFlight build ` +
        `without it would silently disable native crash symbolication. ` +
        `Create it with \`eas secret:create\` (see docs/testflight-dry-run.md) ` +
        `before re-running this production build.`,
    );
  }
}

/**
 * Whether Sentry is provisioned — i.e. the org slug is a real value, not the
 * `TODO_SENTRY_*` placeholder. Used by {@link assertProductionSentryDsn} to
 * decide whether the production DSN requirement applies yet. Injectable
 * `orgSlug` so the unit test can exercise both branches without mutating the
 * module constant.
 *
 * @param orgSlug - the Sentry org slug to inspect; defaults to the module
 *   {@link SENTRY_ORG_SLUG} constant.
 */
export function isSentryProvisioned(orgSlug: string = SENTRY_ORG_SLUG): boolean {
  return !orgSlug.startsWith(SENTRY_TODO_SLUG_PREFIX);
}

/**
 * `process.env` key carrying the Sentry auth token used by the
 * `@sentry/react-native/expo` config plugin to upload JS source maps and iOS
 * dSYMs during `expo prebuild` / EAS Build.
 *
 * Injected as an EAS Secret (scoped to Releases + Builds), never committed to
 * the repo — mirroring the api's `SENTRY_AUTH_TOKEN` pattern from Phase 7.2.
 * Its mere PRESENCE is the guard that enables the symbolication-upload build
 * phase: when it is absent the plugin no-ops the upload (so local prebuilds and
 * the unit suite never attempt a network upload).
 */
export const SENTRY_AUTH_TOKEN_ENV_KEY: string = 'SENTRY_AUTH_TOKEN';

/**
 * Prefix every not-yet-provisioned Sentry slug placeholder shares
 * (`TODO_SENTRY_ORG_SLUG`, and any future `TODO_SENTRY_*` slug).
 *
 * The drift gate ({@link assertSentryAuthTokenSlugDrift}) treats any slug still
 * carrying this prefix as "unprovisioned", so a contributor cannot wire up the
 * upload token while leaving the destination org/project as a placeholder.
 */
export const SENTRY_TODO_SLUG_PREFIX: string = 'TODO_SENTRY';

/**
 * True iff `SENTRY_AUTH_TOKEN` is present and non-blank in `env`.
 *
 * This is the exact condition under which the `@sentry/react-native/expo`
 * plugin will ATTEMPT a source-map / dSYM upload, so the drift gate keys off it
 * directly. Injectable `env` so the unit test can exercise both branches without
 * mutating the real `process.env`.
 *
 * @param env - environment map to read; defaults to `process.env`.
 */
export function hasSentryAuthToken(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const token = env[SENTRY_AUTH_TOKEN_ENV_KEY];
  return typeof token === 'string' && token.trim().length > 0;
}

/**
 * The Sentry slugs the symbolication artifacts upload to, in plugin-entry order
 * (organization, then project). Sourced from the single canonical constants so
 * the drift gate and the plugin entry can never disagree about what is being
 * uploaded where.
 */
export function sentryUploadSlugs(): ReadonlyArray<string> {
  return Object.freeze([SENTRY_ORG_SLUG, SENTRY_PROJECT_SLUG]);
}

/**
 * Subset of {@link sentryUploadSlugs} that is still an unprovisioned
 * `TODO_SENTRY_*` placeholder.
 */
export function unresolvedSentryTodoSlugs(): ReadonlyArray<string> {
  return Object.freeze(
    sentryUploadSlugs().filter((slug) =>
      slug.startsWith(SENTRY_TODO_SLUG_PREFIX),
    ),
  );
}

/**
 * Build-time fail-fast: if the symbolication-upload token is present, the upload
 * destination slugs MUST be real (not `TODO_SENTRY_*` placeholders).
 *
 * Phase 7.3 sub-AC contract verbatim: "app.config.ts throws at build time if
 * `SENTRY_AUTH_TOKEN` is present but `TODO_SENTRY` placeholder slugs remain."
 *
 * Rationale — this catches the half-configured credential state where a human
 * created the `SENTRY_AUTH_TOKEN` EAS Secret (intending a real source-map / dSYM
 * upload) but forgot to replace `SENTRY_ORG_SLUG` (`TODO_SENTRY_ORG_SLUG`). Left
 * un-caught, the plugin would upload symbolication artifacts to a non-existent
 * org and the production TestFlight build would ship with silently-broken native
 * crash symbolication — the exact failure Phase 7.3 exists to prevent.
 *
 * Deliberately gated on token PRESENCE rather than on `isEasBuild()` (unlike the
 * DSN gate): the token mirrors the plugin's own upload guard, so whenever an
 * upload would actually be attempted — EAS Build or a local prebuild with the
 * token exported — the drift is a hard error. When the token is absent (local
 * dev, the vitest suite, the `expo prebuild` dry-run) it no-ops, so the placeholder
 * slugs remain a non-blocking, documented onboarding state.
 *
 * @param env - environment map to read the token from; defaults to `process.env`.
 * @throws Error when `SENTRY_AUTH_TOKEN` is present but ≥1 upload slug is still a
 *   `TODO_SENTRY_*` placeholder.
 */
export function assertSentryAuthTokenSlugDrift(
  env: Record<string, string | undefined> = process.env,
): void {
  if (!hasSentryAuthToken(env)) {
    return;
  }
  const unresolved = unresolvedSentryTodoSlugs();
  if (unresolved.length > 0) {
    throw new Error(
      `[app.config] ${SENTRY_AUTH_TOKEN_ENV_KEY} is set (the Sentry source-map / ` +
        `dSYM upload is enabled), but the upload destination still carries ` +
        `unprovisioned placeholder slug(s): ${unresolved.join(', ')}. ` +
        `Uploading symbolication artifacts to a TODO_SENTRY_* org/project would ` +
        `silently break native crash symbolication on the shipped build. Replace ` +
        `SENTRY_ORG_SLUG (and any other TODO_SENTRY_* slug) in app.config.ts with ` +
        `the real Sentry org/project slug (see docs/testflight-dry-run.md) before ` +
        `re-running this build, or unset ${SENTRY_AUTH_TOKEN_ENV_KEY} to skip the upload.`,
    );
  }
}

export default function defineExpoConfig({
  config,
}: {
  readonly config: Record<string, unknown>;
}): Record<string, unknown> {
  const existingExtra =
    typeof config.extra === 'object' && config.extra !== null
      ? (config.extra as Record<string, unknown>)
      : {};
  // Resolve the active profile once and reuse it for both the build-time gate
  // and the `extra` block, so they can never disagree within a single config
  // resolution.
  const easBuildProfile = resolveEasBuildProfile();
  // Build-time fail-fast: only fire inside a real EAS Build (EAS_BUILD=true) so
  // local `expo start` / `expo prebuild` and the vitest suite — which may set a
  // `production` profile without injecting the EAS-Secret DSN — are not crashed.
  // A genuine production EAS Build missing SENTRY_DSN_MOBILE throws here.
  if (isEasBuild()) {
    assertProductionSentryDsn(easBuildProfile);
  }
  // Token-present-with-TODO-slug drift gate: fires whenever the source-map /
  // dSYM upload token is present (the same condition that enables the plugin's
  // upload), independent of `isEasBuild()`, so a real upload is never aimed at a
  // placeholder org/project. No-ops when SENTRY_AUTH_TOKEN is absent (local dev,
  // vitest, the `expo prebuild` dry-run).
  assertSentryAuthTokenSlugDrift();
  return {
    ...config,
    name: 'personal-color-kr',
    slug: 'personal-color-kr',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'personal-color-kr',
    platforms: ['ios', 'android', 'web'],
    // expo-dev-client is the runtime that replaces Expo Go for Phase 2.5+ —
    // it is what lets the custom dev client load native modules
    // (@superwall/react-native-superwall) that Expo Go cannot link. Adding
    // the plugin here ensures `expo prebuild` and EAS Build inject the
    // necessary native scaffolding into the generated ios/ project.
    // The Sentry Expo config plugin (`@sentry/react-native/expo`) is appended
    // here so `expo prebuild` / EAS Build inject the native crash-symbolication
    // scaffolding (native SDK + source-map/dSYM upload build phase) into the
    // generated ios/ project. The org slug remains the `TODO_SENTRY_ORG_SLUG`
    // placeholder until the Sentry org is provisioned; the project is the
    // mobile-specific `pck-mobile`.
    plugins: [
      'expo-router',
      'expo-dev-client',
      // Embed the Pretendard family (editorial/VSCO direction) into the native
      // project at prebuild/build time. Runtime `useFonts` (src/hooks/use-app-fonts)
      // also registers them so in-dev preview works without a fresh build.
      [
        'expo-font',
        {
          fonts: [
            './assets/fonts/Pretendard-Light.otf',
            './assets/fonts/Pretendard-Regular.otf',
            './assets/fonts/Pretendard-Medium.otf',
            './assets/fonts/Pretendard-SemiBold.otf',
          ],
        },
      ],
      // Real selfie capture (step 7 → diagnosis). The permission strings mirror
      // the app.json `ios.infoPlist` Korean copy so the config-plugin pass and
      // the static infoPlist agree (no English fallback leaks into the prompt).
      [
        'expo-image-picker',
        {
          photosPermission:
            '가지고 있는 셀카로 퍼스널 컬러를 진단할 수 있도록 사진 보관함 접근이 필요해요.',
          cameraPermission:
            '셀카로 퍼스널 컬러를 진단하기 위해 카메라를 사용해요. 촬영한 사진은 진단 분석에만 쓰여요.',
        },
      ],
      // Sign in with Apple (the only auth method). Listing the config plugin
      // makes `expo prebuild` / EAS Build add the `com.apple.developer.applesignin`
      // entitlement to the generated ios/ project so the native
      // `AppleAuthentication.signInAsync()` call mints a real identity token.
      // Mirrors `ios.usesAppleSignIn: true` set in the ios block below.
      'expo-apple-authentication',
      // Backend access-token persistence (Keychain-backed). The config plugin
      // wires the native expo-secure-store module into the prebuilt project so
      // the JWT survives app restarts without a re-auth round-trip.
      'expo-secure-store',
      buildSentryPluginEntry(),
    ],
    runtimeVersion: EXPO_RUNTIME_VERSION,
    ios: {
      // MERGE the static app.json `ios` block (NOT replace it). app.json owns
      // ios.config.usesNonExemptEncryption, ios.infoPlist (camera/photo usage
      // strings + CFBundleDisplayName), buildNumber, and appleTeamId. A bare
      // `ios: { ... }` here would clobber all of those — EAS Build then fails
      // reading `ITSAppUsesNonExemptEncryption`, and a build that did proceed
      // would ship without the required permission strings (App Store reject).
      ...(typeof config.ios === 'object' && config.ios !== null
        ? (config.ios as Record<string, unknown>)
        : {}),
      bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
      // Sign in with Apple capability. Setting this to `true` (in addition to
      // the `expo-apple-authentication` config plugin above) makes Expo add the
      // `com.apple.developer.applesignin` entitlement to the generated ios/
      // project — required for `AppleAuthentication.signInAsync()` to succeed on
      // device. The Apple Developer App ID must also have the capability enabled.
      usesAppleSignIn: true,
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
      // EAS build profile resolved at config-resolution time from the
      // EAS-injected `EAS_BUILD_PROFILE` env var (with a `development`
      // fallback off-EAS). Surfaced via `expo-constants` so the runtime
      // Sentry init can derive its `environment` tag deterministically.
      easBuildProfile,
      // Forward the Sentry DSN (read from `SENTRY_DSN_MOBILE`, set per-profile
      // in `eas.json`) into the runtime manifest so `initSentry()` can read it
      // via `Constants.expoConfig.extra.sentryDsnMobile`. A Sentry DSN is a
      // public, send-only credential (safe to bundle); absent off-build, so
      // `initSentry()` fail-opens (no-ops) when it is undefined.
      sentryDsnMobile: process.env[SENTRY_DSN_MOBILE_ENV_KEY],
    },
  };
}
