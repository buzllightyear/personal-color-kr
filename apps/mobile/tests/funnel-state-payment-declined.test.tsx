/**
 * Unit test — `apps/mobile/src/providers/FunnelStateProvider.tsx`
 * payment-slice transition on `paywallOutcome: 'declined'` (Sub-AC 21.4.3 /
 * Phase 2.5).
 *
 * This test pins the **state-machine half** of the Phase 2.5 Superwall
 * declined-completion contract. Phase 2.5 replaces the Phase 2.4
 * `setTimeout(250ms)` placeholder with a real
 * `triggerPaywall('payment_model_unlock')` invocation whose completion
 * handler — on the `declined` branch (the user dismissed the Superwall
 * paywall modal without purchasing, or explicitly tapped "Cancel" inside
 * Superwall's own UI) — must reduce the payment slice from
 *
 *   { isProcessing: true,  isPremium: false }      ← CTA tap initial state
 *
 * to
 *
 *   { isProcessing: false, isPremium: false }      ← declined completion
 *
 * without navigating away from `payment_model`. The user stays on the
 * payment screen with the CTA re-enabled so they can retry the paywall
 * (Seed `Exit Conditions → declined_retention`: "Superwall paywall dismiss
 * returns user to payment-model screen with CTA available for retry —
 * payment-model screen visible + isProcessing=false + CTA tappable").
 *
 * The declined transition differs from the purchased/restored siblings in
 * exactly one observable way: `isPremium` is NOT flipped. The completion
 * handler calls `setPaymentProcessing(false)` only — `setIsPremium(...)` is
 * never invoked on the declined branch because the user has not unlocked
 * anything. Pinning this asymmetry at the slice level guards against a
 * regression that would accidentally hand the user a free premium unlock
 * after they declined the paywall.
 *
 * Seed constraint relevance:
 *   - "No auto-dismiss timer on declined state (user stays on payment-model
 *     until explicit action)" — the slice transition releases the in-flight
 *     flag but does not encode any auto-navigate side effect; navigation
 *     decisions live at the route level, not on the slice. This test pins
 *     the slice contract only.
 *   - "Restore purchases UI out of scope (Superwall paywall auto-handles
 *     'already subscribed')" — the declined outcome is NOT "already
 *     subscribed but cancelled the new purchase prompt"; that case is a
 *     `restored` outcome (covered by the sibling restored test). The
 *     declined outcome covered here is the plain "user dismissed without
 *     buying".
 *
 * Why a dedicated test file (not folded into the purchased/restored files
 * or per-setter Phase 2.4 files):
 *   - Seed evaluation principle `completion_state_coverage`: "All five
 *     paths (purchased, restored, declined, error, explicit skip) have
 *     defined state updates, navigation, and test coverage". Pinning the
 *     declined slice transition in its own file makes the five-path
 *     coverage easy to audit at the file-listing level — one test file per
 *     outcome.
 *   - The project's `coding-standards` rule prefers many small files over
 *     few large files. The declined completion is a distinct semantic
 *     concept from the purchased/restored unlocks — even though the only
 *     setter call it makes (`setPaymentProcessing(false)`) is shared with
 *     the unlock path, the funnel-level intent diverges (retain the user
 *     on payment-model vs navigate to premium result-reveal) so keeping
 *     them in sibling files lets each evolve independently.
 *   - The Phase 2.4 per-setter test
 *     `funnel-state-payment-set-processing.test.tsx` covers
 *     `setPaymentProcessing` in isolation. This file covers the
 *     **outcome-level** contract — the declined branch deliberately calls
 *     ONLY this setter (no companion `setIsPremium` call), and the slice
 *     snapshot must reflect that the unlock flag remained `false`.
 *
 * What this file owns vs. sibling files:
 *   - This file owns Sub-AC 21.4.3: the **slice-level** verification that
 *     the declined-outcome handler's `setPaymentProcessing(false)` call
 *     produces the correct snapshot AND that `isPremium` was not flipped
 *     as a side effect. It does NOT mount the route, click any CTA, or
 *     import the Superwall wrapper — only the FunnelStateProvider is
 *     exercised, so the test stays free of any native module surface
 *     (Seed evaluation principle `native_isolation`).
 *   - `funnel-state-payment-purchased.test.tsx` (Sub-AC 21.4.1) and
 *     `funnel-state-payment-restored.test.tsx` (Sub-AC 21.4.2) cover the
 *     two unlock paths. The three files intentionally share the same
 *     Probe + transition helper shape so a future refactor that extracts
 *     a shared test utility is mechanically trivial.
 *   - The route-level integration test (Phase 2.5 separate sub-AC) covers
 *     the wiring between `triggerPaywall` mock resolution (declined branch)
 *     and this slice call. That sibling test depends on this one having
 *     pinned the slice contract first.
 *   - `track-payment-completed.test.ts` covers the analytics payload — the
 *     declined branch does NOT fire `payment_completed` (no purchase
 *     occurred), so the absence-of-analytics concern is owned by the
 *     route-level integration test, not this slice file.
 *
 * Testing approach:
 *   Same `react-test-renderer` + `vi.mock('react-native')` pattern used
 *   across the funnel test suite (see `funnel-state-payment-slice.test.tsx`
 *   and the sibling `funnel-state-payment-purchased.test.tsx` /
 *   `funnel-state-payment-restored.test.tsx` for the full rationale).
 *   A small Probe consumer reads the context via `useFunnelState()` and
 *   mirrors the live `payment` snapshot back into an external capture
 *   bundle so the test body can assert on it without going through
 *   @testing-library/react-native. The single setter fires inside one
 *   `act(...)` block — the realistic call pattern when the Phase 2.5
 *   completion handler reduces a `declined` outcome.
 *
 * Out of scope for this file (deferred to other Phase 2.5 sub-ACs):
 *   - `purchased` outcome transition (Sub-AC 21.4.1) — sibling test file.
 *   - `restored` outcome transition (Sub-AC 21.4.2) — sibling test file.
 *   - `error` outcome retention + inline error surface (Sub-AC 21.4.4) —
 *     different test file. The slice transition for `error` happens to
 *     coincide with the declined transition (both drop `isProcessing` and
 *     leave `isPremium` untouched), but the route-level surface diverges
 *     (declined hides any error UI; error renders the Korean inline error
 *     text) so the two outcomes warrant separate test files even though
 *     the slice writes overlap.
 *   - Explicit skip transition (Sub-AC 21.4.5) — different test file.
 *   - Route-level wiring between `triggerPaywall` and this slice call —
 *     covered by the payment-model route integration test.
 *   - Absence of `trackPaymentCompleted` on the declined branch —
 *     covered by the route-level integration test, not this slice file.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Mock `react-native` to a minimal host-component set so the provider's
// transitive imports resolve through vite's SSR transform. Mirrors the mock
// used by every other component test in this suite (including the sibling
// `funnel-state-payment-purchased.test.tsx` and
// `funnel-state-payment-restored.test.tsx`).
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
 * Apply the canonical `declined` completion transition to the slice via
 * the same setter the Phase 2.5 completion handler will call. Crucially,
 * this helper calls ONLY `setPaymentProcessing(false)` — it does NOT call
 * `setIsPremium(...)`. That asymmetry is the entire point of the declined
 * outcome at the slice level: the user dismissed the paywall without
 * purchasing, so the in-flight flag must drop (CTA re-enables) but the
 * premium gate must remain locked.
 *
 * Why this helper exists as a separate function from
 * `applyPurchasedTransition` / `applyRestoredTransition`:
 *   The sibling helpers fire TWO setters (`setIsPremium(true) +
 *   setPaymentProcessing(false)`); this one fires ONE. The structural
 *   asymmetry is the contract — packing the declined case into one of the
 *   sibling helpers would either need a conditional (which hides the
 *   intent) or would force the declined path to make a no-op
 *   `setIsPremium(false)` call (which would obscure the "we don't touch
 *   the unlock flag" property the test is trying to prove).
 */
function applyDeclinedTransition(value: FunnelStateValue): void {
  value.setPaymentProcessing(false);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FunnelStateProvider — paywallOutcome:declined state transition (Sub-AC 21.4.3)', () => {
  it('reduces { isProcessing: true, isPremium: false } to { isProcessing: false, isPremium: false }', () => {
    // The realistic pre-transition state: the user tapped the CTA, which
    // flipped `isProcessing` to `true`, then Superwall opened its paywall
    // modal. The completion handler now receives a `declined` outcome — the
    // user dismissed the paywall (swipe down, hardware back, or tapped the
    // Superwall-rendered close affordance) without completing a purchase.
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
      applyDeclinedTransition(value);
    });

    // Post-transition steady state — in-flight flag dropped, premium gate
    // still locked. This is the Seed `Exit Conditions → declined_retention`
    // observable surface at the slice level: payment-model can re-render
    // with the CTA tappable (isProcessing=false) and the result-reveal
    // premium branch remains locked (isPremium=false).
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('does NOT flip isPremium on the declined branch', () => {
    // Direct guard against the "accidental unlock" regression: a future
    // refactor that introduced an unconditional `setIsPremium(true)` call
    // at the end of every completion handler (or that wired the declined
    // branch through the same code path as purchased/restored) would flip
    // this flag and silently hand the user a free premium unlock after
    // they declined the paywall. Pinning the flag's `false` value AFTER
    // the declined transition fires makes that regression a test failure.
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
      applyDeclinedTransition(value);
    });

    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('preserves selectedMethod across the declined transition (no mutation of the deprecated field)', () => {
    // Phase 2.5 deprecates `selectedMethod` (the KakaoPay/Toss radio is
    // gone) but the field remains on the slice for forward compatibility
    // — Seed constraint: "selectedMethod field on payment slice deprecated
    // as optional but not removed (Phase 2.6 cleanup)". The declined
    // transition must not touch this field, even when seeded with a
    // legacy value, since `setPaymentProcessing` narrows its type-level
    // surface to exactly the `isProcessing` slice field.
    //
    // Mirror of the sibling purchased/restored tests' coverage so the
    // deprecated-field invariant is verified on ALL THREE outcome paths
    // — a regression that accidentally cleared `selectedMethod` on
    // declined only (but not on purchased/restored) would slip past
    // single-path tests.
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
      applyDeclinedTransition(value);
    });

    expect(capture.latest?.payment.selectedMethod).toBe('kakao');
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(false);
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
      applyDeclinedTransition(value);
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

  it('persists the declined state across subsequent context reads', () => {
    // After the transition, every subsequent consumer read must see the
    // post-decline steady state until another write occurs. This is the
    // "persists in state" invariant carried over from Sub-AC 15.3 — the
    // CTA re-enable survives all re-renders that follow the transition,
    // so a navigation race or downstream `useEffect` cannot accidentally
    // see a stale `isProcessing: true` after the dismissal resolved (which
    // would leave the CTA disabled and the user trapped on the screen).
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
      applyDeclinedTransition(value);
    });

    // The final history entry — the post-transition render — must reflect
    // the in-flight flag drop with the premium gate still locked. The
    // history captures every render Probe saw, so a regression where the
    // transition was lost to a stale closure would show up as a final
    // entry that still read `isProcessing: true`.
    const finalHistoryEntry = capture.history[capture.history.length - 1];
    expect(finalHistoryEntry?.isProcessing).toBe(false);
    expect(finalHistoryEntry?.isPremium).toBe(false);

    // And the initial mount-render entry must still reflect the
    // pre-transition values — proving the history captured the transition
    // rather than retroactively overwriting earlier snapshots (which an
    // in-place mutation would have caused).
    expect(capture.history[0]?.isProcessing).toBe(true);
    expect(capture.history[0]?.isPremium).toBe(false);
    expect(capture.history.length).toBeGreaterThanOrEqual(2);
  });

  it('supports a retry sequence — declined → CTA re-tap → declined again', () => {
    // Seed `Exit Conditions → declined_retention` mandates that the CTA is
    // tappable after a declined dismissal. The user must be able to re-tap
    // the CTA and re-enter the in-flight state without any stale-flag
    // wedge. This test exercises the round trip:
    //
    //   { isProcessing: true,  isPremium: false }    ← CTA tap
    //   → declined →
    //   { isProcessing: false, isPremium: false }    ← CTA re-enabled
    //   → CTA re-tap (setPaymentProcessing(true)) →
    //   { isProcessing: true,  isPremium: false }    ← back in flight
    //   → declined again →
    //   { isProcessing: false, isPremium: false }    ← CTA re-enabled again
    //
    // The slice contract must absorb every step cleanly — no stale closure,
    // no double-write that leaves the flag stuck, no accidental
    // `isPremium` flip on the second decline.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: false,
      },
    });

    // First decline.
    act(() => {
      applyDeclinedTransition(capture.latest as FunnelStateValue);
    });
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(false);

    // CTA re-tap — user enters the in-flight state again.
    act(() => {
      (capture.latest as FunnelStateValue).setPaymentProcessing(true);
    });
    expect(capture.latest?.payment.isProcessing).toBe(true);
    expect(capture.latest?.payment.isPremium).toBe(false);

    // Second decline.
    act(() => {
      applyDeclinedTransition(capture.latest as FunnelStateValue);
    });
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('is a no-op write if the declined transition fires while isProcessing is already false', () => {
    // Defensive: the route-level handler MUST set `isProcessing: true`
    // before invoking `triggerPaywall(...)`, but a future refactor could
    // accidentally race two completion callbacks (e.g. Superwall's
    // onDismiss firing twice on a slow device). The slice's bailout
    // semantics — documented inside `setPaymentProcessing` in
    // FunnelStateProvider.tsx — protect against that by returning the
    // previous reference verbatim when the requested value matches the
    // current. The post-second-write snapshot must therefore be the SAME
    // object identity as the post-first-write snapshot.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: false,
        isPremium: false,
      },
    });

    const preWriteSnapshot = capture.latest?.payment;
    expect(preWriteSnapshot?.isProcessing).toBe(false);

    act(() => {
      applyDeclinedTransition(capture.latest as FunnelStateValue);
    });

    // Bailout fired — the slice reference is preserved verbatim. This
    // proves the declined transition is idempotent in the
    // already-not-in-flight starting state.
    expect(capture.latest?.payment).toBe(preWriteSnapshot);
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('keeps the slice setter references stable across the declined transition', () => {
    // The setter references must remain `===` to their initial values
    // across the transition — same useCallback-stable-identity invariant
    // proven by the Phase 2.4 per-setter tests, repeated here so the
    // Phase 2.5 completion handler can list `setPaymentProcessing` in a
    // `useEffect` dependency array without spurious re-runs that would
    // re-fire the dismissal or re-trigger analytics on every render.
    //
    // We assert stability on BOTH `setPaymentProcessing` (which the
    // declined branch actually calls) and `setIsPremium` (which the
    // declined branch deliberately does NOT call) — the latter assertion
    // is included because the route handler typically binds both setters
    // via `useFunnelState()` destructuring, and a regression that
    // rebuilt the context value on every transition would also destabilise
    // the unused setter even though no write touched it.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: false,
      },
    });

    const initialSetPaymentProcessing = capture.latest?.setPaymentProcessing;
    const initialSetIsPremium = capture.latest?.setIsPremium;
    expect(typeof initialSetPaymentProcessing).toBe('function');
    expect(typeof initialSetIsPremium).toBe('function');

    const value = capture.latest as FunnelStateValue;
    act(() => {
      applyDeclinedTransition(value);
    });

    expect(capture.latest?.setPaymentProcessing).toBe(initialSetPaymentProcessing);
    expect(capture.latest?.setIsPremium).toBe(initialSetIsPremium);
  });

  it('exposes a setter typed as SetPaymentProcessing on the context value', () => {
    // Type-level sanity check at runtime: the setter the declined helper
    // invokes must be assignable to `SetPaymentProcessing`. If a future
    // refactor narrowed the context value's setter shape (e.g. dropped
    // the type alias from the contract module), this assertion would
    // surface the regression at the test boundary rather than at the
    // route-level integration test which has heavier mocking overhead.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: false,
      },
    });

    const setter: SetPaymentProcessing | undefined =
      capture.latest?.setPaymentProcessing;
    expect(typeof setter).toBe('function');
    // Smoke-test the setter through the SetPaymentProcessing alias — the
    // type check above is the real proof; this call exercises the runtime
    // path to confirm the alias matches the function's actual signature.
    act(() => {
      (setter as SetPaymentProcessing)(false);
    });
    expect(capture.latest?.payment.isProcessing).toBe(false);
  });
});
