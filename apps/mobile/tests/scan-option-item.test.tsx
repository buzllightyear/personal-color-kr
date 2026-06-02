/**
 * Unit test — `apps/mobile/src/components/funnel/ScanOptionItem.tsx` single
 * scan-option card leaf component (Phase 2.3, Sub-AC 3.2).
 *
 * What this test pins:
 *   1. The option's Korean label renders verbatim (sourced from the
 *      `ScanOption.label` prop, which the screen receives from
 *      `getScanOptions()` / `FUNNEL_SCREENS`).
 *   2. *Enabled* cards:
 *        - Render with the option's testID handle.
 *        - Carry `accessibilityState.disabled === false`.
 *        - Wire the supplied `onPress` callback to the Pressable's `onPress`.
 *        - Invoke the callback exactly once when pressed.
 *        - Do NOT render the "곧 오픈" badge.
 *   3. *Disabled* cards (the primary AC of this sub-task):
 *        - Render with `disabled === true` on the Pressable (RN drops the
 *          press hit-target).
 *        - Carry `accessibilityState.disabled === true`.
 *        - Carry `onPress === undefined` (defence-in-depth — the parent's
 *          callback is never wired up so it cannot fire).
 *        - Render the "곧 오픈" badge with the documented testID.
 *        - Render the literal "곧 오픈" inside the badge.
 *        - Do NOT invoke the supplied callback even when the Pressable's
 *          `onPress` is invoked manually (the Pressable's `onPress` is
 *          `undefined`, so manual invocation is a no-op — this is the
 *          contract the test pins).
 *   4. testID convention is honoured by the default prefix
 *      `'scan-option-select'` and re-rooted by a custom prefix.
 *   5. Exported constants `SCAN_OPTION_ITEM_COMING_SOON_LABEL` and
 *      `SCAN_OPTION_ITEM_DEFAULT_TEST_ID_PREFIX` match the rendered surface
 *      (any string drift between the constants and the component fails here).
 *
 * Why react-test-renderer + the same `vi.mock('react-native')` shape as the
 * other component tests:
 *   The setup-rn-stub pre-populates Node's CJS require.cache so the
 *   testing-library helpers do not crash on `require('react-native')`. Vite's
 *   ESM SSR transform, however, resolves the component's
 *   `import { View, Text, Pressable, StyleSheet } from 'react-native'` through
 *   the ESM path which lands on the real Flow file. The inline `vi.mock`
 *   shadows that resolution with a minimal host-component map, exactly
 *   mirroring the sibling component tests' pattern (funnel-headline,
 *   funnel-primary-button, guide-list, scan-option-select-screen).
 *
 * Why props-based (not screen-mounted):
 *   `ScanOptionItem` is a pure leaf component — no expo-router, no context,
 *   no async, no core-ts registry coupling beyond the `ScanOption` shape it
 *   receives via prop. A direct prop-injection render asserts the contract
 *   surface without spinning up `FunnelScreenLayout`, the headline, or the
 *   selector.
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

import type { ScanOption } from '../src/funnel/scan-options';
import {
  SCAN_OPTION_ITEM_COMING_SOON_LABEL,
  SCAN_OPTION_ITEM_DEFAULT_TEST_ID_PREFIX,
  ScanOptionItem,
} from '../src/components/funnel/ScanOptionItem';

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
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

/**
 * Build a fixture `ScanOption` synthetically — the test does not depend on
 * `getScanOptions()` or the core-ts registry. This keeps the leaf's unit
 * test isolated from upstream copy drift; the screen-level test already
 * pins the actual Korean labels via the registry.
 */
function makeOption(overrides: Partial<ScanOption> = {}): ScanOption {
  return Object.freeze({
    key: 'fixture_key',
    label: '테스트 옵션',
    enabled: true,
    testIdSuffix: 'fixture',
    action: 'select_scan_personal_color',
    ...overrides,
  });
}

const NO_OP = (): void => undefined;

describe('ScanOptionItem — option label rendering', () => {
  it('renders the Korean label supplied via the option prop', () => {
    const option = makeOption({ label: '퍼스널 컬러 진단' });
    const tree = render(
      React.createElement(ScanOptionItem, { option, onPress: NO_OP }),
    );
    const card = findHostByTestId(
      tree,
      `${SCAN_OPTION_ITEM_DEFAULT_TEST_ID_PREFIX}-option-${option.testIdSuffix}`,
    );
    expect(card).toBeTruthy();
    expect(card?.props.accessibilityLabel).toBe('퍼스널 컬러 진단');
  });
});

describe('ScanOptionItem — enabled state', () => {
  it('renders a Pressable with disabled=false and the wired onPress callback', () => {
    const onPress = vi.fn();
    const option = makeOption({ enabled: true, testIdSuffix: 'personal-color' });
    const tree = render(React.createElement(ScanOptionItem, { option, onPress }));
    const card = findHostByTestId(tree, 'scan-option-select-option-personal-color');
    expect(card).toBeTruthy();
    expect(card?.props.disabled).toBe(false);
    expect((card?.props.accessibilityState as { disabled: boolean }).disabled).toBe(
      false,
    );
    // The Pressable's onPress is the supplied callback (not a no-op wrapper).
    expect(card?.props.onPress).toBe(onPress);
  });

  it('invokes onPress exactly once when the enabled card is pressed', () => {
    const onPress = vi.fn();
    const option = makeOption({ enabled: true, testIdSuffix: 'personal-color' });
    const tree = render(React.createElement(ScanOptionItem, { option, onPress }));
    const card = findHostByTestId(tree, 'scan-option-select-option-personal-color');
    const handler = card?.props.onPress as (() => void) | undefined;
    expect(typeof handler).toBe('function');
    act(() => {
      (handler as () => void)();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the "곧 오픈" badge on an enabled card', () => {
    const option = makeOption({ enabled: true, testIdSuffix: 'personal-color' });
    const tree = render(
      React.createElement(ScanOptionItem, { option, onPress: NO_OP }),
    );
    expect(
      findHostByTestId(tree, 'scan-option-select-coming-soon-personal-color'),
    ).toBeNull();
  });
});

describe('ScanOptionItem — disabled state (primary AC)', () => {
  it('renders the Pressable with disabled=true (non-pressable)', () => {
    const option = makeOption({ enabled: false, testIdSuffix: 'secondary-slot-2' });
    const tree = render(
      React.createElement(ScanOptionItem, { option, onPress: NO_OP }),
    );
    const card = findHostByTestId(tree, 'scan-option-select-option-secondary-slot-2');
    expect(card).toBeTruthy();
    expect(card?.props.disabled).toBe(true);
    expect((card?.props.accessibilityState as { disabled: boolean }).disabled).toBe(
      true,
    );
  });

  it('passes undefined for onPress on a disabled card (defence-in-depth)', () => {
    const option = makeOption({ enabled: false, testIdSuffix: 'secondary-slot-2' });
    const tree = render(
      React.createElement(ScanOptionItem, { option, onPress: NO_OP }),
    );
    const card = findHostByTestId(tree, 'scan-option-select-option-secondary-slot-2');
    // Even when the parent supplies a callback, the leaf must NOT wire it to
    // the disabled Pressable. This pins the "non-pressable" contract from
    // the Sub-AC ("disabled options are non-pressable").
    expect(card?.props.onPress).toBeUndefined();
  });

  it('renders the "곧 오픈" badge with the documented testID', () => {
    const option = makeOption({ enabled: false, testIdSuffix: 'secondary-slot-3' });
    const tree = render(
      React.createElement(ScanOptionItem, { option, onPress: NO_OP }),
    );
    const badge = findHostByTestId(
      tree,
      'scan-option-select-coming-soon-secondary-slot-3',
    );
    expect(badge).toBeTruthy();
  });

  it('renders the literal "곧 오픈" Korean copy inside the badge', () => {
    const option = makeOption({ enabled: false, testIdSuffix: 'secondary-slot-3' });
    const tree = render(
      React.createElement(ScanOptionItem, { option, onPress: NO_OP }),
    );
    // Pin the literal Korean copy by searching every `Text` host whose
    // `children` is exactly the exported constant. Walking via parent
    // would be brittle: the `vi.mock('react-native')` host-component
    // wrapper inserts an extra FC layer between the badge `View` and the
    // inner `Text`, so the direct-parent testID check used in some other
    // tests cannot reach the badge handle from the Text host.
    const koreanBadgeNodes = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.type === 'Text' &&
        String(node.props?.children) === SCAN_OPTION_ITEM_COMING_SOON_LABEL,
    );
    expect(koreanBadgeNodes.length).toBeGreaterThan(0);
    expect(String(koreanBadgeNodes[0]?.props?.children)).toBe('곧 오픈');
    // The exported constant must agree with the rendered literal (drift
    // guard — see the file-level docblock).
    expect(SCAN_OPTION_ITEM_COMING_SOON_LABEL).toBe('곧 오픈');
  });

  it('does not invoke the supplied onPress callback for a disabled card', () => {
    const onPress = vi.fn();
    const option = makeOption({ enabled: false, testIdSuffix: 'secondary-slot-2' });
    const tree = render(React.createElement(ScanOptionItem, { option, onPress }));
    const card = findHostByTestId(tree, 'scan-option-select-option-secondary-slot-2');
    // The Pressable's `onPress` is `undefined` on a disabled card (asserted
    // above). Invoking it should be a no-op from the parent's perspective —
    // the supplied callback must never be called.
    const handler = card?.props.onPress as (() => void) | undefined;
    if (typeof handler === 'function') {
      act(() => {
        (handler as () => void)();
      });
    }
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('ScanOptionItem — testID convention', () => {
  it('uses the default "scan-option-select" prefix when testIDPrefix is omitted', () => {
    const option = makeOption({ testIdSuffix: 'personal-color' });
    const tree = render(
      React.createElement(ScanOptionItem, { option, onPress: NO_OP }),
    );
    expect(
      findHostByTestId(tree, 'scan-option-select-option-personal-color'),
    ).toBeTruthy();
    expect(SCAN_OPTION_ITEM_DEFAULT_TEST_ID_PREFIX).toBe('scan-option-select');
  });

  it('re-roots the card testID when a custom testIDPrefix is supplied', () => {
    const option = makeOption({ testIdSuffix: 'personal-color' });
    const tree = render(
      React.createElement(ScanOptionItem, {
        option,
        onPress: NO_OP,
        testIDPrefix: 'custom-prefix',
      }),
    );
    expect(findHostByTestId(tree, 'custom-prefix-option-personal-color')).toBeTruthy();
    expect(
      findHostByTestId(tree, 'scan-option-select-option-personal-color'),
    ).toBeNull();
  });

  it('re-roots the "곧 오픈" badge testID when a custom testIDPrefix is supplied', () => {
    const option = makeOption({
      enabled: false,
      testIdSuffix: 'secondary-slot-2',
    });
    const tree = render(
      React.createElement(ScanOptionItem, {
        option,
        onPress: NO_OP,
        testIDPrefix: 'custom-prefix',
      }),
    );
    expect(
      findHostByTestId(tree, 'custom-prefix-coming-soon-secondary-slot-2'),
    ).toBeTruthy();
  });
});
