/**
 * Prebuild dry-run contract — `apps/mobile/app.config.ts` +
 * `@sentry/react-native/expo` config plugin.
 *
 * Verifies the Phase 7.3 sub-AC: "expo prebuild dry-run succeeds with Sentry
 * config plugin present."
 *
 * Why this test exists (distinct from `app-config-sentry-plugin.test.ts`):
 *   `app-config-sentry-plugin.test.ts` asserts the *shape* of the plugin entry
 *   inside the resolved Expo config object — i.e. that the `[name, options]`
 *   tuple lands in the `plugins` array. It does NOT assert that the plugin
 *   *module* (`@sentry/react-native/expo`) is actually installed and loadable.
 *
 *   But `expo prebuild` resolves every entry in the `plugins` array to a real
 *   module and invokes it. If `@sentry/react-native` is declared in
 *   `package.json` but never materialised into `node_modules`, the config entry
 *   is present yet prebuild crashes with `Cannot find module
 *   '@sentry/react-native/expo'`. That is exactly the failure this test guards
 *   against: it pins, in the project's own test framework (vitest, no Expo CLI
 *   required), the two conditions that together make the prebuild dry-run
 *   succeed:
 *
 *     1. the Sentry Expo config-plugin module RESOLVES (the package is
 *        installed at the subpath Expo's plugin loader will `require`), and is a
 *        callable config-plugin function; and
 *     2. the resolved `app.config.ts` output lists that exact module specifier
 *        in its `plugins` array, so prebuild will actually load and apply it.
 *
 *   `expo config --type prebuild` (the CLI dry-run that runs the same
 *   config-plugin resolution pipeline without emitting native files) is the
 *   manual counterpart to this test; it exits 0 with this plugin present once
 *   both conditions above hold.
 */
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import defineExpoConfig, { SENTRY_EXPO_PLUGIN_NAME } from '../app.config';

const requireFromHere = createRequire(__filename);

describe('app.config.ts — expo prebuild dry-run with Sentry config plugin', () => {
  it('resolves the @sentry/react-native/expo config-plugin module (installed, not just declared)', () => {
    // `expo prebuild` resolves each plugins[] entry to a module path before
    // invoking it. If the package is declared in package.json but absent from
    // node_modules, this throws MODULE_NOT_FOUND — the prebuild-crashing
    // condition this AC exists to prevent.
    expect(() => requireFromHere.resolve(SENTRY_EXPO_PLUGIN_NAME)).not.toThrow();
  });

  it('loads the Sentry Expo config plugin as a callable config-plugin function', () => {
    const mod = requireFromHere(SENTRY_EXPO_PLUGIN_NAME) as unknown;
    // Expo config plugins are exported as a function (default or CJS
    // module.exports). A non-function export would make prebuild throw when it
    // tries to invoke the plugin.
    const plugin =
      typeof mod === 'function' ? mod : (mod as { default?: unknown })?.default;
    expect(typeof plugin).toBe('function');
  });

  it('lists the resolvable Sentry plugin specifier in the prebuild plugins array', () => {
    const result = defineExpoConfig({ config: {} });
    const plugins = result.plugins as ReadonlyArray<unknown>;

    const sentryEntry = plugins.find(
      (p): p is [string, Record<string, unknown>] =>
        Array.isArray(p) && p[0] === SENTRY_EXPO_PLUGIN_NAME,
    );

    // The specifier prebuild will load must be exactly the one we asserted is
    // resolvable above — guarantees the config entry and the installed module
    // can never drift apart.
    expect(sentryEntry).toBeDefined();
    expect(sentryEntry?.[0]).toBe(SENTRY_EXPO_PLUGIN_NAME);
    expect(() => requireFromHere.resolve(sentryEntry?.[0] as string)).not.toThrow();
  });
});
