/**
 * Sentry runtime init seam — mobile crash + transaction observability (Phase 7.3).
 *
 * Purpose
 * -------
 * This module is the ONE place in `apps/mobile` that calls `Sentry.init(...)`.
 * Every other consumer (the root layout `_layout.tsx`, the auth-success
 * `setSentryUser` seam, the `clearSentryUser` sign-out helper) talks to Sentry
 * through small wrapper modules — never `@sentry/react-native` directly — so
 * the native package is imported from a single auditable site and vitest can
 * `vi.mock` it without resolving the Objective-C-backed native shim.
 *
 * It mirrors the api Phase 7.2 / 7.2c `init_sentry_for_environment` contract on
 * the mobile side:
 *
 *   - **Env-aware DSN** — the DSN is read from the Expo runtime manifest
 *     (`Constants.expoConfig.extra.sentryDsnMobile`), which `app.config.ts`
 *     forwards from the `SENTRY_DSN_MOBILE` EAS Secret. The secret is never
 *     committed to the repo.
 *   - **tracesSampleRate per profile** — derived from the active EAS build
 *     profile (`Constants.expoConfig.extra.easBuildProfile`): the two
 *     development profiles trace at `0.0` (off), `preview`/`production` at
 *     `0.1` (10%). The error `sampleRate` is always `1.0` — errors are never
 *     downsampled. This matches the api `DEFAULT_TRACES_SAMPLE_RATES` mapping.
 *   - **environment tag** — taken verbatim from the build profile, so issues
 *     in Sentry are grouped by `development-simulator` / `development` /
 *     `preview` / `production`.
 *
 * Fail-open discipline (the second of three layers)
 * --------------------------------------------------
 * Observability must NEVER break app mount. The runtime init is fail-open:
 *
 *   1. **Missing/empty/non-string DSN** — a single `console.warn`
 *      (`sentry_init_skipped`, mirroring the api `sentry_init_skipped` JSON log)
 *      and `initSentry` returns `false` WITHOUT touching the SDK. The
 *      *production* fail-fast for a missing DSN lives at BUILD time in
 *      `app.config.ts` (a missing prod DSN fails the EAS build), so by the time
 *      this runtime path executes a production binary, the DSN is guaranteed
 *      present — and any other environment is legitimately allowed to run
 *      without one.
 *   2. **Any throw** from reading the manifest or from `Sentry.init` is caught,
 *      logged once as `sentry_init_failed`, and swallowed — `initSentry`
 *      returns `false` and never propagates.
 *
 * (The first fail-open layer is the native SDK's inherent no-op when not
 * configured; the third is the `setSentryUser` / `clearSentryUser` try/catch.)
 *
 * `console.warn` (rather than a logger lib) is the deliberate, Seed-mandated
 * channel here — it matches the api `sentry_init_skipped` breadcrumb pattern
 * and the existing `console.log` breadcrumb in `src/superwall/client.ts`.
 */
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

/**
 * The closed set of EAS build profiles (see `eas.json`). The Sentry
 * `environment` tag is one of these verbatim.
 */
export type EasBuildProfile =
  | 'development-simulator'
  | 'development'
  | 'preview'
  | 'production';

/**
 * Fallback build profile used when `extra.easBuildProfile` is absent — e.g.
 * a classic-manifest fallback or any runtime where `app.config.ts` did not
 * inject the value. Matches the `DEFAULT_EAS_BUILD_PROFILE` fallback in
 * `app.config.ts` so the two never disagree.
 */
export const DEFAULT_EAS_BUILD_PROFILE: EasBuildProfile = 'development';

/**
 * Per-profile transaction sampling rate. Development profiles trace at `0.0`
 * (off — keeps local/simulator runs free of ingest); `preview`/`production`
 * sample 10%. Mirrors the api `DEFAULT_TRACES_SAMPLE_RATES` mapping so the two
 * surfaces stay in lock-step.
 */
export const TRACES_SAMPLE_RATE_BY_PROFILE: Readonly<Record<EasBuildProfile, number>> =
  Object.freeze({
    'development-simulator': 0.0,
    development: 0.0,
    preview: 0.1,
    production: 0.1,
  });

/**
 * Error capture sampling rate. ALWAYS `1.0` — crashes/errors are never
 * downsampled, only transactions are (via {@link TRACES_SAMPLE_RATE_BY_PROFILE}).
 */
export const ERROR_SAMPLE_RATE = 1.0 as const;

/**
 * Safely read `Constants.expoConfig.extra` as a typed record.
 *
 * `Constants.expoConfig` is `null` in a few legitimate contexts (classic
 * manifest fallback, vitest's node env without a real Expo runtime). We
 * normalise any non-object to `{}` so a degenerate manifest degrades to a
 * fail-open no-op rather than crashing app mount. Same defensive shape as
 * `src/config/vendor-keys.ts`.
 */
function readExtra(): Readonly<Record<string, unknown>> {
  const expoConfig = Constants.expoConfig;
  if (expoConfig === null || expoConfig === undefined) {
    return {};
  }
  const extra: unknown = expoConfig.extra;
  if (
    extra === null ||
    extra === undefined ||
    typeof extra !== 'object' ||
    Array.isArray(extra)
  ) {
    return {};
  }
  return extra as Readonly<Record<string, unknown>>;
}

/**
 * Resolve the active EAS build profile from the Expo manifest, falling back to
 * {@link DEFAULT_EAS_BUILD_PROFILE} when it is absent or not one of the known
 * profiles. Exported for direct unit testing of the env-derivation branch.
 */
export function resolveEasBuildProfile(
  extra: Readonly<Record<string, unknown>>,
): EasBuildProfile {
  const raw = extra.easBuildProfile;
  if (
    raw === 'development-simulator' ||
    raw === 'development' ||
    raw === 'preview' ||
    raw === 'production'
  ) {
    return raw;
  }
  return DEFAULT_EAS_BUILD_PROFILE;
}

/**
 * Resolve the transaction sampling rate for a build profile.
 */
export function resolveTracesSampleRate(profile: EasBuildProfile): number {
  return TRACES_SAMPLE_RATE_BY_PROFILE[profile];
}

/**
 * Initialize the Sentry React Native SDK for crash capture + transaction
 * tracing, keyed off the active EAS build profile. Returns whether the SDK was
 * actually initialized (the `failOpenInitResult` concept).
 *
 * Behaviour:
 *   - **DSN present** — calls `Sentry.init` with the env-aware `dsn`,
 *     `environment` (the build profile), per-profile `tracesSampleRate`, and a
 *     fixed error `sampleRate` of `1.0`. Returns `true`.
 *   - **DSN missing/empty/non-string** — fail-open no-op: a single
 *     `console.warn('sentry_init_skipped', …)` and returns `false` without
 *     touching the SDK.
 *   - **Any throw** (manifest read or `Sentry.init`) — caught, logged once as
 *     `console.warn('sentry_init_failed', …)`, returns `false`. Never
 *     propagates.
 *
 * Intended to be called as the FIRST statement inside the root layout's mount
 * effect (`app/_layout.tsx`), so the SDK's global error hooks are armed before
 * any screen renders.
 *
 * @returns `true` if `Sentry.init` ran, `false` on the fail-open no-op/catch.
 */
export function initSentry(): boolean {
  try {
    const extra = readExtra();

    const dsnRaw = extra.sentryDsnMobile;
    const dsn = typeof dsnRaw === 'string' ? dsnRaw : '';
    const profile = resolveEasBuildProfile(extra);

    if (dsn === '') {
      // Fail-open layer 2a: non-production (or a misconfigured non-prod build)
      // with no DSN. Never crash, never init; warn once so the operator knows
      // mobile error reporting is disabled. The production-DSN fail-fast is a
      // BUILD-time gate in app.config.ts, not a runtime crash.

      console.warn('sentry_init_skipped', {
        init_skip_reason: 'no_dsn',
        environment: profile,
      });
      return false;
    }

    Sentry.init({
      dsn,
      // Tag every event with the build profile so Sentry groups issues by
      // environment (development-simulator / development / preview / production).
      environment: profile,
      // Errors are never downsampled.
      sampleRate: ERROR_SAMPLE_RATE,
      // Transactions sampled per-profile: 0.0 dev, 0.1 preview/production.
      tracesSampleRate: resolveTracesSampleRate(profile),
    });
    return true;
  } catch (error) {
    // Fail-open layer 2b: any SDK/manifest failure must not break app mount.

    console.warn('sentry_init_failed', {
      init_fail_reason: error instanceof Error ? error.message : 'unknown_error',
    });
    return false;
  }
}
