/**
 * Unit test — `apps/mobile/src/providers/FunnelStateProvider.tsx`
 * `setSelectedPaymentMethod` action (Sub-AC 15.2 / Phase 2.4).
 *
 * Verifies the **dedicated single-purpose action** that updates
 * `payment.selectedMethod`. The Sub-AC 15.2 contract is:
 *
 *   - Invoking `setSelectedPaymentMethod('kakao')` produces a new `payment`
 *     snapshot where `selectedMethod === 'kakao'`. `isProcessing` and
 *     `isPremium` are carried over untouched from the previous snapshot.
 *   - Invoking `setSelectedPaymentMethod('toss')` produces a new snapshot
 *     where `selectedMethod === 'toss'`. Other fields untouched.
 *   - Invoking `setSelectedPaymentMethod(null)` clears the selection so
 *     `selectedMethod === null`. Other fields untouched.
 *   - The previous `payment` reference is never mutated in place — the
 *     captured pre-write snapshot retains its original values after writes
 *     occur (immutable update — Seed constraint "Context value types must
 *     be immutable readonly").
 *   - The action reference itself is stable across re-renders so consumers
 *     can list it in `useEffect` dependency arrays without spurious re-runs.
 *
 * Why a dedicated test file (not folded into
 * `funnel-state-payment-slice.test.tsx`):
 *   The project's `coding-standards` rule prefers many small files over
 *   few large files. The existing slice test covers initial-state shape
 *   only (Sub-AC 15.1); this file covers the write semantics of the new
 *   action (Sub-AC 15.2). Keeping them apart lets each grow independently
 *   as future sub-ACs (processing-flag toggle, premium-gate flip) add
 *   their own write tests.
 *
 * Testing approach:
 *   Same `react-test-renderer` + `vi.mock('react-native')` pattern used
 *   across the funnel test suite (see `funnel-state-payment-slice.test.tsx`
 *   for the full rationale). A small Probe consumer reads the context via
 *   `useFunnelState()` and mirrors the live `payment` snapshot back into
 *   an external capture bundle so the test body can assert on it without
 *   going through @testing-library/react-native.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Mock `react-native` to a minimal host-component set so the provider's
// transitive imports resolve through vite's SSR transform. Mirrors the mock
// used by every other component test in this suite.
vi.mock('react-native', async () => {
  const reactActual: typeof import('react') = await vi.importActual('react');
  const makeHost =
    (label: string) =>
    (props: { readonly children?: React.ReactNode } & Record<string, unknown>) =>
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
      flatten: (s: unknown): unknown => s,
    },
    Platform: {
      OS: 'ios',
      select: (m: { ios?: unknown; default?: unknown }) => m.ios ?? m.default,
    },
  };
});

import {
  FunnelStateProvider,
  useFunnelState,
} from '../src/providers/FunnelStateProvider';
import {
  type FunnelPayment,
  type FunnelStateValue,
  type SetSelectedPaymentMethod,
} from '../src/contracts/funnel-state';

// ---------------------------------------------------------------------------
// Probe helper — mirrors the latest context value into an external bundle
// so the test body can read it after each `act(...)`.
// ---------------------------------------------------------------------------

interface ProbeCapture {
  latest: FunnelStateValue | null;
  // History of `payment` references seen across renders so the test can
  // assert that the captured pre-write snapshot did NOT mutate underneath
  // the consumer (immutable update invariant).
  history: FunnelPayment[];
}

function Probe(props: { readonly capture: ProbeCapture }): React.ReactElement {
  const value = useFunnelState();
  props.capture.latest = value;
  props.capture.history.push(value.payment);
  return React.createElement('View', { testID: 'probe' });
}

function makeCapture(): ProbeCapture {
  return { latest: null, history: [] };
}

function renderWithProvider(
  capture: ProbeCapture,
  options: { readonly initialPayment?: FunnelPayment } = {},
): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(
      React.createElement(
        FunnelStateProvider,
        options.initialPayment !== undefined
          ? { initialPayment: options.initialPayment }
          : {},
        React.createElement(Probe, { capture }),
      ),
    );
  });
  if (!tree) {
    throw new Error('TestRenderer.create did not produce a tree');
  }
  return tree;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FunnelStateProvider — setSelectedPaymentMethod action (Sub-AC 15.2)', () => {
  it('exposes a setSelectedPaymentMethod function on the context value', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    expect(typeof capture.latest?.setSelectedPaymentMethod).toBe('function');
  });

  it("transitions payment.selectedMethod to 'kakao' when invoked with 'kakao'", () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    // Sanity: initial state matches Sub-AC 15.1 default.
    expect(capture.latest?.payment.selectedMethod).toBeNull();

    const setSelectedPaymentMethod = capture.latest
      ?.setSelectedPaymentMethod as SetSelectedPaymentMethod;
    act(() => {
      setSelectedPaymentMethod('kakao');
    });

    expect(capture.latest?.payment.selectedMethod).toBe('kakao');
  });

  it("transitions payment.selectedMethod to 'toss' when invoked with 'toss'", () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const setSelectedPaymentMethod = capture.latest
      ?.setSelectedPaymentMethod as SetSelectedPaymentMethod;
    act(() => {
      setSelectedPaymentMethod('toss');
    });

    expect(capture.latest?.payment.selectedMethod).toBe('toss');
  });

  it('clears payment.selectedMethod back to null when invoked with null', () => {
    const capture = makeCapture();
    // Seed with a non-null selection so the null-clear is observable as a
    // real transition rather than a no-op against the default.
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: 'kakao',
        isProcessing: false,
        isPremium: false,
      },
    });
    expect(capture.latest?.payment.selectedMethod).toBe('kakao');

    const setSelectedPaymentMethod = capture.latest
      ?.setSelectedPaymentMethod as SetSelectedPaymentMethod;
    act(() => {
      setSelectedPaymentMethod(null);
    });

    expect(capture.latest?.payment.selectedMethod).toBeNull();
  });

  it('produces a new payment object reference per write (no in-place mutation)', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const firstSnapshot = capture.latest?.payment;
    expect(firstSnapshot).toBeDefined();

    const setSelectedPaymentMethod = capture.latest
      ?.setSelectedPaymentMethod as SetSelectedPaymentMethod;
    act(() => {
      setSelectedPaymentMethod('toss');
    });

    const secondSnapshot = capture.latest?.payment;
    // Reference must differ — proves the provider returned a new object.
    expect(secondSnapshot).not.toBe(firstSnapshot);
    // And the captured pre-write snapshot is unchanged — the previous
    // reference's fields were not mutated underneath the consumer.
    expect(firstSnapshot?.selectedMethod).toBeNull();
    expect(firstSnapshot?.isProcessing).toBe(false);
    expect(firstSnapshot?.isPremium).toBe(false);
  });

  it('preserves isProcessing and isPremium across selectedMethod writes', () => {
    const capture = makeCapture();
    // Seed with non-default flags so the preservation guarantee is
    // observable on both `isProcessing` and `isPremium` simultaneously.
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: true,
      },
    });

    const setSelectedPaymentMethod = capture.latest
      ?.setSelectedPaymentMethod as SetSelectedPaymentMethod;
    act(() => {
      setSelectedPaymentMethod('kakao');
    });

    expect(capture.latest?.payment.selectedMethod).toBe('kakao');
    // Both flags carried over untouched — the dedicated single-purpose
    // action does not widen its surface to other payment-slice fields.
    expect(capture.latest?.payment.isProcessing).toBe(true);
    expect(capture.latest?.payment.isPremium).toBe(true);
  });

  it('accumulates sequential transitions: null → kakao → toss → null', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const setSelectedPaymentMethod = capture.latest
      ?.setSelectedPaymentMethod as SetSelectedPaymentMethod;

    act(() => {
      setSelectedPaymentMethod('kakao');
    });
    expect(capture.latest?.payment.selectedMethod).toBe('kakao');

    act(() => {
      setSelectedPaymentMethod('toss');
    });
    expect(capture.latest?.payment.selectedMethod).toBe('toss');

    act(() => {
      setSelectedPaymentMethod(null);
    });
    expect(capture.latest?.payment.selectedMethod).toBeNull();
  });

  it('keeps the setSelectedPaymentMethod reference stable across state updates', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const initialAction = capture.latest?.setSelectedPaymentMethod;
    expect(typeof initialAction).toBe('function');

    act(() => {
      (initialAction as SetSelectedPaymentMethod)('kakao');
    });
    const afterFirstWrite = capture.latest?.setSelectedPaymentMethod;

    act(() => {
      (afterFirstWrite as SetSelectedPaymentMethod)('toss');
    });
    const afterSecondWrite = capture.latest?.setSelectedPaymentMethod;

    // Reference identity is stable across writes — combined with the
    // useMemo bundle, this prevents consumers from re-rendering purely
    // because the action reference changed.
    expect(afterFirstWrite).toBe(initialAction);
    expect(afterSecondWrite).toBe(initialAction);
  });

  it('is a state-bailout no-op when re-tapping the already-selected method', () => {
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: 'kakao',
        isProcessing: false,
        isPremium: false,
      },
    });

    const beforeRetap = capture.latest?.payment;
    const setSelectedPaymentMethod = capture.latest
      ?.setSelectedPaymentMethod as SetSelectedPaymentMethod;

    act(() => {
      setSelectedPaymentMethod('kakao');
    });

    // React bails out when the reducer returns the same reference, so the
    // payment snapshot stays === to the pre-tap reference. This guarantees
    // downstream `useMemo`s keyed on `payment` do not rebuild on a re-tap.
    expect(capture.latest?.payment).toBe(beforeRetap);
    expect(capture.latest?.payment.selectedMethod).toBe('kakao');
  });
});
