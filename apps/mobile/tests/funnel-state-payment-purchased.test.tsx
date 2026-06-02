/**
 * Unit test — `apps/mobile/src/providers/FunnelStateProvider.tsx`
 * payment-slice transition on `paywallOutcome: 'purchased'` (Sub-AC 21.4.1 /
 * Phase 2.5).
 *
 * This test pins the **state-machine half** of the Phase 2.5 Superwall
 * purchased-completion contract. Phase 2.5 replaces the Phase 2.4
 * `setTimeout(250ms)` placeholder with a real
 * `triggerPaywall('payment_model_unlock')` invocation whose completion
 * handler — on the `purchased` branch — must reduce the payment slice from
 *
 *   { isProcessing: true,  isPremium: false }      ← CTA tap initial state
 *
 * to
 *
 *   { isProcessing: false, isPremium: true  }      ← purchased completion
 *
 * before navigating to the premium branch of `result_reveal`. The Seed
 * `Exit Conditions → purchase_flow` is exactly this transition:
 *   "Sandbox purchase completes through Superwall + app transitions to
 *    premium result-reveal (isPremium=true + result-reveal premium branch
 *    + trackPaymentCompleted fired)".
 *
 * What this file owns vs. sibling files:
 *   - This file owns Sub-AC 21.4.1: the **slice-level** verification that
 *     the combined `setIsPremium(true) + setPaymentProcessing(false)`
 *     transition produces the correct snapshot and preserves immutability.
 *     It does NOT mount the route, click any CTA, or import the Superwall
 *     wrapper — only the FunnelStateProvider is exercised, so the test
 *     stays free of any native module surface.
 *   - The route-level integration test (Phase 2.5 separate sub-AC) covers
 *     the wiring between `triggerPaywall` mock resolution and these slice
 *     calls. That sibling test depends on this one having pinned the slice
 *     contract first.
 *   - `funnel-state-payment-set-is-premium.test.tsx` and
 *     `funnel-state-payment-set-processing.test.tsx` (Phase 2.4) each cover
 *     ONE setter in isolation. This file covers the **composed**
 *     transition — both setters fire together on a `purchased` outcome,
 *     and the resulting snapshot must reflect both changes simultaneously.
 *
 * Why a dedicated test file (not folded into the per-setter Phase 2.4 files):
 *   The project's `coding-standards` rule prefers many small files over
 *   few large files. The Phase 2.5 `purchased` completion is a distinct
 *   semantic concept from the Phase 2.4 single-purpose setter contracts:
 *   the Phase 2.4 tests answer "does setIsPremium flip one flag?"; this
 *   test answers "does the purchased-outcome transition reduce the slice
 *   to its expected post-purchase steady state?". Keeping the concerns
 *   separate makes future Phase 2.5+ slice extensions (e.g. tier
 *   branching, restored-user toast) easy to layer on without bloating
 *   either neighbour.
 *
 * Testing approach:
 *   Same `react-test-renderer` + `vi.mock('react-native')` pattern used
 *   across the funnel test suite (see `funnel-state-payment-slice.test.tsx`
 *   for the full rationale). A small Probe consumer reads the context via
 *   `useFunnelState()` and mirrors the live `payment` snapshot back into
 *   an external capture bundle so the test body can assert on it without
 *   going through @testing-library/react-native. The two setters fire
 *   inside a single `act(...)` block so the captured post-write snapshot
 *   reflects both writes simultaneously — the realistic call pattern when
 *   the Phase 2.5 completion handler reduces a `purchased` outcome.
 *
 * Out of scope for this file (deferred to other Phase 2.5 sub-ACs):
 *   - `restored` outcome transition (Sub-AC 21.4.2) — different test file.
 *   - `declined` outcome retention (Sub-AC 21.4.3) — different test file.
 *   - `error` outcome retention + inline error surface (Sub-AC 21.4.4) —
 *     different test file.
 *   - Explicit skip transition (Sub-AC 21.4.5) — different test file.
 *   - Route-level wiring between `triggerPaywall` and these slice calls
 *     — covered by the payment-model route integration test.
 *   - `trackPaymentCompleted({ restored: false })` analytics emission —
 *     covered by the track-payment-completed test file.
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
  type SetPaymentProcessing,
} from '../src/contracts/funnel-state';

// ---------------------------------------------------------------------------
// Probe helper — mirrors the latest context value into an external bundle
// so the test body can read it after each `act(...)`.
// ---------------------------------------------------------------------------

interface ProbeCapture {
  latest: FunnelStateValue | null;
  // History of `payment` references seen across renders so the test can
  // assert that the captured pre-transition snapshot did NOT mutate
  // underneath the consumer (immutable update invariant) and that React
  // produced a fresh reference for the post-transition snapshot.
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

/**
 * Apply the canonical `purchased` completion transition to the slice via
 * the same setters the Phase 2.5 completion handler will call. Both writes
 * are batched inside one `act(...)` so the captured post-write snapshot
 * reflects both fields simultaneously — which is the realistic effect of
 * Superwall's purchased branch.
 *
 * Call order mirrors the production handler:
 *   1. `setIsPremium(true)` — unlocks the premium gate first so that
 *      anything observing the slice reference sees the unlock before the
 *      processing flag drops (no observable "neither in-flight nor
 *      premium" intermediate state).
 *   2. `setPaymentProcessing(false)` — drops the in-flight flag.
 *
 * The provider's `useState`-backed setters are batched by React when both
 * are dispatched inside the same synchronous turn, so the post-write
 * snapshot reflects the merged result regardless of call order — but
 * documenting the canonical order keeps the implementation site easy to
 * audit.
 */
function applyPurchasedTransition(value: FunnelStateValue): void {
  value.setIsPremium(true);
  value.setPaymentProcessing(false);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FunnelStateProvider — paywallOutcome:purchased state transition (Sub-AC 21.4.1)', () => {
  it('reduces { isProcessing: true, isPremium: false } to { isProcessing: false, isPremium: true }', () => {
    // The realistic pre-transition state: the user tapped the CTA, which
    // flipped `isProcessing` to `true`, then Superwall opened its paywall
    // modal. The completion handler now receives a `purchased` outcome.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: false,
      },
    });

    expect(capture.latest?.payment.isProcessing).toBe(true);
    expect(capture.latest?.payment.isPremium).toBe(false);

    const value = capture.latest as FunnelStateValue;
    act(() => {
      applyPurchasedTransition(value);
    });

    // Post-transition steady state — both flags reflect the completed
    // purchase. This is the Seed `Exit Conditions → purchase_flow`
    // observable surface at the slice level.
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(true);
  });

  it('preserves selectedMethod across the purchased transition (no mutation of the deprecated field)', () => {
    // Phase 2.5 deprecates `selectedMethod` (the KakaoPay/Toss radio is
    // gone) but the field remains on the slice for forward compatibility
    // — Seed constraint: "selectedMethod field on payment slice deprecated
    // as optional but not removed (Phase 2.6 cleanup)". The purchased
    // transition must not touch this field, even when seeded with a
    // legacy value, since the single-purpose `setIsPremium` and
    // `setPaymentProcessing` actions narrow their type-level surface to
    // exactly one slice field each.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: 'kakao',
        isProcessing: true,
        isPremium: false,
      },
    });

    const value = capture.latest as FunnelStateValue;
    act(() => {
      applyPurchasedTransition(value);
    });

    expect(capture.latest?.payment.selectedMethod).toBe('kakao');
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(true);
  });

  it('does not mutate the pre-transition payment reference in place', () => {
    // Seed evaluation principle `immutable_state`: "Payment slice updates
    // use existing immutable setter patterns from Phase 2.4 — no mutation
    // of payment object references". The captured pre-transition snapshot
    // must retain its original field values even after the transition
    // fires — the spread-merge invariant guarantees this.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: false,
      },
    });

    const preTransitionSnapshot = capture.latest?.payment;
    expect(preTransitionSnapshot).toBeDefined();

    const value = capture.latest as FunnelStateValue;
    act(() => {
      applyPurchasedTransition(value);
    });

    // Pre-transition snapshot is unchanged — its fields were not mutated
    // underneath the consumer that captured it.
    expect(preTransitionSnapshot?.isProcessing).toBe(true);
    expect(preTransitionSnapshot?.isPremium).toBe(false);
    expect(preTransitionSnapshot?.selectedMethod).toBeNull();

    // And the new snapshot is a different reference — proving React
    // produced a fresh object rather than mutating the previous one.
    expect(capture.latest?.payment).not.toBe(preTransitionSnapshot);
  });

  it('persists the purchased state across subsequent context reads', () => {
    // After the transition, every subsequent consumer read must see the
    // post-purchase steady state until another write occurs. This is the
    // "persists in state" invariant carried over from Sub-AC 15.4 — the
    // unlock survives all re-renders that follow the transition, so a
    // navigation race or downstream `useEffect` cannot accidentally see
    // a stale `isPremium: false` after the purchase resolved.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: false,
      },
    });

    const value = capture.latest as FunnelStateValue;
    act(() => {
      applyPurchasedTransition(value);
    });

    // The final history entry — the post-transition render — must reflect
    // both flag flips. The history captures every render Probe saw, so a
    // regression where the transition was lost to a stale closure would
    // show up as a final entry that still read `isProcessing: true` or
    // `isPremium: false`.
    const finalHistoryEntry = capture.history[capture.history.length - 1];
    expect(finalHistoryEntry?.isProcessing).toBe(false);
    expect(finalHistoryEntry?.isPremium).toBe(true);

    // And the initial mount-render entry must still reflect the
    // pre-transition values — proving the history captured the transition
    // rather than retroactively overwriting earlier snapshots (which an
    // in-place mutation would have caused).
    expect(capture.history[0]?.isProcessing).toBe(true);
    expect(capture.history[0]?.isPremium).toBe(false);
    expect(capture.history.length).toBeGreaterThanOrEqual(2);
  });

  it('produces the same final state when the two setters fire in either order', () => {
    // Sanity check on React's state-batching: the purchased completion
    // handler MAY call the two setters in either order (production code
    // documents `setIsPremium → setPaymentProcessing`, but the slice
    // contract must not be order-dependent — both are dedicated
    // single-purpose actions routing through the same `useState` cell, so
    // the merged snapshot is identical regardless of which setter is
    // dispatched first within the same synchronous turn).
    const captureA = makeCapture();
    renderWithProvider(captureA, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: false,
      },
    });
    act(() => {
      const v = captureA.latest as FunnelStateValue;
      (v.setIsPremium as SetIsPremium)(true);
      (v.setPaymentProcessing as SetPaymentProcessing)(false);
    });

    const captureB = makeCapture();
    renderWithProvider(captureB, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: false,
      },
    });
    act(() => {
      const v = captureB.latest as FunnelStateValue;
      // Reverse order — drop in-flight flag first, then unlock premium.
      (v.setPaymentProcessing as SetPaymentProcessing)(false);
      (v.setIsPremium as SetIsPremium)(true);
    });

    // Both orderings converge on the same observable steady state.
    expect(captureA.latest?.payment.isProcessing).toBe(
      captureB.latest?.payment.isProcessing,
    );
    expect(captureA.latest?.payment.isPremium).toBe(captureB.latest?.payment.isPremium);
    expect(captureA.latest?.payment.isProcessing).toBe(false);
    expect(captureA.latest?.payment.isPremium).toBe(true);
  });

  it('keeps the slice setter references stable across the purchased transition', () => {
    // The two setter references must remain `===` to their initial values
    // across the transition — same useCallback-stable-identity invariant
    // proven by the Phase 2.4 per-setter tests, repeated here so the
    // Phase 2.5 completion handler can list both setters in a `useEffect`
    // dependency array without spurious re-runs that would re-fire the
    // navigation or re-trigger analytics on every render.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: false,
      },
    });

    const initialSetIsPremium = capture.latest?.setIsPremium;
    const initialSetPaymentProcessing = capture.latest?.setPaymentProcessing;
    expect(typeof initialSetIsPremium).toBe('function');
    expect(typeof initialSetPaymentProcessing).toBe('function');

    const value = capture.latest as FunnelStateValue;
    act(() => {
      applyPurchasedTransition(value);
    });

    expect(capture.latest?.setIsPremium).toBe(initialSetIsPremium);
    expect(capture.latest?.setPaymentProcessing).toBe(initialSetPaymentProcessing);
  });
});
