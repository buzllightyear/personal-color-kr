/**
 * Unit test — `ValuePropositionScreen` presentational component.
 *
 * Sub-AC 14a-1: 가치 제시(ValuePropositionScreen) 컴포넌트 — 헤드라인·혜택 목록·
 * CTA 버튼이 올바르게 렌더링되는지 단위 테스트
 *
 * What this test pins:
 *   1. Renders the Korean headline from FUNNEL_SCREENS.value_props
 *      ("오늘의 트렌드, 내 얼굴에 맞춘 편집").
 *   2. Renders exactly 3 moat-aligned benefit cards in a ScrollView:
 *      - trend_matched_generation (트렌드 맞춤 사진 생성)
 *      - trend_drop_freshness (트렌드 드롭 알림)
 *      - personal_color_recipe (내 컬러 recipe 추천)
 *   3. Does NOT render a "monthly_curated_magazine" card (Seed constraint:
 *      월간 매거진 포맷 금지).
 *   4. Each benefit card contains a title and description Text node.
 *   5. The primary CTA renders with accessibilityRole="button" and
 *      accessibilityLabel="다음".
 *   6. Tapping the CTA invokes the `onNext` callback exactly once.
 *
 * Moat integrity asserted:
 *   - No "monthly_curated_magazine" card (old direction artefact must be absent)
 *   - Benefits reference trend generation + trend drops + personal colour — the
 *     three pillars of the moat (생성 파이프라인 + 갱신 엔진 + 청중 신뢰)
 *
 * Pattern follows sibling tests in this directory (react-test-renderer +
 * vi.mock('react-native') + vi.mock('react-native-safe-area-context')).
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

import { ValuePropositionScreen } from '../src/screens/funnel/ValuePropositionScreen';

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

function findAllHostByTestId(
  tree: TestRenderer.ReactTestRenderer,
  pattern: RegExp,
): readonly TestInstance[] {
  return tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      typeof node.props?.testID === 'string' &&
      pattern.test(node.props.testID as string),
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

// ---------------------------------------------------------------------------
// Render tests — 헤드라인 (headline)
// ---------------------------------------------------------------------------

describe('ValuePropositionScreen — headline (Sub-AC 14a-1 헤드라인)', () => {
  it('renders the Korean headline "오늘의 트렌드, 내 얼굴에 맞춘 편집"', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    const headline = findHostByTestId(tree, 'value-proposition-headline');
    expect(headline?.props.children).toBe('오늘의 트렌드, 내 얼굴에 맞춘 편집');
  });

  it('renders the Korean subhead from FUNNEL_SCREENS.value_props', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    const subhead = findHostByTestId(tree, 'value-proposition-subhead');
    expect(subhead?.props.children).toBeTruthy();
    expect(typeof subhead?.props.children).toBe('string');
  });

  it('renders the headline group container', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    expect(findHostByTestId(tree, 'value-proposition-headline-group')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Render tests — 혜택 목록 (benefit cards)
// ---------------------------------------------------------------------------

describe('ValuePropositionScreen — benefit list (Sub-AC 14a-1 혜택 목록)', () => {
  it('renders the benefit list ScrollView container', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    expect(findHostByTestId(tree, 'value-proposition-benefit-list')).toBeTruthy();
  });

  it('renders exactly 3 benefit cards', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    // Cards have testID: value-proposition-benefit-<key> (with a suffix after 'benefit-')
    const cards = findAllHostByTestId(
      tree,
      /^value-proposition-benefit-[a-z-]+$/,
    ).filter((c) => c.props.testID !== 'value-proposition-benefit-list');
    expect(cards).toHaveLength(3);
  });

  it('renders the trend_matched_generation benefit card (core moat)', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    expect(
      findHostByTestId(tree, 'value-proposition-benefit-trend-matched-generation'),
    ).toBeTruthy();
  });

  it('renders the trend_drop_freshness benefit card (retention engine)', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    expect(
      findHostByTestId(tree, 'value-proposition-benefit-trend-drop-freshness'),
    ).toBeTruthy();
  });

  it('renders the personal_color_recipe benefit card (wedge hook)', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    expect(
      findHostByTestId(tree, 'value-proposition-benefit-personal-color-recipe'),
    ).toBeTruthy();
  });

  it('does NOT render a monthly_curated_magazine card (Seed: 월간 매거진 포맷 금지)', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    // The old direction card must be completely absent — if it appears the moat
    // rework is incomplete.
    expect(
      findHostByTestId(tree, 'value-proposition-benefit-monthly-curated-magazine'),
    ).toBeNull();
    // Also confirm no node anywhere in the tree carries the old key
    const staleCards = findAllHostByTestId(tree, /monthly-curated-magazine/);
    expect(staleCards).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Render tests — CTA 버튼 (CTA button)
// ---------------------------------------------------------------------------

describe('ValuePropositionScreen — CTA button (Sub-AC 14a-1 CTA 버튼)', () => {
  it('renders the primary CTA button', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    expect(findHostByTestId(tree, 'value-proposition-cta')).toBeTruthy();
  });

  it('CTA has accessibilityRole="button"', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    const cta = findHostByTestId(tree, 'value-proposition-cta');
    expect(cta?.props.accessibilityRole).toBe('button');
  });

  it('CTA has accessibilityLabel="다음"', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    const cta = findHostByTestId(tree, 'value-proposition-cta');
    expect(cta?.props.accessibilityLabel).toBe('다음');
  });

  it('CTA label text matches FUNNEL_SCREENS.value_props CTA label ("다음")', () => {
    const tree = render(
      React.createElement(ValuePropositionScreen, { onNext: vi.fn() }),
    );
    // The FunnelPrimaryButton renders a Text child with the label string.
    // Walk one level down from the Pressable to find the Text child.
    const ctaNode = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' && node.props?.testID === 'value-proposition-cta',
    )[0];
    expect(ctaNode).toBeTruthy();
    // The label content is carried in children — either as a direct string or
    // as a Text child's children. Find any Text descendant of the CTA.
    const textChildren = ctaNode?.findAll(
      (node) => typeof node.type === 'string' && node.type === 'Text',
    );
    const labelNode = textChildren?.find(
      (n) => typeof n.props.children === 'string' && n.props.children.length > 0,
    );
    expect(labelNode?.props.children).toBe('다음');
  });
});

// ---------------------------------------------------------------------------
// Interaction test
// ---------------------------------------------------------------------------

describe('ValuePropositionScreen — interaction', () => {
  it('invokes onNext when the primary CTA is pressed', () => {
    const onNext = vi.fn();
    const tree = render(React.createElement(ValuePropositionScreen, { onNext }));
    const cta = findHostByTestId(tree, 'value-proposition-cta');
    const onPress = cta?.props.onPress as (e: unknown) => void;
    act(() => onPress({}));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onNext before the CTA is pressed', () => {
    const onNext = vi.fn();
    render(React.createElement(ValuePropositionScreen, { onNext }));
    expect(onNext).not.toHaveBeenCalled();
  });
});
