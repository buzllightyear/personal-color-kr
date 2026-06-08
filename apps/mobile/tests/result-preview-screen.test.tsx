/**
 * Unit test — `ResultPreviewScreen` presentational component (Sub-AC 14a-2).
 *
 * Asserts that the three core render elements are present and correct:
 *   1. **샘플 이미지 슬롯 (sample image slots)**: Exactly 3 static sample image
 *      placeholder slots render with stable testIDs and correct season-accent
 *      labels (spring/autumn/winter). The slot list container renders.
 *      No raw AI output — slots are design placeholders (Seed: 생짜 Fal.ai 출력 금지).
 *
 *   2. **트렌드 태그 (trend tags)**: Tag chips passed in via `trendTags` prop
 *      render correctly. Each chip is individually addressable by index-based
 *      testID. Correct text content is rendered inside each chip.
 *      Empty `trendTags` array hides the chip row entirely.
 *
 *   3. **생성 예시 텍스트 (generation example text)**: The string passed in via
 *      `generationExampleText` renders verbatim inside a `<Text>` node with the
 *      `result-preview-generation-example-text` testID. The component is
 *      copy-agnostic — any string from the voice config is rendered as-is.
 *
 * Additional assertions:
 *   4. Headline and subhead constants render from `RESULT_PREVIEW_HEADLINE` /
 *      `RESULT_PREVIEW_SUBHEAD` (hardcoded Korean copy, not sourced from
 *      FUNNEL_SCREENS — ensures invariant copy across trend variants).
 *   5. CTA button renders with `result-preview-cta` testID, `accessibilityRole`,
 *      and `accessibilityLabel`; pressing it invokes `onGenerate` exactly once.
 *   6. Screen root testID `result-preview-screen` and `accessibilityLabel`
 *      `"결과 프리뷰"` are present (screen-reader contract).
 *
 * Test pattern: `react-test-renderer` + `vi.mock('react-native')` + manual
 * `TestRenderer.create` inside `act()` — same pattern as sibling tests in
 * `apps/mobile/tests/`.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must precede all component imports
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Subject under test (imported AFTER mocks)
// ---------------------------------------------------------------------------

import {
  ResultPreviewScreen,
  RESULT_PREVIEW_HEADLINE,
  RESULT_PREVIEW_SUBHEAD,
  RESULT_PREVIEW_CTA_LABEL,
  SAMPLE_IMAGE_SLOTS,
} from '../src/screens/funnel/ResultPreviewScreen';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

/**
 * Find the first host element (string type node) whose `testID` prop exactly
 * matches `testID`. Returns `null` if no match is found.
 */
function findHostByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance | null {
  const matches = tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props?.testID === testID,
  );
  return (matches[0] as unknown as TestInstance) ?? null;
}

/**
 * Find all host elements whose `testID` prop matches the given regex.
 */
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

/**
 * Render a React element using `TestRenderer.create` inside `act()` so that
 * all synchronous effects and state updates are flushed before assertions.
 */
function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

const NO_OP = (): void => undefined;

/** Default props for rendering ResultPreviewScreen in tests. */
const DEFAULT_PROPS = {
  trendTags: ['#가을 웜톤 트렌드', '#셀피 감성'],
  generationExampleText: '마음에 드는 한 장을 고르세요',
  onGenerate: NO_OP,
} as const;

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

// ── 1. Sample image slots (샘플 이미지 슬롯) ────────────────────────────────

describe('ResultPreviewScreen — 샘플 이미지 슬롯 (sample image slots)', () => {
  it('renders the sample slot list ScrollView container', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    expect(findHostByTestId(tree, 'result-preview-sample-slot-list')).toBeTruthy();
  });

  it('renders exactly 3 sample image slots (spring / autumn / winter)', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    // Each slot has testID: result-preview-sample-slot-<slotId>
    const slots = findAllHostByTestId(tree, /^result-preview-sample-slot-[a-z]+$/);
    // Exclude the list container itself if it accidentally matches
    const slotCards = slots.filter(
      (s) => s.props.testID !== 'result-preview-sample-slot-list',
    );
    expect(slotCards).toHaveLength(3);
  });

  it('renders the spring season slot', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    expect(findHostByTestId(tree, 'result-preview-sample-slot-spring')).toBeTruthy();
  });

  it('renders the autumn season slot', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    expect(findHostByTestId(tree, 'result-preview-sample-slot-autumn')).toBeTruthy();
  });

  it('renders the winter season slot', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    expect(findHostByTestId(tree, 'result-preview-sample-slot-winter')).toBeTruthy();
  });

  it('each slot has the Korean season label as its accessibilityLabel', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    for (const slot of SAMPLE_IMAGE_SLOTS) {
      const node = findHostByTestId(tree, `result-preview-sample-slot-${slot.slotId}`);
      expect(node, `slot-${slot.slotId} should be in tree`).toBeTruthy();
      expect(node?.props.accessibilityLabel).toBe(slot.label);
    }
  });

  it('each slot renders a Text child containing the Korean label', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    for (const slot of SAMPLE_IMAGE_SLOTS) {
      const slotNode = tree.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props?.testID === `result-preview-sample-slot-${slot.slotId}`,
      )[0];
      expect(slotNode, `slot-${slot.slotId} should be in tree`).toBeTruthy();
      // Find a Text descendant whose children string matches the label
      const textNode = slotNode?.findAll(
        (n) =>
          typeof n.type === 'string' &&
          n.type === 'Text' &&
          typeof n.props?.children === 'string' &&
          n.props.children === slot.label,
      );
      expect(
        textNode?.length,
        `slot-${slot.slotId} should have a Text child with label "${slot.label}"`,
      ).toBeGreaterThan(0);
    }
  });

  it('SAMPLE_IMAGE_SLOTS constant exports exactly 3 entries', () => {
    expect(SAMPLE_IMAGE_SLOTS).toHaveLength(3);
  });

  it('SAMPLE_IMAGE_SLOTS contains spring, autumn, winter (no summer in v1)', () => {
    const ids = SAMPLE_IMAGE_SLOTS.map((s) => s.slotId);
    expect(ids).toContain('spring');
    expect(ids).toContain('autumn');
    expect(ids).toContain('winter');
    expect(ids).not.toContain('summer');
  });
});

// ── 2. Trend tags (트렌드 태그) ──────────────────────────────────────────────

describe('ResultPreviewScreen — 트렌드 태그 (trend tags)', () => {
  it('renders the trend tag list container when trendTags is non-empty', () => {
    const tree = render(
      React.createElement(ResultPreviewScreen, {
        ...DEFAULT_PROPS,
        trendTags: ['#가을 웜톤 트렌드'],
      }),
    );
    expect(findHostByTestId(tree, 'result-preview-trend-tag-list')).toBeTruthy();
  });

  it('does NOT render the trend tag list when trendTags is empty', () => {
    const tree = render(
      React.createElement(ResultPreviewScreen, {
        ...DEFAULT_PROPS,
        trendTags: [],
      }),
    );
    expect(findHostByTestId(tree, 'result-preview-trend-tag-list')).toBeNull();
  });

  it('renders exactly 2 trend tag chips for DEFAULT_PROPS trendTags', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const tags = findAllHostByTestId(tree, /^result-preview-trend-tag-\d+$/);
    expect(tags).toHaveLength(2);
  });

  it('renders the first trend tag chip (index 0) with correct testID', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    expect(findHostByTestId(tree, 'result-preview-trend-tag-0')).toBeTruthy();
  });

  it('renders the second trend tag chip (index 1) with correct testID', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    expect(findHostByTestId(tree, 'result-preview-trend-tag-1')).toBeTruthy();
  });

  it('first trend tag chip has the correct Korean tag text content', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const chipNode = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.props?.testID === 'result-preview-trend-tag-0',
    )[0];
    expect(chipNode).toBeTruthy();
    // The Text node inside the chip carries the tag string
    const textNode = chipNode?.findAll(
      (n) =>
        typeof n.type === 'string' &&
        n.type === 'Text' &&
        typeof n.props?.children === 'string' &&
        n.props.children === '#가을 웜톤 트렌드',
    );
    expect(
      textNode?.length,
      'chip 0 should contain "#가을 웜톤 트렌드" text',
    ).toBeGreaterThan(0);
  });

  it('second trend tag chip has the correct Korean tag text content', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const chipNode = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.props?.testID === 'result-preview-trend-tag-1',
    )[0];
    expect(chipNode).toBeTruthy();
    const textNode = chipNode?.findAll(
      (n) =>
        typeof n.type === 'string' &&
        n.type === 'Text' &&
        typeof n.props?.children === 'string' &&
        n.props.children === '#셀피 감성',
    );
    expect(textNode?.length, 'chip 1 should contain "#셀피 감성" text').toBeGreaterThan(
      0,
    );
  });

  it('renders the correct number of chips for an arbitrary trendTags array', () => {
    const tags = ['#트렌드A', '#트렌드B', '#트렌드C', '#트렌드D'];
    const tree = render(
      React.createElement(ResultPreviewScreen, {
        ...DEFAULT_PROPS,
        trendTags: tags,
      }),
    );
    const chips = findAllHostByTestId(tree, /^result-preview-trend-tag-\d+$/);
    expect(chips).toHaveLength(tags.length);
  });

  it('each trend tag chip carries the tag string as accessibilityLabel', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const tag0 = findHostByTestId(tree, 'result-preview-trend-tag-0');
    const tag1 = findHostByTestId(tree, 'result-preview-trend-tag-1');
    expect(tag0?.props.accessibilityLabel).toBe('#가을 웜톤 트렌드');
    expect(tag1?.props.accessibilityLabel).toBe('#셀피 감성');
  });
});

// ── 3. Generation example text (생성 예시 텍스트) ──────────────────────────

describe('ResultPreviewScreen — 생성 예시 텍스트 (generation example text)', () => {
  it('renders the generation example text node with the correct testID', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    expect(
      findHostByTestId(tree, 'result-preview-generation-example-text'),
    ).toBeTruthy();
  });

  it('renders the exact string passed as generationExampleText', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const node = findHostByTestId(tree, 'result-preview-generation-example-text');
    expect(node?.props.children).toBe('마음에 드는 한 장을 고르세요');
  });

  it('renders a different string when generationExampleText changes', () => {
    const customText = '후보 4장 생성됨 — 한 장을 선택해주세요';
    const tree = render(
      React.createElement(ResultPreviewScreen, {
        ...DEFAULT_PROPS,
        generationExampleText: customText,
      }),
    );
    const node = findHostByTestId(tree, 'result-preview-generation-example-text');
    expect(node?.props.children).toBe(customText);
  });

  it('generation example text node is a Text element', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const node = tree.root.findAll(
      (n) =>
        typeof n.type === 'string' &&
        n.type === 'Text' &&
        n.props?.testID === 'result-preview-generation-example-text',
    )[0];
    expect(node).toBeTruthy();
  });

  it('renders voice config copy correctly — getSelectionPrompt output', () => {
    // This test demonstrates that the component is copy-agnostic:
    // any string (including voice config output) is rendered verbatim.
    const voiceConfigCopy = '마음에 드는 한 장을 고르세요';
    const tree = render(
      React.createElement(ResultPreviewScreen, {
        ...DEFAULT_PROPS,
        generationExampleText: voiceConfigCopy,
      }),
    );
    const node = findHostByTestId(tree, 'result-preview-generation-example-text');
    expect(node?.props.children).toBe(voiceConfigCopy);
  });
});

// ── 4. Headline and subhead ──────────────────────────────────────────────────

describe('ResultPreviewScreen — headline and subhead', () => {
  it('renders the headline from RESULT_PREVIEW_HEADLINE constant', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const headline = findHostByTestId(tree, 'result-preview-headline');
    expect(headline).toBeTruthy();
    expect(headline?.props.children).toBe(RESULT_PREVIEW_HEADLINE);
  });

  it('renders "이런 사진이 나와요" as the headline', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const headline = findHostByTestId(tree, 'result-preview-headline');
    expect(headline?.props.children).toBe('이런 사진이 나와요');
  });

  it('renders the subhead from RESULT_PREVIEW_SUBHEAD constant', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const subhead = findHostByTestId(tree, 'result-preview-subhead');
    expect(subhead).toBeTruthy();
    expect(subhead?.props.children).toBe(RESULT_PREVIEW_SUBHEAD);
  });

  it('renders the moat-aligned subhead (de-slop pipeline framing)', () => {
    // "퍼스널 컬러 recipe로 보정된 생성 예시" signals de-slop enhancement,
    // NOT raw AI output — Seed: 생짜 Fal.ai 출력 금지
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const subhead = findHostByTestId(tree, 'result-preview-subhead');
    expect(subhead?.props.children).toBe('퍼스널 컬러 recipe로 보정된 생성 예시');
  });

  it('renders the headline group container', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    expect(findHostByTestId(tree, 'result-preview-headline-group')).toBeTruthy();
  });

  it('RESULT_PREVIEW_HEADLINE constant equals "이런 사진이 나와요"', () => {
    expect(RESULT_PREVIEW_HEADLINE).toBe('이런 사진이 나와요');
  });

  it('RESULT_PREVIEW_SUBHEAD constant equals "퍼스널 컬러 recipe로 보정된 생성 예시"', () => {
    expect(RESULT_PREVIEW_SUBHEAD).toBe('퍼스널 컬러 recipe로 보정된 생성 예시');
  });
});

// ── 5. CTA button ────────────────────────────────────────────────────────────

describe('ResultPreviewScreen — CTA button', () => {
  it('renders the primary CTA with testID "result-preview-cta"', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    expect(findHostByTestId(tree, 'result-preview-cta')).toBeTruthy();
  });

  it('CTA has accessibilityRole="button"', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const cta = findHostByTestId(tree, 'result-preview-cta');
    expect(cta?.props.accessibilityRole).toBe('button');
  });

  it('CTA accessibilityLabel matches RESULT_PREVIEW_CTA_LABEL', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const cta = findHostByTestId(tree, 'result-preview-cta');
    expect(cta?.props.accessibilityLabel).toBe(RESULT_PREVIEW_CTA_LABEL);
    expect(cta?.props.accessibilityLabel).toBe('내 셀카로 생성하기');
  });

  it('CTA label text "내 셀카로 생성하기" is rendered as a Text child', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const textNodes = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.type === 'Text' &&
        typeof node.props?.children === 'string' &&
        node.props.children === '내 셀카로 생성하기',
    );
    expect(
      textNodes.length,
      'CTA label should be rendered as a <Text> child',
    ).toBeGreaterThan(0);
  });

  it('pressing the CTA invokes onGenerate exactly once', () => {
    const onGenerate = vi.fn();
    const tree = render(
      React.createElement(ResultPreviewScreen, {
        ...DEFAULT_PROPS,
        onGenerate,
      }),
    );
    const cta = findHostByTestId(tree, 'result-preview-cta');
    const onPress = cta?.props.onPress as (() => void) | undefined;
    expect(typeof onPress).toBe('function');
    act(() => {
      (onPress as () => void)();
    });
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onGenerate before the CTA is pressed', () => {
    const onGenerate = vi.fn();
    render(
      React.createElement(ResultPreviewScreen, {
        ...DEFAULT_PROPS,
        onGenerate,
      }),
    );
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('RESULT_PREVIEW_CTA_LABEL constant equals "내 셀카로 생성하기"', () => {
    expect(RESULT_PREVIEW_CTA_LABEL).toBe('내 셀카로 생성하기');
  });
});

// ── 6. Screen root accessibility ─────────────────────────────────────────────

describe('ResultPreviewScreen — screen root', () => {
  it('renders with testID "result-preview-screen"', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    expect(findHostByTestId(tree, 'result-preview-screen')).toBeTruthy();
  });

  it('screen root has accessibilityLabel "결과 프리뷰"', () => {
    const tree = render(React.createElement(ResultPreviewScreen, DEFAULT_PROPS));
    const root = findHostByTestId(tree, 'result-preview-screen');
    expect(root?.props.accessibilityLabel).toBe('결과 프리뷰');
  });
});
