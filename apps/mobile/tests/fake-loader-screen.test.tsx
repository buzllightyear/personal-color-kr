/**
 * Unit test — `FakeLoaderScreen` presentational component.
 *
 * Phase 6.2: the `ActivityIndicator` spinner has been replaced by the shared
 * `StageLadder`, driven by the `core-ts` analyzing-loader controller. These
 * tests assert (behavioural only — no snapshots):
 *   1. Renders Korean headline + subhead (FunnelHeadline retained).
 *   2. Renders the 5-stage analyzing-loader ladder (5 Korean labels) and NO
 *      ActivityIndicator spinner.
 *   3. Has zero user-interactive CTA buttons (no skip/cancel).
 *   4. The ladder cycles pending → active → done through an injected fake
 *      scheduler (controller owns timing; the RN layer schedules nothing).
 *   5. `useAutoAdvanceTimer` fires `onElapsed` after exactly 5,000ms and is
 *      cleaned up on unmount.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ANALYZING_STAGE_LABELS } from 'core-ts/funnel';

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
    ActivityIndicator: makeHost('ActivityIndicator'),
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

import { FakeLoaderScreen } from '../src/screens/funnel/FakeLoaderScreen';

// ---------------------------------------------------------------------------
// Injected fake scheduler — synchronous, deterministic timeline driver for the
// analyzing-loader ladder controller. NO wall clock, NO vi.useFakeTimers here.
// ---------------------------------------------------------------------------

interface FakeScheduler {
  readonly now: () => number;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

interface FakeClock {
  readonly scheduler: FakeScheduler;
  readonly advance: (ms: number) => void;
}

function createFakeClock(): FakeClock {
  let nowMs = 0;
  let seq = 0;
  const timers = new Map<number, { dueAt: number; fn: () => void }>();

  const scheduler: FakeScheduler = {
    now: () => nowMs,
    setTimer: (fn, ms) => {
      const id = (seq += 1);
      timers.set(id, { dueAt: nowMs + ms, fn });
      return id;
    },
    clearTimer: (handle) => {
      if (typeof handle === 'number') timers.delete(handle);
    },
  };

  function advance(ms: number): void {
    const target = nowMs + ms;
    for (;;) {
      let nextId: number | undefined;
      let nextDue = Number.POSITIVE_INFINITY;
      for (const [id, t] of timers) {
        if (t.dueAt <= target && t.dueAt < nextDue) {
          nextDue = t.dueAt;
          nextId = id;
        }
      }
      if (nextId === undefined) break;
      const entry = timers.get(nextId);
      timers.delete(nextId);
      if (entry) {
        nowMs = entry.dueAt;
        entry.fn();
      }
    }
    nowMs = target;
  }

  return { scheduler, advance };
}

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

function findAllHostByTestIdPrefix(
  tree: TestRenderer.ReactTestRenderer,
  prefix: string,
): readonly TestInstance[] {
  return tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      typeof node.props?.testID === 'string' &&
      (node.props.testID as string).startsWith(prefix),
  ) as unknown as readonly TestInstance[];
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

describe('FakeLoaderScreen — render', () => {
  it('renders Korean headline "AI가 24개 포인트로 분석 중..."', () => {
    const tree = render(React.createElement(FakeLoaderScreen, { onElapsed: vi.fn() }));
    const headline = findHostByTestId(tree, 'fake-loader-headline');
    expect(headline?.props.children).toBe('AI가 24개 포인트로 분석 중...');
  });

  it('retains the FunnelHeadline subhead', () => {
    const tree = render(React.createElement(FakeLoaderScreen, { onElapsed: vi.fn() }));
    const subhead = findHostByTestId(tree, 'fake-loader-subhead');
    expect(subhead).toBeTruthy();
  });

  it('renders the 5-stage analyzing-loader ladder (Korean labels) and NO spinner', () => {
    const tree = render(React.createElement(FakeLoaderScreen, { onElapsed: vi.fn() }));

    // Ladder container present.
    expect(findHostByTestId(tree, 'fake-loader-ladder')).toBeTruthy();

    // Exactly 5 Korean stage labels, in canonical order.
    const labelNodes = ANALYZING_STAGE_LABELS.map((_, idx) =>
      findHostByTestId(tree, `fake-loader-ladder-item-${idx}-label`),
    );
    expect(labelNodes.every((n) => n !== null)).toBe(true);
    expect(labelNodes.map((n) => n?.props.children)).toEqual([
      ...ANALYZING_STAGE_LABELS,
    ]);

    // Old ActivityIndicator spinner is gone — neither its testID nor the
    // `ActivityIndicator` host element itself renders anywhere in the tree.
    expect(findHostByTestId(tree, 'fake-loader-spinner')).toBeNull();
    const spinners = tree.root.findAll((node) => node.type === 'ActivityIndicator');
    expect(spinners).toHaveLength(0);
  });

  it('renders zero user-interactive buttons (no cancel/skip)', () => {
    const tree = render(React.createElement(FakeLoaderScreen, { onElapsed: vi.fn() }));
    const buttons = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' && node.props?.accessibilityRole === 'button',
    );
    expect(buttons).toHaveLength(0);
  });
});

describe('FakeLoaderScreen — ladder cycles via injected fake scheduler', () => {
  function activeIndex(tree: TestRenderer.ReactTestRenderer): number {
    const rows = findAllHostByTestIdPrefix(tree, 'fake-loader-ladder-item-');
    // Rows (not labels) carry accessibilityState; labels' testIDs also match
    // the prefix, so filter to the rows that expose accessibilityState.
    const selected = rows.filter(
      (r) =>
        (r.props.accessibilityState as { selected?: boolean } | undefined)?.selected ===
        true,
    );
    if (selected.length === 0) return -1;
    const testID = selected[0]?.props.testID as string;
    return Number(testID.replace('fake-loader-ladder-item-', ''));
  }

  it('starts with stage 0 active and advances on each scheduler tick', () => {
    const clock = createFakeClock();
    const tree = render(
      React.createElement(FakeLoaderScreen, {
        onElapsed: vi.fn(),
        ladderScheduler: clock.scheduler,
      }),
    );

    expect(activeIndex(tree)).toBe(0);

    act(() => clock.advance(1_000));
    expect(activeIndex(tree)).toBe(1);

    act(() => clock.advance(1_000));
    expect(activeIndex(tree)).toBe(2);
  });

  it('latches at complete after 5000ms — all stages done, 100% progress', () => {
    const clock = createFakeClock();
    const tree = render(
      React.createElement(FakeLoaderScreen, {
        onElapsed: vi.fn(),
        ladderScheduler: clock.scheduler,
      }),
    );

    act(() => clock.advance(5_000));

    // No row is active once complete (all done).
    expect(activeIndex(tree)).toBe(-1);
    const progress = findHostByTestId(tree, 'fake-loader-ladder-progress');
    expect(progress?.props.children).toBe('100%');
  });
});

describe('FakeLoaderScreen — autoAdvance timer (5000ms)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onElapsed after exactly 5000ms (default duration)', () => {
    const onElapsed = vi.fn();
    render(React.createElement(FakeLoaderScreen, { onElapsed }));
    expect(onElapsed).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(onElapsed).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it('does not fire onElapsed after unmount (cleanup)', () => {
    const onElapsed = vi.fn();
    const tree = render(React.createElement(FakeLoaderScreen, { onElapsed }));
    act(() => {
      tree.unmount();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onElapsed).not.toHaveBeenCalled();
  });

  it('honours custom durationMs prop override', () => {
    const onElapsed = vi.fn();
    render(
      React.createElement(FakeLoaderScreen, {
        onElapsed,
        durationMs: 2_000,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });
});
