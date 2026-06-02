/**
 * Unit test — `result_reveal` CTA navigation handler contract
 * (Phase 2.4 Sub-AC 11.3).
 *
 * Sub-AC 11.3 contract:
 *   Pressing the "친구와 공유하고 잠금 해제" CTA on `result_reveal` MUST invoke
 *   `router.push` exactly once with the literal route string
 *   `'/(funnel)/referral-gate'`. The push is a forward navigation (not a
 *   replace) per the Seed constraint:
 *
 *     "router.push used at: result_reveal CTA → referral_gate"
 *
 *   This pin matters because:
 *     - `router.replace` would erase `result_reveal` from the history stack
 *       and prevent the user from backing out to the locked teaser — a
 *       regression away from the Phase 2.4 navigation contract.
 *     - The route literal must be the absolute group-qualified path
 *       `/(funnel)/referral-gate` (not `referral-gate` or `/referral-gate`)
 *       so expo-router resolves the destination inside the `(funnel)` route
 *       group — same convention used by every Phase 2.3 funnel CTA.
 *
 * Why a dedicated test file (not appended to `result-reveal-route.test.tsx`):
 *   - Mirrors the Sub-AC 11.2 sibling pattern
 *     (`result-reveal-screen-cta-visibility.test.tsx`): each Phase 2.4
 *     sub-AC that extends the result_reveal test surface lives in its own
 *     file to avoid edit-conflict churn with parallel Phase 2.4 work.
 *   - Scopes the assertion surface to the *navigation handler contract*
 *     only — no rendering branches, no preview-mode, no premium-branch
 *     concerns. A future regression in router.push wiring fails this file
 *     first and points directly at the Sub-AC 11.3 contract.
 *
 * Boundary chosen — the route file (`app/(funnel)/result-reveal.tsx`), not
 * the presentational screen component:
 *   - The route wrapper is where `onUnlock` is bound to
 *     `() => router.push('/(funnel)/referral-gate')` — this is the layer
 *     the navigation contract lives at. Testing the screen in isolation
 *     would only assert that `onUnlock` is invoked, not that it routes to
 *     the correct destination.
 *   - Same mocking conventions as `result-reveal-route.test.tsx`:
 *     `react-native` primitives stubbed to lowercase host elements,
 *     `expo-router` mocked to capture `push` invocations, the route is
 *     mounted under a `<FunnelStateProvider>` so `useFunnelState()` does
 *     not throw the fail-loud `FunnelStateProviderMissingError`.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');
  const makeHost =
    (label: string) =>
    (props: Record<string, unknown> & { children?: React.ReactNode }) =>
      reactActual.createElement(label, props, props?.children);
  return {
    View: makeHost('View'),
    Text: makeHost('Text'),
    Pressable: makeHost('Pressable'),
    ScrollView: makeHost('ScrollView'),
    StyleSheet: {
      create: (s: Record<string, unknown>): Record<string, unknown> => s,
      flatten: (s: unknown): unknown => s,
    },
    Platform: {
      OS: 'ios',
      select: (m: { ios?: unknown; default?: unknown }) => m.ios ?? m.default,
    },
    BackHandler: {
      // Phase 2.4 AC 13 wires a BackHandler subscription on the route file
      // when payment.isPremium === true. This test exercises the
      // non-premium branch (where the share-to-unlock CTA is rendered), so
      // the BackHandler is never registered — but the route file imports
      // it unconditionally, so the mock must expose the API surface.
      addEventListener: (): { remove: () => void } => ({
        remove: (): void => undefined,
      }),
    },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('SafeAreaView', props, props.children),
}));

// Capture `router.push` invocations. Reset per-test via `mockPush.mockClear()`
// so each assertion observes only its own press.
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockSearchParams: { current: Record<string, unknown> } = { current: {} };

vi.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    dismissAll: vi.fn(),
  }),
  useLocalSearchParams: () => mockSearchParams.current,
  // `useFocusEffect` runs the supplied callback synchronously at mount in
  // this mock so the BackHandler subscription path in AC 13 is exercised
  // alongside Sub-AC 11.3 (the cleanup return is invoked at unmount via
  // React's effect lifecycle).
  useFocusEffect: (cb: () => (() => void) | undefined): void => {
    React.useEffect(() => {
      const cleanup = cb();
      return cleanup;
    }, [cb]);
  },
}));

import ResultRevealRoute from '../app/(funnel)/result-reveal';
import { FunnelStateProvider } from '../src/providers/FunnelStateProvider';

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

/**
 * Mount the route under a `<FunnelStateProvider>` with `payment.isPremium`
 * defaulted to `false` so the share-to-unlock CTA is rendered. The Sub-AC
 * 11.3 contract is about *what happens when the CTA is pressed*; the CTA
 * must be present for the press to be observable.
 *
 * `share_token` is also left absent (mockSearchParams cleared) so the
 * preview branch does not hide the CTA. Sub-AC 11.2 covers both
 * hidden branches separately.
 */
function renderRouteWithUnlockCtaVisible(): TestRenderer.ReactTestRenderer {
  return render(
    React.createElement(
      FunnelStateProvider,
      {
        initialPayment: {
          selectedMethod: null,
          isProcessing: false,
          isPremium: false,
        },
      },
      React.createElement(ResultRevealRoute),
    ),
  );
}

// Pin the route literal expected by Sub-AC 11.3 here (instead of importing
// it from the route file) so the assertion is authoritative about the
// navigation contract — a future rename of the destination path must still
// satisfy this test.
const REFERRAL_GATE_ROUTE = '/(funnel)/referral-gate';
const UNLOCK_CTA_TEST_ID = 'result-reveal-unlock-cta';

describe('result_reveal CTA navigation handler — Sub-AC 11.3', () => {
  it('invokes router.push with /(funnel)/referral-gate when the share-to-unlock CTA is pressed', () => {
    // Arrange: clear router state and route params so the CTA is rendered
    // and any prior test's `push` calls are not counted here.
    mockSearchParams.current = {};
    mockPush.mockClear();
    mockReplace.mockClear();

    const tree = renderRouteWithUnlockCtaVisible();

    // Pre-condition: the CTA must be rendered. Sub-AC 11.1 / 11.2 cover the
    // visibility truth-table separately; here we simply assert the CTA is
    // present so the press exercise is meaningful.
    const cta = findHostByTestId(tree, UNLOCK_CTA_TEST_ID);
    expect(
      cta,
      'share-to-unlock CTA must be rendered to exercise Sub-AC 11.3',
    ).toBeTruthy();

    // Act: simulate the press via the Pressable's `onPress` prop. The
    // FunnelPrimaryButton wires its own `onPress` to call the
    // route-supplied `onUnlock` callback, which in turn invokes
    // `router.push('/(funnel)/referral-gate')`.
    const onPress = cta?.props.onPress as (e: unknown) => void;
    expect(typeof onPress).toBe('function');
    act(() => onPress({}));

    // Assert: router.push fired exactly once with the absolute,
    // group-qualified referral_gate route. The literal-string match is
    // intentional — Sub-AC 11.3 pins the exact destination path so that a
    // refactor to `'/referral-gate'` or `'referral-gate'` (which expo-router
    // would resolve differently or fail) fails this test loudly.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(REFERRAL_GATE_ROUTE);
  });

  it('uses router.push (forward navigation) — NOT router.replace — so result_reveal stays on the history stack', () => {
    // The Phase 2.4 Seed navigation contract pins this transition as a
    // *push*, not a replace:
    //
    //   "router.push used at: result_reveal CTA → referral_gate"
    //
    // A regression that swapped `push` for `replace` would erase the
    // result_reveal teaser from the back-stack, breaking the user's ability
    // to return to the locked teaser without re-running the diagnosis. This
    // test isolates that specific contract.
    mockSearchParams.current = {};
    mockPush.mockClear();
    mockReplace.mockClear();

    const tree = renderRouteWithUnlockCtaVisible();
    const cta = findHostByTestId(tree, UNLOCK_CTA_TEST_ID);
    expect(cta).toBeTruthy();
    const onPress = cta?.props.onPress as (e: unknown) => void;
    act(() => onPress({}));

    expect(mockPush).toHaveBeenCalledTimes(1);
    // Defence-in-depth: explicitly assert `replace` was NOT called. If a
    // future refactor accidentally routes through `router.replace`, the
    // push assertion would still pass when the implementation calls both,
    // but this assertion would catch it.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not invoke router.push when the CTA is not pressed (no side-effect at mount)', () => {
    // Defensive baseline: mounting the route must not by itself navigate
    // away from result_reveal. Without this, a regression that fires
    // `onUnlock` from inside a `useEffect` at mount would slip past the
    // press-exercise assertion above (the navigation would already have
    // happened before the test pressed anything).
    mockSearchParams.current = {};
    mockPush.mockClear();

    renderRouteWithUnlockCtaVisible();

    expect(mockPush).not.toHaveBeenCalled();
  });
});
