/**
 * Unit test — `apps/mobile/src/components/funnel/PaymentMethodRadio.tsx`
 * mutually-exclusive payment-method radio group component (Phase 2.4,
 * Sub-AC 7.2).
 *
 * What this test pins (Sub-AC 7.2 primary contract — selection toggling
 * and onChange callback):
 *   1. The component renders the group root host with the documented
 *      testID (`<prefix>-method-radio-group`) carrying
 *      `accessibilityRole="radiogroup"`.
 *   2. The component renders exactly two option hosts (one per
 *      `PaymentMethod` literal — `'kakao'` and `'toss'`) carrying:
 *        - `accessibilityRole="radio"`
 *        - the Korean label sourced from
 *          {@link PAYMENT_MODEL_METHOD_LABELS} as the `accessibilityLabel`
 *        - the documented testID pattern (`<prefix>-method-option-<method>`)
 *   3. Mutually-exclusive selection toggling:
 *        - When `value === null`, neither option carries
 *          `accessibilityState.selected === true` and the inner radio dot
 *          is empty on both options (pinning the "no selection yet"
 *          initial state surface).
 *        - When `value === 'kakao'`, the `kakao` option carries
 *          `accessibilityState.selected === true` AND the `toss` option
 *          carries `accessibilityState.selected === false` (one selected,
 *          one not — mutually exclusive).
 *        - When `value === 'toss'`, the symmetric assertion holds
 *          (`toss` selected, `kakao` not selected).
 *   4. onChange callback wiring:
 *        - Tapping the `kakao` option invokes `onChange('kakao')` exactly
 *          once.
 *        - Tapping the `toss` option invokes `onChange('toss')` exactly
 *          once.
 *        - Tapping the currently-selected option still invokes
 *          `onChange(method)` with the same method (no deselect-via-tap;
 *          the radio group never invokes `onChange(null)` itself).
 *   5. Disabled-state contract:
 *        - When `disabled === true`, both options carry
 *          `disabled === true` on the Pressable AND `onPress` is
 *          `undefined` (defence-in-depth — RN drops the press hit-target
 *          AND no callback is wired so the parent cannot observe a press).
 *        - Both options carry `accessibilityState.disabled === true`.
 *        - Tapping (manually invoking `onPress`) does NOT invoke the
 *          supplied `onChange` callback (since `onPress` is `undefined`).
 *   6. testID convention:
 *        - The default testID prefix is `'payment-model'`.
 *        - A custom `testIDPrefix` re-roots all derived testIDs
 *          deterministically.
 *        - The exported `PAYMENT_METHOD_RADIO_DEFAULT_TEST_ID_PREFIX`
 *          constant equals the documented kebab-case prefix.
 *        - The exported `PAYMENT_METHOD_RADIO_OPTIONS` tuple equals
 *          `['kakao', 'toss']` (drift guard between the closed-domain
 *          tuple and the rendered surface).
 *
 * Why react-test-renderer + the same `vi.mock('react-native')` shape as
 * the sibling component tests (`scan-option-item.test.tsx`,
 * `price-card.test.tsx`, `funnel-headline.test.tsx`):
 *   The setup-rn-stub pre-populates Node's CJS require.cache so the
 *   testing-library helpers do not crash on `require('react-native')`.
 *   Vite's ESM SSR transform, however, resolves the component's
 *   `import { View, Text, Pressable, StyleSheet } from 'react-native'`
 *   through the ESM path which lands on the real Flow file. The inline
 *   `vi.mock` shadows that resolution with a minimal host-component map,
 *   exactly mirroring the sibling component tests' pattern.
 *
 * Why props-based (not screen-mounted):
 *   `PaymentMethodRadio` is a pure controlled leaf — no expo-router, no
 *   context, no async. A direct prop-injection render asserts the
 *   contract surface without spinning up the whole `payment_model` screen
 *   tree.
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

import type { PaymentMethod } from '../src/contracts/funnel-state';
import { PAYMENT_MODEL_METHOD_LABELS } from '../src/funnel/payment-model-ctas';
import {
  PAYMENT_METHOD_RADIO_DEFAULT_TEST_ID_PREFIX,
  PAYMENT_METHOD_RADIO_OPTIONS,
  PaymentMethodRadio,
} from '../src/components/funnel/PaymentMethodRadio';

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

const NO_OP = (): void => undefined;

describe('PaymentMethodRadio — group root', () => {
  it('renders a host element with the default <prefix>-method-radio-group testID', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
      }),
    );
    const group = findHostByTestId(tree, 'payment-model-method-radio-group');
    expect(group).toBeTruthy();
  });

  it('marks the group root with accessibilityRole="radiogroup"', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
      }),
    );
    const group = findHostByTestId(tree, 'payment-model-method-radio-group');
    expect(group?.props.accessibilityRole).toBe('radiogroup');
  });

  it('exposes the documented default testID prefix ("payment-model")', () => {
    // Drift guard: the exported constant must equal the kebab-case prefix
    // baked into the rendered handle. A future refactor that desyncs the
    // constant from the component fails this assertion.
    expect(PAYMENT_METHOD_RADIO_DEFAULT_TEST_ID_PREFIX).toBe('payment-model');
  });
});

describe('PaymentMethodRadio — option set (closed domain)', () => {
  it('renders exactly two options: kakao + toss', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
      }),
    );
    expect(
      findHostByTestId(tree, 'payment-model-method-option-kakao'),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'payment-model-method-option-toss'),
    ).toBeTruthy();
  });

  it('exposes the closed-domain tuple as ["kakao", "toss"] in canonical order', () => {
    // Pin the exported tuple to the documented domain order so a future
    // refactor that introduces a third method (or reorders the two) is
    // caught by this assertion before it ships.
    expect(PAYMENT_METHOD_RADIO_OPTIONS).toEqual(['kakao', 'toss']);
  });

  it('renders each option with accessibilityRole="radio"', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    const toss = findHostByTestId(tree, 'payment-model-method-option-toss');
    expect(kakao?.props.accessibilityRole).toBe('radio');
    expect(toss?.props.accessibilityRole).toBe('radio');
  });

  it('renders each option with the Korean label from PAYMENT_MODEL_METHOD_LABELS as accessibilityLabel', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    const toss = findHostByTestId(tree, 'payment-model-method-option-toss');
    expect(kakao?.props.accessibilityLabel).toBe(
      PAYMENT_MODEL_METHOD_LABELS.kakao,
    );
    expect(toss?.props.accessibilityLabel).toBe(
      PAYMENT_MODEL_METHOD_LABELS.toss,
    );
  });
});

describe('PaymentMethodRadio — mutually-exclusive selection toggling (Sub-AC 7.2 primary)', () => {
  it('paints neither option as selected when value === null', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    const toss = findHostByTestId(tree, 'payment-model-method-option-toss');
    expect(
      (kakao?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(false);
    expect(
      (toss?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(false);
  });

  it('paints only the kakao option as selected when value === "kakao"', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: 'kakao' satisfies PaymentMethod,
        onChange: NO_OP,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    const toss = findHostByTestId(tree, 'payment-model-method-option-toss');
    expect(
      (kakao?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(true);
    expect(
      (toss?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(false);
  });

  it('paints only the toss option as selected when value === "toss"', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: 'toss' satisfies PaymentMethod,
        onChange: NO_OP,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    const toss = findHostByTestId(tree, 'payment-model-method-option-toss');
    expect(
      (kakao?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(false);
    expect(
      (toss?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(true);
  });

  it('renders the inner radio-dot fill only on the selected option (kakao selected)', () => {
    // Mutually-exclusive affordance independent of colour fill — the
    // selected option's radio dot carries an inner filled child, the
    // unselected option's dot is empty.
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: 'kakao' satisfies PaymentMethod,
        onChange: NO_OP,
      }),
    );
    const kakaoDot = findHostByTestId(tree, 'payment-model-method-dot-kakao');
    const tossDot = findHostByTestId(tree, 'payment-model-method-dot-toss');
    expect(kakaoDot).toBeTruthy();
    expect(tossDot).toBeTruthy();
    // Selected dot has a filled inner View child (1+ child host nodes).
    // Unselected dot has no inner child.
    const kakaoChildren = (kakaoDot?.children ?? []) as readonly unknown[];
    const tossChildren = (tossDot?.children ?? []) as readonly unknown[];
    expect(kakaoChildren.length).toBeGreaterThan(0);
    expect(tossChildren.length).toBe(0);
  });

  it('renders the inner radio-dot fill only on the selected option (toss selected)', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: 'toss' satisfies PaymentMethod,
        onChange: NO_OP,
      }),
    );
    const kakaoDot = findHostByTestId(tree, 'payment-model-method-dot-kakao');
    const tossDot = findHostByTestId(tree, 'payment-model-method-dot-toss');
    const kakaoChildren = (kakaoDot?.children ?? []) as readonly unknown[];
    const tossChildren = (tossDot?.children ?? []) as readonly unknown[];
    expect(kakaoChildren.length).toBe(0);
    expect(tossChildren.length).toBeGreaterThan(0);
  });

  it('renders neither inner radio-dot fill when value === null', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
      }),
    );
    const kakaoDot = findHostByTestId(tree, 'payment-model-method-dot-kakao');
    const tossDot = findHostByTestId(tree, 'payment-model-method-dot-toss');
    const kakaoChildren = (kakaoDot?.children ?? []) as readonly unknown[];
    const tossChildren = (tossDot?.children ?? []) as readonly unknown[];
    expect(kakaoChildren.length).toBe(0);
    expect(tossChildren.length).toBe(0);
  });
});

describe('PaymentMethodRadio — onChange callback wiring (Sub-AC 7.2 primary)', () => {
  it('invokes onChange("kakao") exactly once when the kakao option is pressed', () => {
    const onChange = vi.fn();
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    const handler = kakao?.props.onPress as (() => void) | undefined;
    expect(typeof handler).toBe('function');
    act(() => {
      (handler as () => void)();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('kakao');
  });

  it('invokes onChange("toss") exactly once when the toss option is pressed', () => {
    const onChange = vi.fn();
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange,
      }),
    );
    const toss = findHostByTestId(tree, 'payment-model-method-option-toss');
    const handler = toss?.props.onPress as (() => void) | undefined;
    expect(typeof handler).toBe('function');
    act(() => {
      (handler as () => void)();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('toss');
  });

  it('toggles selection from kakao to toss across two presses (mutually-exclusive)', () => {
    // Simulate the parent controlling the value across re-renders. First
    // render: value === null, user taps kakao → onChange('kakao'). Parent
    // re-renders with value === 'kakao'. User taps toss → onChange('toss').
    // The radio group must never co-select both options.
    const onChange = vi.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(PaymentMethodRadio, {
          value: null,
          onChange,
        }),
      );
    });
    // First press: kakao.
    const kakao1 = findHostByTestId(
      tree!,
      'payment-model-method-option-kakao',
    );
    act(() => {
      (kakao1?.props.onPress as () => void)();
    });
    expect(onChange).toHaveBeenLastCalledWith('kakao');

    // Parent re-renders with value === 'kakao'.
    act(() => {
      tree!.update(
        React.createElement(PaymentMethodRadio, {
          value: 'kakao' satisfies PaymentMethod,
          onChange,
        }),
      );
    });
    const kakao2 = findHostByTestId(
      tree!,
      'payment-model-method-option-kakao',
    );
    const toss2 = findHostByTestId(tree!, 'payment-model-method-option-toss');
    expect(
      (kakao2?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(true);
    expect(
      (toss2?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(false);

    // Second press: toss.
    act(() => {
      (toss2?.props.onPress as () => void)();
    });
    expect(onChange).toHaveBeenLastCalledWith('toss');
    expect(onChange).toHaveBeenCalledTimes(2);

    // Parent re-renders with value === 'toss'.
    act(() => {
      tree!.update(
        React.createElement(PaymentMethodRadio, {
          value: 'toss' satisfies PaymentMethod,
          onChange,
        }),
      );
    });
    const kakao3 = findHostByTestId(
      tree!,
      'payment-model-method-option-kakao',
    );
    const toss3 = findHostByTestId(tree!, 'payment-model-method-option-toss');
    expect(
      (kakao3?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(false);
    expect(
      (toss3?.props.accessibilityState as { selected: boolean }).selected,
    ).toBe(true);
  });

  it('invokes onChange with the same method when the currently-selected option is re-pressed (no deselect-via-tap)', () => {
    // Radio convention: tapping a selected option does NOT clear the
    // selection. The component re-fires `onChange(method)` with the
    // same method (parent decides whether to re-affirm state); it
    // NEVER invokes `onChange(null)`.
    const onChange = vi.fn();
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: 'kakao' satisfies PaymentMethod,
        onChange,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    act(() => {
      (kakao?.props.onPress as () => void)();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('kakao');
    // Drift guard: the call argument must never be `null`.
    expect(onChange).not.toHaveBeenCalledWith(null);
  });
});

describe('PaymentMethodRadio — disabled state', () => {
  it('sets disabled=true on both Pressables when disabled prop is true', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
        disabled: true,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    const toss = findHostByTestId(tree, 'payment-model-method-option-toss');
    expect(kakao?.props.disabled).toBe(true);
    expect(toss?.props.disabled).toBe(true);
    expect(
      (kakao?.props.accessibilityState as { disabled: boolean }).disabled,
    ).toBe(true);
    expect(
      (toss?.props.accessibilityState as { disabled: boolean }).disabled,
    ).toBe(true);
  });

  it('passes undefined for onPress on both options when disabled (defence-in-depth)', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
        disabled: true,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    const toss = findHostByTestId(tree, 'payment-model-method-option-toss');
    expect(kakao?.props.onPress).toBeUndefined();
    expect(toss?.props.onPress).toBeUndefined();
  });

  it('does not invoke onChange when disabled options are pressed', () => {
    const onChange = vi.fn();
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange,
        disabled: true,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    const toss = findHostByTestId(tree, 'payment-model-method-option-toss');
    // The Pressable's `onPress` is `undefined` on a disabled option
    // (asserted above). Invoking it should be a no-op from the parent's
    // perspective — the supplied callback must never be called.
    const kakaoHandler = kakao?.props.onPress as (() => void) | undefined;
    const tossHandler = toss?.props.onPress as (() => void) | undefined;
    if (typeof kakaoHandler === 'function') {
      act(() => {
        (kakaoHandler as () => void)();
      });
    }
    if (typeof tossHandler === 'function') {
      act(() => {
        (tossHandler as () => void)();
      });
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('defaults disabled to false when prop is omitted', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
      }),
    );
    const kakao = findHostByTestId(tree, 'payment-model-method-option-kakao');
    const toss = findHostByTestId(tree, 'payment-model-method-option-toss');
    expect(kakao?.props.disabled).toBe(false);
    expect(toss?.props.disabled).toBe(false);
    expect(
      (kakao?.props.accessibilityState as { disabled: boolean }).disabled,
    ).toBe(false);
    expect(
      (toss?.props.accessibilityState as { disabled: boolean }).disabled,
    ).toBe(false);
  });
});

describe('PaymentMethodRadio — testID prefix expansion', () => {
  it('uses the default "payment-model" prefix when testIDPrefix is omitted', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
      }),
    );
    expect(
      findHostByTestId(tree, 'payment-model-method-radio-group'),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'payment-model-method-option-kakao'),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'payment-model-method-option-toss'),
    ).toBeTruthy();
  });

  it('re-roots all derived testIDs when a custom testIDPrefix is supplied', () => {
    const tree = render(
      React.createElement(PaymentMethodRadio, {
        value: null,
        onChange: NO_OP,
        testIDPrefix: 'custom-prefix',
      }),
    );
    expect(
      findHostByTestId(tree, 'custom-prefix-method-radio-group'),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'custom-prefix-method-option-kakao'),
    ).toBeTruthy();
    expect(
      findHostByTestId(tree, 'custom-prefix-method-option-toss'),
    ).toBeTruthy();
    // The default-prefixed handles must NOT resolve when the prefix is
    // overridden — drift guard against a copy-paste bug that hard-codes
    // the default in the component.
    expect(
      findHostByTestId(tree, 'payment-model-method-radio-group'),
    ).toBeNull();
    expect(
      findHostByTestId(tree, 'payment-model-method-option-kakao'),
    ).toBeNull();
    expect(
      findHostByTestId(tree, 'payment-model-method-option-toss'),
    ).toBeNull();
  });
});
