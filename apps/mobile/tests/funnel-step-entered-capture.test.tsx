/**
 * funnel_step_entered auto-capture — AC 10.
 *
 * Pins the contract that the root `<RootLayoutInner>` fires a
 * `posthog.capture('funnel_step_entered', { step_kebab })` event whenever
 * the active pathname's terminal segment is one of the 12 funnel kebab
 * slugs — exactly once per pathname change, never for non-funnel routes.
 *
 * The test mocks `expo-router`'s `usePathname` and `posthog-react-native`
 * so we can swap pathnames between renders without spinning up the Expo
 * Router stack. The mocked `Stack` is a Fragment-passthrough so the
 * `useEffect` for `usePathname` + `usePostHog` runs identically to
 * production.
 */
import * as React from 'react';
import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-scope recorders + mutable mock state
// ---------------------------------------------------------------------------
const captureFn = vi.fn();
let mockPathname = '/';
let mockExpoConfig: { extra?: unknown } | null = null;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('posthog-react-native', async () => {
  const reactActual: any = await vi.importActual('react');
  const MockContext = reactActual.createContext(undefined);

  function MockPostHogProvider(props: any) {
    return reactActual.createElement(
      MockContext.Provider,
      { value: props.client },
      props.children,
    );
  }
  function mockUsePostHog() {
    return reactActual.useContext(MockContext);
  }
  // The provider in src/providers/PostHogProvider.tsx will call `new PostHog(...)`
  // and pass the resulting client to the SDK's PostHogProvider. We return a
  // stub object whose `.capture` is the spy under assertion.
  function MockPostHog() {
    return { capture: captureFn };
  }

  return {
    PostHog: MockPostHog,
    PostHogProvider: MockPostHogProvider,
    usePostHog: mockUsePostHog,
  };
});

vi.mock('expo-router', async () => {
  const reactActual: any = await vi.importActual('react');

  function StackSpy(props: any) {
    return reactActual.createElement(reactActual.Fragment, null, props.children);
  }
  (StackSpy as any).Screen = function MockScreen() {
    return null;
  };
  function MockRedirect() {
    return null;
  }
  function mockUsePathname() {
    return mockPathname;
  }

  return {
    Stack: StackSpy,
    Redirect: MockRedirect,
    usePathname: mockUsePathname,
  };
});

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));

// Mock the Superwall wrapper module so the layout's `configureSuperwall`
// import does NOT pull in `@superwall/react-native-superwall` (which fails
// in the vitest environment because the SDK reads its own package.json).
vi.mock('../src/superwall/client', () => ({
  configureSuperwall: vi.fn().mockResolvedValue(undefined),
  triggerPaywall: vi.fn().mockResolvedValue({ outcome: 'declined' }),
}));

// `app/_layout.tsx` calls `initSentry()` (from `../src/sentry`) as the first
// line of its mount effect. That wrapper transitively imports the native
// `@sentry/react-native` package, which vitest's node runtime cannot resolve.
// Mock the wrapper to keep the native shim out of the test graph — the same
// native-isolation seam already applied to `../src/superwall/client`. Sentry is
// orthogonal to the funnel_step_entered capture under test.
vi.mock('../src/sentry', () => ({
  initSentry: vi.fn().mockReturnValue(true),
  setSentryUser: vi.fn(),
  clearSentryUser: vi.fn(),
}));

async function loadRootLayout() {
  const mod: any = await import('../app/_layout');
  return mod.default;
}

describe('funnel_step_entered auto-capture — AC 10', () => {
  beforeEach(() => {
    vi.resetModules();
    captureFn.mockReset();
    // Provide a populated extra block so the provider takes the happy path
    // and the constructor returns our `{ capture: captureFn }` stub.
    mockExpoConfig = {
      extra: {
        posthogApiKey: 'phc_test_funnel_capture',
        posthogHost: 'https://us.i.posthog.com',
      },
    };
  });

  it('fires capture("funnel_step_entered", { step_kebab }) when pathname is a kebab funnel route', async () => {
    mockPathname = '/welcome-hook';
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith('funnel_step_entered', {
      step_kebab: 'welcome-hook',
    });
  });

  it('also recognises kebab funnel routes nested under the (funnel) route group', async () => {
    mockPathname = '/(funnel)/fake-loader';
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith('funnel_step_entered', {
      step_kebab: 'fake-loader',
    });
  });

  it('does NOT fire capture for non-funnel pathnames', async () => {
    mockPathname = '/magazine/2026-05';
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    expect(captureFn).toHaveBeenCalledTimes(0);
  });

  it('does NOT fire capture when the pathname is the root index', async () => {
    mockPathname = '/';
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    expect(captureFn).toHaveBeenCalledTimes(0);
  });

  it('does NOT fire capture when PostHog client is degraded (api key missing)', async () => {
    // Onboarding-degradation path: no posthogApiKey → provider degrades to a
    // children-only fragment and `usePostHog()` returns undefined. The auto-
    // capture must no-op in this branch.
    mockExpoConfig = { extra: { posthogHost: 'https://us.i.posthog.com' } };
    mockPathname = '/value-props';
    const RootLayout = await loadRootLayout();
    render(React.createElement(RootLayout));

    expect(captureFn).toHaveBeenCalledTimes(0);
  });
});
