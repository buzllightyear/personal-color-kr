/**
 * Unit test — `apps/mobile/src/components/funnel/GuideList.tsx` selfie-prep
 * cue checklist (Phase 2.3, Sub-AC 5.1).
 *
 * What this test pins:
 *   1. All three Korean guide strings (`정면`, `자연광`, `민낯`) appear in
 *      the rendered output — this is the *primary* contract this Sub-AC
 *      requires: "a unit test verifying all three guide strings are
 *      present in the rendered output".
 *   2. The cues render in the documented canonical order (정면 → 자연광
 *      → 민낯). Reordering them would silently break the visual reading
 *      hierarchy.
 *   3. Each cue row carries the documented testID pattern
 *      (`guide-list-item-{index}` and `guide-list-item-{index}-label`),
 *      plus a stable container testID (`guide-list`).
 *   4. The `GUIDE_ITEMS` export matches the rendered cues (any drift
 *      between the exported constant and the component's `.map()` would
 *      get caught here).
 *   5. Exactly three cue rows render — no stray extra rows leak from a
 *      future refactor that accidentally double-renders an item.
 *   6. The component accepts an optional `testIDPrefix` prop that
 *      re-roots every testID — verifies the documented prefix convention
 *      so a future screen mounting two lists can disambiguate.
 *
 * Why react-test-renderer + the same `vi.mock('react-native')` shape as
 * funnel-headline.test.tsx:
 *   The setup-rn-stub pre-populates Node's CJS require.cache so the
 *   testing-library helpers do not crash on `require('react-native')`. Vite's
 *   ESM SSR transform, however, resolves the component's
 *   `import { View, Text, StyleSheet } from 'react-native'` through the ESM
 *   path which lands on the real Flow file. The inline `vi.mock` shadows
 *   that resolution with a minimal host-component map, exactly mirroring
 *   the sibling component tests' pattern so a future contributor can copy
 *   the incantation between tests without re-deriving it.
 *
 * Why props-based (not screen-mounted):
 *   GuideList is a pure leaf component — no expo-router, no context, no
 *   async. A direct prop-injection render asserts the contract surface
 *   without spinning up the Stack navigator or the FunnelStateProvider.
 */
import * as React from 'react';
import TestRenderer from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Mock `react-native` ESM entry to a minimal host-component set — see the
// funnel-headline.test.tsx file-level docblock for the full rationale.
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

import { GUIDE_ITEMS, GuideList } from '../src/components/funnel/GuideList';

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
    (node) => typeof node.type === 'string' && node.props?.testID === testID,
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
    throw new Error(`getByTestId('${testID}'): ${matches.length} matches (expected 1)`);
  }
  // matches[0] is guaranteed defined by the length checks above; the cast
  // narrows away the `noUncheckedIndexedAccess` `| undefined`.
  return matches[0] as TestInstance;
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  return TestRenderer.create(element);
}

/**
 * Walk the rendered tree and collect the visible Korean text of every
 * cue label `<Text>`. The label testID is `guide-list-item-{index}-label`
 * so a regex pin against the testID isolates the label nodes from the
 * decorative ✓ glyph nodes.
 */
function collectLabelTexts(
  tree: TestRenderer.ReactTestRenderer,
  prefix: string,
): readonly string[] {
  const labelNodes = tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      typeof node.props?.testID === 'string' &&
      new RegExp(`^${prefix}-item-\\d+-label$`).test(node.props.testID as string),
  );
  return labelNodes.map((node) => String(node.props.children));
}

describe('GuideList — all three Korean guide strings render (primary AC)', () => {
  it('renders the 정면 cue', () => {
    const tree = render(React.createElement(GuideList));
    const labels = collectLabelTexts(tree, 'guide-list');
    expect(labels).toContain('정면');
  });

  it('renders the 자연광 cue', () => {
    const tree = render(React.createElement(GuideList));
    const labels = collectLabelTexts(tree, 'guide-list');
    expect(labels).toContain('자연광');
  });

  it('renders the 민낯 cue', () => {
    const tree = render(React.createElement(GuideList));
    const labels = collectLabelTexts(tree, 'guide-list');
    expect(labels).toContain('민낯');
  });

  it('renders all three cues together (single assertion, defends against drift)', () => {
    const tree = render(React.createElement(GuideList));
    const labels = collectLabelTexts(tree, 'guide-list');
    // Sort-stable membership check — the order assertion lives in its own
    // describe block below.
    expect(new Set(labels)).toEqual(new Set(['정면', '자연광', '민낯']));
  });
});

describe('GuideList — canonical reading order (정면 → 자연광 → 민낯)', () => {
  it('renders the cues in the documented order', () => {
    const tree = render(React.createElement(GuideList));
    const labels = collectLabelTexts(tree, 'guide-list');
    expect(labels).toEqual(['정면', '자연광', '민낯']);
  });

  it('GUIDE_ITEMS export matches the rendered order', () => {
    // Defends against drift: if someone updates the component's map order
    // without updating the exported constant (or vice-versa), this fails.
    const tree = render(React.createElement(GuideList));
    const labels = collectLabelTexts(tree, 'guide-list');
    expect(labels).toEqual([...GUIDE_ITEMS]);
  });
});

describe('GuideList — testID convention', () => {
  it('renders a container testID of "guide-list" by default', () => {
    const tree = render(React.createElement(GuideList));
    expect(getByTestId(tree, 'guide-list')).toBeTruthy();
  });

  it('exposes per-row testIDs guide-list-item-0, guide-list-item-1, guide-list-item-2', () => {
    const tree = render(React.createElement(GuideList));
    expect(getByTestId(tree, 'guide-list-item-0')).toBeTruthy();
    expect(getByTestId(tree, 'guide-list-item-1')).toBeTruthy();
    expect(getByTestId(tree, 'guide-list-item-2')).toBeTruthy();
  });

  it('exposes per-label testIDs guide-list-item-{n}-label with the cue as inner text', () => {
    const tree = render(React.createElement(GuideList));
    expect(getByTestId(tree, 'guide-list-item-0-label').props.children).toBe('정면');
    expect(getByTestId(tree, 'guide-list-item-1-label').props.children).toBe('자연광');
    expect(getByTestId(tree, 'guide-list-item-2-label').props.children).toBe('민낯');
  });

  it('re-roots all testIDs when a custom testIDPrefix is supplied', () => {
    const tree = render(
      React.createElement(GuideList, { testIDPrefix: 'selfie-prep' }),
    );
    expect(getByTestId(tree, 'selfie-prep')).toBeTruthy();
    expect(getByTestId(tree, 'selfie-prep-item-0-label').props.children).toBe('정면');
    expect(getByTestId(tree, 'selfie-prep-item-2-label').props.children).toBe('민낯');
    // The default prefix must NOT appear when a custom prefix is supplied.
    expect(findAllByTestId(tree, 'guide-list')).toHaveLength(0);
  });
});

describe('GuideList — DOM shape (no stray rows)', () => {
  it('renders exactly three cue row containers', () => {
    const tree = render(React.createElement(GuideList));
    const rowNodes = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        typeof node.props?.testID === 'string' &&
        /^guide-list-item-\d+$/.test(node.props.testID as string),
    );
    expect(rowNodes.length).toBe(3);
  });

  it('renders exactly three cue label nodes', () => {
    const tree = render(React.createElement(GuideList));
    const labels = collectLabelTexts(tree, 'guide-list');
    expect(labels.length).toBe(3);
  });
});

describe('GuideList — GUIDE_ITEMS export contract', () => {
  it('exports the three Korean cues in canonical order', () => {
    expect([...GUIDE_ITEMS]).toEqual(['정면', '자연광', '민낯']);
  });

  it('exports a frozen array (no mutation possible)', () => {
    expect(Object.isFrozen(GUIDE_ITEMS)).toBe(true);
  });
});
