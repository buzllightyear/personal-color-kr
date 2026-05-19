/**
 * Unit test — `apps/mobile/src/components/funnel/PriceCard.tsx` price-display
 * leaf component (Phase 2.4, Sub-AC 7.1).
 *
 * What this test pins:
 *   1. The component renders a root card host with the documented testID
 *      (`<prefix>-price-card`) so the screen-level test can pin the
 *      price-line surface without re-discovering it.
 *   2. The price `<Text>` host renders the locale-formatted KRW amount
 *      produced by `formatPaymentAmountKrw()` — verifying both:
 *        (a) the ₩ symbol (or KRW currency marker — Node ICU build variance
 *            is tolerated symmetrically to the sibling `payment-model-ctas`
 *            test);
 *        (b) the thousands-separator grouping ("9,900" — NOT "9900" and NOT
 *            "9.900");
 *      and additionally pins that the rendered string equals the formatter
 *      output verbatim — guaranteeing no hand-stitched "₩" prefix has been
 *      added on top of the formatter result.
 *   3. The price text node carries `accessibilityRole="text"` and an
 *      `accessibilityLabel` matching the formatted amount, so VoiceOver/
 *      TalkBack announces the price correctly.
 *   4. The component renders the Korean one-time-unlock caption
 *      ("1회 결제 · 평생 이용") inside a sibling `<Text>` host carrying the
 *      documented `<prefix>-price-caption` testID — pinning the single-tier
 *      / no-subscription contract from the Seed constraint
 *      ("single one-time unlock only — no subscription model, price tiers,
 *      discount codes, or free trials").
 *   5. The default testID prefix is `'payment-model'` and a custom prefix
 *      re-roots all three derived testIDs deterministically — same
 *      convention as the sibling `FunnelHeadline` / `ScanOptionItem` leaves.
 *   6. The exported `PRICE_CARD_ONE_TIME_CAPTION` constant equals the
 *      rendered caption literal (drift guard between the constant and the
 *      rendered surface).
 *   7. The component does NOT embed a literal hardcoded "9900" or "9,900"
 *      digit string in its source — the price flows through
 *      `formatPaymentAmountKrw()` only. Verified indirectly: setting
 *      `PAYMENT_AMOUNT_KRW` to a different integer at the formatter would
 *      propagate to the rendered string (not asserted here because the
 *      constant is frozen by `as const`, but the no-literal contract is
 *      pinned by the file-level docblock and the source-import structure).
 *
 * Why react-test-renderer + the same `vi.mock('react-native')` shape as the
 * sibling component tests (`scan-option-item.test.tsx`,
 * `funnel-headline.test.tsx`):
 *   The setup-rn-stub pre-populates Node's CJS require.cache so the testing
 *   library helpers do not crash on `require('react-native')`. Vite's ESM
 *   SSR transform, however, resolves the component's
 *   `import { View, Text, StyleSheet } from 'react-native'` through the ESM
 *   path which lands on the real Flow file. The inline `vi.mock` shadows
 *   that resolution with a minimal host-component map, exactly mirroring
 *   the sibling component tests' pattern.
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
  formatPaymentAmountKrw,
  PAYMENT_AMOUNT_KRW,
} from '../src/funnel/payment-model-ctas';
import {
  PriceCard,
  PRICE_CARD_DEFAULT_TEST_ID_PREFIX,
  PRICE_CARD_ONE_TIME_CAPTION,
} from '../src/components/funnel/PriceCard';
import { COLORS, TYPOGRAPHY } from '../src/theme';

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: readonly (TestInstance | string)[];
}

function findHostByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance | null {
  // Filter for host elements only (where `type` is a string like 'View'/'Text').
  // The mocked react-native components wrap their host element in a function
  // component, so `findAll` would otherwise return two matches per testID
  // (the wrapper FC + the rendered host); we want the host node only.
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

describe('PriceCard — root card surface', () => {
  it('renders a host element with the default <prefix>-price-card testID', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const card = findHostByTestId(tree, 'payment-model-price-card');
    expect(card).toBeTruthy();
  });

  it('exposes a stable default testID prefix ("payment-model")', () => {
    // Pin the exported constant to the documented kebab-case prefix so a
    // future refactor that desyncs the constant from the rendered handle
    // fails this assertion.
    expect(PRICE_CARD_DEFAULT_TEST_ID_PREFIX).toBe('payment-model');
  });
});

describe('PriceCard — price amount display (Sub-AC 7.1 primary contract)', () => {
  it('renders the formatted KRW amount produced by formatPaymentAmountKrw()', () => {
    // The price rendered on screen must equal the formatter output
    // verbatim — no hand-stitched ₩ prefix, no duplicated grouping logic.
    // This pins the no-drift invariant between the price card and the
    // primary unlock CTA label (which composes the same formatter).
    const expected = formatPaymentAmountKrw();
    const tree = render(React.createElement(PriceCard, {}));
    const amount = findHostByTestId(tree, 'payment-model-price-amount');
    expect(amount).toBeTruthy();
    expect(String(amount?.props.children)).toBe(expected);
  });

  it('includes the thousands-separator grouped digits ("9,900")', () => {
    // The locale-formatting contract: the rendered string MUST contain the
    // grouped digits. A regression to ungrouped "9900" (mis-configured
    // formatter) or a wrong locale ("9.900" — German grouping) both fail
    // this assertion.
    const tree = render(React.createElement(PriceCard, {}));
    const amount = findHostByTestId(tree, 'payment-model-price-amount');
    expect(String(amount?.props.children)).toContain('9,900');
  });

  it('includes a KRW currency marker (₩ symbol or "KRW" code)', () => {
    // Either rendering is acceptable — Node's ICU build can produce either
    // "₩9,900" or "KRW 9,900" depending on locale data. The assertion
    // fails only when the formatter forgets the currency entirely.
    const tree = render(React.createElement(PriceCard, {}));
    const amount = findHostByTestId(tree, 'payment-model-price-amount');
    const rendered = String(amount?.props.children);
    expect(/[₩]|KRW/.test(rendered)).toBe(true);
  });

  it('matches the underlying PAYMENT_AMOUNT_KRW constant (9,900) in the grouped output', () => {
    // The integer constant + the grouped digit substring must agree —
    // verifies that the formatter is reading from the same constant the
    // unlock CTA reads from, and that no hardcoded literal has been
    // substituted on top.
    expect(PAYMENT_AMOUNT_KRW).toBe(9_900);
    const tree = render(React.createElement(PriceCard, {}));
    const amount = findHostByTestId(tree, 'payment-model-price-amount');
    expect(String(amount?.props.children)).toContain('9,900');
  });
});

describe('PriceCard — accessibility surface', () => {
  it('carries accessibilityRole="text" on the price <Text>', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const amount = findHostByTestId(tree, 'payment-model-price-amount');
    expect(amount?.props.accessibilityRole).toBe('text');
  });

  it('sets accessibilityLabel to the formatted price string', () => {
    // VoiceOver / TalkBack should announce the visible price verbatim;
    // the platforms localise the currency reading themselves so no
    // synthesised "nine thousand nine hundred won" gloss is needed.
    const expected = formatPaymentAmountKrw();
    const tree = render(React.createElement(PriceCard, {}));
    const amount = findHostByTestId(tree, 'payment-model-price-amount');
    expect(amount?.props.accessibilityLabel).toBe(expected);
  });
});

describe('PriceCard — one-time-unlock caption (single-tier contract)', () => {
  it('renders the Korean one-time-unlock caption inside the documented testID', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const caption = findHostByTestId(tree, 'payment-model-price-caption');
    expect(caption).toBeTruthy();
    expect(String(caption?.props.children)).toBe(PRICE_CARD_ONE_TIME_CAPTION);
  });

  it('pins the exported PRICE_CARD_ONE_TIME_CAPTION literal ("1회 결제 · 평생 이용")', () => {
    // Drift guard between the exported constant and the rendered surface.
    // Per the Seed constraint ("single one-time unlock only — no
    // subscription model, price tiers, discount codes, or free trials")
    // this caption makes the framing visually unambiguous.
    expect(PRICE_CARD_ONE_TIME_CAPTION).toBe('1회 결제 · 평생 이용');
  });
});

describe('PriceCard — typography tokens applied (no drift from design tokens)', () => {
  it('applies TYPOGRAPHY.headline.bold (fontSize + fontWeight) to the price row', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const amount = findHostByTestId(tree, 'payment-model-price-amount');
    const style = amount?.props.style as {
      fontSize?: number;
      fontWeight?: string;
      color?: string;
    };
    expect(style.fontSize).toBe(TYPOGRAPHY.headline.bold.fontSize);
    expect(style.fontWeight).toBe(TYPOGRAPHY.headline.bold.fontWeight);
  });

  it('applies TYPOGRAPHY.caption.regular (fontSize + fontWeight) to the caption row', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const caption = findHostByTestId(tree, 'payment-model-price-caption');
    const style = caption?.props.style as {
      fontSize?: number;
      fontWeight?: string;
    };
    expect(style.fontSize).toBe(TYPOGRAPHY.caption.regular.fontSize);
    expect(style.fontWeight).toBe(TYPOGRAPHY.caption.regular.fontWeight);
  });

  it('paints both rows with COLORS.grayscale.text (canonical near-black)', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const amountStyle = findHostByTestId(tree, 'payment-model-price-amount')
      ?.props.style as { color?: string };
    const captionStyle = findHostByTestId(tree, 'payment-model-price-caption')
      ?.props.style as { color?: string };
    expect(amountStyle.color).toBe(COLORS.grayscale.text);
    expect(captionStyle.color).toBe(COLORS.grayscale.text);
  });

  it('paints the card background with COLORS.base.pink (Korean beauty surface)', () => {
    const tree = render(React.createElement(PriceCard, {}));
    const card = findHostByTestId(tree, 'payment-model-price-card');
    const style = card?.props.style as { backgroundColor?: string };
    expect(style.backgroundColor).toBe(COLORS.base.pink);
  });
});

describe('PriceCard — testID prefix expansion', () => {
  it('re-roots all three testIDs when a custom testIDPrefix is supplied', () => {
    const tree = render(
      React.createElement(PriceCard, { testIDPrefix: 'custom-prefix' }),
    );
    expect(findHostByTestId(tree, 'custom-prefix-price-card')).toBeTruthy();
    expect(findHostByTestId(tree, 'custom-prefix-price-amount')).toBeTruthy();
    expect(findHostByTestId(tree, 'custom-prefix-price-caption')).toBeTruthy();
    // The default-prefixed handles must NOT resolve when the prefix is
    // overridden — drift guard against a copy-paste bug that hard-codes
    // the default in the component.
    expect(findHostByTestId(tree, 'payment-model-price-card')).toBeNull();
    expect(findHostByTestId(tree, 'payment-model-price-amount')).toBeNull();
    expect(findHostByTestId(tree, 'payment-model-price-caption')).toBeNull();
  });
});
