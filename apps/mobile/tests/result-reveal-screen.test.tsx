/**
 * Unit test — `ResultRevealScreen` presentational component (Phase 2.3,
 * Sub-AC 4).
 *
 * Asserts:
 *   1. Renders the Korean headline + subhead + body copy sourced from
 *      FUNNEL_SCREENS.result_reveal.
 *   2. Renders exactly 3 visually distinct locked content assets
 *      (full_category_card hero card, guide_text 3-line stack, first_curation
 *      2x2 grid) — the metadata.lockedAssets contract is honoured at runtime.
 *   3. Each locked asset renders both a placeholder layer at
 *      LOCKED_ASSET_PLACEHOLDER_OPACITY (0.2) and an overlay layer at
 *      LOCKED_ASSET_OVERLAY_OPACITY (0.85) — the "behind glass" treatment
 *      called out in the Seed constraint set.
 *   4. Each locked asset overlay carries the 🔒 Unicode emoji rendered in a
 *      <Text> node with accessibilityLabel="잠김" — the constraint pins the
 *      lock indicator to a Unicode glyph (no @expo/vector-icons), and the
 *      Korean a11y label means screen-readers announce "잠김" rather than
 *      the raw codepoint.
 *   5. Renders the primary "결과 잠금 해제" CTA when `isPreviewMode === false`
 *      and invokes `onUnlock` exactly once when pressed.
 *   6. Hides the primary CTA when `isPreviewMode === true` (preserved from
 *      the Phase 2.1 share_token preview branch behaviour).
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

import {
  ResultRevealScreen,
  LOCKED_ASSET_PLACEHOLDER_OPACITY,
  LOCKED_ASSET_OVERLAY_OPACITY,
} from '../src/screens/funnel/ResultRevealScreen';

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

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

function flattenStyles(styleProp: unknown): Record<string, unknown> {
  if (Array.isArray(styleProp)) {
    return styleProp.reduce<Record<string, unknown>>((acc, item) => {
      if (item && typeof item === 'object') {
        return { ...acc, ...(item as Record<string, unknown>) };
      }
      return acc;
    }, {});
  }
  if (styleProp && typeof styleProp === 'object') {
    return styleProp as Record<string, unknown>;
  }
  return {};
}

const NO_OP = (): void => undefined;

describe('ResultRevealScreen — render', () => {
  it('renders the Korean headline from FUNNEL_SCREENS.result_reveal', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        onUnlock: NO_OP,
      }),
    );
    const headline = findHostByTestId(tree, 'result-reveal-headline');
    expect(headline).toBeTruthy();
    expect(headline?.props.children).toBe('당신의 카테고리는 ✦ 가을 웜톤 ✦');
  });

  it('renders the Korean subhead from FUNNEL_SCREENS.result_reveal', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        onUnlock: NO_OP,
      }),
    );
    const subhead = findHostByTestId(tree, 'result-reveal-subhead');
    expect(subhead).toBeTruthy();
    expect(subhead?.props.children).toBe(
      '어울리는 메이크업·코디 + 맞춤 편집 결과는 다음 단계에서 공개돼요',
    );
  });

  it('renders the body copy from FUNNEL_SCREENS.result_reveal', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        onUnlock: NO_OP,
      }),
    );
    const body = findHostByTestId(tree, 'result-reveal-body-copy');
    expect(body).toBeTruthy();
    expect(body?.props.children).toBe(
      '전체 진단 카드 · 가이드 텍스트 · 첫 추천 패키지 4종이 잠겨 있어요.',
    );
  });
});

describe('ResultRevealScreen — locked assets', () => {
  it('renders exactly 3 locked content assets keyed by metadata.lockedAssets', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        onUnlock: NO_OP,
      }),
    );
    expect(
      findHostByTestId(tree, 'result-reveal-locked-asset-full-category-card'),
    ).toBeTruthy();
    expect(findHostByTestId(tree, 'result-reveal-locked-asset-guide-text')).toBeTruthy();
    expect(
      findHostByTestId(tree, 'result-reveal-locked-asset-first-curation'),
    ).toBeTruthy();
  });

  it('renders three visually distinct asset variants (hero card, text stack, 2x2 grid)', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        onUnlock: NO_OP,
      }),
    );
    expect(
      findHostByTestId(
        tree,
        'result-reveal-locked-asset-full-category-card-hero-card',
      ),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'result-reveal-locked-asset-guide-text-text-stack'),
    ).toBeTruthy();
    expect(
      findHostByTestId(
        tree,
        'result-reveal-locked-asset-first-curation-grid-2x2',
      ),
    ).toBeTruthy();
  });

  it('each locked asset has a placeholder layer at 0.2 opacity and an overlay at 0.85 opacity', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        onUnlock: NO_OP,
      }),
    );
    const assetIds: readonly string[] = [
      'result-reveal-locked-asset-full-category-card',
      'result-reveal-locked-asset-guide-text',
      'result-reveal-locked-asset-first-curation',
    ];
    for (const id of assetIds) {
      const placeholder = findHostByTestId(tree, `${id}-placeholder`);
      const overlay = findHostByTestId(tree, `${id}-overlay`);
      expect(placeholder, `${id} placeholder`).toBeTruthy();
      expect(overlay, `${id} overlay`).toBeTruthy();
      const placeholderStyles = flattenStyles(placeholder?.props.style);
      const overlayStyles = flattenStyles(overlay?.props.style);
      expect(placeholderStyles.opacity).toBe(LOCKED_ASSET_PLACEHOLDER_OPACITY);
      expect(overlayStyles.opacity).toBe(LOCKED_ASSET_OVERLAY_OPACITY);
    }
  });

  it('each locked asset overlay carries the 🔒 emoji with accessibilityLabel="잠김"', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        onUnlock: NO_OP,
      }),
    );
    const assetIds: readonly string[] = [
      'result-reveal-locked-asset-full-category-card',
      'result-reveal-locked-asset-guide-text',
      'result-reveal-locked-asset-first-curation',
    ];
    for (const id of assetIds) {
      const lockIcon = findHostByTestId(tree, `${id}-lock-icon`);
      expect(lockIcon, `${id} lock icon`).toBeTruthy();
      expect(lockIcon?.props.children).toBe('🔒');
      expect(lockIcon?.props.accessibilityLabel).toBe('잠김');
    }
  });

  it('opacity constants match the Seed values (placeholder=0.2, overlay=0.85)', () => {
    expect(LOCKED_ASSET_PLACEHOLDER_OPACITY).toBe(0.2);
    expect(LOCKED_ASSET_OVERLAY_OPACITY).toBe(0.85);
  });
});

describe('ResultRevealScreen — primary CTA', () => {
  it('renders the "결과 잠금 해제" CTA when isPreviewMode is false', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        onUnlock: NO_OP,
      }),
    );
    const cta = findHostByTestId(tree, 'result-reveal-unlock-cta');
    expect(cta).toBeTruthy();
    expect(cta?.props.accessibilityLabel).toBe('결과 잠금 해제');
  });

  it('invokes onUnlock exactly once when the primary CTA is pressed', () => {
    const onUnlock = vi.fn();
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        onUnlock,
      }),
    );
    const cta = findHostByTestId(tree, 'result-reveal-unlock-cta');
    const onPress = cta?.props.onPress as (() => void) | undefined;
    expect(typeof onPress).toBe('function');
    act(() => {
      (onPress as () => void)();
    });
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('hides the primary CTA when isPreviewMode is true (preview branch)', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: true,
        onUnlock: NO_OP,
      }),
    );
    expect(findHostByTestId(tree, 'result-reveal-unlock-cta')).toBeNull();
  });

  it('still renders all 3 locked assets in preview mode', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: true,
        onUnlock: NO_OP,
      }),
    );
    expect(
      findHostByTestId(tree, 'result-reveal-locked-asset-full-category-card'),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'result-reveal-locked-asset-guide-text'),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'result-reveal-locked-asset-first-curation'),
    ).toBeTruthy();
  });
});
