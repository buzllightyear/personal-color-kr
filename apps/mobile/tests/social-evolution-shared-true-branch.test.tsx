/**
 * Unit tests — `SocialEvolutionSharedTrueBranch` presentational component
 * (Phase 2.4, AC 4).
 *
 * Coverage (Seed constraint: "Each new screen requires minimum 2 tests —
 * snapshot + state transition or interaction"):
 *
 *   1. Render assertion — every documented section of the shared=true
 *      branch is present in the rendered tree:
 *        - The root layout host is the shared `FunnelScreenLayout` testID
 *          (`social-evolution-shared-true-screen`).
 *        - The canonical headline + subhead group from
 *          `FUNNEL_SCREENS.social_evolution` is mounted under the
 *          `social-evolution-headline-group` testID.
 *        - The share-confirmation row is present with the documented
 *          Korean copy `공유해주셔서 감사합니다!`.
 *        - The empty-state row is present with both the emoji
 *          (`👥`) and the documented Korean copy
 *          `아직 친구가 참여하지 않았어요`.
 *        - The skip CTA host is present and carries the documented
 *          `다음으로` label.
 *
 *   2. Interaction assertion — pressing the skip CTA invokes the
 *      `onContinue` callback exactly once. This pins the soft-gate
 *      navigation contract: the only way past the shared=true branch is
 *      the single `다음으로` press, and the press is forwarded verbatim to
 *      the parent route handler (which wires `router.push` to
 *      `payment-model` per the Seed navigation contract — verified at the
 *      route layer in a separate test).
 *
 * Why two `describe` blocks (render / interaction):
 *   Mirrors `tests/onboarding-priming-screen.test.tsx` — the codebase
 *   already separates render-shape assertions from interaction assertions
 *   so a failing interaction test does not need to re-run the entire
 *   render-shape suite to triage. Each describe block sets up its own
 *   `vi.fn()` fixtures so cross-test state cannot leak.
 *
 * Mocking strategy:
 *   - `react-native`: minimal host-component stubs (View / Text /
 *     Pressable / StyleSheet / Platform) so `react-test-renderer` can
 *     mount the tree without hitting the real `react-native/index.js`
 *     entry (which ships with Flow `import typeof` syntax Node can't parse
 *     natively, even with the setup-rn-stub in place — the per-test mock
 *     keeps the surface trimmed to what the component actually consumes).
 *   - `react-native-safe-area-context`: tiny `SafeAreaView` stub matching
 *     the surface `FunnelScreenLayout` consumes.
 *   - No `expo-router` mock needed — the component itself does not import
 *     expo-router. Navigation lives at the route layer; this component is
 *     a pure callback receiver.
 *   - No `posthog-react-native` mock needed — the component does not
 *     import a PostHog client (auto-capture handles screen views at the
 *     root layout per Phase 2.4 placeholder pattern).
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// react-native mock — host stubs only.
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

// Import the component AFTER the mocks have been registered so the
// component's `import { ... } from 'react-native'` resolves to the
// mocked surface above.
import {
  buildFriendUsedCountText,
  SOCIAL_EVOLUTION_EMPTY_FRIEND_LIST_TEXT,
  SOCIAL_EVOLUTION_SHARE_CONFIRMATION_TEXT,
  SocialEvolutionSharedTrueBranch,
} from '../src/screens/funnel/SocialEvolutionSharedTrueBranch';
import { SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL } from '../src/funnel/social-evolution-ctas';

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

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(element);
  });
  if (!tree) throw new Error('render: tree not created');
  return tree;
}

/**
 * Recursively collect every plain-string child of a node into a single
 * flattened string. Used to assert that a `<Text>` host element renders
 * specific Korean copy — `react-test-renderer` represents children as a
 * mixed array of strings and child instances, so we cannot just inspect
 * `props.children` directly.
 */
function collectText(node: TestInstance | null): string {
  if (node === null) return '';
  const children = node.children;
  let out = '';
  for (const child of children) {
    if (typeof child === 'string') {
      out += child;
    } else if (child && typeof child === 'object') {
      out += collectText(child);
    }
  }
  return out;
}

const NO_OP = (): void => undefined;

describe('SocialEvolutionSharedTrueBranch — render (AC 4)', () => {
  it('renders the root layout, headline group, confirmation, empty-state and CTA hosts', () => {
    // Pure render-shape assertion: the component is a pure props-in,
    // callbacks-out branch, so every documented surface is reachable from
    // a single render call with a no-op callback. We pin the testID
    // surface (not the React node identity) because the testIDs are the
    // stable contract that downstream integration tests (route wrapper +
    // E2E in Phase 2.5+) will query against.
    const tree = render(
      React.createElement(SocialEvolutionSharedTrueBranch, {
        onContinue: NO_OP,
      }),
    );

    // Root layout — `FunnelScreenLayout` mounts a SafeAreaView with the
    // testID passed by the branch. The presence of this host proves the
    // shared frame is in place (and therefore the safe-area / padding /
    // background tokens land via the shared layout, not duplicated here).
    expect(findHostByTestId(tree, 'social-evolution-shared-true-screen')).toBeTruthy();

    // FunnelHeadline mounts a group container with the testIDPrefix.
    // Querying the group (not just the headline/subhead leaves) verifies
    // the canonical headline+subhead pair from
    // `FUNNEL_SCREENS.social_evolution` reached the rendered tree.
    expect(findHostByTestId(tree, 'social-evolution-headline-group')).toBeTruthy();

    // Share confirmation row — the host exists AND carries the documented
    // Korean copy. Both the host presence and the copy assertion live in
    // one test (vs. two separate `it` blocks) because they describe a
    // single coherent contract: "this row is present and reads as the
    // documented thank-you message".
    const confirmation = findHostByTestId(tree, 'social-evolution-share-confirmation');
    expect(confirmation).toBeTruthy();
    expect(collectText(confirmation)).toContain(
      SOCIAL_EVOLUTION_SHARE_CONFIRMATION_TEXT,
    );

    // Empty-state container — the wrapping `<View>` host exists.
    expect(findHostByTestId(tree, 'social-evolution-empty-friend-list')).toBeTruthy();

    // Empty-state illustration is now a react-native-svg line icon (the
    // former 👥 emoji was removed per the editorial direction). Assert the
    // decorative icon container is still present under its testID.
    const emoji = findHostByTestId(tree, 'social-evolution-empty-friend-list-emoji');
    expect(emoji).toBeTruthy();

    // Empty-state Korean copy — pinned against the documented constant so
    // a copy tweak in the component file fails this test loud rather
    // than silently shipping a regression.
    const emptyText = findHostByTestId(tree, 'social-evolution-empty-friend-list-text');
    expect(emptyText).toBeTruthy();
    expect(collectText(emptyText)).toBe(SOCIAL_EVOLUTION_EMPTY_FRIEND_LIST_TEXT);

    // Skip CTA host — Present and labelled with the documented
    // `SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL` ("다음으로"). We assert the
    // label by inspecting the rendered text under the CTA host so the
    // test catches both a missing label and an accidentally swapped one
    // (e.g. someone wires the shared=false back-to-share label by
    // mistake).
    const cta = findHostByTestId(tree, 'social-evolution-shared-true-skip-cta');
    expect(cta).toBeTruthy();
    expect(collectText(cta)).toContain(SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL);
  });
});

describe('SocialEvolutionSharedTrueBranch — interaction (AC 4)', () => {
  it('invokes onContinue exactly once when the skip CTA fires', () => {
    // The skip CTA is the only progression affordance on the shared=true
    // branch (per Seed constraint: "All 3 screens are soft gates with
    // skip options — no hard gating blocks progression"). We pin that
    // contract by asserting:
    //   - The CTA host is reachable (already covered above, but we re-
    //     read it here so the interaction test is self-contained — a
    //     failure here points at the interaction wiring, not render
    //     shape).
    //   - The CTA's `onPress` fires the supplied callback exactly once
    //     per press. The `expect(...toHaveBeenCalledTimes(1))` guard
    //     catches both a missing wire-up (0 calls) and an accidental
    //     double-invocation (2+ calls — e.g. if a future change attaches
    //     onPress to both the inner Text and the outer Pressable).
    const onContinue = vi.fn();
    const tree = render(
      React.createElement(SocialEvolutionSharedTrueBranch, {
        onContinue,
      }),
    );

    const cta = findHostByTestId(tree, 'social-evolution-shared-true-skip-cta');
    expect(cta).toBeTruthy();

    // `FunnelPrimaryButton` wraps the press handler in its own
    // `useCallback`; the rendered Pressable's `onPress` is that wrapped
    // function. Calling it inside `act(...)` simulates a single tap.
    const onPress = cta?.props.onPress as (e: unknown) => void;
    expect(typeof onPress).toBe('function');
    act(() => onPress({}));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('SocialEvolutionSharedTrueBranch — friend_used_count display (Phase 4.5)', () => {
  it('renders the empty state when friendUsedCount is omitted', () => {
    // Backward-compat: the Phase 2.4 call shape (onContinue only) leaves the
    // count undefined → the original empty state renders, and the friend-
    // count host is absent.
    const tree = render(
      React.createElement(SocialEvolutionSharedTrueBranch, {
        onContinue: NO_OP,
      }),
    );
    expect(findHostByTestId(tree, 'social-evolution-empty-friend-list')).toBeTruthy();
    expect(findHostByTestId(tree, 'social-evolution-friend-used-count')).toBeNull();
  });

  it('renders the empty state when friendUsedCount is null (loading / silent-degraded)', () => {
    // A `null` count is the loading / fetch-failed state — the route passes
    // `null` until `GET /v1/referrals/me` resolves (and keeps it `null` on a
    // swallowed failure). The empty state must render so the soft gate never
    // breaks.
    const tree = render(
      React.createElement(SocialEvolutionSharedTrueBranch, {
        onContinue: NO_OP,
        friendUsedCount: null,
      }),
    );
    expect(findHostByTestId(tree, 'social-evolution-empty-friend-list')).toBeTruthy();
    expect(findHostByTestId(tree, 'social-evolution-friend-used-count')).toBeNull();
  });

  it('renders the empty state when friendUsedCount is 0 (no attributed referees yet)', () => {
    // Zero attributed referees is still the empty state — the celebratory
    // count surface only appears once at least one friend has joined.
    const tree = render(
      React.createElement(SocialEvolutionSharedTrueBranch, {
        onContinue: NO_OP,
        friendUsedCount: 0,
      }),
    );
    expect(findHostByTestId(tree, 'social-evolution-empty-friend-list')).toBeTruthy();
    expect(findHostByTestId(tree, 'social-evolution-friend-used-count')).toBeNull();
  });

  it('renders the real friend_used_count when positive', () => {
    // The core AC: a positive `friend_used_count` from the server renders the
    // live count copy (`친구 N명이 참여했어요`) and hides the empty state.
    const tree = render(
      React.createElement(SocialEvolutionSharedTrueBranch, {
        onContinue: NO_OP,
        friendUsedCount: 3,
      }),
    );

    // The empty-state host is gone — the count surface replaced it.
    expect(findHostByTestId(tree, 'social-evolution-empty-friend-list')).toBeNull();

    // The friend-count container + the count text render the real number,
    // pinned against the builder so a copy/format change fails loud.
    const countHost = findHostByTestId(tree, 'social-evolution-friend-used-count');
    expect(countHost).toBeTruthy();
    const countText = findHostByTestId(tree, 'social-evolution-friend-used-count-text');
    expect(countText).toBeTruthy();
    expect(collectText(countText)).toBe(buildFriendUsedCountText(3));
    // The rendered copy embeds the literal server count.
    expect(collectText(countText)).toContain('3');

    // The decorative emoji is still present in the count state.
    expect(
      findHostByTestId(tree, 'social-evolution-friend-used-count-emoji'),
    ).toBeTruthy();
  });

  it('still renders the skip CTA in the friend-count state', () => {
    // The soft-gate forward affordance must remain on the count branch too —
    // a user with friends can still proceed to payment_model.
    const tree = render(
      React.createElement(SocialEvolutionSharedTrueBranch, {
        onContinue: NO_OP,
        friendUsedCount: 5,
      }),
    );
    expect(
      findHostByTestId(tree, 'social-evolution-shared-true-skip-cta'),
    ).toBeTruthy();
  });
});

describe('buildFriendUsedCountText (Phase 4.5)', () => {
  it('interpolates the count into the Korean copy', () => {
    expect(buildFriendUsedCountText(1)).toBe('친구 1명이 참여했어요');
    expect(buildFriendUsedCountText(42)).toBe('친구 42명이 참여했어요');
  });
});
