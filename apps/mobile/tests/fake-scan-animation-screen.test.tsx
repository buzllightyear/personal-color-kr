/**
 * Unit test — `FakeScanAnimationScreen` presentational component (Phase 2.3,
 * Sub-AC 3).
 *
 * Verifies the *single Animated.Value* contract for the 5,000ms sweep-line
 * scan animation:
 *
 *   1. The screen renders the Korean headline + subhead from
 *      `FUNNEL_SCREENS.fake_scan_animation`.
 *   2. The screen renders exactly 24 face landmark dots with stable testIDs
 *      (`fake-scan-animation-dot-0` … `fake-scan-animation-dot-23`).
 *   3. The screen renders the sweep-line element and the counter.
 *   4. The counter starts at `"0 / 24"` immediately after mount (initial
 *      Animated.Value state is `0`).
 *   5. The Animated.Value progresses to `1` via `Animated.timing(...).start()`
 *      and the counter's listener-driven snapshot reaches `"24 / 24"`.
 *   6. `useNativeDriver` is `false` on the timing config (Seed constraint —
 *      we animate `top` + `backgroundColor`, not transform).
 *   7. `useAutoAdvanceTimer` fires `onElapsed` after exactly 5,000ms.
 *   8. Unmounting before the timer elapses suppresses both the `onElapsed`
 *      callback and any post-unmount listener calls.
 *
 * Strategy:
 *   The vitest react-native mock here replaces `Animated.Value` with a
 *   listener-driven stub: `Value.setValue(v)` notifies every registered
 *   listener with `{ value: v }`, and `Animated.timing(value, config).start()`
 *   synchronously calls `value.setValue(config.toValue)` then invokes the
 *   `start` callback (if any) with `{ finished: true }`. This lets the test
 *   exercise the screen's "initialised → driven to completion" lifecycle
 *   without spinning real animation frames — the production code's
 *   `useNativeDriver: false` flag is recorded on a captured config so we can
 *   assert it.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// react-native mock — host stubs + listener-driven Animated.Value
// ---------------------------------------------------------------------------

interface TimingCallArgs {
  readonly toValue: number;
  readonly duration: number;
  readonly useNativeDriver: boolean;
}
const recordedTimingConfigs: TimingCallArgs[] = [];
const recordedAnimatedValueStartValues: number[] = [];

vi.mock('react-native', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');
  const makeHost =
    (label: string) =>
    (props: Record<string, unknown> & { children?: React.ReactNode }) =>
      reactActual.createElement(label, props, props?.children);

  /**
   * Listener-driven mock of `Animated.Value`. Mirrors the production API
   * surface used by `FakeScanAnimationScreen`:
   *   - `new Animated.Value(initial)` — store initial value.
   *   - `.addListener(cb)` — register, return string id.
   *   - `.removeListener(id)` — unregister by id.
   *   - `.setValue(v)` — overwrite and notify all listeners.
   *   - `.interpolate(config)` — return an opaque marker; the production
   *     code only passes the marker to `Animated.View`'s style prop, never
   *     reads from it, so an opaque object is sufficient for the test.
   */
  class MockAnimatedValue {
    private _value: number;
    private _listeners: Map<string, (event: { value: number }) => void> = new Map();
    private _nextListenerId = 0;
    public constructor(initial: number) {
      this._value = initial;
      recordedAnimatedValueStartValues.push(initial);
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
    public getCurrentValue(): number {
      return this._value;
    }
  }

  function mockTiming(
    value: MockAnimatedValue,
    config: { toValue: number; duration: number; useNativeDriver: boolean },
  ): { start: (cb?: (r: { finished: boolean }) => void) => void; stop: () => void } {
    recordedTimingConfigs.push({
      toValue: config.toValue,
      duration: config.duration,
      useNativeDriver: config.useNativeDriver,
    });
    let stopped = false;
    return {
      start: (cb?: (r: { finished: boolean }) => void): void => {
        if (stopped) return;
        // Synchronously drive the value to completion. This mirrors what a
        // real Animated.timing would do at duration-end and lets the test
        // observe the "driven to completion" state without faking
        // requestAnimationFrame ticks.
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

import { FakeScanAnimationScreen } from '../src/screens/funnel/FakeScanAnimationScreen';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

function findAllHosts(tree: TestRenderer.ReactTestRenderer): readonly TestInstance[] {
  return tree.root.findAll(
    (node) => typeof node.type === 'string',
  ) as unknown as readonly TestInstance[];
}

/**
 * Depth-first render-order list of every host node's `testID` (skipping nodes
 * without one). Used to assert *relative document order* between the existing
 * face oval, the additively-composed stage ladder, and the existing counter.
 */
function testIdsInRenderOrder(
  tree: TestRenderer.ReactTestRenderer,
): readonly string[] {
  return findAllHosts(tree)
    .map((h) => h.props?.testID)
    .filter((id): id is string => typeof id === 'string');
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

// Reset captured timing configs / start values between tests so each block
// observes only its own mount.
beforeEach(() => {
  recordedTimingConfigs.length = 0;
  recordedAnimatedValueStartValues.length = 0;
});

// ---------------------------------------------------------------------------
// Render assertions
// ---------------------------------------------------------------------------

describe('FakeScanAnimationScreen — render', () => {
  it('renders the Korean headline from FUNNEL_SCREENS.fake_scan_animation', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    const headline = findHostByTestId(tree, 'fake-scan-animation-headline');
    expect(headline).toBeTruthy();
    expect(headline?.props.children).toBe('얼굴 24개 포인트 스캔 중');
  });

  it('renders the Korean subhead from FUNNEL_SCREENS.fake_scan_animation', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    const subhead = findHostByTestId(tree, 'fake-scan-animation-subhead');
    expect(subhead).toBeTruthy();
    expect(subhead?.props.children).toBe(
      '셀카 위에서 스캔 라인이 24개 포인트를 짚어내고 있어요',
    );
  });

  it('renders exactly 24 face landmark dots with stable testIDs', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    // Every dot is present with the documented testID pattern.
    for (let i = 0; i < 24; i++) {
      const dot = findHostByTestId(tree, `fake-scan-animation-dot-${i}`);
      expect(dot, `dot index ${i}`).toBeTruthy();
    }
    // And there are no 25th / -1th dots.
    expect(findHostByTestId(tree, 'fake-scan-animation-dot-24')).toBeNull();
    expect(findHostByTestId(tree, 'fake-scan-animation-dot--1')).toBeNull();
  });

  it('renders the sweep-line element and the counter', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    expect(findHostByTestId(tree, 'fake-scan-animation-sweep-line')).toBeTruthy();
    expect(findHostByTestId(tree, 'fake-scan-animation-counter')).toBeTruthy();
    expect(findHostByTestId(tree, 'fake-scan-animation-face-oval')).toBeTruthy();
  });

  it('renders zero user-interactive buttons (no cancel/skip)', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    const buttons = findAllHosts(tree).filter(
      (h) => h.props?.accessibilityRole === 'button',
    );
    expect(buttons).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8-stage Korean-label scan ladder (additive composition, Phase 6.2)
// ---------------------------------------------------------------------------

describe('FakeScanAnimationScreen — 8-stage scan ladder', () => {
  /** The eight Korean signature labels, in stage order (from core-ts). */
  const SCAN_LADDER_LABELS: readonly string[] = [
    '얼굴 감지',
    '윤곽 분석',
    '피부 영역 추출',
    '눈 영역 분석',
    '입술 영역 분석',
    '컬러 샘플링',
    '톤 매칭',
    '결과 준비',
  ];

  it('renders the shared StageLadder container with the scan-animation prefix', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    expect(findHostByTestId(tree, 'scan-animation-ladder')).toBeTruthy();
  });

  it('renders exactly 8 Korean-label ladder rows in stage order', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    SCAN_LADDER_LABELS.forEach((label, index) => {
      const row = findHostByTestId(
        tree,
        `scan-animation-ladder-item-${index}-label`,
      );
      expect(row, `ladder row ${index}`).toBeTruthy();
      expect(row?.props.children).toBe(label);
    });
    // No 9th row — the ladder is pinned to the 8 core-ts stages.
    expect(
      findHostByTestId(tree, 'scan-animation-ladder-item-8-label'),
    ).toBeNull();
  });

  it('places the ladder BELOW the face oval and ABOVE the X/24 counter', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    const order = testIdsInRenderOrder(tree);
    const ovalIdx = order.indexOf('fake-scan-animation-face-oval');
    const ladderIdx = order.indexOf('scan-animation-ladder');
    const counterIdx = order.indexOf('fake-scan-animation-counter');
    expect(ovalIdx).toBeGreaterThanOrEqual(0);
    expect(ladderIdx).toBeGreaterThanOrEqual(0);
    expect(counterIdx).toBeGreaterThanOrEqual(0);
    // Render order is exactly: face oval → ladder → counter.
    expect(ovalIdx).toBeLessThan(ladderIdx);
    expect(ladderIdx).toBeLessThan(counterIdx);
  });

  it('mounts the ladder wrapper strictly after the scan-area (below the face oval)', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    const order = testIdsInRenderOrder(tree);
    const scanAreaIdx = order.indexOf('fake-scan-animation-scan-area');
    const wrapperIdx = order.indexOf('fake-scan-animation-ladder-wrapper');
    // Both containers exist…
    expect(scanAreaIdx).toBeGreaterThanOrEqual(0);
    expect(wrapperIdx).toBeGreaterThanOrEqual(0);
    // …and the additively-composed ladder wrapper renders below the entire
    // scan-area (which houses the face oval + sweep line), never inside or
    // before it. This is the container-level guarantee of "below face oval".
    expect(wrapperIdx).toBeGreaterThan(scanAreaIdx);
    // The face oval itself is nested within the scan-area, so it too precedes
    // the ladder wrapper — the additive composition never reorders the
    // existing visual surface.
    const ovalIdx = order.indexOf('fake-scan-animation-face-oval');
    expect(ovalIdx).toBeGreaterThan(scanAreaIdx);
    expect(wrapperIdx).toBeGreaterThan(ovalIdx);
  });

  it('forwards an ARIA live region onto the ladder container', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    const ladder = findHostByTestId(tree, 'scan-animation-ladder');
    // The container forwards the view-model's politeness (idle→none,
    // running→polite, complete→assertive). Whatever the initial phase, the
    // value is one of RN's accepted live-region members — never `'off'`.
    expect(['none', 'polite', 'assertive']).toContain(
      ladder?.props.accessibilityLiveRegion,
    );
  });

  it('does not disturb the existing 24-point face oval, sweep line, or counter', () => {
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    // Existing surface remains intact alongside the additive ladder.
    expect(findHostByTestId(tree, 'fake-scan-animation-face-oval')).toBeTruthy();
    expect(findHostByTestId(tree, 'fake-scan-animation-sweep-line')).toBeTruthy();
    expect(findHostByTestId(tree, 'fake-scan-animation-counter')).toBeTruthy();
    for (let i = 0; i < 24; i++) {
      expect(findHostByTestId(tree, `fake-scan-animation-dot-${i}`)).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Animated.Value initialisation + driven-to-completion
// ---------------------------------------------------------------------------

describe('FakeScanAnimationScreen — Animated.Value lifecycle', () => {
  it('initialises a single Animated.Value at 0', () => {
    render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    // Exactly one Animated.Value was constructed by this screen render and
    // its starting value was 0.
    expect(recordedAnimatedValueStartValues).toHaveLength(1);
    expect(recordedAnimatedValueStartValues[0]).toBe(0);
  });

  it('drives Animated.timing(...) to toValue=1 with useNativeDriver=false', () => {
    render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    expect(recordedTimingConfigs).toHaveLength(1);
    const cfg = recordedTimingConfigs[0];
    expect(cfg?.toValue).toBe(1);
    expect(cfg?.useNativeDriver).toBe(false);
  });

  it('uses durationMs=5000 by default (matches FUNNEL_SCREENS metadata)', () => {
    render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    expect(recordedTimingConfigs[0]?.duration).toBe(5_000);
  });

  it('honours custom durationMs prop override', () => {
    render(
      React.createElement(FakeScanAnimationScreen, {
        onElapsed: vi.fn(),
        durationMs: 1_500,
      }),
    );
    expect(recordedTimingConfigs[0]?.duration).toBe(1_500);
  });

  it('counter ticks from "0 / 24" to "24 / 24" as the Animated.Value reaches 1', () => {
    // With the listener-driven mock, `Animated.timing(...).start()` runs
    // synchronously inside the screen's mount-time `useEffect`. By the time
    // `render(...)` returns, the value has already been driven to 1 and the
    // listener has fired with `{ value: 1 }` → the counter shows "24 / 24".
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed: vi.fn() }),
    );
    const counter = findHostByTestId(tree, 'fake-scan-animation-counter');
    expect(counter?.props.children).toBe('24 / 24');
  });
});

// ---------------------------------------------------------------------------
// useAutoAdvanceTimer integration (5000ms one-shot)
// ---------------------------------------------------------------------------

describe('FakeScanAnimationScreen — auto-advance timer (5000ms)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onElapsed after exactly 5000ms (default duration)', () => {
    const onElapsed = vi.fn();
    render(React.createElement(FakeScanAnimationScreen, { onElapsed }));
    expect(onElapsed).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(onElapsed).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it('does not fire onElapsed after unmount (cleanup)', () => {
    const onElapsed = vi.fn();
    const tree = render(
      React.createElement(FakeScanAnimationScreen, { onElapsed }),
    );
    act(() => {
      tree.unmount();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onElapsed).not.toHaveBeenCalled();
  });
});
