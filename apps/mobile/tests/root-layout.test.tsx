/**
 * Render test — `apps/mobile/app/_layout.tsx`.
 *
 * Verifies Sub-AC 7.3:
 *   "Wire the PostHog provider into the mobile app entry point
 *    (`apps/mobile/app/_layout.tsx` or equivalent) so the root component
 *    tree is wrapped exactly once; include a render test using
 *    `@testing-library/react-native` asserting the provider wraps children
 *    and exposes the singleton client via context."
 *
 * What this test asserts (the wiring contract):
 *   1. Rendering `<RootLayout />` mounts the inner `posthog-react-native`
 *      `PostHogProvider` EXACTLY ONCE — the route-tree subtree lives inside
 *      a single provider (no duplicate provider trees across the paywall /
 *      referral / default gate branches).
 *   2. The `PostHog` constructor is invoked EXACTLY ONCE during the render,
 *      with the api key + host pulled from `Constants.expoConfig.extra`.
 *      This is the singleton invariant — re-mounting the layout during the
 *      same JS runtime must NOT churn the client.
 *   3. The constructed `PostHog` instance is exposed to descendants via
 *      React Context — the mocked `Stack` component (standing in for the
 *      route tree) reads it from context through the mocked `usePostHog()`
 *      and stashes it in module scope so the test can assert identity.
 *   4. Graceful degradation: when `posthogApiKey` is absent from the Expo
 *      runtime manifest (placeholder onboarding state), the source provider
 *      degrades to a children-only fragment — the constructor is NEVER
 *      invoked, no SDK provider mounts, and the route subtree still renders.
 *
 * Mocking strategy:
 *   - `vi.mock('posthog-react-native', ...)`:
 *       * `PostHog`: a `vi.fn` constructor recorder so we can assert call
 *         count + argument values without spinning up the real SDK (which
 *         requires AsyncStorage, the RN bridge, app-lifecycle observers).
 *       * `PostHogProvider`: a real React component that takes the
 *         `client` prop the source provider hands it, records the prop
 *         for assertions, and pushes the client into a private context.
 *         The same context object is used by the mocked `usePostHog()` so
 *         the test exercises the full provider → context → consumer chain.
 *       * `usePostHog`: reads from the same private context the mocked
 *         provider populated — matches the SDK's own production contract
 *         (its real `usePostHog` is `React.useContext(PostHogContext)`).
 *   - `vi.mock('expo-router', ...)`:
 *       * `Stack`: a spy component that calls `usePostHog()` on every
 *         render and stashes the returned value in `stackUsePostHogResult`
 *         so the test can assert "the singleton client reaches the route
 *         subtree via context".
 *       * `Stack.Screen`: a noop component so the JSX
 *         `<Stack.Screen name="..." />` access doesn't crash.
 *       * `Redirect`: a noop component so the (currently-disabled) paywall
 *         and referral gate branches don't fail rendering if a future
 *         contributor flips the default state to `true`.
 *   - `vi.mock('expo-constants', ...)`:
 *       * Same mutable-holder pattern used by `vendor-keys.test.ts` and
 *         the sibling `posthog-provider.test.ts` — a getter consults a
 *         mutable `mockExpoConfig` so individual cases can rewrite the
 *         `extra` block without re-mocking.
 *   - `vi.resetModules()` in `beforeEach` reloads the layout (and
 *     transitively the source provider) so the singleton state inside
 *     `src/providers/PostHogProvider.tsx` starts fresh per test.
 *
 * `react-native` handling:
 *   `react-native/index.js` ships with Flow's `import typeof` syntax which
 *   Node cannot parse natively (Metro normally strips it at build time).
 *   `@testing-library/react-native` eagerly `require('react-native')` from
 *   its helper modules at the top of the file, purely to grab type-only
 *   enums and prop shapes. We pre-populate Node's CJS `require.cache` with
 *   an empty stub before any test file is evaluated — see
 *   `tests/__stubs__/setup-rn-stub.ts`, wired via `setupFiles` in
 *   `vitest.config.ts`. The render path here never exercises an actual
 *   native component (only the mocked `Stack` / `PostHogProvider`), so an
 *   empty object is sufficient.
 */
import * as React from 'react';
import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-scope recorders.
//
// These live outside the mock factories so individual tests can read them
// after `render()` has returned. The mock factories close over them by
// reference.
// ---------------------------------------------------------------------------
const postHogConstructor = vi.fn();
const rnPostHogProviderProps: Array<{ client: unknown }> = [];
let stackUsePostHogResult: unknown = undefined;
let stackRenderCount = 0;
let mockExpoConfig: { extra?: unknown } | null = null;

// ---------------------------------------------------------------------------
// Mock — posthog-react-native
//
// Loads the real `react` via `vi.importActual` so the React instance used to
// build the private context is identical to the one the source under test
// uses (the resolver alias in `vitest.config.ts` pins a single `react` copy
// across the graph). Without that pinning, `React.createContext` in one copy
// is not recognised by `React.useContext` in the other and the consumer
// silently sees the context default.
// ---------------------------------------------------------------------------
vi.mock('posthog-react-native', async () => {
  const reactActual: any = await vi.importActual('react');
  const MockPostHogContext = reactActual.createContext(undefined);

  function MockPostHogProvider(props: any) {
    rnPostHogProviderProps.push({ client: props.client });
    return reactActual.createElement(
      MockPostHogContext.Provider,
      { value: props.client },
      props.children,
    );
  }

  function mockUsePostHog() {
    return reactActual.useContext(MockPostHogContext);
  }

  return {
    PostHog: postHogConstructor,
    PostHogProvider: MockPostHogProvider,
    usePostHog: mockUsePostHog,
  };
});

// ---------------------------------------------------------------------------
// Mock — expo-router
//
// `StackSpy` calls the mocked `usePostHog()` so the test can verify that the
// constructed PostHog instance is delivered to a real React descendant via
// the same context the source provider populates. `Stack.Screen` is a noop
// component so JSX evaluation doesn't fail when accessing the property.
// ---------------------------------------------------------------------------
vi.mock('expo-router', async () => {
  const reactActual: any = await vi.importActual('react');
  const posthogMock: any = await import('posthog-react-native');

  function StackSpy(props: any) {
    stackRenderCount += 1;
    stackUsePostHogResult = posthogMock.usePostHog();
    return reactActual.createElement(reactActual.Fragment, null, props.children);
  }
  (StackSpy as any).Screen = function MockScreen() {
    return null;
  };

  function MockRedirect() {
    return null;
  }

  // `usePathname` is consumed by `RootLayoutInner` for the
  // `funnel_step_entered` auto-capture useEffect.  The test renders the
  // layout in isolation (no router context) so we return a non-funnel
  // pathname — the auto-capture useEffect intentionally no-ops when the
  // last URL segment is not one of the 12 kebab slugs.  This keeps the
  // PostHog wiring assertions clean (no spurious capture() calls).
  function mockUsePathname() {
    return '/';
  }

  return {
    Stack: StackSpy,
    Redirect: MockRedirect,
    usePathname: mockUsePathname,
  };
});

// ---------------------------------------------------------------------------
// Mock — expo-constants
//
// Same mutable-holder pattern used by the sibling tests so each case can
// rewrite `Constants.expoConfig.extra` between cases without re-mocking.
// ---------------------------------------------------------------------------
vi.mock('expo-constants', () => {
  return {
    default: {
      get expoConfig() {
        return mockExpoConfig;
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Mock — superwall client wrapper
//
// The wrapper module is the single test-mock seam for the Superwall native
// integration (per Phase 2.5 Seed: "vitest mocks the wrapper module path and
// does NOT directly import @superwall/react-native-superwall"). Mocking the
// wrapper here prevents the transitive native module import from blowing up
// vitest with "Cannot find module '../package.json'" inside the SDK's bundle.
// ---------------------------------------------------------------------------
vi.mock('../src/superwall/client', () => {
  return {
    configureSuperwall: vi.fn().mockResolvedValue(undefined),
    triggerPaywall: vi.fn().mockResolvedValue({ outcome: 'declined' }),
  };
});

// ---------------------------------------------------------------------------
// Mock — sentry wrapper
//
// `app/_layout.tsx` calls `initSentry()` (from `../src/sentry`) as the first
// line of its mount effect. The wrapper is the single auditable seam that
// imports the native `@sentry/react-native` package, whose Objective-C-backed
// shim vitest's node runtime cannot resolve. Mocking the wrapper here keeps
// the native module out of the test graph — the same native-isolation pattern
// this file already applies to `../src/superwall/client`. The PostHog wiring
// under test is independent of Sentry, so an inert `initSentry` no-op suffices.
// ---------------------------------------------------------------------------
vi.mock('../src/sentry', () => {
  return {
    initSentry: vi.fn().mockReturnValue(true),
    setSentryUser: vi.fn(),
    clearSentryUser: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Lazy module loader.
//
// Re-imports the layout (and transitively the PostHogProvider source) after
// `vi.resetModules()` so each test observes a freshly-initialized singleton
// inside `src/providers/PostHogProvider.tsx`.
// ---------------------------------------------------------------------------
async function loadRootLayout() {
  const mod: any = await import('../app/_layout');
  return mod.default;
}

describe('RootLayout — PostHog provider wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    postHogConstructor.mockReset();
    // Default stub: every constructor invocation returns a tagged stub the
    // tests can identity-check against.
    postHogConstructor.mockImplementation(() => ({
      __isMockPostHog: true,
    }));
    rnPostHogProviderProps.length = 0;
    stackUsePostHogResult = undefined;
    stackRenderCount = 0;
    // Default: a fully-populated `extra` block so the provider takes the
    // happy path (constructor runs, client flows into context).
    mockExpoConfig = {
      extra: {
        posthogApiKey: 'phc_test_layout_wiring',
        posthogHost: 'https://us.i.posthog.com',
        superwallApiKey: 'pk_unused',
      },
    };
  });

  it('wraps the root tree with exactly one PostHogProvider', async () => {
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    // Singleton wrap-site invariant: the mocked SDK `PostHogProvider` was
    // rendered exactly once across the whole layout — the route tree lives
    // inside a single provider.
    expect(rnPostHogProviderProps).toHaveLength(1);
    // And the spy `Stack` rendered inside it — confirming the provider
    // wraps children (rather than sitting beside the route tree).
    expect(stackRenderCount).toBe(1);
  });

  it('invokes the PostHog constructor exactly once with apiKey + host from Constants.expoConfig.extra', async () => {
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    expect(postHogConstructor).toHaveBeenCalledTimes(1);
    expect(postHogConstructor).toHaveBeenCalledWith('phc_test_layout_wiring', {
      host: 'https://us.i.posthog.com',
    });
  });

  it('exposes the singleton PostHog client to children via context (usePostHog returns it)', async () => {
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    // Capture the instance the constructor returned.
    expect(postHogConstructor).toHaveBeenCalledTimes(1);
    const constructedClient = postHogConstructor.mock.results[0]?.value;

    // The provider received that same instance as its `client` prop.
    expect(rnPostHogProviderProps).toHaveLength(1);
    expect(rnPostHogProviderProps[0]?.client).toBe(constructedClient);

    // Contract under test: a descendant calling `usePostHog()` received the
    // same instance via React Context.
    expect(stackUsePostHogResult).toBe(constructedClient);
    // Defence-in-depth: the value is the tagged stub our constructor
    // returned, not an unrelated object that happened to share identity.
    expect(
      (stackUsePostHogResult as { __isMockPostHog?: boolean })?.__isMockPostHog,
    ).toBe(true);
  });

  it('degrades gracefully when posthogApiKey is missing — children still render, no PostHog constructor call', async () => {
    // Onboarding placeholder state: developer hasn't set POSTHOG_API_KEY in
    // their local `.env` yet. The provider degrades to a fragment (children
    // only) and the constructor must NEVER run with an undefined key.
    mockExpoConfig = {
      extra: {
        // posthogApiKey deliberately omitted
        posthogHost: 'https://us.i.posthog.com',
      },
    };

    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    // Constructor never ran — defence against the SDK rejecting an
    // undefined api key with an opaque server-side error.
    expect(postHogConstructor).toHaveBeenCalledTimes(0);
    // The route subtree still rendered (graceful degradation).
    expect(stackRenderCount).toBe(1);
    // No SDK provider was mounted in the fragment fallback path.
    expect(rnPostHogProviderProps).toHaveLength(0);
    // `usePostHog()` resolves to the context default (`undefined`) — same
    // behaviour the real SDK exhibits when the consumer is not wrapped.
    expect(stackUsePostHogResult).toBeUndefined();
  });
});
