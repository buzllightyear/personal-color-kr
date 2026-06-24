/**
 * Integration test — `app/(funnel)/diagnosis-input.tsx` Apple Sign In gate.
 *
 * Complements `diagnosis-input-route.test.tsx` (which pins the signed-in
 * capture wiring): here we drive the SIGNED-OUT path. With `readAuthToken`
 * mocked to resolve `null`, the route hydrates to `signed_out` and renders the
 * gate; we then exercise the three `runSignIn` outcomes:
 *   - `signed_in` → the slice flips and the route re-renders into the capture
 *     surface (`DiagnosisInputScreen`);
 *   - `error`     → the gate stays put and surfaces the error copy;
 *   - `canceled`  → the gate stays put, silently, with no error.
 *
 * `run-sign-in` is mocked so no native `@sentry/react-native` / Apple bridge is
 * pulled in and each outcome is injected deterministically.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignInResult } from '../src/run-sign-in';

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

vi.mock('expo-router', () => {
  return { useRouter: (): { push: (path: string) => void } => ({ push: vi.fn() }) };
});

vi.mock('../src/pick-selfie', () => {
  return { pickSelfieUri: (): Promise<string | null> => Promise.resolve(null) };
});

// Hydration reads null → the route lands on the signed-out gate.
vi.mock('../src/storage/auth-token-storage', () => {
  return { readAuthToken: (): Promise<string | null> => Promise.resolve(null) };
});

// Inject the sign-in outcome per test via this controllable spy.
const runSignInMock = vi.fn<[], Promise<SignInResult>>();
vi.mock('../src/run-sign-in', () => {
  return { runSignIn: (): Promise<SignInResult> => runSignInMock() };
});

import DiagnosisInputRoute from '../app/(funnel)/diagnosis-input';
import { FunnelStateProvider } from '../src/providers/FunnelStateProvider';
import { APPLE_SIGN_IN_BUTTON_TEST_ID } from '../src/components/funnel/AppleSignInButton';
import { DIAGNOSIS_SIGN_IN_GATE_ERROR_TEST_ID } from '../src/screens/funnel/DiagnosisSignInGateScreen';
import {
  SIGN_IN_NETWORK_MESSAGE,
  SIGN_IN_REJECTED_MESSAGE,
} from '../src/sign-in-error-message';

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

async function renderRoute(): Promise<TestRenderer.ReactTestRenderer> {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      React.createElement(
        FunnelStateProvider,
        {},
        React.createElement(DiagnosisInputRoute),
      ),
    );
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

async function pressAppleButton(tree: TestRenderer.ReactTestRenderer): Promise<void> {
  const button = findHostByTestId(tree, APPLE_SIGN_IN_BUTTON_TEST_ID);
  expect(button).toBeTruthy();
  await act(async () => {
    (button?.props.onPress as () => void)();
  });
}

describe('diagnosis-input route — Apple Sign In gate', () => {
  beforeEach(() => {
    runSignInMock.mockReset();
  });

  it('renders the gate (not the capture surface) when signed out', async () => {
    runSignInMock.mockResolvedValue({ status: 'canceled' });
    const tree = await renderRoute();
    expect(findHostByTestId(tree, 'diagnosis-sign-in-gate-screen')).toBeTruthy();
    expect(findHostByTestId(tree, 'diagnosis-input-screen')).toBeNull();
  });

  it('flips to the capture surface after a successful sign-in', async () => {
    runSignInMock.mockResolvedValue({ status: 'signed_in', userId: 'user-123' });
    const tree = await renderRoute();
    await pressAppleButton(tree);
    expect(runSignInMock).toHaveBeenCalledTimes(1);
    expect(findHostByTestId(tree, 'diagnosis-input-screen')).toBeTruthy();
    expect(findHostByTestId(tree, 'diagnosis-sign-in-gate-screen')).toBeNull();
  });

  it('shows the rejection copy on a backend rejection (httpStatus present)', async () => {
    runSignInMock.mockResolvedValue({ status: 'error', httpStatus: 401 });
    const tree = await renderRoute();
    await pressAppleButton(tree);
    const errorNode = findHostByTestId(tree, DIAGNOSIS_SIGN_IN_GATE_ERROR_TEST_ID);
    expect(errorNode).toBeTruthy();
    expect(errorNode?.props.children).toBe(SIGN_IN_REJECTED_MESSAGE);
    expect(findHostByTestId(tree, 'diagnosis-input-screen')).toBeNull();
  });

  it('shows the connectivity copy when the backend was unreachable (httpStatus null)', async () => {
    runSignInMock.mockResolvedValue({ status: 'error', httpStatus: null });
    const tree = await renderRoute();
    await pressAppleButton(tree);
    const errorNode = findHostByTestId(tree, DIAGNOSIS_SIGN_IN_GATE_ERROR_TEST_ID);
    expect(errorNode).toBeTruthy();
    expect(errorNode?.props.children).toBe(SIGN_IN_NETWORK_MESSAGE);
    expect(errorNode?.props.children).not.toBe(SIGN_IN_REJECTED_MESSAGE);
    expect(findHostByTestId(tree, 'diagnosis-input-screen')).toBeNull();
  });

  it('stays on the gate with no error when the user cancels', async () => {
    runSignInMock.mockResolvedValue({ status: 'canceled' });
    const tree = await renderRoute();
    await pressAppleButton(tree);
    expect(findHostByTestId(tree, 'diagnosis-sign-in-gate-screen')).toBeTruthy();
    expect(findHostByTestId(tree, DIAGNOSIS_SIGN_IN_GATE_ERROR_TEST_ID)).toBeNull();
  });
});
