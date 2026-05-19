/**
 * Smoke test — `app/(funnel)/social-evolution.tsx` route wrapper.
 *
 * What this test asserts:
 *   1. The module at `app/(funnel)/social-evolution.tsx` exports a default
 *      React component (the Expo Router contract for a route file).
 *   2. That default component renders without throwing under
 *      `react-test-renderer` when wrapped in a `<FunnelStateProvider>` —
 *      the route reads `referral.shared` from the provider via
 *      `useFunnelState()` so the provider IS required (fail-loud guard).
 *   3. When `referral.shared === false` (the default initial state), the
 *      rendered tree surfaces the `social-evolution-shared-false-branch`
 *      testID — the route delegated to the shared=false branch component.
 *   4. When `referral.shared === true` (seeded via `initialReferral`), the
 *      rendered tree surfaces the original `social-evolution-screen`
 *      testID — the route delegated to the shared=true placeholder
 *      (sibling AC owns that branch's real component).
 *   5. The route does not auto-invoke `router.push` or `router.replace`
 *      on mount — navigation is user-initiated only.
 *
 * Mocking strategy:
 *   - `react-native`: minimal host-component set (Vite's ESM resolver
 *     otherwise lands on the real RN entry which fails to parse Flow
 *     `import typeof` syntax in Node).
 *   - `react-native-safe-area-context`: tiny `SafeAreaView` stub matching
 *     the surface the route consumes.
 *   - `expo-router`: `useRouter` returns a stub object whose `push` and
 *     `replace` are `vi.fn`s; `useLocalSearchParams` returns an empty
 *     params object.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// react-native mock — host stubs only
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
import SocialEvolutionRoute from '../app/(funnel)/social-evolution';
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

function renderRoute(initialShared: boolean): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(
      React.createElement(
        FunnelStateProvider,
        { initialReferral: { shared: initialShared } },
        React.createElement(SocialEvolutionRoute),
      ),
    );
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

describe('social-evolution route file — module shape', () => {
  it('exports a default function', () => {
    // The Expo Router contract is "default export is the route component".
    // We assert the export shape directly so an accidental named-only
    // export, an object literal, or a `null` would fail loudly here.
    expect(SocialEvolutionRoute).toBeDefined();
    expect(typeof SocialEvolutionRoute).toBe('function');
  });
});

describe('social-evolution route file — render smoke', () => {
  it('renders without throwing under a FunnelStateProvider (shared=false default)', () => {
    // The route requires a provider (fail-loud guard); rendering under
    // a provider with the default referral.shared === false must succeed.
    expect(() => {
      renderRoute(false);
    }).not.toThrow();
  });

  it('renders the shared=false branch when referral.shared === false', () => {
    // Default initial state — the route delegates to the
    // SocialEvolutionSharedFalseBranch component, which mounts the
    // `social-evolution-shared-false-branch` testID at its layout root.
    pushSpy.mockClear();
    replaceSpy.mockClear();
    const tree = renderRoute(false);
    expect(
      findHostByTestId(tree, 'social-evolution-shared-false-branch'),
    ).toBeTruthy();
  });

  it('renders the shared=true placeholder when referral.shared === true', () => {
    // shared=true branch lands in a sibling AC; until that component is
    // wired the route retains the original `social-evolution-screen`
    // testID as a stable anchor.
    pushSpy.mockClear();
    replaceSpy.mockClear();
    const tree = renderRoute(true);
    expect(findHostByTestId(tree, 'social-evolution-screen')).toBeTruthy();
  });

  it('does not invoke router.push or router.replace on mount (either branch)', () => {
    // Foundation invariant — no auto-navigation, no side-effecting
    // push/replace at render time. Navigation is user-initiated only.
    pushSpy.mockClear();
    replaceSpy.mockClear();
    renderRoute(false);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();

    pushSpy.mockClear();
    replaceSpy.mockClear();
    renderRoute(true);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});

describe('social-evolution route file — shared=false navigation contract', () => {
  it('share-again CTA fires router.push to /(funnel)/referral-gate', () => {
    // The Seed pins: "router.push used at: ... social_evolution
    // shared=false → referral_gate". Tapping the "친구에게 공유하기" CTA
    // on the shared=false branch must invoke `router.push` (not replace)
    // with the canonical kebab path back to step 10.
    pushSpy.mockClear();
    replaceSpy.mockClear();
    const tree = renderRoute(false);
    const shareAgain = findHostByTestId(
      tree,
      'social-evolution-shared-false-share-again',
    );
    expect(shareAgain).toBeTruthy();
    const onPress = shareAgain?.props.onPress as ((e: unknown) => void) | undefined;
    expect(typeof onPress).toBe('function');
    act(() => {
      (onPress as (e: unknown) => void)({});
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith('/(funnel)/referral-gate');
    // Replace must remain untouched — push semantics preserve back-swipe
    // history per the Seed contract.
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('skip CTA fires router.push to /(funnel)/payment-model (soft-gate forward path)', () => {
    // The soft-gate invariant requires a forward path even when the user
    // did not share. Tapping the "나중에 할게요" CTA must `router.push`
    // forward to payment_model (step 12) — push (not replace) so the
    // back-swipe path back to social_evolution remains intact.
    pushSpy.mockClear();
    replaceSpy.mockClear();
    const tree = renderRoute(false);
    const skip = findHostByTestId(tree, 'social-evolution-shared-false-skip');
    expect(skip).toBeTruthy();
    const onPress = skip?.props.onPress as (() => void) | undefined;
    expect(typeof onPress).toBe('function');
    act(() => {
      (onPress as () => void)();
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith('/(funnel)/payment-model');
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
