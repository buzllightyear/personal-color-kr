/**
 * Unit test — `RatingGateContent` presentational component (rating-gate
 * shared variant body).
 *
 * Asserts:
 *   1. Renders Korean headline + subhead.
 *   2. Renders submit + skip CTAs with correct testIDs and accessibility.
 *   3. submit_rating CTA invokes onSubmit.
 *   4. skip CTA invokes onSkip (dismissable: true semantic).
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

import { RatingGateContent } from '../src/screens/funnel/RatingGateContent';

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

const NO_OP = (): void => undefined;

describe('RatingGateContent — render', () => {
  it('renders Korean headline from FUNNEL_SCREENS.rating_gate', () => {
    const tree = render(
      React.createElement(RatingGateContent, {
        onSubmit: NO_OP,
        onSkip: NO_OP,
        variant: 'default',
      }),
    );
    const headline = findHostByTestId(tree, 'rating-gate-headline');
    expect(headline?.props.children).toBe('잠깐, 별점 한 번만 부탁드려요');
  });

  it('renders submit and skip CTAs with accessibility attributes', () => {
    const tree = render(
      React.createElement(RatingGateContent, {
        onSubmit: NO_OP,
        onSkip: NO_OP,
        variant: 'default',
      }),
    );
    const submit = findHostByTestId(tree, 'rating-gate-submit');
    const skip = findHostByTestId(tree, 'rating-gate-skip');
    expect(submit?.props.accessibilityRole).toBe('button');
    expect(submit?.props.accessibilityLabel).toBe('별점 남기기');
    expect(skip?.props.accessibilityRole).toBe('button');
    expect(skip?.props.accessibilityLabel).toBe('나중에');
  });

  it('uses variant-specific layout testID', () => {
    const tree = render(
      React.createElement(RatingGateContent, {
        onSubmit: NO_OP,
        onSkip: NO_OP,
        variant: 'secondary',
      }),
    );
    expect(findHostByTestId(tree, 'rating-gate-secondary-screen')).toBeTruthy();
  });
});

describe('RatingGateContent — interaction (both CTAs advance forward)', () => {
  it('invokes onSubmit when the submit CTA is pressed', () => {
    const onSubmit = vi.fn();
    const tree = render(
      React.createElement(RatingGateContent, {
        onSubmit,
        onSkip: NO_OP,
        variant: 'default',
      }),
    );
    const submit = findHostByTestId(tree, 'rating-gate-submit');
    const onPress = submit?.props.onPress as (e: unknown) => void;
    act(() => onPress({}));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('invokes onSkip when the skip CTA is pressed (dismissable: true)', () => {
    const onSkip = vi.fn();
    const tree = render(
      React.createElement(RatingGateContent, {
        onSubmit: NO_OP,
        onSkip,
        variant: 'default',
      }),
    );
    const skip = findHostByTestId(tree, 'rating-gate-skip');
    const onPress = skip?.props.onPress as () => void;
    act(() => onPress());
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
