/**
 * Smoke test — `app/(funnel)/fake-scan-animation.tsx` route wrapper (Sub-AC 2.3).
 *
 * Verifies the thin expo-router route file:
 *   1. Mounts the presentational `FakeScanAnimationScreen` underneath it (the
 *      route is a *wrapper*, not a re-implementation — the entire animation
 *      lifecycle lives in the screen file).
 *   2. Wires the `useRouter().push(...)` handler into the screen's
 *      `onElapsed` callback so the 5,000ms auto-advance navigates the funnel
 *      to step 9 (`/(funnel)/result-reveal`).
 *
 * The screen component itself is covered exhaustively by
 * `fake-scan-animation-screen.test.tsx`; this file pins the *wiring*
 * contract (route → screen → router.push) without re-asserting the
 * intra-screen rendering details (24 dots, sweep-line, counter, etc.).
 *
 * Mocking strategy mirrors `fake-scan-animation-screen.test.tsx` plus
 * `diagnosis-input-route.test.tsx`:
 *   - `react-native`: minimal host-component set + listener-driven
 *     Animated.Value mock so the screen's `Animated.timing(...).start()`
 *     resolves synchronously without spinning real frames. Without the
 *     Animated mock the screen's mount-time effect would throw on
 *     `new Animated.Value(0)`.
 *   - `react-native-safe-area-context`: tiny `SafeAreaView` stub matching
 *     the surface the layout consumes.
 *   - `expo-router`: `useRouter` returns a stub object whose `push` is a
 *     `vi.fn`, so the test can assert the route wrapper calls it with the
 *     correct kebab path for step 9 once the auto-advance timer elapses.
 *
 * The route wrapper has no `useFunnelState()` dependency (the animation is
 * stateless from the funnel-state perspective — step 8 is purely temporal
 * priming) so unlike `diagnosis-input-route.test.tsx` we do NOT need to
 * wrap the route in a `<FunnelStateProvider>`.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// react-native mock — host stubs + listener-driven Animated.Value
// ---------------------------------------------------------------------------

vi.mock('react-native', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');
  const makeHost =
    (label: string) =>
    (props: Record<string, unknown> & { children?: React.ReactNode }) =>
      reactActual.createElement(label, props, props?.children);

  /**
   * Listener-driven mock of `Animated.Value`. Mirrors the production API
   * surface the screen consumes (`new Animated.Value(0)`, `.addListener`,
   * `.removeListener`, `.removeAllListeners`, `.setValue`, `.interpolate`,
   * `.stopAnimation`). For the route smoke test we only need the type
   * surface to exist so the screen's mount effect does not crash — the
   * exhaustive lifecycle assertions live in the screen test.
   */
  class MockAnimatedValue {
    private _value: number;
    private _listeners: Map<string, (event: { value: number }) => void> = new Map();
    private _nextListenerId = 0;
    public constructor(initial: number) {
      this._value = initial;
    }
    public addListener(cb: (event: { value: number }) => void): string {
      const id: string = String(++this._nextListenerId);
      this._listeners.set(id, cb);
      return id;
    }
    public removeListener(id: string): void {
      this._listeners.delete(id);
    }
    public removeAllListeners(): void {
      this._listeners.clear();
    }
    public setValue(v: number): void {
      this._value = v;
      this._listeners.forEach((cb) => {
        cb({ value: v });
      });
    }
    public stopAnimation(cb?: (v: number) => void): void {
      if (cb) cb(this._value);
    }
    public interpolate(_config: unknown): { readonly __mockInterpolation: true } {
      return { __mockInterpolation: true } as const;
    }
  }

  function mockTiming(
    value: MockAnimatedValue,
    config: { toValue: number; duration: number; useNativeDriver: boolean },
  ): { start: (cb?: (r: { finished: boolean }) => void) => void; stop: () => void } {
    let stopped = false;
    return {
      start: (cb?: (r: { finished: boolean }) => void): void => {
        if (stopped) return;
        value.setValue(config.toValue);
        if (cb) cb({ finished: true });
      },
      stop: (): void => {
        stopped = true;
      },
    };
  }

  return {
    View: makeHost('View'),
    Text: makeHost('Text'),
    Pressable: makeHost('Pressable'),
    ActivityIndicator: makeHost('ActivityIndicator'),
    Animated: {
      Value: MockAnimatedValue,
      timing: mockTiming,
      View: makeHost('Animated.View'),
    },
    Easing: {
      linear: { __easing: 'linear' } as const,
    },
    StyleSheet: {
      create: (s: Record<string, unknown>): Record<string, unknown> => s,
      flatten: (s: unknown): unknown => s,
    },
    Platform: {
      OS: 'ios',
      select: (m: { ios?: unknown; default?: unknown }) => m.ios ?? m.default,
    },
  };
});

vi.mock('react-native-safe-area-context', () => {
  return {
    SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('SafeAreaView', props, props.children),
  };
});

// Module-scope router push spy — the mocked `useRouter` closes over this so
// individual tests can introspect call count and arguments after rendering.
const pushSpy = vi.fn();

vi.mock('expo-router', () => {
  return {
    useRouter: (): { push: (path: string) => void } => ({ push: pushSpy }),
  };
});

// Import the default export AFTER the mocks have been registered so the
// route module's `import { useRouter } from 'expo-router'` resolves to the
// mocked surface above.
import FakeScanAnimationRoute from '../app/(funnel)/fake-scan-animation';

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

describe('fake-scan-animation route wrapper — mount smoke (Sub-AC 2.3)', () => {
  beforeEach(() => {
    pushSpy.mockClear();
  });

  it('mounts the FakeScanAnimationScreen presentational component', () => {
    const tree = render(React.createElement(FakeScanAnimationRoute));
    // The screen tags its root surface with the `fake-scan-animation-screen`
    // testID — its presence under the route wrapper proves the wrapper
    // delegated to the correct component.
    expect(findHostByTestId(tree, 'fake-scan-animation-screen')).toBeTruthy();
  });

  it('renders the screen-internal sweep-line and 24-dot scaffold (proves real screen mounted, not a stub)', () => {
    const tree = render(React.createElement(FakeScanAnimationRoute));
    // These testIDs come from the presentational component (not the route).
    // Their presence confirms the route is mounting the real screen, not
    // accidentally short-circuiting to a placeholder.
    expect(findHostByTestId(tree, 'fake-scan-animation-sweep-line')).toBeTruthy();
    expect(findHostByTestId(tree, 'fake-scan-animation-counter')).toBeTruthy();
    expect(findHostByTestId(tree, 'fake-scan-animation-dot-0')).toBeTruthy();
    expect(findHostByTestId(tree, 'fake-scan-animation-dot-23')).toBeTruthy();
  });

  it('does not navigate before the auto-advance timer elapses', () => {
    render(React.createElement(FakeScanAnimationRoute));
    // The screen mounts synchronously but the 5,000ms timer is owned by
    // `useAutoAdvanceTimer`. With real timers, no push should have fired by
    // the time the render call returns.
    expect(pushSpy).not.toHaveBeenCalled();
  });
});

describe('fake-scan-animation route wrapper — onElapsed wiring (Sub-AC 2.3)', () => {
  beforeEach(() => {
    pushSpy.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards useRouter().push to onElapsed (advances to /(funnel)/result-reveal after 5000ms)', () => {
    render(React.createElement(FakeScanAnimationRoute));
    expect(pushSpy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(pushSpy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith('/(funnel)/result-reveal');
  });

  it('does not call router.push after unmount even when the would-be timer instant arrives', () => {
    const tree = render(React.createElement(FakeScanAnimationRoute));
    act(() => {
      tree.unmount();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // The useAutoAdvanceTimer cleanup must have cleared the timeout so the
    // navigation callback never fires after the route wrapper unmounts.
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
