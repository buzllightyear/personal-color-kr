/**
 * Smoke test — `app/(funnel)/scan-option-select.tsx` route wrapper (Sub-AC 2.1).
 *
 * Verifies the thin expo-router route file:
 *   1. Mounts the presentational `ScanOptionSelectScreen` underneath it
 *      (the route is a *wrapper*, not a re-implementation — the entire visual
 *      decision tree lives in the screen file).
 *   2. Wires the `useRouter().push(...)` handler into the screen's
 *      `onSelectPersonalColor` callback so the only enabled scan option
 *      advances the funnel to step 7 (`/(funnel)/diagnosis-input`).
 *
 * The screen component itself is covered exhaustively by
 * `scan-option-select-screen.test.tsx`; this file pins the *wiring*
 * contract (route -> screen -> router.push) without re-asserting the
 * intra-screen rendering details.
 *
 * Mocking strategy mirrors `scan-option-select-screen.test.tsx`:
 *   - `react-native`: minimal host-component set so Vite's ESM resolver
 *     does not land on the real RN entry (Flow `import typeof` parse fail).
 *   - `react-native-safe-area-context`: tiny `SafeAreaView` stub matching
 *     the surface the layout consumes.
 *   - `expo-router`: `useRouter` returns a stub object whose `push` is a
 *     `vi.fn`, so the test can assert the route wrapper calls it with the
 *     correct kebab path for step 7.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

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

// Module-scope router push spy — the mocked `useRouter` closes over this so
// individual tests can introspect call count and arguments after rendering.
const pushSpy = vi.fn();

vi.mock('expo-router', () => {
  return {
    useRouter: (): { push: (path: string) => void } => ({ push: pushSpy }),
  };
});

// Import the default export AFTER the mocks have been registered so the
// route module's `import { useRouter } from 'expo-router'` resolves to the
// mocked surface above.
import ScanOptionSelectRoute from '../app/(funnel)/scan-option-select';

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
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

describe('scan-option-select route wrapper — mount smoke (Sub-AC 2.1)', () => {
  it('mounts the ScanOptionSelectScreen presentational component', () => {
    pushSpy.mockClear();
    const tree = render(React.createElement(ScanOptionSelectRoute));
    // The screen overrides the FunnelScreenLayout testID to
    // `scan-option-select-screen` — its presence under the route wrapper
    // proves the wrapper delegated to the correct component.
    expect(findHostByTestId(tree, 'scan-option-select-screen')).toBeTruthy();
  });

  it('renders the primary scan option card sourced from the screen component', () => {
    pushSpy.mockClear();
    const tree = render(React.createElement(ScanOptionSelectRoute));
    expect(
      findHostByTestId(tree, 'scan-option-select-option-personal-color'),
    ).toBeTruthy();
  });

  it('forwards useRouter().push to onSelectPersonalColor (advances to /(funnel)/diagnosis-input)', () => {
    pushSpy.mockClear();
    const tree = render(React.createElement(ScanOptionSelectRoute));
    const primary = findHostByTestId(tree, 'scan-option-select-option-personal-color');
    expect(primary).toBeTruthy();
    const onPress = primary?.props.onPress as (() => void) | undefined;
    expect(typeof onPress).toBe('function');
    act(() => {
      (onPress as () => void)();
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith('/(funnel)/diagnosis-input');
  });
});
