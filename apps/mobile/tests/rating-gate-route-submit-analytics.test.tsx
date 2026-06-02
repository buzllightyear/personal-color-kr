/**
 * Route-level test — `rating_gate` submit CTA PostHog analytics.
 *
 * Contract pinned here (my AC):
 *   "PostHog event `rating_prompt_completed` fires on submit with payload
 *    `{ attempted, available, platform }`."
 *
 *   Pressing the submit CTA must:
 *     1. invoke the unified {@link requestStoreReview} helper (the store-review
 *        seam), then
 *     2. forward its resolved {@link StoreReviewOutcome} verbatim to
 *        `posthog.capture('rating_prompt_completed', { attempted, available,
 *        platform })`, and
 *     3. navigate to `/(funnel)/fake-loader` SYNCHRONOUSLY — the analytics
 *        capture (which fires off the helper promise's `.then`, a microtask
 *        later) must NEVER gate navigation.
 *
 * Isolation boundary (Seed constraint):
 *   This is a ROUTE-level test, so it mocks the HELPER module
 *   (`../src/store-review/request-store-review`) — NOT `expo-store-review`
 *   directly — and mocks `posthog-react-native`'s `usePostHog` to inject a stub
 *   client whose `capture` spy is asserted. The native-module seam is owned
 *   exclusively by the helper's own unit tests.
 *
 * Platform pinned to iOS so this exercises the `default` (iOS) variant — the
 * counterpart of `rating-gate-route-android-submit.test.tsx`.
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
  capture: vi.fn(),
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

describe('rating-gate route — submit CTA fires rating_prompt_completed', () => {
  it('renders the iOS default variant (Platform.OS === "ios")', () => {
    const tree = render(React.createElement(RatingGateRoute));
    expect(findHostByTestId(tree, 'rating-gate-default-screen')).toBeTruthy();
  });

  it('captures rating_prompt_completed with {attempted, available, platform} after submit', async () => {
    const tree = render(React.createElement(RatingGateRoute));
    const submit = findHostByTestId(tree, 'rating-gate-submit');
    expect(submit).toBeTruthy();

    const onPress = submit?.props.onPress as (e: unknown) => void;
    act(() => onPress({}));

    // 1. Helper dispatched, navigation fired SYNCHRONOUSLY (not gated on the
    //    helper's promise or the analytics capture).
    expect(helperSpies.requestStoreReview).toHaveBeenCalledTimes(1);
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');

    // 2. The capture fires off the helper promise's `.then` — a microtask
    //    after the synchronous handler returns. Flush the queue, then assert.
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

  it('does NOT capture before the helper promise settles (navigation never blocked)', () => {
    const tree = render(React.createElement(RatingGateRoute));
    const submit = findHostByTestId(tree, 'rating-gate-submit');
    const onPress = submit?.props.onPress as (e: unknown) => void;

    act(() => onPress({}));

    // Asserted synchronously (no microtask flush): navigation already happened
    // but the capture has not — proving push is not gated on analytics.
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');
    expect(posthogSpies.capture).not.toHaveBeenCalled();
  });

  it('skip CTA does NOT fire rating_prompt_completed', async () => {
    const tree = render(React.createElement(RatingGateRoute));
    const skip = findHostByTestId(tree, 'rating-gate-skip');
    expect(skip).toBeTruthy();

    const onPress = skip?.props.onPress as () => void;
    act(() => onPress());
    await flushMicrotasks();

    // Negative control: the completed event is submit-exclusive.
    expect(helperSpies.requestStoreReview).not.toHaveBeenCalled();
    expect(posthogSpies.capture).not.toHaveBeenCalledWith(
      'rating_prompt_completed',
      expect.anything(),
    );
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');
  });
});
