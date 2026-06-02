/**
 * PostHog provider module — singleton `posthog-react-native` client bootstrap
 * for the personal-color-kr mobile app.
 *
 * Responsibilities of this module (Sub-AC 7.1):
 *   1. Read PostHog `apiKey` and `host` from the Expo runtime manifest at
 *      `Constants.expoConfig.extra` (via the typed accessor `getVendorKeys()`
 *      from `src/config/vendor-keys.ts` so we never touch
 *      `Constants.expoConfig.extra` directly and the shape contract stays in
 *      lock-step with `app.config.ts`).
 *   2. Instantiate a SINGLE `posthog-react-native` `PostHog` client across the
 *      lifetime of the JS runtime. Calling the bootstrap function multiple
 *      times MUST return the same instance and MUST NOT re-invoke the
 *      `PostHog` constructor. This invariant is asserted by the sibling unit
 *      test under `tests/posthog-provider.test.ts`.
 *   3. Surface a React component (`PostHogProvider`) that wraps the subtree
 *      with `posthog-react-native`'s native `PostHogProvider` — using the
 *      singleton client we built in step 2 — so the rest of the funnel can
 *      read it via the `usePostHog()` hook.
 *
 * Graceful-degradation contract:
 *   - When `Constants.expoConfig.extra.posthogApiKey` is `undefined` (the
 *     developer hasn't populated their local `.env` yet, or the runtime is
 *     vitest's node env without an Expo runtime), the bootstrap returns
 *     `null`. The constructor is NEVER called with `undefined` / empty
 *     strings, so a malformed PostHog client cannot be reached by mistake.
 *   - The React component degrades to a fragment (`children` only) in that
 *     case rather than rendering a broken provider. This matches the
 *     placeholder onboarding flow used everywhere else in this codebase.
 *
 * Why a module-level singleton (not a useMemo / useRef):
 *   - The PostHog client is process-global state (network queues, persistent
 *     storage, app-lifecycle observers). Constructing more than one of them
 *     within the same JS runtime corrupts deduplication and persistence.
 *   - A module-level singleton is the canonical pattern in
 *     `posthog-react-native`'s own docs:
 *         export const posthog = new PostHog(...)
 *     We add lazy init + env-driven config on top of that pattern so the
 *     constructor can read `Constants.expoConfig.extra` at first call rather
 *     than at module-load time (which would otherwise force the developer
 *     to populate `.env` before any import of this file).
 *
 * Test isolation:
 *   - `__resetPostHogProviderForTests()` clears the singleton between vitest
 *     cases. The leading double-underscore signals "do not call from
 *     production code" and matches the convention used by other internal
 *     reset helpers in this repo.
 */
import * as React from 'react';
import {
  PostHog,
  PostHogProvider as RnPostHogProvider,
  type PostHogOptions,
} from 'posthog-react-native';

// Relative import (rather than the `@mobile/*` tsconfig path alias) because
// vitest's resolver does not consume tsconfig `paths` by default in this
// workspace's config, and the smoke test must run without bundler-specific
// alias plumbing. Expo Metro and TypeScript both honour the relative path
// without complaint.
import { getVendorKeys } from '../config/vendor-keys';

// ---------------------------------------------------------------------------
// Module-level singleton state.
//
// `cachedClient` is the constructed `PostHog` instance (or `null` when the
// api key was missing).  `initialized` is the gate that guarantees the
// constructor runs exactly once — including in the "null" path so we don't
// retry on every render when the key is genuinely absent.
// ---------------------------------------------------------------------------
let cachedClient: PostHog | null = null;
let initialized = false;

/**
 * Lazily construct (and memoize) the singleton `posthog-react-native` client
 * from the runtime config exposed via `Constants.expoConfig.extra`.
 *
 * On first call:
 *   - Reads `posthogApiKey` and `posthogHost` from {@link getVendorKeys}.
 *   - If `posthogApiKey` is `undefined`, marks the singleton as initialized
 *     to `null` and returns `null` — the `PostHog` constructor is NEVER
 *     invoked with a missing key.
 *   - Otherwise invokes `new PostHog(apiKey, { host })` exactly once,
 *     omitting `host` from the options object when it is `undefined` so the
 *     SDK uses its own default (`https://us.i.posthog.com`).
 *
 * On every subsequent call: returns the cached instance (or cached `null`)
 * without touching the `PostHog` constructor.
 *
 * @returns the singleton `PostHog` client, or `null` when the api key is not
 *   configured.
 */
export function getOrInitializePostHogClient(): PostHog | null {
  if (initialized) {
    return cachedClient;
  }
  initialized = true;

  const { posthogApiKey, posthogHost } = getVendorKeys();
  if (posthogApiKey === undefined) {
    cachedClient = null;
    return null;
  }

  // Build PostHogOptions conditionally so we never forward a literal
  // `host: undefined` (which `exactOptionalPropertyTypes` would reject and
  // which is also semantically distinct from "use the SDK default" to some
  // strict consumers).
  const options: PostHogOptions =
    posthogHost === undefined ? {} : { host: posthogHost };

  cachedClient = new PostHog(posthogApiKey, options);
  return cachedClient;
}

/**
 * Internal — reset the singleton state so a subsequent call to
 * {@link getOrInitializePostHogClient} re-evaluates `Constants.expoConfig`
 * and re-invokes the `PostHog` constructor.
 *
 * Only intended for vitest test isolation. Production code MUST NOT call
 * this — re-constructing the PostHog client at runtime corrupts its
 * persisted queues. The leading double-underscore name is the agreed signal
 * for "do not import from product code".
 */
export function __resetPostHogProviderForTests(): void {
  cachedClient = null;
  initialized = false;
}

/**
 * React component that bootstraps the singleton PostHog client and wraps the
 * subtree with `posthog-react-native`'s native `PostHogProvider`.
 *
 * Renders a plain fragment containing `children` when the api key is missing,
 * so the app still mounts during the placeholder onboarding flow (no key in
 * `.env` yet) without throwing.
 *
 * Implementation note: we deliberately use `React.createElement` rather than
 * JSX literals so this file compiles identically under any JSX runtime
 * configuration (classic vs. automatic) — vitest's esbuild transform and the
 * Expo Metro bundler agree on the resulting code with no per-environment
 * tuning required.
 */
export function PostHogProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const client = getOrInitializePostHogClient();
  if (client === null) {
    return React.createElement(React.Fragment, null, children);
  }
  // `posthog-react-native`'s `PostHogProviderProps` declares `children` as a
  // REQUIRED prop, so it must live in the props bag for `tsc` to accept the
  // call (passing it only as the third `createElement` argument fails the
  // overload — `children` is reported missing). `react/no-children-prop` is a
  // false positive against this third-party type contract; disabled narrowly
  // here (not one of the four protected type-checked rules).
  // eslint-disable-next-line react/no-children-prop
  return React.createElement(RnPostHogProvider, { client, children });
}
