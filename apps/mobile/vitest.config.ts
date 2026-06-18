/**
 * Vitest configuration for the `mobile` workspace.
 *
 * Scope:
 *   - Config-loading smoke tests that pin the contract "app.config.ts loads
 *     root .env via dotenv.config() with correct path resolution".
 *   - Provider-wiring render tests that assert the singleton PostHog client
 *     is mounted exactly once at the root of the Expo Router tree (Sub-AC
 *     7.3). These tests use `@testing-library/react-native` (which renders
 *     via `react-test-renderer`, no DOM required) and live alongside the
 *     `.ts` config tests in `tests/**\/*.test.{ts,tsx}`.
 *
 * Mobile RN screen code (funnel screens, magazine reader, etc.) is NOT
 * covered here — that surface is exercised by core-ts unit tests and
 * (later) an E2E harness on top of Expo.
 *
 * Environment: `node`. The config-loading tests deliberately mutate and
 * inspect `process.env` (unavailable in jsdom), and `react-test-renderer`
 * works in any environment. The provider-wiring test mocks
 * `posthog-react-native` and `expo-router` so no native module touches the
 * runtime.
 */
import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Pre-populate Node's CJS `require.cache` with an empty stub for
    // `react-native` BEFORE any test file imports
    // `@testing-library/react-native`. The testing library's helper modules
    // (`fire-event.js`, `host-component-names.js`, ...) eagerly
    // `require('react-native')` at the top of the file purely to grab
    // type-only enums and prop shapes; the actual `render()` path uses
    // `react-test-renderer` and never exercises a native component. The
    // real `react-native/index.js` ships with Flow's `import typeof`
    // syntax which Node cannot parse natively (Metro normally strips it at
    // build time), so without this stub the test suite crashes during
    // module load. See `tests/__stubs__/setup-rn-stub.ts` for the full
    // rationale.
    setupFiles: ['tests/__stubs__/setup-rn-stub.ts'],
  },
  resolve: {
    // Pin a single physical copy of `react` across the test, the source
    // under test, and the mocked `posthog-react-native` context. Without
    // this, vitest's resolver can hand back two distinct copies (one for
    // the test file, one for transitive imports under `apps/mobile`), and
    // `React.createContext(...)` in one copy is not recognised by
    // `React.useContext(...)` in the other — silently returning the context
    // default and breaking the singleton-via-context assertion.
    alias: [
      // `use-app-fonts` loads `expo-font` + `require('*.otf')` font binaries —
      // native/Metro-only concerns vite/rollup cannot parse in the node test
      // env. Redirect to an inert stub (reports fonts-loaded) so RootLayout
      // renders its real tree without pulling in the font runtime. Regex entry
      // first so it wins before the string aliases below.
      {
        // Match the WHOLE specifier (regex aliases replace only the matched
        // span, so anchor with `.*` to swap the entire import path).
        find: /.*use-app-fonts$/,
        replacement: path.resolve(__dirname, 'tests/__stubs__/use-app-fonts-stub.ts'),
      },
      { find: 'react', replacement: path.resolve(__dirname, 'node_modules/react') },
      // `expo-linking` transitively imports `react-native`, whose Flow
      // `import typeof` syntax vite/rollup cannot parse in the node test
      // environment (same root cause the `react-native` require-cache stub
      // addresses for the CJS path). Redirect it to a parseable, inert stub
      // so any component that statically imports `expo-linking` (e.g.
      // `app/_layout.tsx`, which mounts the deep-link referral-stash hook)
      // can be rendered. The stash logic itself is unit-tested directly
      // against `stashReferralCodeFromDeepLink`, not through this hook.
      {
        find: 'expo-linking',
        replacement: path.resolve(__dirname, 'tests/__stubs__/expo-linking-stub.ts'),
      },
      // `react-native-svg` is a native module vite can't parse; the editorial
      // line icons (src/components/icons/*) import it. Stub renders each SVG
      // primitive as an inert host element so icon testIDs are findable.
      {
        find: 'react-native-svg',
        replacement: path.resolve(__dirname, 'tests/__stubs__/react-native-svg-stub.ts'),
      },
      // `expo-image-picker` is a native module vite can't parse; `src/pick-selfie.ts`
      // imports it for the default permission/launch fns + the MediaTypeOptions
      // enum. Redirect to an inert stub so the module resolves — the picker flow
      // itself is tested through `pickSelfie`'s injected deps.
      {
        find: 'expo-image-picker',
        replacement: path.resolve(__dirname, 'tests/__stubs__/expo-image-picker-stub.ts'),
      },
      // `expo-apple-authentication` is a native module vite can't parse;
      // `src/acquire-apple-credential.ts` imports its `signInAsync` /
      // `isAvailableAsync` + scope enum, and `AppleSignInButton` imports the
      // native `AppleAuthenticationButton`. Stub resolves the import, exposes
      // the enums, and renders the button as an inert host element. The auth
      // flow itself is tested through `acquireAppleCredential`'s injected deps.
      {
        find: 'expo-apple-authentication',
        replacement: path.resolve(
          __dirname,
          'tests/__stubs__/expo-apple-authentication-stub.ts',
        ),
      },
      // `expo-secure-store` is a native Keychain module vite can't parse;
      // `src/storage/auth-token-storage.ts` imports its get/set/delete fns.
      // Stub resolves the import with inert no-ops — the storage seam is tested
      // through its injected deps.
      {
        find: 'expo-secure-store',
        replacement: path.resolve(
          __dirname,
          'tests/__stubs__/expo-secure-store-stub.ts',
        ),
      },
    ],
  },
});
