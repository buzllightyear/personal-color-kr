/**
 * FunnelPrimaryButton — unit tests (AC 9).
 *
 * Pins the contract for the shared primary CTA button used across the
 * Phase 2.3 funnel screens (welcome_hook, value_props, onboarding_priming,
 * rating_gate, …).
 *
 * Covered behaviour:
 *   1. Renders the supplied Korean `label` text inside the button.
 *   2. Invokes `onPress` exactly once per tap when enabled.
 *   3. Suppresses `onPress` when `disabled` is true.
 *   4. Reflects `disabled` in `accessibilityState.disabled`.
 *   5. Defaults `accessibilityLabel` to `label` when not supplied; honours
 *      a caller-supplied override.
 *   6. Always sets `accessibilityRole="button"`.
 *   7. Defaults `testID` to the exported sentinel; honours a caller-supplied
 *      override.
 *   8. Sets `Pressable`'s own `disabled` prop so RN's hit-target
 *      suppression kicks in (defence-in-depth alongside the in-handler guard).
 *   9. Spreads design tokens into the StyleSheet so a token change updates
 *      every consumer in one place.
 *
 * Why react-test-renderer + vi.mock('react-native'):
 *   Same rationale as `funnel-placeholder-smoke.test.tsx` — the unit-test
 *   environment lacks Expo Router context and the real `react-native/index.js`
 *   ships with Flow syntax Node cannot parse. We mock the ESM resolution
 *   path with a minimal host-component shape and use `react-test-renderer`
 *   directly (no @testing-library/react-native, no DOM).
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Match the host-component shape funnel-placeholder-smoke.test.tsx uses,
// expanded with `flatten` so the StyleSheet token-spread assertions can
// inspect resolved styles.
vi.mock('react-native', async () => {
  const reactActual: any = await vi.importActual('react');
  const makeHost =
    (label: string) =>
    (props: any) =>
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
      // Lightweight flatten — merges arrays of style objects left-to-right
      // so the assertion code can read the resolved leaf style without
      // pulling in react-native's real implementation.
      flatten: (s: unknown): unknown => {
        if (Array.isArray(s)) {
          return s.reduce((acc: Record<string, unknown>, item: unknown) => {
            if (item == null || typeof item !== 'object') return acc;
            return { ...acc, ...(item as Record<string, unknown>) };
          }, {});
        }
        return s;
      },
    },
    Platform: { OS: 'ios', select: (m: any) => m.ios ?? m.default },
  };
});

interface TestInstance {
  readonly props: Record<string, unknown>;
  readonly type: unknown;
  findAllByProps: (filter: Record<string, unknown>) => readonly TestInstance[];
}

function makeQuery(tree: TestRenderer.ReactTestRenderer) {
  const root = tree.root;
  const findOne = (testID: string): TestInstance | null => {
    // Filter for host elements only (where `type` is a string). The mocked
    // react-native components wrap their host element in a function
    // component, so findAll would otherwise return two matches per testID
    // (the wrapper FC + the rendered host); the host node carries the
    // real onPress/disabled props we want to assert against.
    const matches = root.findAll(
      (node) =>
        typeof node.type === 'string' && node.props?.testID === testID,
    );
    return (matches[0] as unknown as TestInstance) ?? null;
  };
  return {
    getByTestId(testID: string): TestInstance {
      const match = findOne(testID);
      if (!match) throw new Error(`getByTestId('${testID}'): no match`);
      return match;
    },
    queryByTestId(testID: string): TestInstance | null {
      return findOne(testID);
    },
    findTextNode(text: string): TestInstance {
      const all = root.findAll(
        (node) =>
          typeof node.props === 'object' &&
          (node.props as { children?: unknown }).children === text,
      );
      const first = all[0];
      if (!first) throw new Error(`findTextNode('${text}'): no match`);
      return first as unknown as TestInstance;
    },
  };
}

function render(element: React.ReactElement) {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return { ...makeQuery(tree), tree };
}

import {
  FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
  FunnelPrimaryButton,
} from '../src/components/funnel/FunnelPrimaryButton';
import { COLORS, SPACING, TYPOGRAPHY } from '../src/theme';

describe('FunnelPrimaryButton — render', () => {
  it('renders the supplied Korean label text', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
      }),
    );
    expect(result.findTextNode('시작하기')).toBeTruthy();
  });

  it('renders multiple distinct labels across screens (smoke for reuse)', () => {
    const labels = ['시작하기', '다음', '별점 남기기'] as const;
    for (const label of labels) {
      const result = render(
        React.createElement(FunnelPrimaryButton, {
          label,
          onPress: vi.fn(),
        }),
      );
      expect(result.findTextNode(label)).toBeTruthy();
    }
  });

  it('uses the default testID when none is supplied', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '다음',
        onPress: vi.fn(),
      }),
    );
    expect(
      result.queryByTestId(FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID),
    ).not.toBeNull();
  });

  it('honours a caller-supplied testID (screen-scoped naming convention)', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
        testID: 'welcome-hook-cta',
      }),
    );
    expect(result.queryByTestId('welcome-hook-cta')).not.toBeNull();
    // Default sentinel must NOT also be present — the caller's value wins.
    expect(
      result.queryByTestId(FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID),
    ).toBeNull();
  });
});

describe('FunnelPrimaryButton — onPress wiring', () => {
  it('invokes onPress exactly once per tap when enabled', () => {
    const handlePress = vi.fn();
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '다음',
        onPress: handlePress,
        testID: 'value-props-cta',
      }),
    );

    const pressable = result.getByTestId('value-props-cta');
    const onPress = pressable.props.onPress as (e: unknown) => void;

    act(() => {
      onPress({} as unknown);
    });

    expect(handlePress).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke onPress when disabled is true', () => {
    const handlePress = vi.fn();
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '다음',
        onPress: handlePress,
        disabled: true,
        testID: 'onboarding-priming-cta',
      }),
    );

    const pressable = result.getByTestId('onboarding-priming-cta');
    const onPress = pressable.props.onPress as (e: unknown) => void;

    act(() => {
      onPress({} as unknown);
    });

    expect(handlePress).not.toHaveBeenCalled();
  });

  it('threads disabled through to Pressable as defence-in-depth', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '다음',
        onPress: vi.fn(),
        disabled: true,
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    expect(pressable.props.disabled).toBe(true);
  });

  it('passes disabled=false to Pressable when prop is omitted', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    expect(pressable.props.disabled).toBe(false);
  });
});

describe('FunnelPrimaryButton — accessibility', () => {
  it('sets accessibilityRole="button" always', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '다음',
        onPress: vi.fn(),
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    expect(pressable.props.accessibilityRole).toBe('button');
  });

  it('defaults accessibilityLabel to the visible label when not supplied', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    expect(pressable.props.accessibilityLabel).toBe('시작하기');
  });

  it('honours a caller-supplied accessibilityLabel override', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '→',
        onPress: vi.fn(),
        accessibilityLabel: '다음 단계로 이동',
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    expect(pressable.props.accessibilityLabel).toBe('다음 단계로 이동');
  });

  it('reflects disabled=true in accessibilityState.disabled', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '다음',
        onPress: vi.fn(),
        disabled: true,
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    const state = pressable.props.accessibilityState as {
      readonly disabled: boolean;
    };
    expect(state.disabled).toBe(true);
  });

  it('reflects disabled=false in accessibilityState.disabled by default', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '다음',
        onPress: vi.fn(),
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    const state = pressable.props.accessibilityState as {
      readonly disabled: boolean;
    };
    expect(state.disabled).toBe(false);
  });
});

describe('FunnelPrimaryButton — styling pulled from design tokens', () => {
  // Helper: resolve the Pressable's `style` prop for a given pressed state.
  // The component uses the function-form style API, so we invoke it with the
  // appropriate pseudo state argument to extract the resolved style array.
  function resolveStyle(
    pressable: TestInstance,
    state: { readonly pressed: boolean },
  ): Record<string, unknown> {
    const styleProp = pressable.props.style as unknown;
    const resolved =
      typeof styleProp === 'function'
        ? (styleProp as (s: typeof state) => unknown)(state)
        : styleProp;
    if (Array.isArray(resolved)) {
      return resolved.reduce(
        (acc: Record<string, unknown>, item: unknown) => {
          if (item == null || typeof item !== 'object') return acc;
          return { ...acc, ...(item as Record<string, unknown>) };
        },
        {},
      );
    }
    return (resolved as Record<string, unknown>) ?? {};
  }

  it('uses COLORS.base.coral as the enabled background fill', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    const style = resolveStyle(pressable, { pressed: false });
    expect(style.backgroundColor).toBe(COLORS.base.coral);
  });

  it('swaps to COLORS.grayscale.disabled fill when disabled', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
        disabled: true,
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    const style = resolveStyle(pressable, { pressed: false });
    expect(style.backgroundColor).toBe(COLORS.grayscale.disabled);
  });

  it('applies a press-feedback opacity dip while pressed (enabled state)', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    const pressedStyle = resolveStyle(pressable, { pressed: true });
    const idleStyle = resolveStyle(pressable, { pressed: false });
    expect(pressedStyle.opacity).toBe(0.7);
    // Idle state must NOT carry the press opacity (would dim the button
    // even when not pressed).
    expect(idleStyle.opacity).toBeUndefined();
  });

  it('does NOT apply press feedback when disabled (no pressed branch)', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
        disabled: true,
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    const style = resolveStyle(pressable, { pressed: true });
    // Disabled state pins the gray fill regardless of pressed flag.
    expect(style.backgroundColor).toBe(COLORS.grayscale.disabled);
    expect(style.opacity).toBeUndefined();
  });

  it('uses SPACING.md vertical and SPACING.xl horizontal padding tokens', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    const style = resolveStyle(pressable, { pressed: false });
    expect(style.paddingVertical).toBe(SPACING.md);
    expect(style.paddingHorizontal).toBe(SPACING.xl);
  });

  it('uses a fully rounded pill (borderRadius 999) — stylistic constant', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
      }),
    );
    const pressable = result.getByTestId(
      FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID,
    );
    const style = resolveStyle(pressable, { pressed: false });
    expect(style.borderRadius).toBe(999);
  });

  it('renders the label with TYPOGRAPHY.button.bold + white color', () => {
    const result = render(
      React.createElement(FunnelPrimaryButton, {
        label: '시작하기',
        onPress: vi.fn(),
      }),
    );
    const textNode = result.findTextNode('시작하기');
    const styleProp = textNode.props.style as Record<string, unknown>;
    expect(styleProp.fontSize).toBe(TYPOGRAPHY.button.bold.fontSize);
    expect(styleProp.fontWeight).toBe(TYPOGRAPHY.button.bold.fontWeight);
    expect(styleProp.color).toBe(COLORS.grayscale.background);
    expect(styleProp.textAlign).toBe('center');
  });
});
