/**
 * Render test — `apps/mobile/app/_layout.tsx` Superwall configure wiring.
 *
 * Verifies Phase 2.5 Sub-AC 2.2:
 *   "app/_layout.tsx invokes configureSuperwall(apiKey) exactly once on
 *    mount via useEffect with an empty dependency array (verified by a
 *    React Testing Library render test that mocks the superwall client
 *    wrapper and asserts configureSuperwall mock is called exactly once
 *    across initial render + rerender)."
 *
 * What this test asserts (the wiring contract):
 *   1. Rendering `<RootLayout />` invokes the wrapper's `configureSuperwall`
 *      function EXACTLY ONCE.
 *   2. The configure call receives the `superwallApiKey` value that the
 *      Expo runtime manifest exposes via `Constants.expoConfig.extra`.
 *   3. Re-rendering the same `<RootLayout />` instance MUST NOT trigger a
 *      second `configureSuperwall` call — the `useEffect` has an empty
 *      dependency array and runs at mount only. This is the load-bearing
 *      idempotency check the Sub-AC names out explicitly.
 *   4. Graceful degradation: when `superwallApiKey` is absent from the
 *      Expo runtime manifest (placeholder onboarding state — developer
 *      has not populated `SUPERWALL_API_KEY` in their local `.env`),
 *      the configure call is SKIPPED entirely so the wrapper never sees
 *      an `undefined` key. The app still mounts and renders children.
 *
 * Native-isolation invariant:
 *   This test mocks the WRAPPER module path (`../src/superwall/client`),
 *   NOT the native package `@superwall/react-native-superwall`. Per the
 *   Seed constraint:
 *
 *     "vitest mocks the wrapper module path (apps/mobile/src/superwall/client)
 *      and does NOT directly import @superwall/react-native-superwall;
 *      native isolation is achieved precisely because vitest substitutes
 *      the wrapper at test time"
 *
 *   The mocked surface mirrors the shape pinned by
 *   `superwall-client-wrapper.test.ts` — keeping route-level and
 *   layout-level mock sites in lock-step ensures a wrapper-API rename
 *   surfaces in both places.
 *
 * Mocking strategy mirrors the sibling `root-layout.test.tsx`:
 *   - `posthog-react-native`: lightweight provider + `usePostHog` stub
 *     so the inner layout subtree mounts without touching the real SDK.
 *   - `expo-router`: spy `Stack` + noop `Redirect` + non-funnel
 *     `usePathname` so the route-tree subtree renders inertly.
 *   - `expo-constants`: mutable-holder pattern so individual cases can
 *     rewrite the `extra` block (happy path vs. missing-key degrade).
 *   - `../src/superwall/client`: the contract under test — a `vi.fn`
 *     for `configureSuperwall` whose call count is the test's primary
 *     assertion.
 *
 * `react-native` handling:
 *   The vitest setup file `tests/__stubs__/setup-rn-stub.ts` pre-populates
 *   Node's CJS `require.cache` with an empty `react-native` stub before
 *   any test file is evaluated (see `vitest.config.ts` `setupFiles`).
 *   This test never exercises a real native component — the route-tree
 *   subtree below `RootLayoutInner` is rendered through the mocked
 *   `Stack` spy which returns a Fragment.
 */
import * as React from 'react';
import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-scope recorders + mutable mock state.
//
// The wrapper-mock factory closes over `configureSuperwallSpy` by reference
// so individual tests can `mockReset()` it between cases. `mockExpoConfig`
// is read by the `expo-constants` mock's `expoConfig` getter at access time,
// so a case can rewrite the `extra` block before `render()` without
// re-mocking.
// ---------------------------------------------------------------------------
const configureSuperwallSpy = vi.fn<[string], Promise<void>>();
let mockExpoConfig: { extra?: unknown } | null = null;

// ---------------------------------------------------------------------------
// Mock — `../src/superwall/client` (the wrapper module, NOT the native pkg)
//
// This is the substitution seam the Seed constraint names as the only valid
// mock surface for vitest. The keys returned here mirror the wrapper's
// public exports as pinned by `superwall-client-wrapper.test.ts`. A drift
// between the two mock sites would surface as a TS error when route-tests
// type-check against the real wrapper module.
// ---------------------------------------------------------------------------
vi.mock('../src/superwall/client', () => {
  return {
    PLACEMENT_PAYMENT_MODEL_UNLOCK: 'payment_model_unlock',
    configureSuperwall: configureSuperwallSpy,
    triggerPaywall: vi.fn(),
    SuperwallNotConfiguredError: class extends Error {
      public override readonly name = 'SuperwallNotConfiguredError';
    },
    SuperwallTriggerError: class extends Error {
      public override readonly name = 'SuperwallTriggerError';
    },
    __resetSuperwallConfiguredForTest: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Mock — `posthog-react-native`
//
// The inner layout component `RootLayoutInner` calls `usePostHog()` for the
// `funnel_step_entered` auto-capture. We provide an inert client + a noop
// provider so the inner tree mounts without touching the real SDK.
// ---------------------------------------------------------------------------
vi.mock('posthog-react-native', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');

  function MockPostHogProvider(props: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return reactActual.createElement(
      reactActual.Fragment,
      null,
      props.children,
    );
  }

  function mockUsePostHog(): null {
    return null;
  }

  return {
    PostHog: vi.fn().mockImplementation(() => ({ __isMockPostHog: true })),
    PostHogProvider: MockPostHogProvider,
    usePostHog: mockUsePostHog,
  };
});

// ---------------------------------------------------------------------------
// Mock — `expo-router`
//
// `StackSpy` is a Fragment-passthrough so the layout's `useEffect` for
// pathname capture and the Superwall configure effect both fire identically
// to production. `usePathname` returns `/` so the funnel-step capture
// useEffect intentionally no-ops (the last URL segment is not a funnel
// kebab slug) — keeps the Superwall configure assertions clean.
// ---------------------------------------------------------------------------
vi.mock('expo-router', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');

  function StackSpy(props: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return reactActual.createElement(
      reactActual.Fragment,
      null,
      props.children,
    );
  }
  (StackSpy as unknown as { Screen: () => null }).Screen = function MockScreen(): null {
    return null;
  };

  function MockRedirect(): null {
    return null;
  }

  function mockUsePathname(): string {
    return '/';
  }

  return {
    Stack: StackSpy,
    Redirect: MockRedirect,
    usePathname: mockUsePathname,
  };
});

// ---------------------------------------------------------------------------
// Mock — `expo-constants`
//
// Same mutable-holder pattern used by the sibling tests so each case can
// rewrite `Constants.expoConfig.extra` (and therefore `superwallApiKey`)
// before `render()` without re-mocking the whole module.
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
// Lazy module loader.
//
// Re-imports the layout module after `vi.resetModules()` in each
// `beforeEach` so the singleton-style module-scope state (none in the
// layout itself, but `getVendorKeys()` reads `Constants.expoConfig` fresh
// per call so this is belt-and-suspenders) starts clean per case.
// ---------------------------------------------------------------------------
async function loadRootLayout(): Promise<React.ComponentType> {
  const mod: { default: React.ComponentType } = await import('../app/_layout');
  return mod.default;
}

// A structurally-valid Superwall publishable key (per the
// `core-ts/superwall/key.ts` `pk_*` regex). The literal `pk_` prefix is
// what the wrapper's validator gates on; the body is arbitrary characters
// in the allowed alphabet — this string is not a real Superwall key.
const VALID_SUPERWALL_KEY = 'pk_test_layout_superwall_configure';

describe('RootLayout — Superwall configure wiring (Sub-AC 2.2)', () => {
  beforeEach(() => {
    vi.resetModules();
    configureSuperwallSpy.mockReset();
    configureSuperwallSpy.mockResolvedValue(undefined);
    // Default: a fully-populated `extra` block so the layout takes the
    // happy path and invokes the configure call.
    mockExpoConfig = {
      extra: {
        posthogApiKey: 'phc_test_layout_superwall_configure',
        posthogHost: 'https://us.i.posthog.com',
        superwallApiKey: VALID_SUPERWALL_KEY,
      },
    };
  });

  it('invokes configureSuperwall exactly once on initial mount with the apiKey from Constants.expoConfig.extra', async () => {
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    // Primary Sub-AC assertion: one call across the initial render.
    // The empty-deps `useEffect` fires synchronously after the commit
    // phase that `render(...)` triggers, so by the time `render()`
    // returns the spy has already been invoked.
    expect(configureSuperwallSpy).toHaveBeenCalledTimes(1);
    expect(configureSuperwallSpy).toHaveBeenCalledWith(VALID_SUPERWALL_KEY);
  });

  it('does NOT re-invoke configureSuperwall on rerender (empty-deps useEffect runs once per mount)', async () => {
    const RootLayout = await loadRootLayout();
    const result = render(React.createElement(RootLayout));

    // Baseline: one call after mount.
    expect(configureSuperwallSpy).toHaveBeenCalledTimes(1);

    // Force a re-render of the SAME root component instance. With an
    // empty dependency array the configure effect must not fire again.
    // This is the load-bearing assertion the Sub-AC names out:
    // "called exactly once across initial render + rerender".
    result.rerender(React.createElement(RootLayout));
    expect(configureSuperwallSpy).toHaveBeenCalledTimes(1);

    // Defence-in-depth: a second rerender stays at one call too.
    result.rerender(React.createElement(RootLayout));
    expect(configureSuperwallSpy).toHaveBeenCalledTimes(1);

    // And the one call carried the expected key — proves we didn't
    // accidentally satisfy "called once" with a stale or wrong value.
    expect(configureSuperwallSpy).toHaveBeenCalledWith(VALID_SUPERWALL_KEY);
  });

  it('skips configureSuperwall entirely when superwallApiKey is missing (graceful degradation)', async () => {
    // Onboarding placeholder state: developer hasn't set
    // SUPERWALL_API_KEY in their local `.env` yet. The layout MUST NOT
    // call `configureSuperwall(undefined)` — the wrapper's regex
    // validator would reject it with `SuperwallNotConfiguredError`,
    // which is the wrong error path for this state (the right answer is
    // "no configure call at all; the app still mounts").
    mockExpoConfig = {
      extra: {
        posthogApiKey: 'phc_test_no_superwall',
        posthogHost: 'https://us.i.posthog.com',
        // superwallApiKey deliberately omitted
      },
    };

    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    // Zero calls — the missing-key guard inside the effect short-circuits
    // before any wrapper call. This protects the wrapper's "exactly one
    // configure() per runtime" invariant even when the developer's `.env`
    // is in the placeholder state.
    expect(configureSuperwallSpy).toHaveBeenCalledTimes(0);
  });
});
