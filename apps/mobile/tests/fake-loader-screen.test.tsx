/**
 * Unit test — `FakeLoaderScreen` presentational component.
 *
 * Asserts:
 *   1. Renders Korean headline + subhead.
 *   2. Renders ActivityIndicator with testID="fake-loader-spinner".
 *   3. Has zero user-interactive CTA buttons (no skip/cancel).
 *   4. `useAutoAdvanceTimer` fires `onElapsed` after exactly 5,000ms.
 *   5. Timer is cleaned up on unmount (no callback fires after unmount).
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('FakeLoaderScreen — render', () => {
  it('renders Korean headline "AI가 24개 포인트로 분석 중..."', () => {
    const tree = render(
      React.createElement(FakeLoaderScreen, { onElapsed: vi.fn() }),
    );
    const headline = findHostByTestId(tree, 'fake-loader-headline');
    expect(headline?.props.children).toBe('AI가 24개 포인트로 분석 중...');
  });

  it('renders the ActivityIndicator spinner', () => {
    const tree = render(
      React.createElement(FakeLoaderScreen, { onElapsed: vi.fn() }),
    );
    const spinner = findHostByTestId(tree, 'fake-loader-spinner');
    expect(spinner).toBeTruthy();
    expect(spinner?.props.size).toBe('large');
  });

  it('renders zero user-interactive buttons (no cancel/skip)', () => {
    const tree = render(
      React.createElement(FakeLoaderScreen, { onElapsed: vi.fn() }),
    );
    const buttons = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.props?.accessibilityRole === 'button',
    );
    expect(buttons).toHaveLength(0);
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
    const tree = render(
      React.createElement(FakeLoaderScreen, { onElapsed }),
    );
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
