/**
 * Render test — `apps/mobile/app/(post-payment)/_layout.tsx`.
 *
 * Phase 3.3 Sub-AC 1.1 / Sub-AC 2 contract:
 *   - First-entry redirect: when the persisted `DiagnosisRevealSeen`
 *     flag is false and the pathname is not the reveal route, redirect
 *     to /(post-payment)/diagnosis-reveal.
 *   - Loop-suppression: when pathname === /(post-payment)/diagnosis-reveal,
 *     render the Stack (no redirect).
 *   - Revisit (DiagnosisRevealSeen === true): no redirect, Stack renders.
 *   - Stack has exactly 2 children: diagnosis-reveal (fullScreenModal,
 *     gestureEnabled false) + (tabs).
 *   - Stack screenOptions.headerShown === false.
 *
 * The ToneStateProvider wrap and AsyncStorage read are mocked so the
 * test stays pure to the layout's routing/Stack contract.
 */
import * as React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectHrefRecorder: string[] = [];
const stackScreenOptionsRecorder: Array<unknown> = [];
const stackChildrenRecorder: Array<{ name: string; options: unknown }> = [];
let mockPathname: string = '/';
let mockRevealSeen: boolean = false;

vi.mock('expo-router', async () => {
  const reactActual: any = await vi.importActual('react');

  function StackSpy(props: any) {
    stackScreenOptionsRecorder.push(props.screenOptions);
    reactActual.Children.forEach(props.children, (child: any) => {
      if (child && child.props && typeof child.props.name === 'string') {
        stackChildrenRecorder.push({
          name: child.props.name,
          options: child.props.options ?? null,
        });
      }
    });
    return reactActual.createElement(reactActual.Fragment, null);
  }
  (StackSpy as any).Screen = function MockScreen() {
    return null;
  };

  function MockRedirect(props: { href: string }) {
    redirectHrefRecorder.push(props.href);
    return null;
  }

  function mockUsePathname(): string {
    return mockPathname;
  }

  return {
    Stack: StackSpy,
    Redirect: MockRedirect,
    usePathname: mockUsePathname,
  };
});

// ToneStateProvider is mocked to a pass-through Fragment so the layout's
// Stack contract is the unit under test (the provider's own contract is
// covered by tone-state-provider.test.tsx).
vi.mock('../src/providers/ToneStateProvider', async () => {
  const reactActual: any = await vi.importActual('react');
  return {
    ToneStateProvider: function ToneStateProviderMock(props: {
      children?: React.ReactNode;
    }) {
      return reactActual.createElement(reactActual.Fragment, null, props.children);
    },
  };
});

// AsyncStorage wrapper — readDiagnosisRevealSeen returns a Promise of
// mockRevealSeen so individual tests can flip the persisted-gate state
// between renders.
vi.mock('../src/storage/post-payment-storage', () => ({
  readDiagnosisRevealSeen: async () => mockRevealSeen,
}));

async function loadPostPaymentLayout() {
  const mod: any = await import('../app/(post-payment)/_layout');
  return mod.default;
}

describe('(post-payment) _layout — first-touch diagnosis-reveal gate', () => {
  beforeEach(() => {
    vi.resetModules();
    redirectHrefRecorder.length = 0;
    stackScreenOptionsRecorder.length = 0;
    stackChildrenRecorder.length = 0;
    mockPathname = '/';
    mockRevealSeen = false;
  });

  it('default-exports a React component (function)', async () => {
    const PostPaymentLayout = await loadPostPaymentLayout();
    expect(typeof PostPaymentLayout).toBe('function');
  });

  it('on first entry (revealSeen=false, pathname != reveal) renders Redirect to /(post-payment)/diagnosis-reveal', async () => {
    mockRevealSeen = false;
    mockPathname = '/';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    await waitFor(() => {
      expect(redirectHrefRecorder).toEqual(['/(post-payment)/diagnosis-reveal']);
    });
    expect(stackScreenOptionsRecorder).toHaveLength(0);
    expect(stackChildrenRecorder).toHaveLength(0);
  });

  it('does NOT redirect when already on the diagnosis-reveal route (loop suppression)', async () => {
    mockRevealSeen = false;
    mockPathname = '/(post-payment)/diagnosis-reveal';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    await waitFor(() => {
      expect(stackScreenOptionsRecorder).toHaveLength(1);
    });
    expect(redirectHrefRecorder).toHaveLength(0);
  });

  it('does NOT redirect when DiagnosisRevealSeen === true (revisit path)', async () => {
    mockRevealSeen = true;
    mockPathname = '/(post-payment)/(tabs)/edit';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    await waitFor(() => {
      expect(stackScreenOptionsRecorder).toHaveLength(1);
    });
    expect(redirectHrefRecorder).toHaveLength(0);
  });

  it('Stack has headerShown: false in screenOptions when it renders', async () => {
    mockRevealSeen = false;
    mockPathname = '/(post-payment)/diagnosis-reveal';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    await waitFor(() => expect(stackScreenOptionsRecorder).toHaveLength(1));
    expect(stackScreenOptionsRecorder[0]).toEqual({ headerShown: false });
  });

  it('declares exactly two Stack.Screen children: diagnosis-reveal + (tabs)', async () => {
    mockRevealSeen = false;
    mockPathname = '/(post-payment)/diagnosis-reveal';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    await waitFor(() => {
      expect(stackChildrenRecorder).toHaveLength(2);
    });
    const names = stackChildrenRecorder.map((c) => c.name).sort();
    expect(names).toEqual(['(tabs)', 'diagnosis-reveal']);
  });

  it('diagnosis-reveal screen is declared as a full-screen modal with gestureEnabled: false', async () => {
    mockRevealSeen = false;
    mockPathname = '/(post-payment)/diagnosis-reveal';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    await waitFor(() => expect(stackChildrenRecorder).toHaveLength(2));
    const reveal = stackChildrenRecorder.find((c) => c.name === 'diagnosis-reveal');
    expect(reveal).toBeDefined();
    expect(reveal?.options).toEqual({
      presentation: 'fullScreenModal',
      gestureEnabled: false,
    });
  });

  it('(tabs) child is declared with no overriding options (inherits parent screenOptions)', async () => {
    mockRevealSeen = false;
    mockPathname = '/(post-payment)/diagnosis-reveal';
    const PostPaymentLayout = await loadPostPaymentLayout();
    render(React.createElement(PostPaymentLayout));

    await waitFor(() => expect(stackChildrenRecorder).toHaveLength(2));
    const tabs = stackChildrenRecorder.find((c) => c.name === '(tabs)');
    expect(tabs).toBeDefined();
    expect(tabs?.options).toBeNull();
  });
});
