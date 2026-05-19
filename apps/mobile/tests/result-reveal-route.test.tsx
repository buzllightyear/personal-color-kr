/**
 * Smoke test — `app/(funnel)/result-reveal.tsx` route wrapper.
 *
 * Verifies the thin expo-router route file:
 *   1. Mounts the presentational `ResultRevealScreen` underneath it.
 *   2. Derives `isPreviewMode` from the `share_token` route param —
 *      `share_token` present → preview mode true → no unlock CTA.
 *      `share_token` absent → preview mode false → unlock CTA visible
 *      and `router.push('/(funnel)/referral-gate')` fires on tap.
 *   3. Phase 2.4 (Sub-AC 11.1 wiring): the route reads `payment.isPremium`
 *      from the surrounding `<FunnelStateProvider>` and forwards it to the
 *      screen — when `isPremium === true` the share-to-unlock CTA is
 *      omitted just like the preview branch.
 *
 * The screen component itself is covered exhaustively by
 * `result-reveal-screen.test.tsx`; this file pins the *wiring* contract
 * (route → screen → router.push) and the Phase 2.1 isPreviewMode invariant
 * preserved by the Phase 2.3 route file rewrite.
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
    // Phase 2.4 AC 13: the route file imports `BackHandler` from
    // `react-native` to register a hardware-back interception on the
    // premium branch. This existing wiring test doesn't exercise that
    // path (a dedicated test file covers it), so the stub returns a
    // subscription whose `.remove()` is a no-op — enough to satisfy
    // module load.
    BackHandler: {
      addEventListener: (): { remove: () => void } => ({ remove: () => undefined }),
    },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('SafeAreaView', props, props.children),
}));

const mockPush = vi.fn();
const mockSearchParams: { current: Record<string, unknown> } = { current: {} };

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), dismissAll: vi.fn() }),
  useLocalSearchParams: () => mockSearchParams.current,
  // Phase 2.4 AC 13: the route uses `useFocusEffect` to scope the
  // BackHandler subscription to the focused lifecycle. For the existing
  // wiring tests we model it as `useEffect` so the callback runs once on
  // mount and its cleanup runs on unmount — preserving observable
  // behaviour without needing a real navigation context. The dedicated
  // AC 13 test file overrides this with a callback-capturing mock.
  useFocusEffect: (cb: () => undefined | (() => void)) => {
    React.useEffect(() => cb(), [cb]);
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
    (node) =>
      typeof node.type === 'string' && node.props?.testID === testID,
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
 * Render the route under a `<FunnelStateProvider>` (matches production
 * wiring: `app/(funnel)/_layout.tsx` always wraps every funnel screen).
 * The Phase 2.4 route reads `payment.isPremium` via `useFunnelState()` so
 * a provider must be present — invoking the route without one would throw
 * the fail-loud `FunnelStateProviderMissingError`.
 *
 * `initialIsPremium` seeds the payment slice so tests can pin both the
 * default (`isPremium: false` — share-to-unlock CTA visible) and the
 * premium branch (`isPremium: true` — CTA hidden) without simulating the
 * full payment_model placeholder flow.
 */
function renderRoute(
  initialIsPremium: boolean,
): TestRenderer.ReactTestRenderer {
  return render(
    React.createElement(
      FunnelStateProvider,
      {
        initialPayment: {
          selectedMethod: null,
          isProcessing: false,
          isPremium: initialIsPremium,
        },
      },
      React.createElement(ResultRevealRoute),
    ),
  );
}

describe('result-reveal route wrapper', () => {
  it('mounts ResultRevealScreen with isPreviewMode=false when no share_token param', () => {
    mockSearchParams.current = {};
    mockPush.mockClear();
    const tree = renderRoute(false);
    // CTA is rendered (not preview mode, not premium)
    expect(findHostByTestId(tree, 'result-reveal-unlock-cta')).toBeTruthy();
  });

  it('mounts ResultRevealScreen with isPreviewMode=true when share_token param present', () => {
    mockSearchParams.current = { share_token: 'abc-123' };
    mockPush.mockClear();
    const tree = renderRoute(false);
    // CTA must NOT be rendered in preview mode (Phase 2.1 isPreviewMode invariant)
    expect(findHostByTestId(tree, 'result-reveal-unlock-cta')).toBeNull();
  });

  it('navigates to /(funnel)/referral-gate when unlock CTA is pressed', () => {
    mockSearchParams.current = {};
    mockPush.mockClear();
    const tree = renderRoute(false);
    const cta = findHostByTestId(tree, 'result-reveal-unlock-cta');
    expect(cta).toBeTruthy();
    const onPress = cta?.props.onPress as (e: unknown) => void;
    act(() => onPress({}));
    expect(mockPush).toHaveBeenCalledWith('/(funnel)/referral-gate');
  });

  it('does NOT fire router.push when in preview mode (no CTA rendered)', () => {
    mockSearchParams.current = { share_token: 'abc-123' };
    mockPush.mockClear();
    renderRoute(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('hides the share-to-unlock CTA when payment.isPremium is true (Sub-AC 11.1 wiring)', () => {
    // Phase 2.4: when the FunnelStateProvider payment slice already has
    // `isPremium: true` (set by the placeholder payment flow on step 12),
    // re-entering `result_reveal` must NOT show the share-to-unlock CTA.
    // The route reads `payment.isPremium` from the provider and forwards
    // it to the screen — this asserts that wiring is in place.
    mockSearchParams.current = {};
    mockPush.mockClear();
    const tree = renderRoute(true);
    expect(findHostByTestId(tree, 'result-reveal-unlock-cta')).toBeNull();
  });
});
