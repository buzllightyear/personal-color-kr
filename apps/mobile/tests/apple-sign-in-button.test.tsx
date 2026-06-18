/**
 * Unit test — `components/funnel/AppleSignInButton.tsx`.
 *
 * The native `expo-apple-authentication` is aliased to an inert stub in
 * `vitest.config.ts` (its `AppleAuthenticationButton` renders as a host element
 * forwarding `testID` / `onPress`). Here we pin the press → callback contract
 * and the `disabled`-swallows-the-press guard without the native bridge.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  return {
    StyleSheet: {
      create: (s: Record<string, unknown>): Record<string, unknown> => s,
      flatten: (s: unknown): unknown => s,
    },
  };
});

import {
  AppleSignInButton,
  APPLE_SIGN_IN_BUTTON_TEST_ID,
} from '../src/components/funnel/AppleSignInButton';

interface TestInstance {
  readonly props: Record<string, unknown>;
}

function findButton(tree: TestRenderer.ReactTestRenderer): TestInstance | null {
  const matches = tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      node.props?.testID === APPLE_SIGN_IN_BUTTON_TEST_ID,
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

describe('AppleSignInButton', () => {
  it('invokes onPress when pressed', () => {
    const onPress = vi.fn();
    const tree = render(React.createElement(AppleSignInButton, { onPress }));
    const button = findButton(tree);
    expect(button).toBeTruthy();
    act(() => {
      (button?.props.onPress as () => void)();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('swallows the press while disabled (no callback)', () => {
    const onPress = vi.fn();
    const tree = render(
      React.createElement(AppleSignInButton, { onPress, disabled: true }),
    );
    act(() => {
      (findButton(tree)?.props.onPress as () => void)();
    });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders the SIGN_IN black button with the design-system radius 2', () => {
    const tree = render(React.createElement(AppleSignInButton, { onPress: vi.fn() }));
    const button = findButton(tree);
    expect(button?.props.cornerRadius).toBe(2);
    // BLACK style + SIGN_IN type come from the stub enums (0 / 0 respectively).
    expect(button?.props.buttonStyle).toBe(2);
    expect(button?.props.buttonType).toBe(0);
  });
});
