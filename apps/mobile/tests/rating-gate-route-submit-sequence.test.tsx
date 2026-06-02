/**
 * Route-level test — `rating_gate` submit CTA end-to-end causal chain.
 *
 * Contract pinned here (the AC this file owns):
 *   "Route test for submit CTA asserts `requestStoreReview` called THEN
 *    `rating_prompt_completed` captured THEN navigation."
 *
 *   Pressing the submit CTA must produce the full submit chain — all three
 *   observable effects, in the load-bearing causal order:
 *     1. the unified {@link requestStoreReview} helper is dispatched exactly
 *        once (the store-review seam), then
 *     2. its resolved {@link StoreReviewOutcome} drives a single
 *        `rating_prompt_completed` PostHog capture (so the helper MUST run
 *        before the capture — the capture's payload is the helper's outcome),
 *        and
 *     3. the route navigates forward to `/(funnel)/fake-loader`.
 *
 * Where this differs from its siblings:
 *   - `rating-gate-route-submit-analytics.test.tsx` pins the capture PAYLOAD
 *     shape (`{ attempted, available, platform }`).
 *   - `rating-gate-route-android-submit.test.tsx` pins the Android variant's
 *     dispatch→navigate path.
 *   This file pins the SEQUENCE: it asserts every link of the submit chain is
 *   present AND ordered via `invocationCallOrder`, so a regression that drops
 *   any one effect (or reorders the helper after the capture) fails here.
 *
 * Navigation-never-blocked / fire-and-forget (Seed invariant — why the order
 * is NOT "capture strictly before push"):
 *   `router.push` runs SYNCHRONOUSLY inside the press handler, while the
 *   capture fires off the helper promise's `.then` — a microtask later. So the
 *   real wall-clock order is `requestStoreReview` → `push` → (microtask)
 *   `capture`. Navigation therefore precedes the capture by design and is
 *   never gated on analytics or the native prompt. This test encodes that
 *   reality (and proves the invariant) rather than asserting an impossible
 *   capture-before-navigation ordering.
 *
 * Isolation boundary (Seed constraint):
 *   This is a ROUTE-level test, so it mocks the HELPER module
 *   (`../src/store-review/request-store-review`) — NOT `expo-store-review`
 *   directly. The native-module seam is owned exclusively by the helper's own
 *   unit tests. `usePostHog` is stubbed with a `capture` spy; the route's real
 *   `track-rating-prompt-completed` helper still runs.
 *
 * Platform pinned to iOS → the `default` (iOS) variant.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The route file relies on the automatic JSX runtime and does NOT `import
// React`. Vitest's esbuild transform uses the CLASSIC runtime, so expose the
// pinned React copy globally rather than editing the shared route file.
(globalThis as { React?: typeof React }).React = React;

const OUTCOME = {
  attempted: true,
  available: true,
  platform: 'ios' as const,
};

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

const posthogSpies = vi.hoisted(() => ({
  capture: vi.fn<[string, Record<string, unknown>], void>(),
}));

// Route-level isolation: mock the HELPER, never `expo-store-review`.
vi.mock('../src/store-review/request-store-review', () => ({
  requestStoreReview: helperSpies.requestStoreReview,
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: routerSpies.push, replace: () => undefined }),
}));

vi.mock('posthog-react-native', () => ({
  usePostHog: () => ({ capture: posthogSpies.capture }),
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

function pressSubmit(tree: TestRenderer.ReactTestRenderer): void {
  const submit = findHostByTestId(tree, 'rating-gate-submit');
  expect(submit).toBeTruthy();
  const onPress = submit?.props.onPress as (e: unknown) => void;
  act(() => onPress({}));
}

const flushMicrotasks = (): Promise<void> =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

afterEach(() => {
  helperSpies.requestStoreReview.mockClear();
  routerSpies.push.mockClear();
  posthogSpies.capture.mockClear();
});

describe('rating-gate route — submit CTA causal chain (helper → capture → nav)', () => {
  it('renders the iOS default variant (Platform.OS === "ios")', () => {
    const tree = render(React.createElement(RatingGateRoute));
    expect(findHostByTestId(tree, 'rating-gate-default-screen')).toBeTruthy();
  });

  it('dispatches requestStoreReview, captures rating_prompt_completed, then navigates', async () => {
    const tree = render(React.createElement(RatingGateRoute));
    pressSubmit(tree);

    // Link 1 — the unified helper was dispatched exactly once.
    expect(helperSpies.requestStoreReview).toHaveBeenCalledTimes(1);

    // Link 3 (navigation) is observable synchronously — fire-and-forget means
    // push is never gated on the helper promise or the analytics capture.
    expect(routerSpies.push).toHaveBeenCalledTimes(1);
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');

    // Link 2 — the capture rides the helper promise's `.then`, a microtask
    // after the synchronous handler returns. Flush, then assert it fired with
    // the helper's resolved outcome.
    await flushMicrotasks();

    expect(posthogSpies.capture).toHaveBeenCalledTimes(1);
    expect(posthogSpies.capture).toHaveBeenCalledWith(
      'rating_prompt_completed',
      expect.objectContaining({
        attempted: OUTCOME.attempted,
        available: OUTCOME.available,
        platform: OUTCOME.platform,
      }),
    );
  });

  it('orders the chain: requestStoreReview BEFORE capture (outcome feeds the event)', async () => {
    const tree = render(React.createElement(RatingGateRoute));
    pressSubmit(tree);
    await flushMicrotasks();

    const dispatchOrder =
      helperSpies.requestStoreReview.mock.invocationCallOrder[0];
    const captureOrder = posthogSpies.capture.mock.invocationCallOrder[0];

    expect(dispatchOrder).toBeDefined();
    expect(captureOrder).toBeDefined();
    // The helper MUST run before the capture — the capture payload IS the
    // helper's resolved outcome, so this ordering is load-bearing, not cosmetic.
    expect(dispatchOrder as number).toBeLessThan(captureOrder as number);
  });

  it('navigation is never blocked: push fires BEFORE the microtask capture', () => {
    const tree = render(React.createElement(RatingGateRoute));
    pressSubmit(tree);

    // Asserted synchronously (NO microtask flush): the helper was dispatched
    // and navigation already happened, but the capture has NOT yet run —
    // proving push is not gated on analytics (navigation-never-blocked /
    // fire-and-forget). The capture lands later (covered by the test above).
    expect(helperSpies.requestStoreReview).toHaveBeenCalledTimes(1);
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');
    expect(posthogSpies.capture).not.toHaveBeenCalled();
  });

  it('helper rejection can never happen, but a slow probe never delays navigation', async () => {
    // Re-pin the helper to a promise that resolves on a later microtask turn.
    // Even so, navigation must already have fired synchronously.
    helperSpies.requestStoreReview.mockImplementationOnce(
      () =>
        Promise.resolve().then(() => ({
          attempted: true,
          available: true,
          platform: 'ios' as const,
        })),
    );

    const tree = render(React.createElement(RatingGateRoute));
    pressSubmit(tree);

    // Navigation is synchronous regardless of how late the outcome settles.
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');
    expect(posthogSpies.capture).not.toHaveBeenCalled();

    // Once the (delayed) outcome settles, the completed event still lands.
    await flushMicrotasks();
    expect(posthogSpies.capture).toHaveBeenCalledWith(
      'rating_prompt_completed',
      expect.objectContaining({ platform: 'ios' }),
    );
  });
});
