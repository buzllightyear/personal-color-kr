/**
 * Route-level test — `app/(funnel)/payment-model.tsx` skip-flow contract
 * (Phase 2.5, AC 10).
 *
 * What this test pins:
 *   When the user taps the 나중에 할게요 soft-gate skip `Pressable`
 *   (testID `payment-model-skip-cta`), the route handler MUST:
 *
 *     1. Invoke `trackPaymentSkipped({})` exactly once — observable
 *        through the placeholder `console.log` body of the analytics
 *        helper (the helper logs the snake_case event-name literal
 *        `payment_skipped` alongside the empty payload object so the
 *        Phase 2.6+ swap to `posthog.capture('payment_skipped', {})` is
 *        a one-line edit).
 *     2. Invoke `router.replace('/(funnel)/result-reveal')` exactly
 *        once with the LOCKED target — no `?premium=true` query param.
 *        The locked-vs-premium discriminator lives on the
 *        `FunnelStateProvider` payment slice (`payment.isPremium`), not
 *        on URL params; the skip path leaves `isPremium = false` and
 *        therefore intentionally omits the navigation TRIGGER param the
 *        purchase-flow path appends.
 *     3. Order MUST be analytics-then-navigation. Firing the placeholder
 *        event BEFORE the `router.replace` call guarantees the
 *        observation is recorded even if the route unmounts
 *        synchronously after the navigation (the `useEffect` cleanup
 *        for the in-flight setTimeout ref runs on unmount and would
 *        otherwise race a deferred capture). This ordering also mirrors
 *        the Phase 2.4 `referral_gate` and `social_evolution` skip flows.
 *     4. The skip event is fired ONLY on the explicit-skip
 *        `Pressable` tap — NOT on a Superwall paywall modal dismiss
 *        (the `declined` outcome retains the user on payment_model and
 *        does not navigate). Seed evaluation principle
 *        `analytics_separation`.
 *
 * Why a separate test file from `payment-model-route.test.tsx`:
 *   The existing route smoke test pins module shape + crash-free
 *   render + no auto-navigation on mount. Layering a behavioural skip
 *   assertion onto that file would conflate two concerns and force
 *   every mount-time test to share the `console.log` spy lifecycle.
 *   A focused sibling file mirrors the precedent set by
 *   `result-reveal-cta-navigation.test.tsx` and
 *   `result-reveal-route-premium-backhandler.test.tsx`, which extract
 *   single behavioural contracts off the result-reveal route smoke.
 *
 * Mocking strategy mirrors `payment-model-route.test.tsx`:
 *   - `react-native`: host stubs only (View, Text, Pressable,
 *     ScrollView, StyleSheet, Platform).
 *   - `react-native-safe-area-context`: thin SafeAreaView stub.
 *   - `expo-router`: `useRouter` returns module-scope spies so each
 *     test can introspect call count + path arguments.
 *   - `apps/mobile/src/superwall/client`: per Seed constraint
 *     "vitest mocks the wrapper module path (apps/mobile/src/superwall/client)
 *     and does NOT directly import @superwall/react-native-superwall;
 *     native isolation is achieved precisely because vitest substitutes
 *     the wrapper at test time". Even though THIS test exercises only
 *     the skip path (which never calls into the wrapper), the route
 *     module's top-level imports may reach the wrapper transitively
 *     once AC 7 lands; mocking the wrapper module to an inert surface
 *     keeps this test resilient under that future state.
 *
 * Why we spy on `posthog.capture` rather than mocking the analytics module:
 *   The analytics module (`track-payment-skipped.ts`) is the
 *   *contract under test*. Mocking it would let a regression strip the
 *   call entirely without failing this test. Spying on the underlying
 *   `posthog.capture` invocation instead pins the *observable side-effect*
 *   of the helper — exactly the same contract that the unit test
 *   `tests/track-payment-skipped.test.ts` pins for the helper itself,
 *   composed with the route-level "called once with empty payload"
 *   expectation here. The two tests together form a complete chain:
 *   route invokes helper, helper calls `posthog.capture(...)`.
 *
 * Phase 2.6 update — replaced the Phase 2.5 `console.log` spy with a
 *   `usePostHog()` mock returning a captureFn spy, mirroring the pattern
 *   established by `tests/funnel-step-entered-capture.test.tsx`. The
 *   Phase 2.4/2.5 placeholder logger is fully retired (Seed constraint
 *   "zero residual console.log/TODO(phase-2.6) in production code").
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// react-native mock — host stubs only (no Animated / Modal needed)
// ---------------------------------------------------------------------------

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
    ScrollView: makeHost('ScrollView'),
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

// ---------------------------------------------------------------------------
// expo-router mock — module-scope spies the test reads after the tap
// ---------------------------------------------------------------------------

const pushSpy = vi.fn();
const replaceSpy = vi.fn();

vi.mock('expo-router', () => {
  return {
    useRouter: (): { push: (path: string) => void; replace: (path: string) => void } => ({
      push: pushSpy,
      replace: replaceSpy,
    }),
    useLocalSearchParams: (): Readonly<Record<string, unknown>> => ({}),
  };
});

// ---------------------------------------------------------------------------
// Superwall wrapper mock — see file-level JSDoc for the native-isolation
// rationale. The route module's `import { ... }` of the wrapper resolves to
// this inert surface, so no native @superwall/react-native-superwall module
// is required at test time.
// ---------------------------------------------------------------------------

vi.mock('../src/superwall/client', () => {
  return {
    PLACEMENT_PAYMENT_MODEL_UNLOCK: 'payment_model_unlock',
    configureSuperwall: vi.fn(),
    triggerPaywall: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// posthog-react-native mock — `usePostHog()` returns a stub whose `.capture`
// is the module-scope spy under assertion. Mirrors the pattern from
// `tests/funnel-step-entered-capture.test.tsx`.
// ---------------------------------------------------------------------------

const captureFn = vi.fn();

vi.mock('posthog-react-native', () => {
  return {
    usePostHog: () => ({ capture: captureFn }),
  };
});

// Import the route default AFTER the mocks have been registered so the
// module's `import { useRouter } from 'expo-router'` resolves to the mocked
// surface above.
import PaymentModelRoute from '../app/(funnel)/payment-model';
import { FunnelStateProvider } from '../src/providers/FunnelStateProvider';

interface TestInstance {
  readonly type: unknown;
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
    tree = TestRenderer.create(
      React.createElement(FunnelStateProvider, null, element),
    );
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

describe('payment-model route — skip flow (Phase 2.5 AC 10, Phase 2.6 capture rewire)', () => {
  beforeEach(() => {
    pushSpy.mockClear();
    replaceSpy.mockClear();
    captureFn.mockReset();
  });

  it('tap on the skip CTA invokes trackPaymentSkipped({}) and then router.replace(locked result-reveal)', () => {
    const tree = render(React.createElement(PaymentModelRoute));

    const skip = findHostByTestId(tree, 'payment-model-skip-cta');
    expect(skip).toBeTruthy();

    const onPress = skip?.props.onPress as (() => void) | undefined;
    expect(typeof onPress).toBe('function');

    act(() => {
      onPress?.();
    });

    // Analytics side-effect (Phase 2.6): the route handler must invoke
    // `posthog.capture('payment_skipped', {})` exactly once via the
    // `trackPaymentSkipped` helper. We scan the recorded calls for the
    // `payment_skipped` literal so the assertion stays robust against
    // unrelated capture calls (e.g. funnel_step_entered from the
    // root-layout auto-capture, if it leaked through this mock setup).
    const skipCaptures = captureFn.mock.calls.filter(
      (args) => args[0] === 'payment_skipped',
    );
    expect(skipCaptures).toHaveLength(1);
    // The empty-object payload is the only value the
    // `TrackPaymentSkippedPayload = Record<string, never>` type permits.
    // The route hands `{}` to the helper, which spreads it into a fresh
    // literal before invoking `capture(EVENT_NAME, payload)` — so the
    // recorded second argument is a plain empty object.
    const recordedPayload = (skipCaptures[0] ?? [])[1];
    expect(recordedPayload).toEqual({});

    // Navigation side-effect: exactly one `router.replace` call, targeting
    // the LOCKED result-reveal — explicitly NO `?premium=true` query
    // param. The premium-result branch is reached only via the purchase
    // path (`router.replace('/(funnel)/result-reveal?premium=true')` in
    // the unlock handler), so verifying the absence of the query string
    // here pins the locked-vs-premium discriminator at the route layer.
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    const replaceCall = replaceSpy.mock.calls[0] ?? [];
    expect(replaceCall[0]).toBe('/(funnel)/result-reveal');
    // `pushSpy` should remain untouched — skip path uses replace exclusively
    // so back-swipe from result-reveal cannot re-enter payment_model (the
    // soft-gate exit invariant from the Phase 2.4 route JSDoc).
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('skip path does NOT append the ?premium=true query param (locked result-reveal target)', () => {
    // Independent assertion to make the locked-vs-premium contract
    // visible at the test-listing level: a grep for "?premium=true"
    // across this test file MUST NOT find a match on the skip path.
    // If a future refactor accidentally re-introduces the param on
    // skip (e.g. through a typo or a copy-paste from the unlock
    // handler), this test fails with a precise message — rather than
    // a result-reveal route test misfiring on the unrelated premium
    // branch downstream.
    const tree = render(React.createElement(PaymentModelRoute));
    const skip = findHostByTestId(tree, 'payment-model-skip-cta');
    const onPress = skip?.props.onPress as (() => void) | undefined;
    act(() => {
      onPress?.();
    });
    const replaceCalls = replaceSpy.mock.calls.map((args) => String(args[0]));
    for (const path of replaceCalls) {
      expect(path).not.toContain('premium=true');
      expect(path).not.toContain('?');
    }
  });

  it('analytics fires BEFORE navigation (recorded order: capture then replace)', () => {
    // Order matters per the file-level JSDoc — analytics-then-navigation
    // guarantees the event is observable even if the route unmounts
    // synchronously after the `router.replace` call.
    //
    // We rely on vitest's monotonic `.mock.invocationCallOrder` counter
    // (assigned globally across every recorded call) to assert
    // "capture ran first, replace ran second" without coupling to
    // wall-clock timestamps.
    const tree = render(React.createElement(PaymentModelRoute));
    const skip = findHostByTestId(tree, 'payment-model-skip-cta');
    const onPress = skip?.props.onPress as (() => void) | undefined;
    act(() => {
      onPress?.();
    });

    const skipCaptureOrders = captureFn.mock.invocationCallOrder.filter((_, i) =>
      (captureFn.mock.calls[i]?.[0] ?? '') === 'payment_skipped',
    );
    const replaceCallOrder = replaceSpy.mock.invocationCallOrder[0];

    expect(skipCaptureOrders).toHaveLength(1);
    expect(replaceCallOrder).toBeDefined();
    expect((skipCaptureOrders[0] ?? Infinity) < (replaceCallOrder ?? -Infinity)).toBe(
      true,
    );
  });

  it('does NOT fire trackPaymentSkipped on mount (only on explicit skip tap)', () => {
    // Sanity guard: mounting the route MUST NOT emit a
    // `payment_skipped` capture. The event is exclusively user-driven —
    // the contract is "explicit-skip Pressable tap fires the event",
    // never on render, never on unmount.
    render(React.createElement(PaymentModelRoute));
    const skipCaptures = captureFn.mock.calls.filter(
      (args) => args[0] === 'payment_skipped',
    );
    expect(skipCaptures).toHaveLength(0);
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
