/**
 * Smoke test — `app/(funnel)/result-reveal.tsx` route wrapper.
 *
 * Verifies the thin expo-router route file:
 *   1. Mounts the presentational `ResultRevealScreen` underneath it.
 *   2. Derives `isPreviewMode` from the `share_token` route param —
 *      `share_token` present → preview mode true → no unlock CTA.
 *      `share_token` absent → preview mode false → unlock CTA visible
 *      and `router.push('/(funnel)/referral-gate')` fires on tap.
 *
 * The screen component itself is covered exhaustively by
 * `result-reveal-screen.test.tsx`; this file pins the *wiring* contract
 * (route → screen → router.push) and the Phase 2.1 isPreviewMode invariant
 * preserved by the Phase 2.3 route file rewrite.
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

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('SafeAreaView', props, props.children),
}));

const mockPush = vi.fn();
const mockSearchParams: { current: Record<string, unknown> } = { current: {} };

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useLocalSearchParams: () => mockSearchParams.current,
}));

import ResultRevealRoute from '../app/(funnel)/result-reveal';

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

function findHostByTestId(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestInstance | null {
  const matches = tree.root.findAll(
    (node) =>
      typeof node.type === 'string' && node.props?.testID === testID,
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

describe('result-reveal route wrapper', () => {
  it('mounts ResultRevealScreen with isPreviewMode=false when no share_token param', () => {
    mockSearchParams.current = {};
    mockPush.mockClear();
    const tree = render(React.createElement(ResultRevealRoute));
    // CTA is rendered (not preview mode)
    expect(findHostByTestId(tree, 'result-reveal-unlock-cta')).toBeTruthy();
  });

  it('mounts ResultRevealScreen with isPreviewMode=true when share_token param present', () => {
    mockSearchParams.current = { share_token: 'abc-123' };
    mockPush.mockClear();
    const tree = render(React.createElement(ResultRevealRoute));
    // CTA must NOT be rendered in preview mode (Phase 2.1 isPreviewMode invariant)
    expect(findHostByTestId(tree, 'result-reveal-unlock-cta')).toBeNull();
  });

  it('navigates to /(funnel)/referral-gate when unlock CTA is pressed', () => {
    mockSearchParams.current = {};
    mockPush.mockClear();
    const tree = render(React.createElement(ResultRevealRoute));
    const cta = findHostByTestId(tree, 'result-reveal-unlock-cta');
    expect(cta).toBeTruthy();
    const onPress = cta?.props.onPress as (e: unknown) => void;
    act(() => onPress({}));
    expect(mockPush).toHaveBeenCalledWith('/(funnel)/referral-gate');
  });

  it('does NOT fire router.push when in preview mode (no CTA rendered)', () => {
    mockSearchParams.current = { share_token: 'abc-123' };
    mockPush.mockClear();
    render(React.createElement(ResultRevealRoute));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
