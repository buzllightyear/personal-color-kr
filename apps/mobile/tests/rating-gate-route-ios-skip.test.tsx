/**
 * Route-level test — `rating_gate` iOS **default** variant skip path.
 *
 * Contract pinned here (the iOS counterpart of the Android skip control in
 * `rating-gate-route-android-submit.test.tsx`):
 *   "Skip CTA on both variants navigates to fake-loader WITHOUT calling
 *    requestStoreReview."
 *
 *   When `Platform.OS === 'ios'`, `selectRatingGateVariant()` resolves the
 *   `RatingGateDefaultVariant` (asserted via the `rating-gate-default-screen`
 *   layout testID). Pressing the skip CTA on that variant must:
 *     1. NEVER dispatch the unified {@link requestStoreReview} helper
 *        (dismissable: true — skip is review-free), and
 *     2. still navigate forward to `/(funnel)/fake-loader` via `router.push`
 *        (navigation-never-blocked).
 *
 *   The submit CTA is the positive control in this file: it proves the helper
 *   mock is actually wired (it IS dispatched on submit), so the skip path's
 *   "never called" assertion is meaningful rather than vacuously true.
 *
 * Isolation boundary (Seed constraint):
 *   This is a ROUTE-level test, so it mocks the HELPER module
 *   (`../src/store-review/request-store-review`) — NOT `expo-store-review`
 *   directly. The native-module seam is owned exclusively by the helper's own
 *   unit tests; route tests treat `requestStoreReview` as the abstraction
 *   boundary.
 *
 * Why pin `Platform.OS` to 'ios' via `vi.mock('react-native', ...)`:
 *   `selectRatingGateVariant()` reads `Platform.select` at call time, so the
 *   mock's `select` must return the `ios` slot to exercise the default variant.
 *   Host-component stubs (`View`, `Text`, `Pressable`, `StyleSheet`) are
 *   supplied because the full route → RatingGateContent →
 *   FunnelScreenLayout/FunnelPrimaryButton subtree renders through them.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The `rating-gate.tsx` route file relies on the automatic JSX runtime in the
// Expo/Metro build and therefore does NOT `import React`. Vitest's esbuild
// transform uses the CLASSIC runtime (`React.createElement`), so rendering the
// route's JSX needs `React` resolvable at call time. We expose the single
// pinned React copy on the global scope rather than editing the shared route
// file (owned by sibling tasks).
(globalThis as { React?: typeof React }).React = React;

// ---------------------------------------------------------------------------
// Hoisted spies. `requestStoreReview` is the helper seam; `routerPush` is the
// expo-router navigation spy. Declared via vi.hoisted so the mock factories
// below (themselves hoisted above the SUT import) can close over them.
// ---------------------------------------------------------------------------
const helperSpies = vi.hoisted(() => ({
  requestStoreReview: vi.fn(() =>
    Promise.resolve({
      attempted: true,
      available: true,
      platform: 'ios' as const,
    }),
  ),
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
      OS: 'ios' as const,
      // Pinned to the ios slot — exercises the DEFAULT variant.
      select: <T,>(spec: Spec<T>): T | undefined =>
        spec.ios ?? spec.native ?? spec.default,
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

describe('rating-gate route — iOS default variant skip', () => {
  it('renders the iOS default variant (Platform.OS === "ios")', () => {
    const tree = render(React.createElement(RatingGateRoute));
    // Proof the route resolved the DEFAULT (ios) variant, not the Android
    // secondary — guards against a slot-swap regression.
    expect(findHostByTestId(tree, 'rating-gate-default-screen')).toBeTruthy();
    expect(findHostByTestId(tree, 'rating-gate-secondary-screen')).toBeNull();
  });

  it('skip CTA navigates to fake-loader WITHOUT dispatching requestStoreReview', () => {
    const tree = render(React.createElement(RatingGateRoute));
    const skip = findHostByTestId(tree, 'rating-gate-skip');
    expect(skip).toBeTruthy();

    const onPress = skip?.props.onPress as () => void;
    act(() => onPress());

    // Core AC: the skip path is review-free — the native prompt is never
    // requested on dismissal.
    expect(helperSpies.requestStoreReview).not.toHaveBeenCalled();
    // ...but navigation still advances forward unconditionally.
    expect(routerSpies.push).toHaveBeenCalledTimes(1);
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');
  });

  it('submit CTA IS the positive control: it DOES dispatch requestStoreReview', () => {
    // Proves the helper mock is wired so the skip-path "not called" assertion
    // above is meaningful, not vacuously true.
    const tree = render(React.createElement(RatingGateRoute));
    const submit = findHostByTestId(tree, 'rating-gate-submit');
    expect(submit).toBeTruthy();

    const onPress = submit?.props.onPress as (e: unknown) => void;
    act(() => onPress({}));

    expect(helperSpies.requestStoreReview).toHaveBeenCalledTimes(1);
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');
  });

  it('repeated skip presses never dispatch the helper (idempotent skip)', () => {
    const tree = render(React.createElement(RatingGateRoute));
    const skip = findHostByTestId(tree, 'rating-gate-skip');
    const onPress = skip?.props.onPress as () => void;

    act(() => onPress());
    act(() => onPress());

    expect(helperSpies.requestStoreReview).not.toHaveBeenCalled();
    expect(routerSpies.push).toHaveBeenCalledTimes(2);
  });
});
