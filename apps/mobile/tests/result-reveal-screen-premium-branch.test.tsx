/**
 * Unit test — `ResultRevealScreen` premium branch (Phase 2.4 AC 12).
 *
 * AC 12 contract: when `isPremium === true`, the lock overlay is removed from
 * the 3 placeholder sections (full_category_card, guide_text, first_curation)
 * and `accessibilityLabel="잠김"` disappears from the tree.
 *
 * Lives in a dedicated test file (not appended to
 * `result-reveal-screen.test.tsx`) so AC 12's render contract is isolated
 * from the Sub-AC 4 / Sub-AC 11.1 assertions and to avoid edit-time conflicts
 * with sibling Phase 2.4 ACs that also extend the screen test suite.
 *
 * Asserts:
 *   1. When `isPremium === true`:
 *      a. No `*-overlay` element is rendered for any of the 3 placeholder
 *         sections (`full_category_card`, `guide_text`, `first_curation`).
 *      b. No `*-lock-icon` element is rendered for any of the 3 sections.
 *      c. No element on the rendered tree carries
 *         `accessibilityLabel="잠김"` — neither the wrapper (which used to
 *         say "{koreanLabel} 잠김") nor the (now-omitted) 🔒 emoji node.
 *      d. Each wrapper still carries an accessibility label, but it equals
 *         just the Korean section name (e.g. "전체 진단 카드") without
 *         the "잠김" suffix.
 *      e. The placeholder shape (hero card / text stack / 2x2 grid) is
 *         still rendered, and its opacity is now `1` (the suppressed-shape
 *         treatment is no longer meaningful when the lock is gone).
 *   2. When `isPremium === false` the locked overlay + 🔒 emoji +
 *      `accessibilityLabel="잠김"` remain rendered (regression guard against
 *      accidentally always-stripping the lock surface).
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

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

function findAllWithAccessibilityLabel(
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): readonly TestInstance[] {
  return tree.root.findAll(
    (node) =>
      typeof node.type === 'string' && node.props?.accessibilityLabel === label,
  ) as unknown as readonly TestInstance[];
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

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

const NO_OP = (): void => undefined;

// The 3 locked-asset test-ID prefixes and their canonical Korean labels.
// Pinning them here (rather than importing from the component) keeps the test
// authoritative about the asset-key → label mapping the AC 12 contract is
// specified against.
const ASSETS: readonly {
  readonly id: string;
  readonly koreanLabel: string;
}[] = [
  {
    id: 'result-reveal-locked-asset-full-category-card',
    koreanLabel: '전체 진단 카드',
  },
  {
    id: 'result-reveal-locked-asset-guide-text',
    koreanLabel: '가이드 텍스트',
  },
  {
    id: 'result-reveal-locked-asset-first-curation',
    koreanLabel: '첫 추천 패키지',
  },
];

describe('ResultRevealScreen — AC 12 premium branch (isPremium=true)', () => {
  it('removes the *-overlay element from all 3 placeholder sections', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        isPremium: true,
        onUnlock: NO_OP,
      }),
    );
    for (const asset of ASSETS) {
      const overlay = findHostByTestId(tree, `${asset.id}-overlay`);
      expect(overlay, `${asset.id} overlay must NOT render in premium mode`).toBeNull();
    }
  });

  it('removes the *-lock-icon (🔒) element from all 3 placeholder sections', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        isPremium: true,
        onUnlock: NO_OP,
      }),
    );
    for (const asset of ASSETS) {
      const lockIcon = findHostByTestId(tree, `${asset.id}-lock-icon`);
      expect(lockIcon, `${asset.id} lock icon must NOT render in premium mode`).toBeNull();
    }
  });

  it('removes accessibilityLabel="잠김" from the rendered tree entirely', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        isPremium: true,
        onUnlock: NO_OP,
      }),
    );
    const matches = findAllWithAccessibilityLabel(tree, '잠김');
    expect(matches.length).toBe(0);
  });

  it('drops the "잠김" suffix from each wrapper accessibilityLabel', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        isPremium: true,
        onUnlock: NO_OP,
      }),
    );
    for (const asset of ASSETS) {
      const wrapper = findHostByTestId(tree, asset.id);
      expect(wrapper, `${asset.id} wrapper`).toBeTruthy();
      // Wrapper still has SOME accessibilityLabel, but it's just the Korean
      // section name — no trailing " 잠김".
      expect(wrapper?.props.accessibilityLabel).toBe(asset.koreanLabel);
    }
  });

  it('still renders the placeholder shape for all 3 sections at full opacity', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        isPremium: true,
        onUnlock: NO_OP,
      }),
    );
    for (const asset of ASSETS) {
      const placeholder = findHostByTestId(tree, `${asset.id}-placeholder`);
      expect(placeholder, `${asset.id} placeholder`).toBeTruthy();
      const styles = flattenStyles(placeholder?.props.style);
      expect(styles.opacity).toBe(1);
    }
  });

  it('preserves the 3 distinct variant shapes (hero card, text stack, 2x2 grid) in premium mode', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        isPremium: true,
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
      findHostByTestId(tree, 'result-reveal-locked-asset-first-curation-grid-2x2'),
    ).toBeTruthy();
  });
});

describe('ResultRevealScreen — AC 12 regression guard (isPremium=false)', () => {
  it('keeps the lock overlay + 🔒 emoji + "잠김" label when isPremium=false', () => {
    const tree = render(
      React.createElement(ResultRevealScreen, {
        isPreviewMode: false,
        isPremium: false,
        onUnlock: NO_OP,
      }),
    );
    for (const asset of ASSETS) {
      const overlay = findHostByTestId(tree, `${asset.id}-overlay`);
      const lockIcon = findHostByTestId(tree, `${asset.id}-lock-icon`);
      expect(overlay, `${asset.id} overlay must render in locked mode`).toBeTruthy();
      expect(lockIcon, `${asset.id} lock icon must render in locked mode`).toBeTruthy();
      expect(lockIcon?.props.accessibilityLabel).toBe('잠김');
      const wrapper = findHostByTestId(tree, asset.id);
      expect(wrapper?.props.accessibilityLabel).toBe(`${asset.koreanLabel} 잠김`);
    }
    // At least 3 elements (the 3 lock icons) carry accessibilityLabel="잠김".
    const matches = findAllWithAccessibilityLabel(tree, '잠김');
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});
