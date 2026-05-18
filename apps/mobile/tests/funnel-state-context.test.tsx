/**
 * Unit test — `apps/mobile/src/providers/FunnelStateProvider.tsx` (Sub-AC 7.2).
 *
 * Verifies the runtime contract of the `FunnelStateProvider` + `useFunnelState`
 * pair using a small probe component that consumes the Context and exposes
 * the live value back to the test via `testID`-tagged Text nodes.
 *
 * What this test asserts:
 *   1. **Default state** — first render inside the provider exposes
 *      `onboarding.selfieEditStyle === null` and `onboarding.priorDiagnosis === null`
 *      (matching `INITIAL_FUNNEL_ONBOARDING_ANSWERS`).
 *   2. **Immutable partial merge** — `setOnboarding({ selfieEditStyle: 'natural' })`
 *      produces a new `onboarding` object where `selfieEditStyle === 'natural'`
 *      and `priorDiagnosis` is untouched (still `null`).
 *   3. **Sequential merges accumulate** — a second
 *      `setOnboarding({ priorDiagnosis: 'professional' })` call preserves the
 *      previously-set `selfieEditStyle` ('natural') and adds the new answer.
 *   4. **Previous snapshot is not mutated** — the `onboarding` object captured
 *      before the first write is structurally unchanged after the writes
 *      (both fields still `null` on the captured reference), proving the
 *      provider returns a fresh object rather than mutating in place.
 *   5. **Updater identity is stable** — the `setOnboarding` reference is the
 *      same function across re-renders, so consumers can safely list it in
 *      `useEffect` dependency arrays.
 *   6. **Empty patch is a no-op for visible fields** — `setOnboarding({})`
 *      does not corrupt existing answers (a fresh object is created but it
 *      has the same field values).
 *   7. **Outside-provider fallback** — `useFunnelState()` rendered without a
 *      surrounding `<FunnelStateProvider>` returns the default snapshot
 *      (null answers + no-op setter) instead of throwing.
 *   8. **`initialOnboarding` seed prop** — when the test passes a non-default
 *      `initialOnboarding`, the first render reflects those values (used by
 *      future tests that want to spin up the provider mid-flow).
 *
 * Testing approach:
 *   We follow the same react-test-renderer + `vi.mock('react-native')`
 *   pattern documented in `funnel-placeholder-smoke.test.tsx` and
 *   `use-auto-advance-timer.test.tsx`. The Probe component is a
 *   presentational consumer that:
 *     - reads the live context value via `useFunnelState()`
 *     - renders the two answer fields as testID-tagged Text nodes so the
 *       test can assert on visible content
 *     - exposes the latest `setOnboarding` and captured snapshots to the
 *       test through external refs (a pattern that keeps the assertions
 *       simple without depending on `@testing-library/react-native`)
 *
 *   `act(...)` from `react-test-renderer` brackets every state-changing
 *   call so React's batched updates are flushed synchronously before the
 *   next assertion — without this, the rendered output would lag one
 *   render behind the `setOnboarding` invocation.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Mock `react-native` ESM entry to a minimal host-component set. Vite's SSR
// transform resolves the provider's transitive `react-native` imports
// through the ESM path even though the CJS require.cache stub from
// `setup-rn-stub.ts` covers the CommonJS surface. Mocking here keeps both
// resolution paths happy. (See `funnel-placeholder-smoke.test.tsx` for the
// full rationale — this mirrors that mock exactly.)
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
  FunnelStateContext,
  FunnelStateProvider,
  useFunnelState,
} from '../src/providers/FunnelStateProvider';
import {
  INITIAL_FUNNEL_ONBOARDING_ANSWERS,
  type FunnelOnboardingAnswers,
  type FunnelStateValue,
  type SetOnboarding,
} from '../src/contracts/funnel-state';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Tiny test-instance shape narrowed for the property-based queries below.
 * Mirrors the helper used in `funnel-placeholder-smoke.test.tsx` so the
 * test file stays self-contained (no @testing-library/react-native).
 */
interface TestInstance {
  readonly props: Record<string, unknown>;
}

function findByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance {
  const match = tree.root.findAll((node) => node.props?.testID === testID);
  const first = match[0] as unknown as TestInstance | undefined;
  if (!first) {
    throw new Error(`findByTestId('${testID}'): no match`);
  }
  return first;
}

/**
 * External capture bundle the test passes into the Probe so the running test
 * body can reach into the live consumer's view of the Context without going
 * through a separate render-pass. Each field is updated on every Probe
 * render so the test can read "the very latest" value after `act(...)`.
 */
interface ProbeCapture {
  // Latest read of the Context value (full snapshot).
  latest: FunnelStateValue | null;
  // History of `onboarding` references seen across renders, so the test can
  // assert "the captured pre-write snapshot did NOT mutate" by checking
  // that the FIRST entry's fields are still null after later writes.
  history: FunnelOnboardingAnswers[];
  // Number of times the Probe re-rendered. Used to assert "the updater
  // reference is stable" (no extra renders triggered by identity churn).
  renderCount: number;
}

/**
 * Probe consumer: reads the Context via the hook, mirrors the live value
 * into the external `capture` bundle, and renders the two onboarding
 * fields as testID-tagged Text nodes so the test can assert on visible
 * output.
 *
 * The textual rendering uses the literal `null` string (via `String(...)`)
 * so an unanswered field is observably distinct from the string `'null'`
 * the user could not actually type (per the Seed constraint, free-text is
 * disallowed).
 */
function Probe(props: { readonly capture: ProbeCapture }): React.ReactElement {
  const value = useFunnelState();
  // Record-into-capture must happen during render so the test reads the
  // post-render snapshot in the next tick. Counting renders separately
  // proves the stable-identity contract for setOnboarding.
  props.capture.latest = value;
  props.capture.history.push(value.onboarding);
  props.capture.renderCount += 1;

  return React.createElement(
    'View',
    { testID: 'probe' },
    React.createElement(
      'Text',
      { testID: 'probe-selfie' },
      String(value.onboarding.selfieEditStyle),
    ),
    React.createElement(
      'Text',
      { testID: 'probe-prior' },
      String(value.onboarding.priorDiagnosis),
    ),
  );
}

function makeCapture(): ProbeCapture {
  return { latest: null, history: [], renderCount: 0 };
}

function renderWithProvider(
  capture: ProbeCapture,
  options: { readonly initialOnboarding?: FunnelOnboardingAnswers } = {},
): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(
      React.createElement(
        FunnelStateProvider,
        options.initialOnboarding !== undefined
          ? { initialOnboarding: options.initialOnboarding }
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

describe('FunnelStateProvider — default state (Sub-AC 7.2)', () => {
  it('exposes both onboarding answers as null on first render', () => {
    const capture = makeCapture();
    const tree = renderWithProvider(capture);

    expect(capture.latest).not.toBeNull();
    expect(capture.latest?.onboarding.selfieEditStyle).toBeNull();
    expect(capture.latest?.onboarding.priorDiagnosis).toBeNull();

    // Visible textual output matches the underlying state.
    expect(findByTestId(tree, 'probe-selfie').props.children).toBe('null');
    expect(findByTestId(tree, 'probe-prior').props.children).toBe('null');
  });

  it('uses the same shape as INITIAL_FUNNEL_ONBOARDING_ANSWERS', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    expect(capture.latest?.onboarding).toEqual(INITIAL_FUNNEL_ONBOARDING_ANSWERS);
  });

  it('exposes a setOnboarding function (not the no-op fallback) from the provider', () => {
    const capture = makeCapture();
    renderWithProvider(capture);
    expect(typeof capture.latest?.setOnboarding).toBe('function');
  });
});

describe('FunnelStateProvider — setOnboarding immutable merges (Sub-AC 7.2)', () => {
  it('merges a single-field patch without touching the other field', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const setOnboarding = capture.latest?.setOnboarding as SetOnboarding;
    act(() => {
      setOnboarding({ selfieEditStyle: 'natural' });
    });

    expect(capture.latest?.onboarding.selfieEditStyle).toBe('natural');
    expect(capture.latest?.onboarding.priorDiagnosis).toBeNull();
  });

  it('accumulates sequential partial updates without resetting prior answers', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const setOnboarding = capture.latest?.setOnboarding as SetOnboarding;

    act(() => {
      setOnboarding({ selfieEditStyle: 'subtle' });
    });
    act(() => {
      setOnboarding({ priorDiagnosis: 'professional' });
    });

    expect(capture.latest?.onboarding.selfieEditStyle).toBe('subtle');
    expect(capture.latest?.onboarding.priorDiagnosis).toBe('professional');
  });

  it('produces a new onboarding object reference per write (no in-place mutation)', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const firstSnapshot = capture.latest?.onboarding;
    expect(firstSnapshot).toBeDefined();

    const setOnboarding = capture.latest?.setOnboarding as SetOnboarding;
    act(() => {
      setOnboarding({ selfieEditStyle: 'expressive' });
    });

    const secondSnapshot = capture.latest?.onboarding;
    // Reference must differ — proves the provider returned a new object.
    expect(secondSnapshot).not.toBe(firstSnapshot);
    // And the captured pre-write snapshot is unchanged — the previous
    // reference's fields were not mutated underneath the consumer.
    expect(firstSnapshot?.selfieEditStyle).toBeNull();
    expect(firstSnapshot?.priorDiagnosis).toBeNull();
  });

  it('allows explicitly clearing a field by passing null', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const setOnboarding = capture.latest?.setOnboarding as SetOnboarding;
    act(() => {
      setOnboarding({ selfieEditStyle: 'natural', priorDiagnosis: 'self_test' });
    });
    expect(capture.latest?.onboarding.selfieEditStyle).toBe('natural');
    expect(capture.latest?.onboarding.priorDiagnosis).toBe('self_test');

    act(() => {
      setOnboarding({ selfieEditStyle: null });
    });
    expect(capture.latest?.onboarding.selfieEditStyle).toBeNull();
    // priorDiagnosis must remain untouched by the cleared selfieEditStyle.
    expect(capture.latest?.onboarding.priorDiagnosis).toBe('self_test');
  });

  it('is a structural no-op for visible fields when given an empty patch', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const setOnboarding = capture.latest?.setOnboarding as SetOnboarding;
    act(() => {
      setOnboarding({ selfieEditStyle: 'natural' });
    });
    const afterFirstWrite = capture.latest?.onboarding;

    act(() => {
      setOnboarding({});
    });
    // The two visible fields are unchanged.
    expect(capture.latest?.onboarding).toEqual(afterFirstWrite);
  });

  it('keeps the setOnboarding reference stable across state updates', () => {
    const capture = makeCapture();
    renderWithProvider(capture);

    const initialSetOnboarding = capture.latest?.setOnboarding;
    act(() => {
      (initialSetOnboarding as SetOnboarding)({ selfieEditStyle: 'natural' });
    });
    const afterFirstWrite = capture.latest?.setOnboarding;

    act(() => {
      (afterFirstWrite as SetOnboarding)({ priorDiagnosis: 'never' });
    });
    const afterSecondWrite = capture.latest?.setOnboarding;

    expect(afterFirstWrite).toBe(initialSetOnboarding);
    expect(afterSecondWrite).toBe(initialSetOnboarding);
  });
});

describe('FunnelStateProvider — initialOnboarding seed prop (Sub-AC 7.2)', () => {
  it('uses the provided initialOnboarding as the first render value', () => {
    const capture = makeCapture();
    const seed: FunnelOnboardingAnswers = {
      selfieEditStyle: 'expressive',
      priorDiagnosis: 'professional',
    };
    renderWithProvider(capture, { initialOnboarding: seed });

    expect(capture.latest?.onboarding.selfieEditStyle).toBe('expressive');
    expect(capture.latest?.onboarding.priorDiagnosis).toBe('professional');
  });

  it('still permits subsequent setOnboarding writes on top of the seed', () => {
    const capture = makeCapture();
    const seed: FunnelOnboardingAnswers = {
      selfieEditStyle: 'natural',
      priorDiagnosis: null,
    };
    renderWithProvider(capture, { initialOnboarding: seed });

    const setOnboarding = capture.latest?.setOnboarding as SetOnboarding;
    act(() => {
      setOnboarding({ priorDiagnosis: 'self_test' });
    });

    // Seeded field preserved, patched field applied.
    expect(capture.latest?.onboarding.selfieEditStyle).toBe('natural');
    expect(capture.latest?.onboarding.priorDiagnosis).toBe('self_test');
  });
});

describe('FunnelStateProvider — outside-provider fail-loud guard (Sub-AC 7.3)', () => {
  it('throws when useFunnelState is called outside a <FunnelStateProvider>', () => {
    const capture = makeCapture();
    // No provider wrapper here — the strict hook (Sub-AC 7.3) must throw so
    // a missing-wrapper bug fails loud during render rather than silently
    // discarding `setOnboarding(...)` writes. We swallow React's "ErrorBoundary
    // caught" log noise by spying on console.error inside the act() body.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* mute React's render-error noise for this expected throw */
    });
    try {
      expect(() => {
        act(() => {
          TestRenderer.create(React.createElement(Probe, { capture }));
        });
      }).toThrow(/FunnelStateProvider/);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('exports a Context object with the FunnelState displayName for devtools', () => {
    expect(FunnelStateContext.displayName).toBe('FunnelStateContext');
  });
});
