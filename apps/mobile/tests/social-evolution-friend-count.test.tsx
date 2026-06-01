/**
 * Integration test — `app/(funnel)/social-evolution.tsx` friend-count wiring
 * (Phase 4.5).
 *
 * What this test asserts:
 *   1. On the shared=true branch the route fetches `friend_used_count` from
 *      `GET /v1/referrals/me` (via the mocked `fetch-referral-me` seam) and
 *      passes it down so `SocialEvolutionSharedTrueBranch` renders the real
 *      count copy (`친구 N명이 참여했어요`).
 *   2. The route does NOT fetch on the shared=false branch (the empty/upsell
 *      branch shows no count).
 *   3. A fetch failure degrades silently — the count host never appears, the
 *      empty state remains, and the render does not throw (soft gate).
 *
 * Mocking strategy:
 *   - `react-native` / `react-native-safe-area-context` / `expo-router`:
 *     same host/route stubs as `social-evolution-route.test.tsx`.
 *   - `../src/fetch-referral-me`: the network seam is mocked so the test
 *     controls the resolved `friendUsedCount` (or a rejection) without a live
 *     HTTP client. `createReferralMeTransport` returns an opaque stub the
 *     route only forwards to `fetchReferralMe`, which is the real assertion
 *     surface.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    SafeAreaView: (props: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('SafeAreaView', props, props.children),
  };
});

vi.mock('expo-router', () => {
  return {
    useRouter: (): {
      push: (path: string) => void;
      replace: (path: string) => void;
    } => ({
      push: vi.fn(),
      replace: vi.fn(),
    }),
    useLocalSearchParams: (): Readonly<Record<string, unknown>> => ({}),
  };
});

// The network seam — the route forwards the opaque transport to
// `fetchReferralMe`, so we only need `fetchReferralMe` to resolve/reject.
const fetchReferralMeMock = vi.fn();
vi.mock('../src/fetch-referral-me', () => {
  return {
    createReferralMeTransport: (): (() => Promise<unknown>) => async () => ({}),
    fetchReferralMe: (
      ...args: readonly unknown[]
    ): Promise<unknown> => fetchReferralMeMock(...args),
  };
});

import SocialEvolutionRoute from '../app/(funnel)/social-evolution';
import { FunnelStateProvider } from '../src/providers/FunnelStateProvider';
import { buildFriendUsedCountText } from '../src/screens/funnel/SocialEvolutionSharedTrueBranch';

interface TestInstance {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: ReadonlyArray<TestInstance | string>;
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

function collectText(node: TestInstance | null): string {
  if (node === null) return '';
  let out = '';
  for (const child of node.children) {
    if (typeof child === 'string') {
      out += child;
    } else if (child && typeof child === 'object') {
      out += collectText(child);
    }
  }
  return out;
}

async function renderRoute(
  initialShared: boolean,
): Promise<TestRenderer.ReactTestRenderer> {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      React.createElement(
        FunnelStateProvider,
        { initialReferral: { shared: initialShared } },
        React.createElement(SocialEvolutionRoute),
      ),
    );
    // Flush the effect's microtask chain so the fetched count is committed.
    await Promise.resolve();
    await Promise.resolve();
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

afterEach(() => {
  fetchReferralMeMock.mockReset();
});

describe('social-evolution friend-count wiring (Phase 4.5)', () => {
  it('renders the real friend_used_count on the shared=true branch', async () => {
    fetchReferralMeMock.mockResolvedValue({
      referralCode: 'abc12345',
      shareUrl: 'https://pcolor.example/r/abc12345',
      friendUsedCount: 7,
    });

    const tree = await renderRoute(true);

    expect(fetchReferralMeMock).toHaveBeenCalledTimes(1);
    const countText = findHostByTestId(
      tree,
      'social-evolution-friend-used-count-text',
    );
    expect(countText).toBeTruthy();
    expect(collectText(countText)).toBe(buildFriendUsedCountText(7));
    expect(
      findHostByTestId(tree, 'social-evolution-empty-friend-list'),
    ).toBeNull();
  });

  it('does not fetch on the shared=false branch', async () => {
    fetchReferralMeMock.mockResolvedValue({
      referralCode: 'abc12345',
      shareUrl: 'https://pcolor.example/r/abc12345',
      friendUsedCount: 7,
    });

    await renderRoute(false);

    expect(fetchReferralMeMock).not.toHaveBeenCalled();
  });

  it('degrades silently to the empty state when the fetch rejects', async () => {
    fetchReferralMeMock.mockRejectedValue(new Error('network down'));

    let tree: TestRenderer.ReactTestRenderer | undefined;
    await expect(
      (async () => {
        tree = await renderRoute(true);
      })(),
    ).resolves.toBeUndefined();

    expect(fetchReferralMeMock).toHaveBeenCalledTimes(1);
    expect(tree).toBeDefined();
    // No count host — the empty state remains so the soft gate never breaks.
    expect(
      findHostByTestId(tree!, 'social-evolution-friend-used-count'),
    ).toBeNull();
    expect(
      findHostByTestId(tree!, 'social-evolution-empty-friend-list'),
    ).toBeTruthy();
  });
});
