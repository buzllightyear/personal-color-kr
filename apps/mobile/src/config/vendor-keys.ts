/**
 * Runtime accessor for vendor credentials forwarded via the Expo `extra` block.
 *
 * This module is the *runtime* counterpart to `apps/mobile/app.config.ts`. The
 * config file runs at Expo CLI configuration-resolution time and writes the
 * three safe-to-bundle vendor keys into `expo.extra`. Expo then snapshots that
 * block into the build manifest, where it is exposed at runtime via
 * `expo-constants` (`Constants.expoConfig.extra`). This file is the single,
 * typed accessor screens, hooks, and the `core-ts` PostHogClient wrapper use
 * to read those values — callers MUST NOT touch `Constants.expoConfig.extra`
 * directly so the shape stays in lock-step with `app.config.ts`.
 *
 * What lives in `extra` (Sub-AC 8.2 contract):
 *   - `posthogApiKey`     — PostHog public project key (`phc_...`).
 *   - `posthogHost`       — PostHog ingest host (US/EU/self-hosted).
 *   - `superwallApiKey`   — Superwall iOS public API key.
 *
 * What is INTENTIONALLY ABSENT (security invariant):
 *   - `falApiKey` is server-side only and MUST NEVER be bundled into the
 *     mobile app binary. The Expo `extra` block is bundled into the runtime
 *     manifest packaged with the IPA/APK, so we deliberately:
 *       (a) omit `falApiKey` from the {@link VendorKeys} shape, and
 *       (b) never read `process.env.FAL_API_KEY` from this file.
 *     A regression test (`tests/vendor-keys.test.ts`) asserts the returned
 *     object has no `falApiKey` property, even when one is forced into the
 *     mocked `Constants.expoConfig.extra` payload.
 *
 * Defensive contract:
 *   - `Constants.expoConfig` is `null` in a few legitimate runtime contexts
 *     (e.g. classic-manifest fallback, vitest's node env without a real Expo
 *     runtime). We treat absent fields as `undefined` rather than throwing
 *     so screens can degrade gracefully during onboarding; live validation
 *     of the actual values is the job of sibling sub-ACs (PostHog smoke,
 *     Superwall regex).
 *   - We freeze the returned object so accidental mutation cannot poison a
 *     shared singleton in a long-lived JS runtime.
 */
import Constants from 'expo-constants';

/**
 * The three vendor credential fields that the Expo `extra` block exposes at
 * runtime. Each field is `string | undefined` because the developer's local
 * `.env` may not yet be populated (placeholder onboarding flow), and the
 * Expo manifest carries `undefined` straight through.
 *
 * Note: `falApiKey` is intentionally NOT a member of this type so a future
 * contributor cannot accidentally surface the server-side-only Fal.ai key
 * to client code without also changing this shape (which the regression
 * test will reject).
 */
export interface VendorKeys {
  readonly posthogApiKey: string | undefined;
  readonly posthogHost: string | undefined;
  readonly superwallApiKey: string | undefined;
}

/**
 * Internal helper: safely coerce an arbitrary `extra` value into a typed
 * record. `Constants.expoConfig` may be `null` and `expoConfig.extra` may
 * be `undefined` / `null` / non-object in degenerate environments, so we
 * normalise to an empty object rather than letting an inadvertent property
 * access crash the JS runtime at startup.
 */
function readExtraObject(): Readonly<Record<string, unknown>> {
  const expoConfig = Constants.expoConfig;
  if (expoConfig === null || expoConfig === undefined) {
    return {};
  }
  const extra: unknown = expoConfig.extra;
  if (extra === null || extra === undefined) {
    return {};
  }
  if (typeof extra !== 'object' || Array.isArray(extra)) {
    return {};
  }
  return extra as Readonly<Record<string, unknown>>;
}

/**
 * Internal helper: read a single `extra` field as `string | undefined`.
 *
 * Anything that is not a string (number, object, boolean, `null`) is
 * coerced to `undefined` rather than passed through — vendor SDKs all
 * expect string keys, and a wrong-typed value is more harmful than a
 * missing one (it would pass a truthiness check but fail vendor auth
 * with an opaque server-side error).
 */
function readStringField(extra: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = extra[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Read the three vendor credentials from `Constants.expoConfig.extra`.
 *
 * Returns a frozen `VendorKeys` snapshot. Each call reads `Constants.expoConfig`
 * fresh (rather than memoising at module load) so vitest tests that mutate
 * the `expo-constants` mock between cases observe deterministic values.
 *
 * @example
 *   const { posthogApiKey, posthogHost } = getVendorKeys();
 *   if (posthogApiKey === undefined) {
 *     // placeholder onboarding flow — skip PostHog init
 *     return;
 *   }
 *   const client = createPostHogClient({ apiKey: posthogApiKey, host: posthogHost });
 */
export function getVendorKeys(): VendorKeys {
  const extra = readExtraObject();
  return Object.freeze({
    posthogApiKey: readStringField(extra, 'posthogApiKey'),
    posthogHost: readStringField(extra, 'posthogHost'),
    superwallApiKey: readStringField(extra, 'superwallApiKey'),
  });
}
