/**
 * Smoke test — `app/(funnel)/referral-gate.tsx` route wrapper (Sub-AC 17.1).
 *
 * What this test asserts:
 *   1. The module at `app/(funnel)/referral-gate.tsx` exports a default
 *      React component (the Expo Router contract for a route file).
 *   2. That default component renders without throwing under
 *      `react-test-renderer`, with `expo-router`'s `useRouter` and
 *      `useLocalSearchParams` mocked to inert stubs.
 *   3. The rendered tree surfaces a stable root testID
 *      (`referral-gate-screen`) so subsequent sub-ACs that layer in
 *      kakao-share / copy-link / skip controls can pin their queries to
 *      a known host element.
 *
 * Why this is a route-level smoke test (not a screen-level test):
 *   Sub-AC 17.1 is the foundation step for Phase 2.4 (`referral_gate`
 *   step-10 implementation). The route file is the Expo Router entry
 *   point — establishing that it imports cleanly, exports a default
 *   component, and renders crash-free guarantees later sub-ACs have a
 *   stable surface to extend without re-doing the bootstrap work.
 *
 * Mocking strategy mirrors `scan-option-select-route.test.tsx`:
 *   - `react-native`: minimal host-component set (Vite's ESM resolver
 *     otherwise lands on the real RN entry which fails to parse Flow
 *     `import typeof` syntax in Node).
 *   - `react-native-safe-area-context`: tiny `SafeAreaView` stub matching
 *     the surface the route consumes.
 *   - `expo-router`: `useRouter` returns a stub object whose `push` and
 *     `replace` are `vi.fn`s; `useLocalSearchParams` returns an empty
 *     params object. Sub-AC 17.1 does not exercise the share / skip
 *     navigation paths — those land in later sub-ACs — so the spies are
 *     present purely to satisfy the route's import surface.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// react-native mock — host stubs only (no Animated / Modal needed at 17.1)
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

// Module-scope router spies — the mocked `useRouter` closes over these so
// individual tests can introspect call count and arguments after rendering.
// Sub-AC 17.1 does not exercise navigation; they exist solely so the route
// module's `import { useRouter } from 'expo-router'` resolves without
// blowing up at import time.
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

// Import the default export AFTER the mocks have been registered so the
// route module's `import { useRouter } from 'expo-router'` resolves to the
// mocked surface above.
import ReferralGateRoute from '../app/(funnel)/referral-gate';
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

describe('referral-gate route file — module shape (Sub-AC 17.1)', () => {
  it('exports a default function', () => {
    // The Expo Router contract is "default export is the route component".
    // We assert the export shape directly so an accidental named-only
    // export, an object literal, or a `null` would fail loudly here.
    expect(ReferralGateRoute).toBeDefined();
    expect(typeof ReferralGateRoute).toBe('function');
  });
});

describe('referral-gate route file — render smoke (Sub-AC 17.1)', () => {
  it('renders without throwing', () => {
    // The smoke contract: invoking the default export under
    // react-test-renderer with mocked expo-router hooks does not raise.
    // Subsequent sub-ACs will layer share / skip / state-write logic on
    // top of this surface.
    expect(() => {
      render(React.createElement(ReferralGateRoute));
    }).not.toThrow();
  });

  it('mounts a host element tagged with the referral-gate-screen testID', () => {
    // The stable testID anchors future query-by-testId assertions (e.g.
    // kakao-share / copy-link / skip controls) without forcing every
    // downstream test to re-discover the root surface.
    const tree = render(React.createElement(ReferralGateRoute));
    expect(findHostByTestId(tree, 'referral-gate-screen')).toBeTruthy();
  });

  it('does not invoke router.push or router.replace on mount (Sub-AC 17.1)', () => {
    // Sub-AC 17.1 is a foundation step — no auto-navigation, no
    // side-effecting push/replace. Navigation wiring (share → social-evolution
    // via router.replace, skip → social-evolution via router.push) lands
    // in later sub-ACs and will be tested there.
    pushSpy.mockClear();
    replaceSpy.mockClear();
    render(React.createElement(ReferralGateRoute));
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
