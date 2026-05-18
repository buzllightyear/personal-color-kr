/**
 * Unit test — `apps/mobile/src/components/FunnelHeadline.tsx` shared
 * headline + subhead component (AC 10).
 *
 * What this test pins:
 *   1. Both rows render their respective Korean copy via props.
 *   2. The testID prefix expands deterministically to `<prefix>-headline` and
 *      `<prefix>-subhead`, plus a group container `<prefix>-headline-group`.
 *   3. The headline `<Text>` carries the `TYPOGRAPHY.headline.bold`
 *      fontSize + fontWeight; the subhead `<Text>` carries the
 *      `TYPOGRAPHY.subhead.regular` fontSize + fontWeight. Drifting either
 *      away from the design tokens is what this test exists to catch.
 *   4. Both rows carry the grayscale text colour from `COLORS.grayscale.text`.
 *   5. Both rows carry `accessibilityRole="header"` so VoiceOver/TalkBack
 *      announces them as headings (Seed constraint
 *      "accessibility_minimum_met").
 *   6. The visible order is headline-first, subhead-second (a future
 *      reordering would silently break the reading hierarchy on screen
 *      readers).
 *   7. The component does not render any unexpected extra `<Text>` nodes —
 *      the test counts text descendants and asserts exactly two.
 *
 * Why react-test-renderer + the same `vi.mock('react-native')` shape as
 * funnel-placeholder-smoke.test.tsx:
 *   The setup-rn-stub pre-populates Node's CJS require.cache so the
 *   testing-library helpers do not crash on `require('react-native')`. Vite's
 *   ESM SSR transform, however, resolves the component's
 *   `import { View, Text, StyleSheet } from 'react-native'` through the ESM
 *   path which lands on the real Flow file. The inline `vi.mock` shadows
 *   that resolution with a minimal host-component map, exactly mirroring the
 *   sibling smoke test's pattern so a future contributor can copy the
 *   incantation between tests without re-deriving it.
 *
 * Why props-based (not screen-mounted):
 *   FunnelHeadline is a pure leaf component — no expo-router, no context,
 *   no async. A direct prop-injection render asserts the contract surface
 *   without spinning up the Stack navigator or the FunnelStateProvider.
 *   This is the same pattern the Seed evaluation principle
 *   "test_coverage: props-based render tests" calls for.
 */
import * as React from 'react';
import TestRenderer from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Mock `react-native` ESM entry to a minimal host-component set — see the
// funnel-placeholder-smoke.test.tsx file-level docblock for the full
// rationale. We re-implement the same shape here (not import a shared helper)
// because vitest's `vi.mock` is hoisted per-test-file and a cross-file mock
// hoist would not be ergonomic to share.
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

import { COLORS, SPACING, TYPOGRAPHY } from '../src/theme';
import { FunnelHeadline } from '../src/components/FunnelHeadline';

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: readonly (TestInstance | string)[];
}

function findAllByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): readonly TestInstance[] {
  // Filter for host elements only (where `type` is a string like 'View'/'Text').
  // The mocked react-native components wrap their host element in a function
  // component, so `findAll` would otherwise return two matches per testID
  // (the wrapper FC + the rendered host); we want the host node only.
  return tree.root.findAll(
    (node) =>
      typeof node.type === 'string' && node.props?.testID === testID,
  ) as unknown as readonly TestInstance[];
}

function getByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance {
  const matches = findAllByTestId(tree, testID);
  if (matches.length === 0) {
    throw new Error(`getByTestId('${testID}'): no match`);
  }
  if (matches.length > 1) {
    throw new Error(
      `getByTestId('${testID}'): ${matches.length} matches (expected 1)`,
    );
  }
  // matches[0] is guaranteed defined by the length checks above; the cast
  // narrows away the `noUncheckedIndexedAccess` `| undefined`.
  return matches[0] as TestInstance;
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  return TestRenderer.create(element);
}

/**
 * Canonical Korean copy from `FUNNEL_SCREENS.welcome_hook` — using real
 * copy (not a placeholder like `'foo'`) guards against subtle rendering
 * bugs around hangul-width strings (e.g. accidental String → number
 * coercion would discard the Korean glyphs).
 */
const KOREAN_HEADLINE = '내 퍼스널 컬러로 셀카가 한 장 더 빛나도록';
const KOREAN_SUBHEAD = '1분 진단으로 봄·여름·가을·겨울 카테고리부터 맞춤 편집까지';

describe('FunnelHeadline — Korean copy renders verbatim via props', () => {
  it('renders the headline prop as the inner text of the headline row', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    const headlineNode = getByTestId(tree, 'welcome-hook-headline');
    expect(headlineNode.props.children).toBe(KOREAN_HEADLINE);
  });

  it('renders the subhead prop as the inner text of the subhead row', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    const subheadNode = getByTestId(tree, 'welcome-hook-subhead');
    expect(subheadNode.props.children).toBe(KOREAN_SUBHEAD);
  });
});

describe('FunnelHeadline — testID prefix expansion', () => {
  it('builds testIDs from the prefix prop ({prefix}-headline / -subhead / -headline-group)', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: 'h',
        subhead: 's',
        testIDPrefix: 'value-props',
      }),
    );
    expect(getByTestId(tree, 'value-props-headline')).toBeTruthy();
    expect(getByTestId(tree, 'value-props-subhead')).toBeTruthy();
    expect(getByTestId(tree, 'value-props-headline-group')).toBeTruthy();
  });

  it('handles different screen prefixes without colliding (welcome-hook vs fake-loader)', () => {
    const welcomeTree = render(
      React.createElement(FunnelHeadline, {
        headline: 'h1',
        subhead: 's1',
        testIDPrefix: 'welcome-hook',
      }),
    );
    const loaderTree = render(
      React.createElement(FunnelHeadline, {
        headline: 'h2',
        subhead: 's2',
        testIDPrefix: 'fake-loader',
      }),
    );
    expect(getByTestId(welcomeTree, 'welcome-hook-headline').props.children).toBe('h1');
    expect(getByTestId(loaderTree, 'fake-loader-headline').props.children).toBe('h2');

    // Cross-prefix lookups must return nothing.
    expect(findAllByTestId(welcomeTree, 'fake-loader-headline')).toHaveLength(0);
    expect(findAllByTestId(loaderTree, 'welcome-hook-headline')).toHaveLength(0);
  });
});

describe('FunnelHeadline — typography tokens applied (no drift from design tokens)', () => {
  it('applies TYPOGRAPHY.headline.bold (fontSize + fontWeight) to the headline row', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    const headlineNode = getByTestId(tree, 'welcome-hook-headline');
    const style = headlineNode.props.style as {
      fontSize?: number;
      fontWeight?: string;
      color?: string;
    };
    expect(style.fontSize).toBe(TYPOGRAPHY.headline.bold.fontSize);
    expect(style.fontWeight).toBe(TYPOGRAPHY.headline.bold.fontWeight);
  });

  it('applies TYPOGRAPHY.subhead.regular (fontSize + fontWeight) to the subhead row', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    const subheadNode = getByTestId(tree, 'welcome-hook-subhead');
    const style = subheadNode.props.style as {
      fontSize?: number;
      fontWeight?: string;
      color?: string;
    };
    expect(style.fontSize).toBe(TYPOGRAPHY.subhead.regular.fontSize);
    expect(style.fontWeight).toBe(TYPOGRAPHY.subhead.regular.fontWeight);
  });

  it('paints both rows with COLORS.grayscale.text (canonical near-black)', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    const headlineStyle = getByTestId(tree, 'welcome-hook-headline').props
      .style as { color?: string };
    const subheadStyle = getByTestId(tree, 'welcome-hook-subhead').props
      .style as { color?: string };
    expect(headlineStyle.color).toBe(COLORS.grayscale.text);
    expect(subheadStyle.color).toBe(COLORS.grayscale.text);
  });

  it('honours SPACING.xs for the headline→subhead vertical rhythm via container gap', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    const group = getByTestId(tree, 'welcome-hook-headline-group');
    const groupStyle = group.props.style as { gap?: number };
    expect(groupStyle.gap).toBe(SPACING.xs);
  });
});

describe('FunnelHeadline — accessibility surface (Seed: accessibility_minimum_met)', () => {
  it('marks the headline row as accessibilityRole="header"', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    expect(getByTestId(tree, 'welcome-hook-headline').props.accessibilityRole).toBe('header');
  });

  it('marks the subhead row as accessibilityRole="header"', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    expect(getByTestId(tree, 'welcome-hook-subhead').props.accessibilityRole).toBe('header');
  });

  it('does NOT synthesise an accessibilityLabel — the visible Korean text IS the announcement', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    // Passing accessibilityLabel would duplicate the visible copy and risk
    // drift; the contract is: only role, no synthesised label.
    expect(getByTestId(tree, 'welcome-hook-headline').props.accessibilityLabel).toBeUndefined();
    expect(getByTestId(tree, 'welcome-hook-subhead').props.accessibilityLabel).toBeUndefined();
  });
});

describe('FunnelHeadline — DOM shape & visible order', () => {
  it('renders headline FIRST and subhead SECOND in source order (h1 → h2 reading hierarchy)', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    // Walk the rendered tree, find every node carrying a testID that ends
    // in `-headline` or `-subhead`, and assert they appear in the expected
    // order via test-renderer's depth-first traversal.
    const textRows = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        typeof node.props?.testID === 'string' &&
        (node.props.testID === 'welcome-hook-headline' ||
          node.props.testID === 'welcome-hook-subhead'),
    );
    expect(textRows.length).toBe(2);
    expect(textRows[0]?.props.testID).toBe('welcome-hook-headline');
    expect(textRows[1]?.props.testID).toBe('welcome-hook-subhead');
  });

  it('renders exactly two text rows (no stray Text nodes leak from refactors)', () => {
    const tree = render(
      React.createElement(FunnelHeadline, {
        headline: KOREAN_HEADLINE,
        subhead: KOREAN_SUBHEAD,
        testIDPrefix: 'welcome-hook',
      }),
    );
    const textNodes = tree.root.findAllByType('Text' as unknown as React.ComponentType<unknown>);
    expect(textNodes.length).toBe(2);
  });
});
