/**
 * Unit test — `apps/mobile/src/providers/FunnelStateProvider.tsx`
 * `setPaymentProcessing` action (Sub-AC 15.3 / Phase 2.4).
 *
 * Verifies the **dedicated single-purpose action** that toggles
 * `payment.isProcessing`. The Sub-AC 15.3 contract is:
 *
 *   - Invoking `setPaymentProcessing(true)` from the default state
 *     produces a new `payment` snapshot where `isProcessing === true`.
 *     `selectedMethod` and `isPremium` are carried over untouched from the
 *     previous snapshot.
 *   - Invoking `setPaymentProcessing(false)` after `(true)` produces a new
 *     snapshot where `isProcessing === false`. Other fields untouched.
 *   - The full `false → true → false` round-trip is observable on the
 *     latest captured snapshot.
 *   - The previous `payment` reference is never mutated in place — the
 *     captured pre-write snapshot retains its original values after writes
 *     occur (immutable update — Seed constraint "Context value types must
 *     be immutable readonly").
 *   - The action reference itself is stable across re-renders so consumers
 *     can list it in `useEffect` dependency arrays (the placeholder timer
 *     effect on payment_model lists it as a dep) without spurious re-runs.
 *   - A bailout write (e.g. `setPaymentProcessing(false)` while already
 *     `false`) returns the same reference verbatim so downstream `useMemo`s
 *     keyed on `payment` do not rebuild.
 *
 * Why a dedicated test file (not folded into
 * `funnel-state-payment-set-selected-method.test.tsx` or
 * `funnel-state-payment-slice.test.tsx`):
 *   The project's `coding-standards` rule prefers many small files over
 *   few large files. Each Sub-AC 15.* action gets its own file so the
 *   write semantics for one action can grow without bloating the others.
 *   This file owns Sub-AC 15.3 (`setPaymentProcessing` true/false
 *   transitions) exclusively.
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
  type SetPaymentProcessing,
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

describe('FunnelStateProvider — setPaymentProcessing action (Sub-AC 15.3)', () => {
  it('exposes a setPaymentProcessing function on the context value', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    expect(typeof capture.latest?.setPaymentProcessing).toBe('function');
  });

  it('transitions payment.isProcessing from false to true on (true)', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    // Sanity: initial state matches Sub-AC 15.1 default (false).
    expect(capture.latest?.payment.isProcessing).toBe(false);

    const setPaymentProcessing = capture.latest
      ?.setPaymentProcessing as SetPaymentProcessing;
    act(() => {
      setPaymentProcessing(true);
    });

    // Post-write: the latest snapshot reflects the true value.
    expect(capture.latest?.payment.isProcessing).toBe(true);
  });

  it('transitions payment.isProcessing from true back to false on (false)', () => {
    const capture = makeCapture();
    // Seed with `isProcessing: true` so the `(false)` transition is
    // observable as a real downward write rather than a no-op against the
    // default.
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: 'kakao',
        isProcessing: true,
        isPremium: false,
      },
    });
    expect(capture.latest?.payment.isProcessing).toBe(true);

    const setPaymentProcessing = capture.latest
      ?.setPaymentProcessing as SetPaymentProcessing;
    act(() => {
      setPaymentProcessing(false);
    });

    expect(capture.latest?.payment.isProcessing).toBe(false);
  });

  it('completes a full false → true → false round-trip', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const setPaymentProcessing = capture.latest
      ?.setPaymentProcessing as SetPaymentProcessing;

    // false → true (CTA tap simulator entered the in-flight state).
    act(() => {
      setPaymentProcessing(true);
    });
    expect(capture.latest?.payment.isProcessing).toBe(true);

    // true → false (placeholder timer fired / cleanup ran).
    act(() => {
      setPaymentProcessing(false);
    });
    expect(capture.latest?.payment.isProcessing).toBe(false);
  });

  it('produces a new payment object reference per write (no in-place mutation)', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const firstSnapshot = capture.latest?.payment;
    expect(firstSnapshot).toBeDefined();

    const setPaymentProcessing = capture.latest
      ?.setPaymentProcessing as SetPaymentProcessing;
    act(() => {
      setPaymentProcessing(true);
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

  it('preserves selectedMethod and isPremium across isProcessing writes', () => {
    const capture = makeCapture();
    // Seed with both non-default companion flags so the preservation
    // guarantee is observable on both fields simultaneously.
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: 'toss',
        isProcessing: false,
        isPremium: true,
      },
    });

    const setPaymentProcessing = capture.latest
      ?.setPaymentProcessing as SetPaymentProcessing;
    act(() => {
      setPaymentProcessing(true);
    });

    expect(capture.latest?.payment.isProcessing).toBe(true);
    // Both companion fields carried over untouched — the dedicated
    // single-purpose action does not widen its surface to other
    // payment-slice fields.
    expect(capture.latest?.payment.selectedMethod).toBe('toss');
    expect(capture.latest?.payment.isPremium).toBe(true);

    // And the same preservation holds on the way back down.
    act(() => {
      setPaymentProcessing(false);
    });
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.selectedMethod).toBe('toss');
    expect(capture.latest?.payment.isPremium).toBe(true);
  });

  it('keeps the setPaymentProcessing reference stable across state updates', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const initialAction = capture.latest?.setPaymentProcessing;
    expect(typeof initialAction).toBe('function');

    act(() => {
      (initialAction as SetPaymentProcessing)(true);
    });
    const afterFirstWrite = capture.latest?.setPaymentProcessing;

    act(() => {
      (afterFirstWrite as SetPaymentProcessing)(false);
    });
    const afterSecondWrite = capture.latest?.setPaymentProcessing;

    // Reference identity is stable across writes — combined with the
    // useMemo bundle, this prevents consumers from re-rendering purely
    // because the action reference changed. The payment_model placeholder
    // timer effect lists this action as a `useEffect` dependency, so a
    // changing identity would re-fire the timer on every state update.
    expect(afterFirstWrite).toBe(initialAction);
    expect(afterSecondWrite).toBe(initialAction);
  });

  it('is a state-bailout no-op when re-asserting the current isProcessing value', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const beforeBailout = capture.latest?.payment;
    const setPaymentProcessing = capture.latest
      ?.setPaymentProcessing as SetPaymentProcessing;

    // The current value is already `false`; asserting `false` again must
    // not produce a fresh `payment` reference.
    act(() => {
      setPaymentProcessing(false);
    });

    // React bails out when the reducer returns the same reference, so the
    // payment snapshot stays === to the pre-write reference. This
    // guarantees downstream `useMemo`s keyed on `payment` do not rebuild
    // on the cleanup-after-unmount path when the timer never fired.
    expect(capture.latest?.payment).toBe(beforeBailout);
    expect(capture.latest?.payment.isProcessing).toBe(false);
  });

  it('is a state-bailout no-op when re-asserting an already-true value', () => {
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: 'kakao',
        isProcessing: true,
        isPremium: false,
      },
    });

    const beforeBailout = capture.latest?.payment;
    const setPaymentProcessing = capture.latest
      ?.setPaymentProcessing as SetPaymentProcessing;

    act(() => {
      setPaymentProcessing(true);
    });

    expect(capture.latest?.payment).toBe(beforeBailout);
    expect(capture.latest?.payment.isProcessing).toBe(true);
  });
});
