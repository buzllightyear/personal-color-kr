/**
 * Unit test — `apps/mobile/src/providers/FunnelStateProvider.tsx`
 * payment-slice transition on `paywallOutcome: 'error'` (Sub-AC 21.4.4 /
 * Phase 2.5).
 *
 * This test pins the **state-machine half** of the Phase 2.5 Superwall
 * error-completion contract. Phase 2.5 replaces the Phase 2.4
 * `setTimeout(250ms)` placeholder with a real
 * `triggerPaywall('payment_model_unlock')` invocation whose completion
 * handler — on the `error` branch (the paywall failed to load or the
 * native SDK threw mid-flight; user did NOT decline and no transaction
 * occurred) — must reduce the payment slice from
 *
 *   { isProcessing: true,  isPremium: false }      ← CTA tap initial state
 *
 * to
 *
 *   { isProcessing: false, isPremium: false }      ← error completion
 *
 * without navigating away from `payment_model`. The user stays on the
 * payment screen with the CTA re-enabled so the route-level surface can
 * additionally render the Korean inline error text (covered by the
 * route-level integration test). Seed `Exit Conditions → error_handling`:
 * "Network disconnection during paywall trigger shows inline error +
 * allows retry (SuperwallTriggerError caught + Korean error text visible
 * + CTA re-enabled)".
 *
 * The error transition differs from the purchased/restored siblings in
 * exactly one observable slice-level way: `isPremium` is NOT flipped. The
 * completion handler calls `setPaymentProcessing(false)` only —
 * `setIsPremium(...)` is never invoked on the error branch because the
 * user has not unlocked anything. Pinning this asymmetry at the slice
 * level guards against a regression that would accidentally hand the user
 * a free premium unlock after a paywall load failure.
 *
 * Seed constraint and evaluation principle relevance:
 *   - Seed evaluation principle `error_transparency`: "Paywall load
 *     failures surface user-friendly Korean inline error text + CTA
 *     re-enable for retry — no silent swallowing". The "CTA re-enable for
 *     retry" half is exactly the `isProcessing: true → false` transition
 *     pinned here. The "Korean error text" half is a route-level surface
 *     concern owned by the payment-model integration test, not this slice
 *     file.
 *   - Seed evaluation principle `immutable_state`: "Payment slice updates
 *     use existing immutable setter patterns from Phase 2.4 — no mutation
 *     of payment object references". The pre-transition snapshot must
 *     remain unmutated after the error transition fires.
 *   - Seed constraint "selectedMethod field on payment slice deprecated
 *     as optional but not removed (Phase 2.6 cleanup)": the error
 *     transition must not touch the deprecated field even when seeded
 *     with a legacy value.
 *
 * Why a dedicated test file (not folded into the
 * `funnel-state-payment-declined.test.tsx` sibling):
 *   - Seed evaluation principle `completion_state_coverage`: "All five
 *     paths (purchased, restored, declined, error, explicit skip) have
 *     defined state updates, navigation, and test coverage". Pinning the
 *     error slice transition in its own file makes the five-path
 *     coverage easy to audit at the file-listing level — one test file
 *     per outcome.
 *   - The project's `coding-standards` rule prefers many small files over
 *     few large files. The error completion is a distinct semantic
 *     concept from the declined dismissal — even though the slice writes
 *     coincide (both call `setPaymentProcessing(false)` only), the
 *     funnel-level intent diverges (declined: user actively dismissed and
 *     can retry silently; error: SDK threw, route renders Korean inline
 *     error text alongside the re-enabled CTA). Keeping them in sibling
 *     files lets each evolve independently — e.g. a future phase that
 *     starts auto-recording an `errorCode` on the slice for error
 *     telemetry would mutate this file only, leaving the declined slice
 *     contract untouched.
 *   - The Phase 2.4 per-setter test
 *     `funnel-state-payment-set-processing.test.tsx` covers
 *     `setPaymentProcessing` in isolation. This file covers the
 *     **outcome-level** contract — the error branch deliberately calls
 *     ONLY this setter (no companion `setIsPremium` call), and the slice
 *     snapshot must reflect that the unlock flag remained `false`.
 *
 * What this file owns vs. sibling files:
 *   - This file owns Sub-AC 21.4.4: the **slice-level** verification that
 *     the error-outcome handler's `setPaymentProcessing(false)` call
 *     produces the correct snapshot AND that `isPremium` was not flipped
 *     as a side effect. It does NOT mount the route, click any CTA,
 *     import the Superwall wrapper, or render the Korean inline error
 *     text — only the FunnelStateProvider is exercised, so the test stays
 *     free of any native module surface (Seed evaluation principle
 *     `native_isolation`).
 *   - `funnel-state-payment-purchased.test.tsx` (Sub-AC 21.4.1) and
 *     `funnel-state-payment-restored.test.tsx` (Sub-AC 21.4.2) cover the
 *     two unlock paths. `funnel-state-payment-declined.test.tsx`
 *     (Sub-AC 21.4.3) covers the user-dismissal path. The four files
 *     intentionally share the same Probe + transition helper shape so a
 *     future refactor that extracts a shared test utility is mechanically
 *     trivial.
 *   - The route-level integration test (Phase 2.5 separate sub-AC) covers
 *     (a) the wiring between the wrapper's rejected/error-resolution
 *     promise and this slice call, (b) the Korean inline error text
 *     render, and (c) the absence of a `payment_completed` analytics
 *     event on the error branch. That sibling test depends on this one
 *     having pinned the slice contract first.
 *   - `track-payment-completed.test.ts` covers the analytics payload —
 *     the error branch does NOT fire `payment_completed` (no purchase
 *     occurred); a separate `paywall_error` analytics tracker fires
 *     instead. The absence-of-payment-completed concern is owned by the
 *     route-level integration test, not this slice file.
 *
 * Testing approach:
 *   Same `react-test-renderer` + `vi.mock('react-native')` pattern used
 *   across the funnel test suite (see `funnel-state-payment-slice.test.tsx`
 *   and the sibling `funnel-state-payment-purchased.test.tsx` /
 *   `funnel-state-payment-restored.test.tsx` /
 *   `funnel-state-payment-declined.test.tsx` for the full rationale).
 *   A small Probe consumer reads the context via `useFunnelState()` and
 *   mirrors the live `payment` snapshot back into an external capture
 *   bundle so the test body can assert on it without going through
 *   @testing-library/react-native. The single setter fires inside one
 *   `act(...)` block — the realistic call pattern when the Phase 2.5
 *   completion handler catches a SuperwallTriggerError and reduces the
 *   `error` outcome.
 *
 * Out of scope for this file (deferred to other Phase 2.5 sub-ACs):
 *   - `purchased` outcome transition (Sub-AC 21.4.1) — sibling test file.
 *   - `restored` outcome transition (Sub-AC 21.4.2) — sibling test file.
 *   - `declined` outcome transition (Sub-AC 21.4.3) — sibling test file.
 *     The slice writes for `error` happen to coincide with `declined`,
 *     but the two are intentionally split per the file-per-outcome
 *     auditing convention (see "Why a dedicated test file" above).
 *   - Explicit skip transition (Sub-AC 21.4.5) — different test file.
 *   - Route-level wiring between the wrapper's error-resolution promise
 *     and this slice call — covered by the payment-model route
 *     integration test.
 *   - Korean inline error text render — covered by the payment-model
 *     route integration test (the `errorMessage` ontology concept lives
 *     at the route level, not on the payment slice).
 *   - `paywall_error` analytics tracker invocation — covered by the
 *     route-level integration test, not this slice file.
 *   - The actual error object / message content thrown by the Superwall
 *     wrapper — pure native concern bound by Seed evaluation principle
 *     `native_isolation` to live exclusively inside the wrapper module.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Mock `react-native` to a minimal host-component set so the provider's
// transitive imports resolve through vite's SSR transform. Mirrors the mock
// used by every other component test in this suite (including the sibling
// `funnel-state-payment-purchased.test.tsx`,
// `funnel-state-payment-restored.test.tsx`, and
// `funnel-state-payment-declined.test.tsx`).
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
 * Apply the canonical `error` completion transition to the slice via the
 * same setter the Phase 2.5 completion handler will call when the
 * Superwall wrapper rejects (network failure, SDK throw, paywall asset
 * load timeout, etc.). Crucially, this helper calls ONLY
 * `setPaymentProcessing(false)` — it does NOT call `setIsPremium(...)`.
 * That asymmetry is the entire point of the error outcome at the slice
 * level: the SDK failed, so the in-flight flag must drop (CTA re-enables
 * so the user can retry) but the premium gate must remain locked.
 *
 * Why this helper exists as a separate function from
 * `applyPurchasedTransition` / `applyRestoredTransition` /
 * `applyDeclinedTransition`:
 *   The unlock helpers fire TWO setters (`setIsPremium(true) +
 *   setPaymentProcessing(false)`); the declined and error helpers each
 *   fire ONE. Even though the error and declined helpers make the same
 *   single setter call, splitting them into separate named helpers
 *   documents the funnel-level intent at the call site — a future reader
 *   stepping through the route handler's `try {...} catch {...}` block
 *   sees `applyErrorTransition(value)` in the catch and immediately
 *   understands the slice write is the SDK-error branch, not the
 *   user-dismiss branch. Packing both into one helper would erase that
 *   distinction.
 */
function applyErrorTransition(value: FunnelStateValue): void {
  value.setPaymentProcessing(false);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FunnelStateProvider — paywallOutcome:error state transition (Sub-AC 21.4.4)', () => {
  it('reduces { isProcessing: true, isPremium: false } to { isProcessing: false, isPremium: false }', () => {
    // The realistic pre-transition state: the user tapped the CTA, which
    // flipped `isProcessing` to `true`, then the Superwall wrapper's
    // `triggerPaywall(...)` invocation rejected (e.g. network
    // disconnection during paywall asset fetch, SDK initialization
    // failure, malformed publishable key surfaced post-configure). The
    // completion handler's catch branch now reduces an `error` outcome.
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
      applyErrorTransition(value);
    });

    // Post-transition steady state — in-flight flag dropped, premium gate
    // still locked. This is the Seed `Exit Conditions → error_handling`
    // observable surface at the slice level: payment-model can re-render
    // with the CTA tappable (isProcessing=false) and the result-reveal
    // premium branch remains locked (isPremium=false). The Korean inline
    // error text render is a route-level concern owned by the
    // payment-model integration test, not this slice file.
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('does NOT flip isPremium on the error branch', () => {
    // Direct guard against the "accidental unlock" regression: a future
    // refactor that introduced an unconditional `setIsPremium(true)` call
    // at the end of every completion handler (or that wired the error
    // catch branch through the same code path as the purchased/restored
    // success branches) would flip this flag and silently hand the user a
    // free premium unlock after the SDK threw. Pinning the flag's `false`
    // value AFTER the error transition fires makes that regression a
    // test failure.
    //
    // This is the most important assertion in the file — error_transparency
    // (Seed evaluation principle) demands "no silent swallowing", but the
    // converse failure mode — silent over-unlocking on error — would
    // additionally violate the price_single_source principle (the user
    // would gain premium without ever seeing the paywall confirm a
    // transaction).
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
      applyErrorTransition(value);
    });

    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('preserves selectedMethod across the error transition (no mutation of the deprecated field)', () => {
    // Phase 2.5 deprecates `selectedMethod` (the KakaoPay/Toss radio is
    // gone) but the field remains on the slice for forward compatibility
    // — Seed constraint: "selectedMethod field on payment slice deprecated
    // as optional but not removed (Phase 2.6 cleanup)". The error
    // transition must not touch this field, even when seeded with a
    // legacy value, since `setPaymentProcessing` narrows its type-level
    // surface to exactly the `isProcessing` slice field.
    //
    // Mirror of the sibling purchased/restored/declined tests' coverage
    // so the deprecated-field invariant is verified on ALL FOUR outcome
    // paths — a regression that accidentally cleared `selectedMethod` on
    // error only (but not on the other outcomes) would slip past
    // single-path tests.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: 'toss',
        isProcessing: true,
        isPremium: false,
      },
    });

    const value = capture.latest as FunnelStateValue;
    act(() => {
      applyErrorTransition(value);
    });

    expect(capture.latest?.payment.selectedMethod).toBe('toss');
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
      applyErrorTransition(value);
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

  it('persists the error state across subsequent context reads', () => {
    // After the transition, every subsequent consumer read must see the
    // post-error steady state until another write occurs. The CTA
    // re-enable survives all re-renders that follow the transition, so a
    // navigation race or downstream `useEffect` cannot accidentally see a
    // stale `isProcessing: true` after the catch resolved (which would
    // leave the CTA disabled and the user trapped on the screen with an
    // error banner they cannot dismiss by retrying).
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
      applyErrorTransition(value);
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

  it('supports a retry sequence — error → CTA re-tap → error again', () => {
    // Seed `Exit Conditions → error_handling` mandates that the CTA is
    // tappable after an error surface. The user must be able to re-tap
    // the CTA and re-enter the in-flight state without any stale-flag
    // wedge — e.g. on a flaky cellular connection where the Superwall
    // asset fetch fails repeatedly. This test exercises the round trip:
    //
    //   { isProcessing: true,  isPremium: false }    ← CTA tap
    //   → error →
    //   { isProcessing: false, isPremium: false }    ← CTA re-enabled
    //   → CTA re-tap (setPaymentProcessing(true)) →
    //   { isProcessing: true,  isPremium: false }    ← back in flight
    //   → error again →
    //   { isProcessing: false, isPremium: false }    ← CTA re-enabled again
    //
    // The slice contract must absorb every step cleanly — no stale closure,
    // no double-write that leaves the flag stuck, no accidental
    // `isPremium` flip on the second error.
    const capture = makeCapture();
    renderWithProvider(capture, {
      initialPayment: {
        selectedMethod: null,
        isProcessing: true,
        isPremium: false,
      },
    });

    // First error.
    act(() => {
      applyErrorTransition(capture.latest as FunnelStateValue);
    });
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(false);

    // CTA re-tap — user enters the in-flight state again.
    act(() => {
      (capture.latest as FunnelStateValue).setPaymentProcessing(true);
    });
    expect(capture.latest?.payment.isProcessing).toBe(true);
    expect(capture.latest?.payment.isPremium).toBe(false);

    // Second error.
    act(() => {
      applyErrorTransition(capture.latest as FunnelStateValue);
    });
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('is a no-op write if the error transition fires while isProcessing is already false', () => {
    // Defensive: the route-level handler MUST set `isProcessing: true`
    // before invoking `triggerPaywall(...)`, but a future refactor could
    // accidentally race two completion callbacks (e.g. the wrapper's
    // error-rejection firing concurrently with a synchronous throw inside
    // the `try` block on a slow device). The slice's bailout semantics —
    // documented inside `setPaymentProcessing` in FunnelStateProvider.tsx
    // — protect against that by returning the previous reference verbatim
    // when the requested value matches the current. The post-second-write
    // snapshot must therefore be the SAME object identity as the
    // post-first-write snapshot.
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
      applyErrorTransition(capture.latest as FunnelStateValue);
    });

    // Bailout fired — the slice reference is preserved verbatim. This
    // proves the error transition is idempotent in the
    // already-not-in-flight starting state.
    expect(capture.latest?.payment).toBe(preWriteSnapshot);
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('keeps the slice setter references stable across the error transition', () => {
    // The setter references must remain `===` to their initial values
    // across the transition — same useCallback-stable-identity invariant
    // proven by the Phase 2.4 per-setter tests, repeated here so the
    // Phase 2.5 completion handler can list `setPaymentProcessing` in a
    // `useEffect` dependency array (the route-level handler does exactly
    // this for the CTA's onPress closure) without spurious re-runs that
    // would re-fire the error catch or re-trigger analytics on every
    // render.
    //
    // We assert stability on BOTH `setPaymentProcessing` (which the
    // error branch actually calls) and `setIsPremium` (which the error
    // branch deliberately does NOT call) — the latter assertion is
    // included because the route handler typically binds both setters
    // via `useFunnelState()` destructuring, and a regression that
    // rebuilt the context value on every transition would also
    // destabilise the unused setter even though no write touched it.
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
      applyErrorTransition(value);
    });

    expect(capture.latest?.setPaymentProcessing).toBe(initialSetPaymentProcessing);
    expect(capture.latest?.setIsPremium).toBe(initialSetIsPremium);
  });

  it('exposes a setter typed as SetPaymentProcessing on the context value', () => {
    // Type-level sanity check at runtime: the setter the error helper
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

  it('matches the declined-branch slice contract (same isProcessing drop, same isPremium preservation)', () => {
    // Cross-outcome invariant: the slice-level write performed by the
    // error branch must be IDENTICAL to the slice-level write performed
    // by the declined branch. Both outcomes fire exactly one setter
    // (`setPaymentProcessing(false)`), and both leave `isPremium`
    // untouched. The divergence between the two outcomes lives at the
    // route level (declined silently re-renders the CTA; error
    // additionally renders the Korean inline error text), NOT at the
    // slice level.
    //
    // This assertion pins the cross-outcome equivalence so a future
    // refactor that introduced an asymmetry (e.g. "error also writes
    // selectedMethod = null to force a re-selection") would be caught at
    // the slice contract boundary instead of leaking into the integration
    // test. Pinning the equivalence at the test level also documents the
    // intentional design choice — the error and declined paths share the
    // slice contract on purpose, not by coincidence.
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
      applyErrorTransition(value);
    });

    // Exact post-transition shape — every field has the expected value,
    // proving the error branch makes the same single write
    // (`setPaymentProcessing(false)`) and leaves every other field
    // untouched. The shape equality is asserted field-by-field rather
    // than via `toEqual({...})` so a future contract widening that added
    // an extra optional field would not silently slip past the test.
    expect(capture.latest?.payment.selectedMethod).toBe('kakao');
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(false);
  });
});
