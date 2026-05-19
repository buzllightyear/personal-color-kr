/**
 * Unit test — `apps/mobile/src/providers/FunnelStateProvider.tsx` payment
 * slice (Sub-AC 15.1 / Phase 2.4).
 *
 * Verifies the **initial-state shape** of the payment slice exposed by
 * `<FunnelStateProvider>` via the `useFunnelState()` hook. The Sub-AC 15.1
 * contract is:
 *
 *   - `payment.selectedMethod === null`   (no method selected yet)
 *   - `payment.isProcessing === false`    (no in-flight payment simulation)
 *   - `payment.isPremium === false`       (premium content remains locked)
 *
 * What this test asserts (all on the *first* render — no writes performed):
 *   1. The `payment` field is present on the context value (proving the
 *      provider wired the new slice through its `useMemo` bundle).
 *   2. Each of the three declared fields matches the Sub-AC 15.1 default.
 *   3. The slice exposes *exactly* those three keys (no surplus, no
 *      missing) — protects against accidental field additions slipping in
 *      without a corresponding contract/test update.
 *   4. The initial `payment` reference is structurally equal to
 *      `INITIAL_FUNNEL_PAYMENT` (proves the provider seeds from the
 *      contract constant rather than an ad-hoc inline object).
 *   5. The `initialPayment` seed prop overrides the default — the test
 *      escape hatch that future sibling sub-ACs (e.g. result-reveal
 *      premium-branch rendering) rely on to spin the provider up
 *      mid-flow.
 *
 * Why a dedicated file (not folded into `funnel-state-context.test.tsx`):
 *   The project's `coding-standards` rule prefers "many small files >
 *   few large files" with 200–400 lines as the sweet spot. The existing
 *   context test is already ~400 lines covering the onboarding slice's
 *   write semantics; the payment slice has its own initial-state contract
 *   and its own future sub-ACs (setter, processing flag, premium gate),
 *   so a dedicated file gives those tests a coherent home as they grow.
 *
 * Testing approach:
 *   Same `react-test-renderer` + `vi.mock('react-native')` pattern used
 *   across the funnel test suite (see `funnel-state-context.test.tsx`
 *   for the full rationale). A small Probe consumer reads the context
 *   via `useFunnelState()` and mirrors the live `payment` snapshot back
 *   into an external capture bundle so the test body can assert on it
 *   without going through @testing-library/react-native.
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
  INITIAL_FUNNEL_PAYMENT,
  type FunnelPayment,
  type FunnelStateValue,
} from '../src/contracts/funnel-state';

// ---------------------------------------------------------------------------
// Probe helper — mirrors the latest context value into an external bundle
// so the test body can read it after each `act(...)`.
// ---------------------------------------------------------------------------

interface ProbeCapture {
  latest: FunnelStateValue | null;
}

function Probe(props: { readonly capture: ProbeCapture }): React.ReactElement {
  const value = useFunnelState();
  props.capture.latest = value;
  // Render a single host element so `TestRenderer.create` succeeds — the
  // visible output is irrelevant; the capture-bundle side channel carries
  // every assertion target.
  return React.createElement('View', { testID: 'probe' });
}

function makeCapture(): ProbeCapture {
  return { latest: null };
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

describe('FunnelStateProvider — payment slice initial state (Sub-AC 15.1)', () => {
  it('exposes a `payment` field on the context value', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    expect(capture.latest).not.toBeNull();
    expect(capture.latest?.payment).toBeDefined();
  });

  it('initialises selectedMethod to null', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    expect(capture.latest?.payment.selectedMethod).toBeNull();
  });

  it('initialises isProcessing to false', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    expect(capture.latest?.payment.isProcessing).toBe(false);
  });

  it('initialises isPremium to false (locked premium branch)', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    expect(capture.latest?.payment.isPremium).toBe(false);
  });

  it('exposes exactly the three declared keys on the payment slice', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const payment = capture.latest?.payment;
    expect(payment).toBeDefined();
    expect(Object.keys(payment as object).sort()).toEqual([
      'isPremium',
      'isProcessing',
      'selectedMethod',
    ]);
  });

  it('seeds from INITIAL_FUNNEL_PAYMENT (not an ad-hoc inline object)', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    // Structural equality — the provider's `useState` initializer should
    // hand back exactly the contract constant on first render so a future
    // refactor cannot silently introduce a drifting default.
    expect(capture.latest?.payment).toEqual(INITIAL_FUNNEL_PAYMENT);
  });

  it('exposes a setPayment function on the context value', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    expect(typeof capture.latest?.setPayment).toBe('function');
  });
});

describe('FunnelStateProvider — initialPayment seed prop (Sub-AC 15.1)', () => {
  it('uses the provided initialPayment as the first render value', () => {
    const capture = makeCapture();
    const seed: FunnelPayment = {
      selectedMethod: 'kakao',
      isProcessing: false,
      isPremium: true,
    };
    renderWithProvider(capture, { initialPayment: seed });

    expect(capture.latest?.payment.selectedMethod).toBe('kakao');
    expect(capture.latest?.payment.isProcessing).toBe(false);
    expect(capture.latest?.payment.isPremium).toBe(true);
  });

  it('keeps the default null/false/false when no initialPayment is given', () => {
    const capture = makeCapture();
    renderWithProvider(capture, {});

    expect(capture.latest?.payment).toEqual({
      selectedMethod: null,
      isProcessing: false,
      isPremium: false,
    });
  });
});
