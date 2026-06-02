/**
 * Unit test — `app/(funnel)/result-reveal.tsx` Phase 2.4 AC 13.
 *
 * Contract under test:
 *   When `payment.isPremium === true` AND the result-reveal route is the
 *   focused screen, an Android hardware-back press must be intercepted
 *   and trigger `router.dismissAll()` instead of popping back into the
 *   placeholder payment_model screen. The interception is registered
 *   via `useFocusEffect` (so it is automatically scoped to the focused
 *   lifecycle) and the BackHandler subscription is cleaned up on
 *   unfocus / unmount.
 *
 *   When `payment.isPremium === false`, the route does NOT register a
 *   BackHandler subscription — the default Android back behaviour
 *   (pop one screen) is preserved.
 *
 * Why a dedicated test file (vs. extending `result-reveal-route.test.tsx`):
 *   - The AC 13 assertions need callback-capturing mocks for both
 *     `useFocusEffect` and `BackHandler.addEventListener`. Mixing those
 *     into the existing wiring test would couple unrelated assertions
 *     and force the wiring test to thread the same capture state.
 *   - This file is added by the AC 13 sub-task; siblings extending the
 *     existing wiring test can do so without colliding with the
 *     BackHandler capture plumbing.
 *
 * Test approach:
 *   - Mock `react-native` with a `BackHandler.addEventListener` that
 *     records each `(eventName, handler)` pair into a module-scoped
 *     bundle. The returned subscription's `.remove()` is also tracked
 *     so cleanup can be asserted.
 *   - Mock `expo-router` with a `useFocusEffect` that immediately
 *     invokes the callback (modelling "screen is focused") and stores
 *     the returned cleanup function for later invocation in an
 *     "unfocus" act. The mocked router exposes `dismissAll` as a
 *     `vi.fn()` so the AC's "dismissAll on back press" contract can
 *     be asserted.
 *   - Render the route under a `<FunnelStateProvider>` seeded with the
 *     premium / non-premium branch under test.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// react-native mock — capture BackHandler subscriptions for assertion.
// ---------------------------------------------------------------------------

interface CapturedSubscription {
  readonly eventName: string;
  readonly handler: () => boolean;
  readonly remove: ReturnType<typeof vi.fn>;
}

const backHandlerCaptures: CapturedSubscription[] = [];

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
      OS: 'android',
      select: (m: { android?: unknown; default?: unknown }) => m.android ?? m.default,
    },
    BackHandler: {
      addEventListener: (
        eventName: string,
        handler: () => boolean,
      ): { remove: () => void } => {
        const remove = vi.fn();
        backHandlerCaptures.push({ eventName, handler, remove });
        return { remove };
      },
    },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('SafeAreaView', props, props.children),
}));

// ---------------------------------------------------------------------------
// expo-router mock — capture useFocusEffect callbacks + expose dismissAll.
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockDismissAll = vi.fn();
const mockSearchParams: { current: Record<string, unknown> } = { current: {} };

vi.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    dismissAll: mockDismissAll,
  }),
  useLocalSearchParams: () => mockSearchParams.current,
  // Model useFocusEffect as a useEffect that runs the callback once per
  // mount (the "screen focused" event) and runs the returned cleanup on
  // unmount (the "screen unfocused" event). For AC 13 this is sufficient
  // — we don't need full focus-stack semantics, only the "subscribe on
  // focus, unsubscribe on unfocus/unmount" contract.
  useFocusEffect: (cb: () => undefined | (() => void)) => {
    React.useEffect(() => cb(), [cb]);
  },
}));

// Late imports so the mocks are hoisted before the route module evaluates.
import ResultRevealRoute from '../app/(funnel)/result-reveal';
import { FunnelStateProvider } from '../src/providers/FunnelStateProvider';

function renderRoute(initialIsPremium: boolean): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(
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
  });
  if (!tree) throw new Error('renderRoute: tree not created');
  return tree;
}

beforeEach(() => {
  backHandlerCaptures.length = 0;
  mockPush.mockClear();
  mockDismissAll.mockClear();
  mockSearchParams.current = {};
});

describe('result-reveal route — AC 13 BackHandler on premium branch', () => {
  it('registers a hardwareBackPress listener when isPremium=true', () => {
    renderRoute(true);
    // Exactly one subscription created — the premium-branch BackHandler.
    expect(backHandlerCaptures).toHaveLength(1);
    expect(backHandlerCaptures[0]?.eventName).toBe('hardwareBackPress');
  });

  it('does NOT register a hardwareBackPress listener when isPremium=false', () => {
    renderRoute(false);
    expect(backHandlerCaptures).toHaveLength(0);
  });

  it('invokes router.dismissAll() when the hardware back press handler fires', () => {
    renderRoute(true);
    const sub = backHandlerCaptures[0];
    expect(sub).toBeDefined();
    // Simulate Android pressing hardware back while the premium
    // result-reveal screen is focused.
    const consumed = sub!.handler();
    // Returning `true` tells RN the event was consumed — the default
    // pop-screen behaviour must not also fire.
    expect(consumed).toBe(true);
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    // No accidental navigation push side-effect.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('removes the BackHandler subscription on unmount (cleanup contract)', () => {
    const tree = renderRoute(true);
    const sub = backHandlerCaptures[0];
    expect(sub).toBeDefined();
    expect(sub!.remove).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
    expect(sub!.remove).toHaveBeenCalledTimes(1);
  });

  it('does not call router.dismissAll on mount alone (only on back press)', () => {
    renderRoute(true);
    // Mounting the focused-premium route registers the listener but
    // must NOT proactively invoke dismissAll — that only happens when
    // the user presses the hardware back button.
    expect(mockDismissAll).not.toHaveBeenCalled();
  });
});
