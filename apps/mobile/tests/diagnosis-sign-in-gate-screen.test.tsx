/**
 * Unit test — `screens/funnel/DiagnosisSignInGateScreen.tsx`.
 *
 * Pins the signed-out gate's presentational contract: it mounts the headline +
 * Apple button, fires `onSignIn` on press, disables the button while signing
 * in, and shows the error copy only when an `errorMessage` is supplied. Mirrors
 * the screen-test mocking strategy (host-component `react-native`, SafeAreaView
 * stub); `expo-apple-authentication` is aliased to its inert stub.
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
  DiagnosisSignInGateScreen,
  DIAGNOSIS_SIGN_IN_GATE_ERROR_TEST_ID,
} from '../src/screens/funnel/DiagnosisSignInGateScreen';
import { APPLE_SIGN_IN_BUTTON_TEST_ID } from '../src/components/funnel/AppleSignInButton';

interface TestInstance {
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

describe('DiagnosisSignInGateScreen', () => {
  it('mounts the gate surface with the Apple Sign In button', () => {
    const tree = render(
      React.createElement(DiagnosisSignInGateScreen, { onSignIn: vi.fn() }),
    );
    expect(findHostByTestId(tree, 'diagnosis-sign-in-gate-screen')).toBeTruthy();
    expect(findHostByTestId(tree, APPLE_SIGN_IN_BUTTON_TEST_ID)).toBeTruthy();
  });

  it('fires onSignIn when the Apple button is pressed', () => {
    const onSignIn = vi.fn();
    const tree = render(React.createElement(DiagnosisSignInGateScreen, { onSignIn }));
    act(() => {
      (
        findHostByTestId(tree, APPLE_SIGN_IN_BUTTON_TEST_ID)?.props
          .onPress as () => void
      )();
    });
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('swallows presses while signing in (isSigningIn disables the button)', () => {
    const onSignIn = vi.fn();
    const tree = render(
      React.createElement(DiagnosisSignInGateScreen, { onSignIn, isSigningIn: true }),
    );
    act(() => {
      (
        findHostByTestId(tree, APPLE_SIGN_IN_BUTTON_TEST_ID)?.props
          .onPress as () => void
      )();
    });
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it('hides the error row by default and shows it when an errorMessage is supplied', () => {
    const noError = render(
      React.createElement(DiagnosisSignInGateScreen, { onSignIn: vi.fn() }),
    );
    expect(findHostByTestId(noError, DIAGNOSIS_SIGN_IN_GATE_ERROR_TEST_ID)).toBeNull();

    const withError = render(
      React.createElement(DiagnosisSignInGateScreen, {
        onSignIn: vi.fn(),
        errorMessage: '로그인에 실패했어요. 다시 시도해 주세요.',
      }),
    );
    const errorNode = findHostByTestId(withError, DIAGNOSIS_SIGN_IN_GATE_ERROR_TEST_ID);
    expect(errorNode).toBeTruthy();
    expect(errorNode?.props.children).toBe('로그인에 실패했어요. 다시 시도해 주세요.');
  });
});
