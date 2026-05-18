/**
 * Unit test — `WelcomeHookScreen` presentational component.
 *
 * Asserts:
 *   1. Renders the Korean headline + subhead from FUNNEL_SCREENS.welcome_hook.
 *   2. Renders the primary CTA with the Korean label "1분 진단 시작".
 *   3. Pressing the CTA invokes the `onNext` prop exactly once.
 *   4. CTA carries accessibilityRole + accessibilityLabel + testID.
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
    TextInput: makeHost('TextInput'),
    Image: makeHost('Image'),
    Switch: makeHost('Switch'),
    ScrollView: makeHost('ScrollView'),
    Modal: makeHost('Modal'),
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

import { WelcomeHookScreen } from '../src/screens/funnel/WelcomeHookScreen';

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

describe('WelcomeHookScreen — render', () => {
  it('renders the Korean headline from FUNNEL_SCREENS.welcome_hook', () => {
    const tree = render(
      React.createElement(WelcomeHookScreen, { onNext: vi.fn() }),
    );
    const headline = findHostByTestId(tree, 'welcome-hook-headline');
    expect(headline).toBeTruthy();
    expect(headline?.props.children).toBe(
      '내 퍼스널 컬러로 셀카가 한 장 더 빛나도록',
    );
  });

  it('renders the Korean subhead from FUNNEL_SCREENS.welcome_hook', () => {
    const tree = render(
      React.createElement(WelcomeHookScreen, { onNext: vi.fn() }),
    );
    const subhead = findHostByTestId(tree, 'welcome-hook-subhead');
    expect(subhead).toBeTruthy();
    expect(subhead?.props.children).toBe(
      '1분 진단으로 봄·여름·가을·겨울 카테고리부터 맞춤 편집까지',
    );
  });

  it('renders the primary CTA with label "1분 진단 시작"', () => {
    const tree = render(
      React.createElement(WelcomeHookScreen, { onNext: vi.fn() }),
    );
    const cta = findHostByTestId(tree, 'welcome-hook-cta');
    expect(cta).toBeTruthy();
    expect(cta?.props.accessibilityRole).toBe('button');
    expect(cta?.props.accessibilityLabel).toBe('1분 진단 시작');
  });
});

describe('WelcomeHookScreen — interaction', () => {
  it('invokes onNext exactly once when the CTA is pressed', () => {
    const onNext = vi.fn();
    const tree = render(
      React.createElement(WelcomeHookScreen, { onNext }),
    );
    const cta = findHostByTestId(tree, 'welcome-hook-cta');
    const onPress = cta?.props.onPress as (e: unknown) => void;
    act(() => {
      onPress({});
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
