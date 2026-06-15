/**
 * Unit test — `apps/mobile/src/components/funnel/PriceCard.tsx`
 * value-proposition card leaf component (Phase 2.5, AC 13).
 *
 * Phase context (Phase 2.4 → Phase 2.5):
 *   In Phase 2.4 this component rendered the hardcoded one-time premium
 *   amount "₩9,900" read from `formatPaymentAmountKrw()`. Phase 2.5
 *   replaces the placeholder payment flow with the real Superwall SDK
 *   paywall trigger — the subscription price is owned entirely by the
 *   Superwall paywall modal (ASC sandbox product), so the app UI MUST NOT
 *   duplicate it. Per the Seed evaluation principle "price_single_source",
 *   this test pins the new value-prop content contract and explicitly
 *   forbids any re-introduction of price-display behavior.
 *
 * What this test pins:
 *   1. The component renders a root card host with the documented testID
 *      (`<prefix>-value-prop-card`) so the screen-level test can pin the
 *      value-prop surface without re-discovering it.
 *   2. The card renders a heading text node carrying the documented
 *      `<prefix>-value-prop-heading` testID and the Korean heading
 *      literal exported from `VALUE_PROP_CARD_HEADING`.
 *   3. The card renders exactly three benefit rows — one per
 *      `VALUE_PROP_CARD_BENEFITS` tuple entry — each carrying the
 *      documented `<prefix>-value-prop-item-<index>` testID and the
 *      corresponding Korean benefit copy. Tuple ordering is part of the
 *      contract (scope → utility → longevity).
 *   4. Each benefit row carries `accessibilityRole="text"` and an
 *      `accessibilityLabel` equal to the benefit string alone (the leading
 *      checkmark glyph is decorative and must not be announced).
 *   5. The exported constants (`VALUE_PROP_CARD_DEFAULT_TEST_ID_PREFIX`,
 *      `VALUE_PROP_CARD_HEADING`, `VALUE_PROP_CARD_BENEFITS`) match the
 *      documented literals — drift guards between the constants and the
 *      rendered surface.
 *   6. The default testID prefix is `'payment-model'` and a custom prefix
 *      re-roots every derived testID deterministically — same convention
 *      as the sibling `FunnelHeadline` / `ScanOptionItem` leaves.
 *   7. The component does NOT render any price string, currency marker
 *      ('₩', 'KRW', '9,900', '9900'), or one-time-unlock caption ("1회
 *      결제"). Verified by sweeping the entire rendered tree's text
 *      content for forbidden substrings — a regression that re-adds the
 *      Phase 2.4 price line would fail this assertion.
 *
 * Why react-test-renderer + the same `vi.mock('react-native')` shape as
 * the sibling component tests (`scan-option-item.test.tsx`,
 * `funnel-headline.test.tsx`):
 *   The setup-rn-stub pre-populates Node's CJS require.cache so the
 *   testing library helpers do not crash on `require('react-native')`.
 *   Vite's ESM SSR transform, however, resolves the component's
 *   `import { View, Text, StyleSheet } from 'react-native'` through the
 *   ESM path which lands on the real Flow file. The inline `vi.mock`
 *   shadows that resolution with a minimal host-component map, exactly
 *   mirroring the sibling component tests' pattern.
 *
 * Why props-based (not screen-mounted):
 *   `PriceCard` is a pure leaf component — no expo-router, no context, no
 *   async. A direct prop-injection render asserts the display contract
 *   without spinning up the whole `payment_model` screen tree.
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

import {
  PriceCard,
  VALUE_PROP_CARD_BENEFITS,
  VALUE_PROP_CARD_BULLET_GLYPH,
  VALUE_PROP_CARD_DEFAULT_TEST_ID_PREFIX,
  VALUE_PROP_CARD_HEADING,
} from '../src/components/funnel/PriceCard';
import { FONT, INK } from '../src/theme/editorial';

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: readonly (TestInstance | string)[];
}

function findHostByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance | null {
  // Filter for host elements only (where `type` is a string like
  // 'View'/'Text'). The mocked react-native components wrap their host
  // element in a function component, so `findAll` would otherwise return
  // two matches per testID (the wrapper FC + the rendered host); we want
  // the host node only.
  const matches = tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props?.testID === testID,
  );
  return (matches[0] as unknown as TestInstance) ?? null;
}

function findAllHostsByTestIdPattern(
  tree: TestRenderer.ReactTestRenderer,
  prefix: string,
): readonly TestInstance[] {
  return tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      typeof node.props?.testID === 'string' &&
      (node.props.testID as string).startsWith(prefix),
  ) as unknown as readonly TestInstance[];
}

function collectRenderedText(tree: TestRenderer.ReactTestRenderer): string {
  // Sweep every host text-bearing child and concatenate into one string so
  // the "no forbidden substring" assertion below can scan the whole
  // rendered surface in one pass.
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node !== null && typeof node === 'object') {
      const maybeChildren = (node as { children?: unknown }).children;
      if (maybeChildren !== undefined) {
        walk(maybeChildren);
      }
      const maybeProps = (node as { props?: { children?: unknown } }).props;
      if (maybeProps && maybeProps.children !== undefined) {
        walk(maybeProps.children);
      }
    }
  };
  walk(tree.toJSON());
  return parts.join(' ');
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

describe('PriceCard — root value-prop card surface', () => {
  it('renders a host element with the default <prefix>-value-prop-card testID', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const card = findHostByTestId(tree, 'payment-model-value-prop-card');
    expect(card).toBeTruthy();
  });

  it('exposes a stable default testID prefix ("payment-model")', () => {
    // Pin the exported constant to the documented kebab-case prefix so a
    // future refactor that desyncs the constant from the rendered handle
    // fails this assertion.
    expect(VALUE_PROP_CARD_DEFAULT_TEST_ID_PREFIX).toBe('payment-model');
  });

  it('carries accessibilityRole="summary" on the card root', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const card = findHostByTestId(tree, 'payment-model-value-prop-card');
    expect(card?.props.accessibilityRole).toBe('summary');
  });
});

describe('PriceCard — value-prop heading (AC 13 primary contract)', () => {
  it('renders the Korean heading literal inside the documented testID', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const heading = findHostByTestId(tree, 'payment-model-value-prop-heading');
    expect(heading).toBeTruthy();
    expect(String(heading?.props.children)).toBe(VALUE_PROP_CARD_HEADING);
  });

  it('pins the exported VALUE_PROP_CARD_HEADING literal ("이 분석으로 받게 되는 것")', () => {
    // Drift guard between the exported constant and the rendered surface.
    expect(VALUE_PROP_CARD_HEADING).toBe('이 분석으로 받게 되는 것');
  });

  it('carries accessibilityRole="header" on the heading text', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const heading = findHostByTestId(tree, 'payment-model-value-prop-heading');
    expect(heading?.props.accessibilityRole).toBe('header');
  });
});

describe('PriceCard — three benefit rows (AC 13 primary contract)', () => {
  it('renders exactly three benefit rows', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const rows = findAllHostsByTestIdPattern(tree, 'payment-model-value-prop-item-');
    expect(rows).toHaveLength(3);
  });

  it('exposes a VALUE_PROP_CARD_BENEFITS tuple of length 3', () => {
    // The tuple length is part of the contract — exactly three benefits,
    // not 2 or 4. A future contributor cannot add a fourth without
    // updating the tuple AND this assertion.
    expect(VALUE_PROP_CARD_BENEFITS).toHaveLength(3);
  });

  it('renders the three Korean benefit strings in tuple order (scope → utility → longevity)', () => {
    const tree = render(React.createElement(PriceCard, {}));
    VALUE_PROP_CARD_BENEFITS.forEach((benefit, index) => {
      const row = findHostByTestId(
        tree,
        `payment-model-value-prop-item-${String(index)}`,
      );
      expect(row).toBeTruthy();
      // The visible text on each row is "✓ <benefit>" — we assert the
      // benefit copy is present anywhere in the rendered string so the
      // glyph + spacing details remain implementation flexibility.
      expect(String(row?.props.children)).toContain(benefit);
    });
  });

  it('pins each benefit literal explicitly (scope: full color analysis)', () => {
    // Verify the canonical scope-of-analysis benefit copy.
    expect(VALUE_PROP_CARD_BENEFITS[0]).toBe('전체 퍼스널 컬러 분석');
  });

  it('pins each benefit literal explicitly (utility: coordination recommendations)', () => {
    // Verify the canonical coordination-recommendation benefit copy.
    expect(VALUE_PROP_CARD_BENEFITS[1]).toBe('맞춤 코디 추천');
  });

  it('pins each benefit literal explicitly (longevity: lifetime save)', () => {
    // Verify the canonical lifetime-save benefit copy.
    expect(VALUE_PROP_CARD_BENEFITS[2]).toBe('평생 저장');
  });

  it('renders the decorative checkmark glyph in front of each benefit', () => {
    const tree = render(React.createElement(PriceCard, {}));
    VALUE_PROP_CARD_BENEFITS.forEach((_benefit, index) => {
      const row = findHostByTestId(
        tree,
        `payment-model-value-prop-item-${String(index)}`,
      );
      expect(String(row?.props.children)).toContain(VALUE_PROP_CARD_BULLET_GLYPH);
    });
  });
});

describe('PriceCard — benefit-row accessibility', () => {
  it('sets accessibilityRole="text" on every benefit row', () => {
    const tree = render(React.createElement(PriceCard, {}));
    VALUE_PROP_CARD_BENEFITS.forEach((_benefit, index) => {
      const row = findHostByTestId(
        tree,
        `payment-model-value-prop-item-${String(index)}`,
      );
      expect(row?.props.accessibilityRole).toBe('text');
    });
  });

  it('sets accessibilityLabel to the benefit string alone (glyph not announced)', () => {
    // The leading ✓ glyph is decorative — the screen-reader announcement
    // must be the benefit text only, NOT "checkmark <benefit>".
    const tree = render(React.createElement(PriceCard, {}));
    VALUE_PROP_CARD_BENEFITS.forEach((benefit, index) => {
      const row = findHostByTestId(
        tree,
        `payment-model-value-prop-item-${String(index)}`,
      );
      expect(row?.props.accessibilityLabel).toBe(benefit);
    });
  });
});

describe('PriceCard — Phase 2.5 price-removal contract (price_single_source)', () => {
  it('does NOT render any KRW currency marker (₩ or "KRW")', () => {
    // Per the Seed evaluation principle "price_single_source", the
    // subscription price is owned only by the Superwall paywall — no
    // hardcoded duplicates in the value-prop card.
    const tree = render(React.createElement(PriceCard, {}));
    const rendered = collectRenderedText(tree);
    expect(rendered).not.toContain('₩');
    expect(rendered).not.toContain('KRW');
  });

  it('does NOT render the Phase 2.4 amount digits ("9,900" or "9900")', () => {
    // The hardcoded ₩9,900 line was removed in Phase 2.5 — a regression
    // that re-introduces the literal digit sequence would fail here.
    const tree = render(React.createElement(PriceCard, {}));
    const rendered = collectRenderedText(tree);
    expect(rendered).not.toContain('9,900');
    expect(rendered).not.toContain('9900');
  });

  it('does NOT render the Phase 2.4 one-time-unlock caption ("1회 결제")', () => {
    // The "1회 결제 · 평생 이용" caption was removed because Phase 2.5
    // ships a monthly subscription, not a one-time unlock. The
    // value-prop card's "평생 저장" benefit refers to retention of the
    // analysis result, NOT a one-time-purchase framing.
    const tree = render(React.createElement(PriceCard, {}));
    const rendered = collectRenderedText(tree);
    expect(rendered).not.toContain('1회 결제');
  });
});

describe('PriceCard — editorial typography applied (no drift from tokens)', () => {
  it('sets the heading in Pretendard Medium primary ink', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const heading = findHostByTestId(tree, 'payment-model-value-prop-heading');
    const style = heading?.props.style as {
      fontFamily?: string;
      color?: string;
    };
    expect(style.fontFamily).toBe(FONT.medium);
    expect(style.color).toBe(INK.primary);
  });

  it('sets every benefit row in Pretendard Regular muted ink', () => {
    const tree = render(React.createElement(PriceCard, {}));
    VALUE_PROP_CARD_BENEFITS.forEach((_benefit, index) => {
      const row = findHostByTestId(
        tree,
        `payment-model-value-prop-item-${String(index)}`,
      );
      const style = row?.props.style as {
        fontFamily?: string;
        color?: string;
      };
      expect(style.fontFamily).toBe(FONT.regular);
      expect(style.color).toBe(INK.muted);
    });
  });

  it('paints the card as a neutral wash panel with a hairline edge', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const card = findHostByTestId(tree, 'payment-model-value-prop-card');
    const style = card?.props.style as {
      backgroundColor?: string;
      borderColor?: string;
    };
    expect(style.backgroundColor).toBe(INK.wash);
    expect(style.borderColor).toBe(INK.line);
  });
});

describe('PriceCard — testID prefix expansion', () => {
  it('re-roots all testIDs when a custom testIDPrefix is supplied', () => {
    const tree = render(
      React.createElement(PriceCard, { testIDPrefix: 'custom-prefix' }),
    );
    expect(findHostByTestId(tree, 'custom-prefix-value-prop-card')).toBeTruthy();
    expect(findHostByTestId(tree, 'custom-prefix-value-prop-heading')).toBeTruthy();
    expect(findHostByTestId(tree, 'custom-prefix-value-prop-item-0')).toBeTruthy();
    expect(findHostByTestId(tree, 'custom-prefix-value-prop-item-1')).toBeTruthy();
    expect(findHostByTestId(tree, 'custom-prefix-value-prop-item-2')).toBeTruthy();
    // The default-prefixed handles must NOT resolve when the prefix is
    // overridden — drift guard against a copy-paste bug that hard-codes
    // the default in the component.
    expect(findHostByTestId(tree, 'payment-model-value-prop-card')).toBeNull();
    expect(findHostByTestId(tree, 'payment-model-value-prop-heading')).toBeNull();
    expect(findHostByTestId(tree, 'payment-model-value-prop-item-0')).toBeNull();
  });
});
