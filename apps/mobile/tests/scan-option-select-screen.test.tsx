/**
 * Unit test — `ScanOptionSelectScreen` presentational component.
 *
 * Asserts:
 *   1. Renders the Korean headline + subhead sourced from
 *      FUNNEL_SCREENS.scan_option_select.
 *   2. Renders exactly 3 scan option cards — one primary (enabled) and two
 *      secondary (disabled "곧 오픈" stubs).
 *   3. The primary option's label is "퍼스널 컬러 진단" (the Korean CTA
 *      sourced from the FUNNEL_SCREENS registry).
 *   4. The two secondary options carry the "곧 오픈" badge and the disabled
 *      accessibility state.
 *   5. Pressing the primary option invokes `onSelectPersonalColor` exactly
 *      once — this is the funnel-state transition the screen dispatches
 *      (the only path advancing from step 6 to step 7).
 *   6. Pressing a secondary option does NOT invoke `onSelectPersonalColor`.
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

import { ScanOptionSelectScreen } from '../src/screens/funnel/ScanOptionSelectScreen';

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

const NO_OP = (): void => undefined;

describe('ScanOptionSelectScreen — render', () => {
  it('renders the Korean headline from FUNNEL_SCREENS.scan_option_select', () => {
    const tree = render(
      React.createElement(ScanOptionSelectScreen, {
        onSelectPersonalColor: NO_OP,
      }),
    );
    const headline = findHostByTestId(tree, 'scan-option-select-headline');
    expect(headline).toBeTruthy();
    expect(headline?.props.children).toBe('어떤 진단부터 시작할까요?');
  });

  it('renders the Korean subhead from FUNNEL_SCREENS.scan_option_select', () => {
    const tree = render(
      React.createElement(ScanOptionSelectScreen, {
        onSelectPersonalColor: NO_OP,
      }),
    );
    const subhead = findHostByTestId(tree, 'scan-option-select-subhead');
    expect(subhead).toBeTruthy();
    expect(subhead?.props.children).toBe(
      '메인은 퍼스널 컬러. 보조 2개 옵션은 곧 정식 오픈 (Phase-N).',
    );
  });

  it('renders 3 scan option cards (1 primary + 2 secondary)', () => {
    const tree = render(
      React.createElement(ScanOptionSelectScreen, {
        onSelectPersonalColor: NO_OP,
      }),
    );
    expect(
      findHostByTestId(tree, 'scan-option-select-option-personal-color'),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'scan-option-select-option-secondary-slot-2'),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'scan-option-select-option-secondary-slot-3'),
    ).toBeTruthy();
  });

  it('primary option renders the Korean label "퍼스널 컬러 진단" and is enabled', () => {
    const tree = render(
      React.createElement(ScanOptionSelectScreen, {
        onSelectPersonalColor: NO_OP,
      }),
    );
    const primary = findHostByTestId(tree, 'scan-option-select-option-personal-color');
    expect(primary).toBeTruthy();
    expect(primary?.props.accessibilityLabel).toBe('퍼스널 컬러 진단');
    expect((primary?.props.accessibilityState as { disabled: boolean }).disabled).toBe(
      false,
    );
  });

  it('secondary options render the "곧 오픈" badge and are disabled', () => {
    const tree = render(
      React.createElement(ScanOptionSelectScreen, {
        onSelectPersonalColor: NO_OP,
      }),
    );
    const slot2 = findHostByTestId(tree, 'scan-option-select-option-secondary-slot-2');
    const slot3 = findHostByTestId(tree, 'scan-option-select-option-secondary-slot-3');
    expect(slot2).toBeTruthy();
    expect(slot3).toBeTruthy();
    expect((slot2?.props.accessibilityState as { disabled: boolean }).disabled).toBe(
      true,
    );
    expect((slot3?.props.accessibilityState as { disabled: boolean }).disabled).toBe(
      true,
    );
    expect(
      findHostByTestId(tree, 'scan-option-select-coming-soon-secondary-slot-2'),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'scan-option-select-coming-soon-secondary-slot-3'),
    ).toBeTruthy();
  });
});

describe('ScanOptionSelectScreen — funnel state transition', () => {
  it('invokes onSelectPersonalColor exactly once when the primary option is pressed', () => {
    const onSelect = vi.fn();
    const tree = render(
      React.createElement(ScanOptionSelectScreen, {
        onSelectPersonalColor: onSelect,
      }),
    );
    const primary = findHostByTestId(tree, 'scan-option-select-option-personal-color');
    const onPress = primary?.props.onPress as (() => void) | undefined;
    expect(typeof onPress).toBe('function');
    act(() => {
      (onPress as () => void)();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onSelectPersonalColor when a secondary option is pressed', () => {
    const onSelect = vi.fn();
    const tree = render(
      React.createElement(ScanOptionSelectScreen, {
        onSelectPersonalColor: onSelect,
      }),
    );
    const slot2 = findHostByTestId(tree, 'scan-option-select-option-secondary-slot-2');
    // Disabled secondary option intentionally has no onPress handler;
    // pressing it must be a no-op from the funnel-state perspective.
    const onPress = slot2?.props.onPress as (() => void) | undefined;
    if (typeof onPress === 'function') {
      act(() => {
        (onPress as () => void)();
      });
    }
    expect(onSelect).not.toHaveBeenCalled();
  });
});
