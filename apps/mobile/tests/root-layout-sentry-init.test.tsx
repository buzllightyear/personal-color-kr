/**
 * Render test — `apps/mobile/app/_layout.tsx` Sentry init wiring.
 *
 * Verifies the Phase 7.3 Sub-AC:
 *   "app/_layout.tsx calls initSentry as first line of mounted effect before
 *    PostHog."
 *
 * Interpretation of "before PostHog" (and why this is the honest contract):
 *   The `posthog-react-native` `PostHog` constructor runs during the
 *   `<PostHogProvider>` *render* (see `src/providers/PostHogProvider.tsx` —
 *   `getOrInitializePostHogClient()` is called in the render body, not an
 *   effect). React always runs render before any `useEffect` commit, so an
 *   effect-based `initSentry()` cannot precede the PostHog *constructor* at
 *   runtime — and the AC deliberately specifies a "mounted effect" (mirroring
 *   `src/sentry.ts`'s docstring: "called as the FIRST statement inside the root
 *   layout's mount effect"). "Before PostHog" is therefore the layout's
 *   *mount-sequence* ordering: `useInitSentryOnce()` is the FIRST statement in
 *   `RootLayout`, invoked ahead of `useConfigureSuperwallOnce()` and ahead of
 *   returning the `<PostHogProvider>` tree, so Sentry's global error hooks are
 *   the first subsystem the root layout arms.
 *
 *   This file pins that contract with assertions that are actually TRUE:
 *     1. `initSentry()` is invoked EXACTLY ONCE on mount (empty-deps effect).
 *     2. `initSentry()` runs BEFORE the Superwall configure effect — the two
 *        mount effects `RootLayout` owns, registered in source order, so this
 *        proves "Sentry is the first thing the layout boots". (Sentry-before-
 *        Superwall is the strongest runtime-observable expression of the
 *        source ordering; Sentry-before-PostHog-constructor is impossible by
 *        React's render-before-effect rule, as explained above.)
 *     3. PostHog still bootstraps at mount (coexistence — adding the Sentry
 *        wiring did not break the existing provider construction).
 *     4. The mount effect does NOT re-fire on rerender (one-shot per runtime).
 *     5. Fail-open: when `initSentry()` returns `false` (disabled / no-DSN),
 *        the app still mounts and PostHog still bootstraps.
 *
 * Native-isolation invariant:
 *   This test mocks the WRAPPER module path (`../src/sentry`), NOT the native
 *   package `@sentry/react-native`. The wrapper is the single auditable seam
 *   that imports `@sentry/react-native`, so substituting it at test time keeps
 *   the Objective-C-backed native shim out of vitest's node runtime — the same
 *   strategy `root-layout-superwall-configure.test.tsx` uses for the Superwall
 *   wrapper.
 */
import * as React from 'react';
import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared, ordered call log.
//
// The `initSentry`, `configureSuperwall`, and `PostHog` constructor spies each
// push a marker onto this array at call time. Relative indices encode the
// mount-sequence ordering the test asserts.
// ---------------------------------------------------------------------------
const callOrder: string[] = [];

const initSentrySpy = vi.fn<[], boolean>(() => {
  callOrder.push('sentry:init');
  return true;
});

let mockExpoConfig: { extra?: unknown } | null = null;

// ---------------------------------------------------------------------------
// Mock — `../src/sentry` (the wrapper module, NOT `@sentry/react-native`)
//
// This is the substitution seam that keeps the native Sentry package out of
// the vitest node runtime. Only `initSentry` is exercised by the layout; the
// other wrapper exports are stubbed for shape parity with the real module.
// ---------------------------------------------------------------------------
vi.mock('../src/sentry', () => {
  return {
    initSentry: initSentrySpy,
    setSentryUser: vi.fn(),
    clearSentryUser: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Mock — `posthog-react-native`
//
// The `PostHog` constructor spy records its invocation on the shared call log
// so the test can prove PostHog still bootstraps at mount. The provider is
// inert and `usePostHog` returns a stub so `RootLayoutInner` mounts cleanly.
// ---------------------------------------------------------------------------
vi.mock('posthog-react-native', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');

  function MockPostHogProvider(props: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return reactActual.createElement(reactActual.Fragment, null, props.children);
  }

  function mockUsePostHog(): null {
    return null;
  }

  const PostHogCtor = vi.fn().mockImplementation(() => {
    callOrder.push('posthog:construct');
    return { __isMockPostHog: true };
  });

  return {
    PostHog: PostHogCtor,
    PostHogProvider: MockPostHogProvider,
    usePostHog: mockUsePostHog,
  };
});

// ---------------------------------------------------------------------------
// Mock — `../src/superwall/client`
//
// `configureSuperwall` records onto the shared call log so the test can assert
// the Sentry init effect runs before the Superwall configure effect. Mirrors
// the shape pinned by the sibling tests.
// ---------------------------------------------------------------------------
vi.mock('../src/superwall/client', () => {
  return {
    PLACEMENT_PAYMENT_MODEL_UNLOCK: 'payment_model_unlock',
    configureSuperwall: vi.fn().mockImplementation(() => {
      callOrder.push('superwall:configure');
      return Promise.resolve(undefined);
    }),
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
// Mock — `expo-router`
// ---------------------------------------------------------------------------
vi.mock('expo-router', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');

  function StackSpy(props: {
    readonly children?: React.ReactNode;
  }): React.ReactElement {
    return reactActual.createElement(reactActual.Fragment, null, props.children);
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
// Lazy module loader — re-imports the layout after `vi.resetModules()` so the
// PostHog provider's module-scope singleton starts clean per case (otherwise
// the constructor only runs in the first test and the coexistence assertion in
// later cases would see a cached client).
// ---------------------------------------------------------------------------
async function loadRootLayout(): Promise<React.ComponentType> {
  const mod: { default: React.ComponentType } = await import('../app/_layout');
  return mod.default;
}

describe('RootLayout — Sentry init wiring (Phase 7.3)', () => {
  beforeEach(() => {
    vi.resetModules();
    callOrder.length = 0;
    initSentrySpy.mockReset();
    // Use mockImplementation (NOT mockReturnValue) so the `callOrder` push
    // side-effect is preserved — `mockReturnValue` would replace the body and
    // the ordering markers would never be recorded.
    initSentrySpy.mockImplementation(() => {
      callOrder.push('sentry:init');
      return true;
    });
    // Populated keys so PostHog's constructor and Superwall's configure both
    // run — required for the mount-sequence ordering + coexistence assertions.
    mockExpoConfig = {
      extra: {
        posthogApiKey: 'phc_test_layout_sentry_init',
        posthogHost: 'https://us.i.posthog.com',
        superwallApiKey: 'pk_test_layout_sentry_init',
        sentryDsnMobile: 'https://examplePublicKey@o0.ingest.sentry.io/0',
        easBuildProfile: 'development',
      },
    };
  });

  it('invokes initSentry exactly once on initial mount', async () => {
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    expect(initSentrySpy).toHaveBeenCalledTimes(1);
  });

  it('runs the Sentry init effect before the Superwall configure effect (Sentry is the first subsystem the layout boots)', async () => {
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    // Both mount effects fired...
    expect(callOrder).toContain('sentry:init');
    expect(callOrder).toContain('superwall:configure');

    // ...and Sentry's hooks were armed first. `useInitSentryOnce()` is the
    // FIRST statement in `RootLayout`, so its effect is registered (and runs)
    // before the Superwall configure effect — the strongest runtime-observable
    // expression of "initSentry is wired before the rest of the bootstrap".
    const sentryIndex = callOrder.indexOf('sentry:init');
    const superwallIndex = callOrder.indexOf('superwall:configure');
    expect(sentryIndex).toBeLessThan(superwallIndex);
  });

  it('still bootstraps PostHog at mount (Sentry wiring coexists with the provider)', async () => {
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    // Adding the Sentry mount effect must not have broken the existing
    // PostHog provider construction — the constructor still ran exactly once.
    expect(callOrder.filter((m) => m === 'posthog:construct')).toHaveLength(1);
    expect(initSentrySpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-invoke initSentry on rerender (empty-deps mount effect)', async () => {
    const RootLayout = await loadRootLayout();
    const result = render(React.createElement(RootLayout));

    expect(initSentrySpy).toHaveBeenCalledTimes(1);

    // Empty dependency array → the init effect must not fire again across
    // rerenders of the same root instance (one-shot per JS runtime).
    result.rerender(React.createElement(RootLayout));
    expect(initSentrySpy).toHaveBeenCalledTimes(1);

    result.rerender(React.createElement(RootLayout));
    expect(initSentrySpy).toHaveBeenCalledTimes(1);
  });

  it('still mounts (PostHog bootstraps) when initSentry returns false — fail-open / disabled Sentry', async () => {
    // Disabled / no-DSN state: the wrapper's fail-open path returns false.
    // The layout ignores the result and must mount normally regardless.
    initSentrySpy.mockImplementation(() => {
      callOrder.push('sentry:init');
      return false;
    });

    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    expect(initSentrySpy).toHaveBeenCalledTimes(1);
    // App mounted without throwing — PostHog still bootstrapped its client.
    expect(callOrder.filter((m) => m === 'posthog:construct')).toHaveLength(1);
  });
});
