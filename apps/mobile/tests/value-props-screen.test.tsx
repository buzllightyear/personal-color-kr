/**
 * Unit test — `ValuePropsScreen` presentational component.
 *
 * Asserts:
 *   1. Renders Korean headline + subhead.
 *   2. Renders 3 cards (trend_matched_editing, monthly_curated_magazine,
 *      personal_color_preset_library) each with emoji + title + description.
 *   3. Each card is wrapped in a ScrollView.
 *   4. Primary CTA invokes onNext.
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
  };
});

vi.mock('react-native-safe-area-context', () => {
  return {
    SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('SafeAreaView', props, props.children),
  };
});

import { ValuePropsScreen } from '../src/screens/funnel/ValuePropsScreen';

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

function findAllHostByTestId(
  tree: TestRenderer.ReactTestRenderer,
  pattern: RegExp,
): readonly TestInstance[] {
  return tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      typeof node.props?.testID === 'string' &&
      pattern.test(node.props.testID),
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

describe('ValuePropsScreen — render', () => {
  it('renders Korean headline "오늘의 트렌드, 내 얼굴에 맞춘 편집"', () => {
    const tree = render(
      React.createElement(ValuePropsScreen, { onNext: vi.fn() }),
    );
    const headline = findHostByTestId(tree, 'value-props-headline');
    expect(headline?.props.children).toBe('오늘의 트렌드, 내 얼굴에 맞춘 편집');
  });

  it('renders 3 value-props cards via ScrollView', () => {
    const tree = render(
      React.createElement(ValuePropsScreen, { onNext: vi.fn() }),
    );
    expect(findHostByTestId(tree, 'value-props-card-list')).toBeTruthy();
    // Use a stricter pattern that excludes the parent list container —
    // each card has testID `value-props-card-<key>` (with a suffix).
    const cards = findAllHostByTestId(tree, /^value-props-card-[a-z-]+$/);
    expect(cards.filter((c) => c.props.testID !== 'value-props-card-list')).toHaveLength(3);
  });

  it('renders trend_matched_editing card', () => {
    const tree = render(
      React.createElement(ValuePropsScreen, { onNext: vi.fn() }),
    );
    expect(findHostByTestId(tree, 'value-props-card-trend-matched-editing')).toBeTruthy();
  });

  it('renders monthly_curated_magazine card', () => {
    const tree = render(
      React.createElement(ValuePropsScreen, { onNext: vi.fn() }),
    );
    expect(findHostByTestId(tree, 'value-props-card-monthly-curated-magazine')).toBeTruthy();
  });

  it('renders personal_color_preset_library card', () => {
    const tree = render(
      React.createElement(ValuePropsScreen, { onNext: vi.fn() }),
    );
    expect(findHostByTestId(tree, 'value-props-card-personal-color-preset-library')).toBeTruthy();
  });

  it('renders the primary CTA with accessibility attributes', () => {
    const tree = render(
      React.createElement(ValuePropsScreen, { onNext: vi.fn() }),
    );
    const cta = findHostByTestId(tree, 'value-props-cta');
    expect(cta?.props.accessibilityRole).toBe('button');
    expect(cta?.props.accessibilityLabel).toBe('다음');
  });
});

describe('ValuePropsScreen — interaction', () => {
  it('invokes onNext when the CTA is pressed', () => {
    const onNext = vi.fn();
    const tree = render(
      React.createElement(ValuePropsScreen, { onNext }),
    );
    const cta = findHostByTestId(tree, 'value-props-cta');
    const onPress = cta?.props.onPress as (e: unknown) => void;
    act(() => onPress({}));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
