/**
 * Smoke test — `apps/mobile/app.config.ts` `@sentry/react-native/expo`
 * config-plugin wiring.
 *
 * Verifies the Phase 7.3 sub-AC: "app.config.ts extended with
 * @sentry/react-native/expo plugin entry containing TODO_SENTRY_ORG_SLUG and
 * pck-mobile project slug."
 *
 * The Sentry Expo config plugin is what wires native crash symbolication into
 * the generated `ios/` (and `android/`) projects during `expo prebuild` / EAS
 * Build: it installs the native Sentry SDK, registers the source-map and dSYM
 * upload build phases, and stamps the release identifiers. The plugin entry is
 * a `[pluginName, options]` tuple where `options.organization` / `options.project`
 * are the Sentry org/project slugs the symbolication artifacts upload to.
 *
 * What this test asserts:
 *   1. `SENTRY_ORG_SLUG` is the documented `TODO_SENTRY_ORG_SLUG` placeholder
 *      (org not yet provisioned — replaced by a human at credential time, no
 *      code change required).
 *   2. `SENTRY_PROJECT_SLUG` is `pck-mobile` (mobile-specific issue grouping,
 *      separate from the api's `pck-api` project).
 *   3. `buildSentryPluginEntry()` returns the `[name, options]` tuple shape the
 *      Expo plugin loader expects.
 *   4. `defineExpoConfig` includes that tuple in its `plugins` array, alongside
 *      the pre-existing `expo-router` / `expo-dev-client` plugins (extend, not
 *      replace).
 */
import { describe, expect, it } from 'vitest';

import defineExpoConfig, {
  SENTRY_EXPO_PLUGIN_NAME,
  SENTRY_ORG_SLUG,
  SENTRY_PROJECT_SLUG,
  buildSentryPluginEntry,
} from '../app.config';

describe('app.config.ts — @sentry/react-native/expo plugin entry', () => {
  it('SENTRY_ORG_SLUG is the TODO placeholder until the org is provisioned', () => {
    expect(SENTRY_ORG_SLUG).toBe('TODO_SENTRY_ORG_SLUG');
  });

  it('SENTRY_PROJECT_SLUG is the mobile-specific `pck-mobile` slug', () => {
    expect(SENTRY_PROJECT_SLUG).toBe('pck-mobile');
  });

  it('SENTRY_EXPO_PLUGIN_NAME targets the Expo config-plugin subpath', () => {
    expect(SENTRY_EXPO_PLUGIN_NAME).toBe('@sentry/react-native/expo');
  });

  it('buildSentryPluginEntry() returns the [name, options] tuple shape', () => {
    const entry = buildSentryPluginEntry();
    expect(Array.isArray(entry)).toBe(true);
    expect(entry).toHaveLength(2);

    const [name, options] = entry;
    expect(name).toBe('@sentry/react-native/expo');
    expect(options).toMatchObject({
      organization: 'TODO_SENTRY_ORG_SLUG',
      project: 'pck-mobile',
    });
  });

  it('includes the Sentry plugin tuple in the resolved plugins array', () => {
    const result = defineExpoConfig({ config: {} });
    const plugins = result.plugins as ReadonlyArray<unknown>;

    expect(Array.isArray(plugins)).toBe(true);

    const sentryEntry = plugins.find(
      (p): p is [string, Record<string, unknown>] =>
        Array.isArray(p) && p[0] === '@sentry/react-native/expo',
    );

    expect(sentryEntry).toBeDefined();
    expect(sentryEntry?.[1]).toMatchObject({
      organization: 'TODO_SENTRY_ORG_SLUG',
      project: 'pck-mobile',
    });
  });

  it('preserves the pre-existing expo-router / expo-dev-client plugins', () => {
    const result = defineExpoConfig({ config: {} });
    const plugins = result.plugins as ReadonlyArray<unknown>;

    expect(plugins).toContain('expo-router');
    expect(plugins).toContain('expo-dev-client');
  });
});
