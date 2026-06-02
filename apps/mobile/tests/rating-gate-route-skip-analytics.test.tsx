/**
 * Route-level test — `rating_gate` skip CTA analytics contract.
 *
 * Contract pinned here (the AC this file owns):
 *   "PostHog event `rating_prompt_skipped` fires on skip with payload
 *    `{ platform }`."
 *
 *   Pressing the skip CTA on the rating-gate route must:
 *     1. fire exactly one `rating_prompt_skipped` PostHog capture whose payload
 *        is the narrowed `{ platform }` (here `'ios'`, since Platform.OS is
 *        pinned to `'ios'` → the default variant);
 *     2. NEVER dispatch the unified `requestStoreReview` helper (the skip path
 *        is review-free — navigation-never-blocked / dismissable: true); and
 *     3. still navigate forward to `/(funnel)/fake-loader`.
 *
 * Isolation boundary (Seed constraint):
 *   This is a ROUTE-level test, so it mocks the HELPER module
 *   (`../src/store-review/request-store-review`) — NOT `expo-store-review`
 *   directly — to assert the skip path never touches the native seam. The
 *   analytics assertion goes through the REAL `track-rating-prompt-skipped`
 *   helper (only the `usePostHog()` client is stubbed with a `capture` spy), so
 *   this test exercises the genuine event-name constant + payload shape rather
 *   than a mocked track function.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RATING_PROMPT_SKIPPED_EVENT_NAME } from '../src/analytics/track-rating-prompt-skipped';

// The route file relies on the automatic JSX runtime and does NOT `import
// React`. Vitest's esbuild transform uses the CLASSIC runtime, so rendering the
// route's JSX needs `React` resolvable at call time.
(globalThis as { React?: typeof React }).React = React;

// ---------------------------------------------------------------------------
// Hoisted spies: the helper seam (must NOT be called on skip), the PostHog
// capture spy, and the expo-router navigation spy.
// ---------------------------------------------------------------------------
const helperSpies = vi.hoisted(() => ({
  requestStoreReview: vi.fn(() =>
    Promise.resolve({ attempted: true, available: true, platform: 'ios' as const }),
  ),
}));

const posthogSpies = vi.hoisted(() => ({
  capture: vi.fn<[string, Record<string, unknown>], void>(),
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

// Stub only the client resolver — the real track helper still runs.
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
      // Pinned to iOS → default variant → narrowed payload platform === 'ios'.
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

function pressSkip(tree: TestRenderer.ReactTestRenderer): void {
  const skip = findHostByTestId(tree, 'rating-gate-skip');
  expect(skip).toBeTruthy();
  const onPress = skip?.props.onPress as () => void;
  act(() => onPress());
}

afterEach(() => {
  helperSpies.requestStoreReview.mockClear();
  posthogSpies.capture.mockClear();
  routerSpies.push.mockClear();
});

describe('rating-gate route — skip CTA analytics (rating_prompt_skipped)', () => {
  it('fires rating_prompt_skipped exactly once with payload { platform }', () => {
    const tree = render(React.createElement(RatingGateRoute));
    pressSkip(tree);

    expect(posthogSpies.capture).toHaveBeenCalledTimes(1);
    expect(posthogSpies.capture).toHaveBeenCalledWith(
      RATING_PROMPT_SKIPPED_EVENT_NAME,
      { platform: 'ios' },
    );
    // Pin the literal too, guarding the snake_case event-name contract.
    expect(posthogSpies.capture).toHaveBeenCalledWith('rating_prompt_skipped', {
      platform: 'ios',
    });
  });

  it('payload carries ONLY platform (no attempted / available leakage)', () => {
    const tree = render(React.createElement(RatingGateRoute));
    pressSkip(tree);

    const payload = posthogSpies.capture.mock.calls[0]?.[1];
    expect(payload).toEqual({ platform: 'ios' });
    expect(Object.keys(payload as object).sort()).toEqual(['platform']);
  });

  it('skip never dispatches requestStoreReview but still navigates forward', () => {
    const tree = render(React.createElement(RatingGateRoute));
    pressSkip(tree);

    // Negative control: skip is review-free (navigation-never-blocked).
    expect(helperSpies.requestStoreReview).not.toHaveBeenCalled();
    expect(routerSpies.push).toHaveBeenCalledTimes(1);
    expect(routerSpies.push).toHaveBeenCalledWith('/(funnel)/fake-loader');
  });

  it('fires the skip event BEFORE navigating (capture then push)', () => {
    const tree = render(React.createElement(RatingGateRoute));
    pressSkip(tree);

    const captureOrder = posthogSpies.capture.mock.invocationCallOrder[0];
    const navOrder = routerSpies.push.mock.invocationCallOrder[0];
    expect(captureOrder).toBeDefined();
    expect(navOrder).toBeDefined();
    expect(captureOrder as number).toBeLessThan(navOrder as number);
  });
});
