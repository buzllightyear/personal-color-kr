/**
 * ResultRevealScreen — secondary "트렌드 시작하기" CTA (content-generation
 * entry).
 *
 * Contract:
 *   - The trends CTA is the in-app entry into the recipe catalog
 *     (`(generate)/(tabs)/catalog`). It renders on every NON-preview branch —
 *     both the default (pre-payment) user and the premium user can browse
 *     trends — so the visibility rule is exactly `isPreviewMode === false`
 *     (independent of `isPremium`, unlike the share-to-unlock CTA).
 *   - The read-only share-recipient preview (`isPreviewMode === true`) omits
 *     it, matching the existing preview-mode read-only invariant.
 *   - Pressing it invokes `onBrowseTrends` exactly once (the route wires that
 *     to `router.push('/(generate)/(tabs)/catalog')`; the navigation literal
 *     itself is asserted in result-reveal-route.test.tsx).
 *
 *   isPreviewMode | isPremium | trends CTA?
 *   ──────────────┼───────────┼────────────
 *        false    |   false   | YES
 *        false    |   true    | YES
 *        true     |   false   | no
 *        true     |   true    | no
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

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('SafeAreaView', props, props.children),
}));

import { ResultRevealScreen } from '../src/screens/funnel/ResultRevealScreen';

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

function findTextNodesWithLabel(
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): readonly TestInstance[] {
  return tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      node.type === 'Text' &&
      typeof node.props?.children === 'string' &&
      node.props.children === label,
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

const NO_OP = (): void => undefined;

// Pinned authoritative literals — a future rename of the component constants
// must still satisfy this contract.
const TRENDS_CTA_TEST_ID = 'result-reveal-trends-cta';
const TRENDS_CTA_LABEL = '트렌드 시작하기';

describe('ResultRevealScreen — trends-entry CTA', () => {
  it('renders the trends CTA in the default branch (isPreviewMode=false, isPremium=false)', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        isPremium: false,
        onUnlock: NO_OP,
        onBrowseTrends: NO_OP,
      }),
    );
    expect(findHostByTestId(tree, TRENDS_CTA_TEST_ID)).toBeTruthy();
    expect(findTextNodesWithLabel(tree, TRENDS_CTA_LABEL)).toHaveLength(1);
  });

  it('renders the trends CTA in the premium branch (isPreviewMode=false, isPremium=true)', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        isPremium: true,
        onUnlock: NO_OP,
        onBrowseTrends: NO_OP,
      }),
    );
    expect(findHostByTestId(tree, TRENDS_CTA_TEST_ID)).toBeTruthy();
    expect(findTextNodesWithLabel(tree, TRENDS_CTA_LABEL)).toHaveLength(1);
  });

  it('hides the trends CTA in preview mode (isPreviewMode=true)', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: true,
        isPremium: false,
        onUnlock: NO_OP,
        onBrowseTrends: NO_OP,
      }),
    );
    expect(findHostByTestId(tree, TRENDS_CTA_TEST_ID)).toBeNull();
    expect(findTextNodesWithLabel(tree, TRENDS_CTA_LABEL)).toHaveLength(0);
  });

  it('invokes onBrowseTrends exactly once when the trends CTA is pressed', () => {
    const onBrowseTrends = vi.fn();
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        isPremium: false,
        onUnlock: NO_OP,
        onBrowseTrends,
      }),
    );
    const cta = findHostByTestId(tree, TRENDS_CTA_TEST_ID);
    expect(cta).toBeTruthy();
    const onPress = cta?.props.onPress as () => void;
    act(() => onPress());
    expect(onBrowseTrends).toHaveBeenCalledTimes(1);
  });
});
