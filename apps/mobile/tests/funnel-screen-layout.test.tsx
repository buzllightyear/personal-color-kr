/**
 * Unit test — `apps/mobile/src/funnel/FunnelScreenLayout.tsx` (AC 8).
 *
 * Pins the contract for the shared frame component that wraps every funnel
 * screen. The layout is intentionally a thin component (SafeAreaView + a
 * single padded inner View) so the tests focus on:
 *
 *   1. **Renders children** — anything passed via `children` shows up in the
 *      rendered tree under the layout root.
 *   2. **Default `testID`** — when no `testID` prop is provided, the root
 *      uses the documented `'funnel-screen-layout'` literal.
 *   3. **Override `testID`** — a screen-supplied `testID` (e.g.
 *      `'welcome-hook-screen'`) is applied to the root node.
 *   4. **`accessibilityLabel` passthrough** — Korean accessibility labels
 *      reach the SafeAreaView root unchanged.
 *   5. **`accessibilityLabel` omitted by default** — when the prop is not
 *      supplied, the rendered root does NOT carry an `accessibilityLabel`
 *      attribute (we don't want a stray empty label competing with inner
 *      element labels for screen-reader focus).
 *   6. **Background token applied** — the safe-area surface style includes
 *      the canonical `COLORS.grayscale.background` (`#FFFFFF`) value, so a
 *      future palette refactor cannot silently drift the layout background.
 *   7. **Edge padding tokens applied** — the inner content view uses
 *      `SPACING.lg` (horizontal) and `SPACING.xl` (vertical) — both exact
 *      values pulled from the design tokens, so the layout cannot drift
 *      from the broader spacing scale.
 *   8. **Both safe-area + content are flex-1** — the layout fills its parent
 *      vertically so a child centred via flex still occupies the whole
 *      screen height (the welcome_hook hero centring relies on this).
 *
 * Testing approach:
 *   We follow the same react-test-renderer + `vi.mock('react-native')`
 *   pattern documented in `funnel-placeholder-smoke.test.tsx`,
 *   `use-auto-advance-timer.test.tsx`, and `funnel-state-context.test.tsx`.
 *   The `react-native-safe-area-context` import is mocked separately because
 *   its real entry pulls in native module bridges that Node cannot
 *   resolve — the mock exposes a `SafeAreaView` that renders a host node
 *   matching the SafeAreaView's prop shape so the assertions can inspect
 *   the rendered tree directly.
 */
import * as React from 'react';
import TestRenderer from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Mock `react-native` ESM entry to a minimal host-component set. Vite's SSR
// transform resolves the layout's `react-native` import through the ESM path
// even though the CJS require.cache stub from `setup-rn-stub.ts` covers the
// CommonJS surface. Mocking here keeps both resolution paths happy.
vi.mock('react-native', async () => {
  const reactActual: typeof React = await vi.importActual('react');
  const makeHost = (label: string) => (props: Record<string, unknown>) =>
    reactActual.createElement(label, props, (props as { children?: unknown }).children);
  return {
    View: makeHost('View'),
    Text: makeHost('Text'),
    Pressable: makeHost('Pressable'),
    TextInput: makeHost('TextInput'),
    Image: makeHost('Image'),
    Switch: makeHost('Switch'),
    ScrollView: makeHost('ScrollView'),
    Modal: makeHost('Modal'),
    ActivityIndicator: makeHost('ActivityIndicator'),
    StyleSheet: {
      create: (s: Record<string, unknown>): Record<string, unknown> => s,
      flatten: (s: unknown): unknown => s,
    },
    Platform: {
      OS: 'ios',
      select: (m: { ios?: unknown; android?: unknown; default?: unknown }) =>
        m.ios ?? m.default,
    },
  };
});

// Mock `react-native-safe-area-context` so the layout's `SafeAreaView` import
// resolves to a host component the react-test-renderer can walk. The real
// package's entry points reach into a native bridge (TurboModules), which Node
// cannot resolve in the vitest environment.
vi.mock('react-native-safe-area-context', async () => {
  const reactActual: typeof React = await vi.importActual('react');
  const SafeAreaView = (props: Record<string, unknown>) =>
    reactActual.createElement(
      'SafeAreaView',
      props,
      (props as { children?: unknown }).children,
    );
  const SafeAreaProvider = (props: Record<string, unknown>) =>
    reactActual.createElement(
      'SafeAreaProvider',
      props,
      (props as { children?: unknown }).children,
    );
  return {
    SafeAreaView,
    SafeAreaProvider,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

import { COLORS, SPACING } from '../src/theme';
import {
  FUNNEL_SCREEN_LAYOUT_TEST_ID,
  FunnelScreenLayout,
} from '../src/funnel/FunnelScreenLayout';

// ---------------------------------------------------------------------------
// Tiny react-test-renderer query helpers (same shape as the sibling tests).
// We deliberately avoid @testing-library/react-native because its
// accessibility helpers require a fuller `StyleSheet.flatten` surface than
// our minimal mock provides.
// ---------------------------------------------------------------------------

interface TestInstance {
  readonly type: string | React.ComponentType<unknown>;
  readonly props: Record<string, unknown>;
}

function findByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance | null {
  const matches = tree.root.findAll((node) => node.props?.testID === testID);
  return (matches[0] as unknown as TestInstance) ?? null;
}

function getByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance {
  const match = findByTestId(tree, testID);
  if (!match) throw new Error(`getByTestId('${testID}'): no match`);
  return match;
}

/**
 * Flatten the layered style array a component may have received. Our
 * StyleSheet mock returns the literal object passed to `StyleSheet.create`,
 * so a single style prop is already the merged object; this helper just
 * normalises the array vs. object shape.
 */
function flattenStyle(styleProp: unknown): Readonly<Record<string, unknown>> {
  if (!styleProp) return {};
  if (Array.isArray(styleProp)) {
    return styleProp.reduce<Record<string, unknown>>(
      (acc, layer) => ({ ...acc, ...(layer as Record<string, unknown>) }),
      {},
    );
  }
  return styleProp as Readonly<Record<string, unknown>>;
}

describe('FunnelScreenLayout — shared frame contract (AC 8)', () => {
  it('renders its children inside the layout root', () => {
    const tree = TestRenderer.create(
      React.createElement(
        FunnelScreenLayout,
        null,
        React.createElement('Text', { testID: 'inner-child' }, 'Hello 안녕하세요'),
      ),
    );
    const child = getByTestId(tree, 'inner-child');
    expect(child.props.children).toBe('Hello 안녕하세요');
  });

  it('applies the documented default testID when none is supplied', () => {
    const tree = TestRenderer.create(
      React.createElement(
        FunnelScreenLayout,
        null,
        React.createElement('Text', null, 'body'),
      ),
    );
    const root = findByTestId(tree, FUNNEL_SCREEN_LAYOUT_TEST_ID);
    expect(root).not.toBeNull();
    // The default constant must equal the documented literal so consumers
    // can rely on it without re-stringing the value.
    expect(FUNNEL_SCREEN_LAYOUT_TEST_ID).toBe('funnel-screen-layout');
  });

  it('overrides the testID when a screen-supplied value is passed', () => {
    const tree = TestRenderer.create(
      React.createElement(
        FunnelScreenLayout,
        { testID: 'welcome-hook-screen' },
        React.createElement('Text', null, 'body'),
      ),
    );
    expect(findByTestId(tree, 'welcome-hook-screen')).not.toBeNull();
    // The default testID must NOT also be present — the override replaces it.
    expect(findByTestId(tree, FUNNEL_SCREEN_LAYOUT_TEST_ID)).toBeNull();
  });

  it('passes a Korean accessibilityLabel through to the root', () => {
    const tree = TestRenderer.create(
      React.createElement(
        FunnelScreenLayout,
        { accessibilityLabel: '환영합니다' },
        React.createElement('Text', null, 'body'),
      ),
    );
    const root = getByTestId(tree, FUNNEL_SCREEN_LAYOUT_TEST_ID);
    expect(root.props.accessibilityLabel).toBe('환영합니다');
  });

  it('omits accessibilityLabel from the root when the prop is not provided', () => {
    const tree = TestRenderer.create(
      React.createElement(
        FunnelScreenLayout,
        null,
        React.createElement('Text', null, 'body'),
      ),
    );
    const root = getByTestId(tree, FUNNEL_SCREEN_LAYOUT_TEST_ID);
    // The layout must NOT default `accessibilityLabel` to an empty string —
    // that would create a stray empty focus target for screen readers.
    expect(root.props.accessibilityLabel).toBeUndefined();
  });

  it('paints the SafeAreaView surface with COLORS.grayscale.background', () => {
    const tree = TestRenderer.create(
      React.createElement(
        FunnelScreenLayout,
        null,
        React.createElement('Text', null, 'body'),
      ),
    );
    const root = getByTestId(tree, FUNNEL_SCREEN_LAYOUT_TEST_ID);
    const style = flattenStyle(root.props.style);
    expect(style.backgroundColor).toBe(COLORS.grayscale.background);
    // Defense-in-depth: the canonical token must equal the literal #FFFFFF.
    expect(style.backgroundColor).toBe('#FFFFFF');
  });

  it('applies SPACING.lg horizontal and SPACING.xl vertical padding to the content layer', () => {
    const tree = TestRenderer.create(
      React.createElement(
        FunnelScreenLayout,
        null,
        React.createElement('Text', null, 'body'),
      ),
    );
    const content = getByTestId(tree, `${FUNNEL_SCREEN_LAYOUT_TEST_ID}-content`);
    const style = flattenStyle(content.props.style);
    expect(style.paddingHorizontal).toBe(SPACING.lg);
    expect(style.paddingVertical).toBe(SPACING.xl);
    // Defense-in-depth: the token values must match the project's documented
    // pixel scale (24 / 32).
    expect(style.paddingHorizontal).toBe(24);
    expect(style.paddingVertical).toBe(32);
  });

  it('marks both safe-area and content layers as flex-1 fill', () => {
    const tree = TestRenderer.create(
      React.createElement(
        FunnelScreenLayout,
        null,
        React.createElement('Text', null, 'body'),
      ),
    );
    const root = getByTestId(tree, FUNNEL_SCREEN_LAYOUT_TEST_ID);
    const content = getByTestId(tree, `${FUNNEL_SCREEN_LAYOUT_TEST_ID}-content`);
    expect(flattenStyle(root.props.style).flex).toBe(1);
    expect(flattenStyle(content.props.style).flex).toBe(1);
  });

  it('also renames the inner content testID when the outer testID is overridden', () => {
    const tree = TestRenderer.create(
      React.createElement(
        FunnelScreenLayout,
        { testID: 'value-props-screen' },
        React.createElement('Text', null, 'body'),
      ),
    );
    expect(findByTestId(tree, 'value-props-screen-content')).not.toBeNull();
    // The default inner content testID must NOT be present when the outer is
    // overridden — they are derived from the same prop.
    expect(findByTestId(tree, `${FUNNEL_SCREEN_LAYOUT_TEST_ID}-content`)).toBeNull();
  });
});
