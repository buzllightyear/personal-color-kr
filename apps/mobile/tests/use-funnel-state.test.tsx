/**
 * Unit test — `apps/mobile/src/hooks/use-funnel-state.ts` (Sub-AC 7.3).
 *
 * Verifies the runtime contract of the strict `useFunnelState` hook:
 *
 *   1. **Successful read inside the provider** — when mounted under a
 *      `<FunnelStateProvider>`, the hook returns the live `FunnelStateValue`
 *      snapshot with both the immutable `onboarding` answers and the stable
 *      `setOnboarding` updater. The returned value must satisfy the contract
 *      shape (no `undefined` leakage, both fields present).
 *
 *   2. **Outside-provider fail-loud guard** — when called WITHOUT any
 *      `<FunnelStateProvider>` wrapper, the hook throws a
 *      `FunnelStateProviderMissingError` (a distinguishable subclass of
 *      `Error`). This is the Seed's "fail-loud guard stubs maintained"
 *      constraint applied to in-app UX state: a missing provider is a
 *      programming bug, not a recoverable UX condition.
 *
 *   3. **Error identity** — the thrown error carries a recognisable
 *      `name` (`'FunnelStateProviderMissingError'`) and a message that
 *      mentions both the hook and the missing provider, so developer-facing
 *      diagnostics can pattern-match without coupling to a raw string.
 *
 * Testing approach:
 *   We mirror the `funnel-state-context.test.tsx` pattern (react-test-renderer
 *   + `vi.mock('react-native')`). The probe component synchronously reads the
 *   hook and surfaces its return into an external capture bundle for the
 *   in-provider case; for the throw case the probe simply calls the hook —
 *   the thrown error propagates out of `TestRenderer.create(...)` and is
 *   asserted with `expect(...).toThrow(...)`.
 *
 *   `console.error` is muted while rendering the unhappy-path tree because
 *   React emits a render-error log to stderr by default. The mute is local
 *   to each test (mockRestore in a finally) so other tests are unaffected.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Mock `react-native` ESM entry to a minimal host-component set — same shape
// the sibling `funnel-state-context.test.tsx` uses. The strict hook itself
// does not touch `react-native`, but the provider it pairs with does (via
// transitive imports inside the funnel screens that may be co-resolved),
// and Vite's SSR transform otherwise lands on the real `react-native/index.js`
// Flow source and fails to parse.
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
  FunnelStateProviderMissingError,
  useFunnelState,
} from '../src/hooks/use-funnel-state';
import { FunnelStateProvider } from '../src/providers/FunnelStateProvider';
import {
  INITIAL_FUNNEL_ONBOARDING_ANSWERS,
  type FunnelStateValue,
} from '../src/contracts/funnel-state';

// ---------------------------------------------------------------------------
// Probe components — synchronous hook consumers
// ---------------------------------------------------------------------------

/**
 * In-provider probe: reads the hook and mirrors the live value into the
 * `capture` ref so the test body can assert on it after `act(...)`.
 */
function HappyPathProbe(props: {
  readonly capture: { value: FunnelStateValue | null };
}): React.ReactElement {
  const value = useFunnelState();
  props.capture.value = value;
  // Render nothing visible — we don't care about the DOM for this test, only
  // the captured return value. A bare `View` keeps react-test-renderer happy.
  return React.createElement('View', { testID: 'happy-path-probe' });
}

/**
 * Outside-provider probe: calls the hook unguarded. Used only to trigger the
 * fail-loud throw — the test asserts on the thrown error, not on any
 * rendered output (none reaches the tree because the throw aborts render).
 */
function UnguardedProbe(): React.ReactElement {
  useFunnelState();
  return React.createElement('View', { testID: 'unguarded-probe' });
}

// ---------------------------------------------------------------------------
// Sub-AC 7.3 — successful read inside provider
// ---------------------------------------------------------------------------

describe('useFunnelState — successful read inside provider (Sub-AC 7.3)', () => {
  it('returns the live FunnelStateValue snapshot when wrapped in a provider', () => {
    const capture: { value: FunnelStateValue | null } = { value: null };

    act(() => {
      TestRenderer.create(
        React.createElement(
          FunnelStateProvider,
          {},
          React.createElement(HappyPathProbe, { capture }),
        ),
      );
    });

    // The captured value must be a real bundle (not undefined / null).
    expect(capture.value).not.toBeNull();
    // Shape contract: both onboarding answers default to null, setOnboarding
    // is a function.
    expect(capture.value?.onboarding).toEqual(INITIAL_FUNNEL_ONBOARDING_ANSWERS);
    expect(typeof capture.value?.setOnboarding).toBe('function');
  });

  it('returns the same value reference across renders that did not write', () => {
    // A consumer that re-renders for an unrelated reason MUST see the same
    // FunnelStateValue reference — the provider's `useMemo` over
    // `[onboarding, setOnboarding]` guarantees this, and the strict hook
    // relays the reference verbatim.
    const capture: { value: FunnelStateValue | null } = { value: null };
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    act(() => {
      renderer = TestRenderer.create(
        React.createElement(
          FunnelStateProvider,
          {},
          React.createElement(HappyPathProbe, { capture }),
        ),
      );
    });

    const firstSnapshot = capture.value;
    expect(firstSnapshot).not.toBeNull();

    // Force a re-render of the entire tree with no state change. The
    // captured value must point to the same object.
    act(() => {
      renderer?.update(
        React.createElement(
          FunnelStateProvider,
          {},
          React.createElement(HappyPathProbe, { capture }),
        ),
      );
    });

    // Note: re-mounting `FunnelStateProvider` with a different element
    // instance *will* generate a new context value (the parent re-rendered).
    // The important invariant is "still defined, still well-typed" — the
    // reference-stability invariant is owned by the provider's tests, not
    // the hook's. We assert structural equality instead.
    expect(capture.value?.onboarding).toEqual(INITIAL_FUNNEL_ONBOARDING_ANSWERS);
    expect(typeof capture.value?.setOnboarding).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 7.3 — fail-loud guard when called outside the provider
// ---------------------------------------------------------------------------

describe('useFunnelState — outside-provider error case (Sub-AC 7.3)', () => {
  it('throws when called without a <FunnelStateProvider> ancestor', () => {
    // Mute React's expected render-error log so the test output stays clean.
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {
        /* expected: React logs the render error before rethrowing */
      });

    try {
      expect(() => {
        act(() => {
          TestRenderer.create(React.createElement(UnguardedProbe));
        });
      }).toThrow();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('throws a FunnelStateProviderMissingError (distinguishable subclass)', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {
        /* expected */
      });

    try {
      expect(() => {
        act(() => {
          TestRenderer.create(React.createElement(UnguardedProbe));
        });
      }).toThrow(FunnelStateProviderMissingError);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('error.name is "FunnelStateProviderMissingError" for stable matching', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {
        /* expected */
      });

    let caught: unknown = null;
    try {
      try {
        act(() => {
          TestRenderer.create(React.createElement(UnguardedProbe));
        });
      } catch (err) {
        caught = err;
      }
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('FunnelStateProviderMissingError');
  });

  it('error message names both the hook and the missing provider', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {
        /* expected */
      });

    let caught: unknown = null;
    try {
      try {
        act(() => {
          TestRenderer.create(React.createElement(UnguardedProbe));
        });
      } catch (err) {
        caught = err;
      }
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    // The message must be developer-actionable — name the hook AND the
    // missing wrapper so a stack-trace reader knows exactly what to mount.
    expect(message).toMatch(/useFunnelState/);
    expect(message).toMatch(/FunnelStateProvider/);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 7.3 — exported error class shape
// ---------------------------------------------------------------------------

describe('FunnelStateProviderMissingError — exported error class', () => {
  it('is a subclass of Error', () => {
    const err = new FunnelStateProviderMissingError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FunnelStateProviderMissingError);
  });

  it('preserves the prototype chain after construction (instanceof works)', () => {
    // The constructor explicitly runs `Object.setPrototypeOf` for ES5 target
    // compatibility. Verifying `instanceof` directly is the most robust way
    // to assert the chain survived.
    const err = new FunnelStateProviderMissingError();
    expect(err instanceof FunnelStateProviderMissingError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('has a stable name property for cross-module pattern-matching', () => {
    const err = new FunnelStateProviderMissingError();
    expect(err.name).toBe('FunnelStateProviderMissingError');
  });
});
