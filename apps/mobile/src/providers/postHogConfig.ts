/**
 * `getPostHogConfig()` — strict, throwing config-reader for the PostHog
 * `apiKey` / `host` pair exposed via the Expo runtime manifest.
 *
 * This module is the *strict* counterpart to `src/config/vendor-keys.ts`:
 *
 *   - {@link import('../config/vendor-keys').getVendorKeys | getVendorKeys()}
 *     is runtime-safe and degrades to `undefined` so the app still mounts
 *     during the placeholder onboarding flow (no `.env` yet, classic
 *     manifest, vitest node env without an Expo runtime, …).
 *   - {@link getPostHogConfig} is strict. It is intended for callers that
 *     CANNOT proceed without a fully-configured PostHog setup (an explicit
 *     "validate vendor config on app boot" check, a developer smoke screen,
 *     etc.) and surfaces a typed, descriptive {@link PostHogConfigError}
 *     when any required field is missing. The failure mode at startup is
 *     loud and unambiguous instead of silently producing a broken client.
 *
 * Field-naming bridge:
 *   - The Expo `extra` block (wired in `app.config.ts`, Sub-AC 8.2) uses
 *     FLAT field names `posthogApiKey` / `posthogHost`. The typed accessor
 *     `getVendorKeys()` exposes them as such.
 *   - The `posthog-react-native` constructor signature is
 *     `new PostHog(apiKey, { host })`. The Sub-AC 7.2 contract describes
 *     the keys as `apiKey` / `host`.
 *   - This module bridges the two namespaces by reading the flat field
 *     names from the manifest and returning a narrow `{ apiKey, host }`
 *     shape — the same shape the constructor consumes.
 *
 * Security / privacy contract:
 *   - This module only reads `posthog*` fields. It deliberately does not
 *     reach for `FAL_API_KEY` (server-side-only) or any other vendor
 *     credential — that boundary is enforced upstream by the typed
 *     `VendorKeys` shape, which omits `falApiKey` entirely.
 *
 * Why empty-string is treated as missing:
 *   - A common onboarding mistake is leaving `POSTHOG_API_KEY=""` in `.env`
 *     to "stub it out". An empty string is *truthy enough* to pass a naive
 *     `value === undefined` check but is not a valid PostHog credential.
 *     We collapse `''` → "missing" so the developer sees the descriptive
 *     error rather than a downstream PostHog auth failure with an opaque
 *     server-side message.
 */
import { getVendorKeys } from '../config/vendor-keys';

/**
 * Strict, validated PostHog runtime config — the input shape consumed by
 * `new PostHog(apiKey, { host })`.
 *
 * Both fields are guaranteed non-empty strings: `getPostHogConfig()` throws
 * {@link PostHogConfigError} rather than returning a partial value.
 */
export interface PostHogConfig {
  readonly apiKey: string;
  readonly host: string;
}

/**
 * Discriminator for {@link PostHogConfigError} so callers can branch on
 * `err.reason` rather than parsing the message string.
 *
 * - `missing_api_key` — no usable `posthogApiKey` (absent, empty, or
 *   wrong-typed) in `Constants.expoConfig.extra`.
 * - `missing_host`    — no usable `posthogHost` (absent, empty, or
 *   wrong-typed) in `Constants.expoConfig.extra`.
 */
export type PostHogConfigErrorReason = 'missing_api_key' | 'missing_host';

/**
 * Typed error thrown by {@link getPostHogConfig} when a required field
 * is missing.
 *
 * The error message names the underlying env var (`POSTHOG_API_KEY` /
 * `POSTHOG_HOST`) so a developer reading a crash log can fix the offending
 * line in `.env` without having to re-derive the mapping from the source
 * file.
 *
 * The `reason` discriminator is the canonical branching surface for callers
 * (matching the {@link PostHogClientError} pattern in `core-ts/posthog/client.ts`).
 */
export class PostHogConfigError extends Error {
  public override readonly name = 'PostHogConfigError';
  public readonly reason: PostHogConfigErrorReason;

  constructor(reason: PostHogConfigErrorReason, message: string) {
    super(message);
    this.reason = reason;
    // Restore prototype chain when transpiled to ES5 / older targets.
    // Harmless under ES2022 (the workspace target) and defensive otherwise.
    Object.setPrototypeOf(this, PostHogConfigError.prototype);
  }
}

/**
 * Internal predicate: a value qualifies as a usable string config field iff
 * it is a non-empty `string`. Anything else (`undefined`, `''`, numbers,
 * objects, …) is treated as "missing" by the validator.
 *
 * `getVendorKeys()` already coerces non-string values to `undefined`, so in
 * practice this guard only has to discriminate between `undefined` and `''`.
 * The explicit `typeof` check is defence-in-depth in case the upstream
 * accessor contract ever loosens.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Read `posthogApiKey` and `posthogHost` from `Constants.expoConfig.extra`
 * (via the typed accessor `getVendorKeys()`), validate that both are
 * non-empty strings, and return them as a narrow `{ apiKey, host }` shape.
 *
 * @throws {PostHogConfigError} with `reason === 'missing_api_key'` when the
 *   api key is absent, empty, or wrong-typed. The message names
 *   `POSTHOG_API_KEY` so the offending `.env` line is obvious.
 * @throws {PostHogConfigError} with `reason === 'missing_host'` when the
 *   host is absent, empty, or wrong-typed. The message names `POSTHOG_HOST`.
 *
 * Ordering note: the api-key error takes precedence over the host error
 * when both are missing. The api key is the more critical secret and the
 * one a developer must populate first — surfacing it first means the
 * developer fixes one thing, re-runs, and then sees the next missing field
 * (rather than a confusing combined error).
 *
 * @example Strict boot-time validation
 *   try {
 *     const { apiKey, host } = getPostHogConfig();
 *     // proceed with full PostHog initialization
 *   } catch (err) {
 *     if (err instanceof PostHogConfigError) {
 *       console.error(`[PostHog] ${err.reason}: ${err.message}`);
 *       throw err; // fail fast — do not boot the app with a broken vendor
 *     }
 *     throw err;
 *   }
 */
export function getPostHogConfig(): PostHogConfig {
  const { posthogApiKey, posthogHost } = getVendorKeys();

  if (!isNonEmptyString(posthogApiKey)) {
    throw new PostHogConfigError(
      'missing_api_key',
      'PostHog config is missing the api key. Set POSTHOG_API_KEY in the ' +
        'monorepo-root .env so app.config.ts can forward it via ' +
        'expo.extra.posthogApiKey.',
    );
  }

  if (!isNonEmptyString(posthogHost)) {
    throw new PostHogConfigError(
      'missing_host',
      'PostHog config is missing the ingest host. Set POSTHOG_HOST in the ' +
        'monorepo-root .env (e.g. https://us.i.posthog.com or ' +
        'https://eu.i.posthog.com) so app.config.ts can forward it via ' +
        'expo.extra.posthogHost.',
    );
  }

  return Object.freeze({
    apiKey: posthogApiKey,
    host: posthogHost,
  });
}
