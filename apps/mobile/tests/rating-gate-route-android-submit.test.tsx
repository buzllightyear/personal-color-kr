/**
 * Route-level test — `rating_gate` Android **secondary** variant submit path.
 *
 * Contract pinned here (the Android counterpart of the iOS submit AC):
 *   "RatingGateSecondaryVariant (Android) onSubmit calls requestStoreReview
 *    then navigates to fake-loader."
 *
 *   When `Platform.OS === 'android'`, `selectRatingGateVariant()` resolves the
 *   `RatingGateSecondaryVariant` (asserted via the `rating-gate-secondary-screen`
 *   layout testID). Pressing the submit CTA on that variant must:
 *     1. invoke the unified {@link requestStoreReview} helper exactly once, then
 *     2. navigate forward to `/(funnel)/fake-loader` via `router.push`.
 *
 *   The skip CTA is the negative control: it navigates WITHOUT ever dispatching
 *   `requestStoreReview` (dismissable: true, navigation-never-blocked).
 *
 * Isolation boundary (Seed constraint):
 *   This is a ROUTE-level test, so it mocks the HELPER module
 *   (`../src/store-review/request-store-review`) — NOT `expo-store-review`
 *   directly. The native-module seam is owned exclusively by the helper's own
 *   unit tests; route tests treat `requestStoreReview` as the abstraction
 *   boundary and assert only that the route calls it and then navigates.
 *
 * Why pin `Platform.OS` to 'android' via `vi.mock('react-native', ...)`:
 *   The route's `selectRatingGateVariant()` reads `Platform.select` at call
 *   time, so the mock's `select` must return the `android` slot to exercise
 *   the secondary variant. Host-component stubs (`View`, `Text`, `Pressable`,
 *   `StyleSheet`) are supplied because the full route → RatingGateContent →
 *   FunnelScreenLayout/FunnelPrimaryButton subtree renders through them.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The `rating-gate.tsx` route file relies on the automatic JSX runtime in the
// Expo/Metro build and therefore does NOT `import React`. Vitest's esbuild
// transform uses the CLASSIC runtime (`React.createElement`), so rendering the
// route's JSX needs `React` resolvable at call time. Existing route tests only
// compare variant references (never execute the route's JSX), so they never hit
// this; this is the first test that actually renders the route. We expose the
// single pinned React copy on the global scope rather than editing the shared
// route file (owned by sibling tasks).
(globalThis as { React?: typeof React }).React = React;

// ---------------------------------------------------------------------------
// Hoisted spies. `requestStoreReview` is the helper seam; `routerPush` is the
// expo-router navigation spy. Declared via vi.hoisted so the mock factories
// below (themselves hoisted above the SUT import) can close over them.
// ---------------------------------------------------------------------------
const helperSpies = vi.hoisted(() => ({
  requestStoreReview: vi.fn(() => Promise.resolve({
    attempted: true,
    available: true,
    platform: 'android' as const,
  })),
}));

const routerSpies = vi.hoisted(() => ({
  push: vi.fn<[string], void>(),
}));

// Route-level isolation: mock the HELPER, never `expo-store-review`.
vi.mock('../src/store-review/request-store-review', () => ({
  requestStoreReview: helperSpies.requestStoreReview,
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: routerSpies.push, replace: () => undefined }),
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('SafeAreaView', props, props.children),
}));

vi.mock('react-native', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');
  const makeHost =
    (label: string) =>
    (props: Record<string, unknown> & { children?: React.ReactNode }) =>
      reactActual.createElement(label, props, props?.children);
  type Spec<T> = { ios?: T; android?: T; native?: T; default?: T };
  return {
    View: makeHost('View'),
    Text: makeHost('Text'),
    Pressable: makeHost('Pressable'),
    StyleSheet: {
      create: (s: Record<string, unknown>): Record<string, unknown> => s,
      flatten: (s: unknown): unknown => s,
    },
    Platform: {
      OS: 'android' as const,
      // Pinned to the android slot — never falls through to `ios`, so this
      // test proves the secondary variant is reachable independently.
      select: <T,>(spec: Spec<T>): T | undefined =>
        spec.android ?? spec.native ?? spec.default,
    },
  };
});

// SUT imported AFTER the mocks (vitest hoists the vi.mock calls above this).
import RatingGateRoute from '../app/(funnel)/rating-gate';

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

function findHostByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance | null {
  const matches = tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props?.testID === testID,
  );
  return (matches[0] as unknown as TestInstance) ?? null;
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

afterEach(() => {
  helperSpies.requestStoreReview.mockClear();
  routerSpies.push.mockClear();
});

describe('rating-gate route — Android secondary variant submit', () => {
  it('renders the Android secondary variant (Platform.OS === "android")', () => {
    const tree = render(React.createElement(RatingGateRoute));
    // Proof the route resolved the SECONDARY (android) variant, not the iOS
    // default — guards against a slot-swap regression in selectRatingGateVariant.
    expect(findHostByTestId(tree, 'rating-gate-secondary-screen')).toBeTruthy();
    expect(findHostByTestId(tree, 'rating-gate-default-screen')).toBeNull();
  });

  it('onSubmit calls requestStoreReview then navigates to fake-loader', () => {
    const tree = render(React.createElement(RatingGateRoute));
    const submit = findHostByTestId(tree, 'rating-gate-submit');
    expect(submit).toBeTruthy();

    const onPress = submit?.props.onPress as (e: unknown) => void;
    act(() => onPress({}));

    // 1. The unified helper was dispatched exactly once.
    expect(helperSpies.requestStoreReview).toHaveBeenCalledTimes(1);
    // 2. Navigation to fake-loader fired.
    expect(routerSpies.push).toHaveBeenCalledTimes(1);
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');

    // Ordering: requestStoreReview is dispatched BEFORE navigation ("calls
    // requestStoreReview then navigates"). invocationCallOrder is a strictly
    // increasing global counter across all vitest spies.
    const dispatchOrder =
      helperSpies.requestStoreReview.mock.invocationCallOrder[0];
    const navOrder = routerSpies.push.mock.invocationCallOrder[0];
    expect(dispatchOrder).toBeDefined();
    expect(navOrder).toBeDefined();
    expect(dispatchOrder as number).toBeLessThan(navOrder as number);
  });

  it('navigation is never blocked: push fires even though the helper is async', () => {
    // The helper returns a pending-then-resolved promise; the route must NOT
    // await it. Navigation happens synchronously within the press handler.
    const tree = render(React.createElement(RatingGateRoute));
    const submit = findHostByTestId(tree, 'rating-gate-submit');
    const onPress = submit?.props.onPress as (e: unknown) => void;

    act(() => onPress({}));

    // Asserted synchronously (no `await`) — proves the push was not gated on
    // the helper's promise settling.
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');
  });

  it('skip CTA navigates WITHOUT dispatching requestStoreReview', () => {
    const tree = render(React.createElement(RatingGateRoute));
    const skip = findHostByTestId(tree, 'rating-gate-skip');
    expect(skip).toBeTruthy();

    const onPress = skip?.props.onPress as () => void;
    act(() => onPress());

    // Negative control: skip is review-free but still advances forward.
    expect(helperSpies.requestStoreReview).not.toHaveBeenCalled();
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');
  });
});
