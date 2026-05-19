/**
 * Unit test — `apps/mobile/src/providers/FunnelStateProvider.tsx`
 * `setIsPremium` action (Sub-AC 15.4 / Phase 2.4).
 *
 * Verifies the **dedicated single-purpose action** that toggles
 * `payment.isPremium`. The Sub-AC 15.4 contract is:
 *
 *   - Invoking `setIsPremium(true)` from the default state produces a new
 *     `payment` snapshot where `isPremium === true`. `selectedMethod` and
 *     `isProcessing` are carried over untouched from the previous snapshot.
 *   - Invoking `setIsPremium(false)` after `(true)` produces a new snapshot
 *     where `isPremium === false`. Other fields untouched.
 *   - The flag persists in state across re-renders — once flipped, every
 *     subsequent context read sees the same value until another write
 *     occurs. This is the "persists in state" half of the Sub-AC 15.4
 *     verification surface.
 *   - The previous `payment` reference is never mutated in place — the
 *     captured pre-write snapshot retains its original values after writes
 *     occur (immutable update — Seed constraint "Context value types must
 *     be immutable readonly").
 *   - The action reference itself is stable across re-renders so consumers
 *     can list it in `useEffect` dependency arrays without spurious re-runs.
 *   - A bailout write (e.g. `setIsPremium(true)` while already `true`)
 *     returns the same reference verbatim so downstream `useMemo`s keyed on
 *     `payment` do not rebuild. The `result_reveal` lock-overlay branch is
 *     the primary consumer of `payment.isPremium` and gates an expensive
 *     re-render off the slice reference, so this bailout matters in
 *     practice.
 *
 * Why a dedicated test file (not folded into
 * `funnel-state-payment-set-selected-method.test.tsx` /
 * `funnel-state-payment-set-processing.test.tsx` /
 * `funnel-state-payment-slice.test.tsx`):
 *   The project's `coding-standards` rule prefers many small files over
 *   few large files. Each Sub-AC 15.* action gets its own file so the
 *   write semantics for one action can grow without bloating the others.
 *   This file owns Sub-AC 15.4 (`setIsPremium` true/false transitions and
 *   persistence) exclusively.
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
  type SetIsPremium,
} from '../src/contracts/funnel-state';

// ---------------------------------------------------------------------------
// Probe helper — mirrors the latest context value into an external bundle
// so the test body can read it after each `act(...)`.
// ---------------------------------------------------------------------------

interface ProbeCapture {
  latest: FunnelStateValue | null;
  // History of `payment` references seen across renders so the test can
  // assert that the captured pre-write snapshot did NOT mutate underneath
  // the consumer (immutable update invariant), and that the flipped flag
  // persists across subsequent renders.
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

describe('FunnelStateProvider — setIsPremium action (Sub-AC 15.4)', () => {
  it('exposes a setIsPremium function on the context value', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    expect(typeof capture.latest?.setIsPremium).toBe('function');
  });

  it('transitions payment.isPremium from false to true on (true)', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    // Sanity: initial state matches Sub-AC 15.1 default (false).
    expect(capture.latest?.payment.isPremium).toBe(false);

    const setIsPremium = capture.latest?.setIsPremium as SetIsPremium;
    act(() => {
      setIsPremium(true);
    });

    // Post-write: the latest snapshot reflects the true value (the flag
    // has flipped — the first half of the Sub-AC 15.4 contract).
    expect(capture.latest?.payment.isPremium).toBe(true);
  });

  it('transitions payment.isPremium from true back to false on (false)', () => {
    const capture = makeCapture();
    // Seed with `isPremium: true` so the `(false)` downgrade transition is
    // observable as a real downward write rather than a no-op against the
    // default. (Phase 2.4 has no UI for this downgrade; Phase 2.5 owns it.)
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: 'kakao',
        isProcessing: false,
        isPremium: true,
      },
    });
    expect(capture.latest?.payment.isPremium).toBe(true);

    const setIsPremium = capture.latest?.setIsPremium as SetIsPremium;
    act(() => {
      setIsPremium(false);
    });

    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('persists the flipped isPremium value across subsequent context reads', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const setIsPremium = capture.latest?.setIsPremium as SetIsPremium;
    act(() => {
      setIsPremium(true);
    });

    // After the single write the flag must remain `true` across every
    // captured snapshot history entry that followed the write — this is
    // the "persists in state" half of the Sub-AC 15.4 contract. Without
    // persistence the post-write render's snapshot would still read
    // `false`, which would be the regression case.
    expect(capture.latest?.payment.isPremium).toBe(true);

    // The history captures every render Probe saw. The final entry is the
    // post-write render and it must reflect the flipped flag.
    const finalHistoryEntry = capture.history[capture.history.length - 1];
    expect(finalHistoryEntry?.isPremium).toBe(true);

    // History should contain at least two entries: the initial mount
    // render (isPremium false) and the post-write render (isPremium true).
    // This proves the write triggered a re-render rather than being lost
    // to a stale closure.
    expect(capture.history.length).toBeGreaterThanOrEqual(2);
    expect(capture.history[0]?.isPremium).toBe(false);
  });

  it('completes a full false → true → false round-trip', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const setIsPremium = capture.latest?.setIsPremium as SetIsPremium;

    // false → true (placeholder payment simulator resolved successfully).
    act(() => {
      setIsPremium(true);
    });
    expect(capture.latest?.payment.isPremium).toBe(true);

    // true → false (reserved for Phase 2.5 cancellation/refund — symmetric
    // setter still exposed so the slice contract stays future-proof).
    act(() => {
      setIsPremium(false);
    });
    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('produces a new payment object reference per write (no in-place mutation)', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const firstSnapshot = capture.latest?.payment;
    expect(firstSnapshot).toBeDefined();

    const setIsPremium = capture.latest?.setIsPremium as SetIsPremium;
    act(() => {
      setIsPremium(true);
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

  it('preserves selectedMethod and isProcessing across isPremium writes', () => {
    const capture = makeCapture();
    // Seed with both non-default companion fields so the preservation
    // guarantee is observable on both simultaneously. The realistic call
    // pattern is: user tapped 'kakao', placeholder timer flipped
    // `isProcessing` to true mid-flight, success path then calls
    // `setIsPremium(true)` — we expect the in-flight flag and method to
    // be preserved verbatim by the dedicated single-purpose action.
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: 'kakao',
        isProcessing: true,
        isPremium: false,
      },
    });

    const setIsPremium = capture.latest?.setIsPremium as SetIsPremium;
    act(() => {
      setIsPremium(true);
    });

    expect(capture.latest?.payment.isPremium).toBe(true);
    // Both companion fields carried over untouched — the dedicated
    // single-purpose action does not widen its surface to other
    // payment-slice fields.
    expect(capture.latest?.payment.selectedMethod).toBe('kakao');
    expect(capture.latest?.payment.isProcessing).toBe(true);

    // And the same preservation holds on the way back down.
    act(() => {
      setIsPremium(false);
    });
    expect(capture.latest?.payment.isPremium).toBe(false);
    expect(capture.latest?.payment.selectedMethod).toBe('kakao');
    expect(capture.latest?.payment.isProcessing).toBe(true);
  });

  it('keeps the setIsPremium reference stable across state updates', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const initialAction = capture.latest?.setIsPremium;
    expect(typeof initialAction).toBe('function');

    act(() => {
      (initialAction as SetIsPremium)(true);
    });
    const afterFirstWrite = capture.latest?.setIsPremium;

    act(() => {
      (afterFirstWrite as SetIsPremium)(false);
    });
    const afterSecondWrite = capture.latest?.setIsPremium;

    // Reference identity is stable across writes — combined with the
    // useMemo bundle, this prevents consumers from re-rendering purely
    // because the action reference changed.
    expect(afterFirstWrite).toBe(initialAction);
    expect(afterSecondWrite).toBe(initialAction);
  });

  it('is a state-bailout no-op when re-asserting the current isPremium value', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const beforeBailout = capture.latest?.payment;
    const setIsPremium = capture.latest?.setIsPremium as SetIsPremium;

    // The current value is already `false`; asserting `false` again must
    // not produce a fresh `payment` reference.
    act(() => {
      setIsPremium(false);
    });

    // React bails out when the reducer returns the same reference, so the
    // payment snapshot stays === to the pre-write reference. This
    // guarantees downstream `useMemo`s keyed on `payment` (notably the
    // result_reveal lock-overlay branch) do not rebuild on a no-op write.
    expect(capture.latest?.payment).toBe(beforeBailout);
    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('is a state-bailout no-op when re-asserting an already-true value', () => {
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: 'toss',
        isProcessing: false,
        isPremium: true,
      },
    });

    const beforeBailout = capture.latest?.payment;
    const setIsPremium = capture.latest?.setIsPremium as SetIsPremium;

    act(() => {
      setIsPremium(true);
    });

    expect(capture.latest?.payment).toBe(beforeBailout);
    expect(capture.latest?.payment.isPremium).toBe(true);
  });
});
