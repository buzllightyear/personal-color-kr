/**
 * Unit test — `ReferralGateScreen` presentational component
 * (Sub-AC 1.1 + Sub-AC 1.2 + Sub-AC 1.3).
 *
 * Coverage focus for Sub-AC 1.1 (Kakao share CTA):
 *   1. The Kakao share CTA element is mounted under a stable testID
 *      (`referral-gate-kakao-share`). Subsequent sub-ACs that introduce
 *      copy-link / skip controls can rely on this anchor being a
 *      sibling of theirs.
 *   2. The CTA renders the Korean label "카카오톡으로 공유" pulled from
 *      `REFERRAL_GATE_SHARE_CTA_LABELS.kakao` — the screen never embeds
 *      a literal, and the test pins what reaches the rendered button.
 *   3. Pressing the CTA invokes the `onShareKakao` callback exactly
 *      once. Sub-AC 1.1 explicitly requires "CTA is present and triggers
 *      its handler".
 *
 * Coverage focus for Sub-AC 1.2 (copy-link CTA):
 *   4. The copy-link CTA element is mounted under a stable testID
 *      (`referral-gate-copy-link`) — sibling of the Kakao share CTA in
 *      the rendered tree, never re-using the same anchor.
 *   5. The CTA renders the Korean label "링크 복사" pulled from
 *      `REFERRAL_GATE_SHARE_CTA_LABELS.copy_link` — same no-literal
 *      discipline as the Kakao label.
 *   6. Pressing the CTA invokes the `onCopyLink` callback exactly once
 *      and leaves `onShareKakao` untouched (the two handlers stay
 *      independent — pressing one must not accidentally double-bind to
 *      the other). Sub-AC 1.2 explicitly requires "CTA is present and
 *      triggers its handler".
 *
 * Coverage focus for Sub-AC 1.3 (skip CTA):
 *   7. The skip CTA element is mounted under a stable testID
 *      (`referral-gate-skip`) — sibling of both share CTAs in the
 *      rendered tree, never re-using either share anchor. Asserting
 *      all three nodes resolve independently catches an accidental
 *      copy/paste regression where the new control shadows an
 *      existing one.
 *   8. The CTA renders the Korean label "나중에 할게요" pulled from
 *      `REFERRAL_GATE_SKIP_CTA_LABEL` — same no-literal discipline as
 *      the share labels. Per the Seed constraint, every soft-gate
 *      skip control reads with the consistent "나중에 할게요" phrasing.
 *   9. Pressing the CTA invokes the `onSkip` callback exactly once
 *      and leaves both `onShareKakao` and `onCopyLink` untouched. The
 *      three handlers stay independent — pressing one must not
 *      accidentally double-bind to either of the others. Sub-AC 1.3
 *      explicitly requires "skip control is present and triggers its
 *      handler".
 *
 * Mocking strategy mirrors `welcome-hook-screen.test.tsx` /
 * `rating-gate-screen.test.tsx`:
 *   - `react-native` is stubbed to host primitives so vitest's Node
 *     resolver does not land on the real RN entry (which ships Flow
 *     `import typeof` syntax Node cannot parse).
 *   - `react-native-safe-area-context` is stubbed with a tiny
 *     SafeAreaView shim matching the surface
 *     `FunnelScreenLayout` consumes.
 *   - No `expo-router` mock is needed — this is a presentational
 *     component test (no `useRouter`, no `useLocalSearchParams`), the
 *     route wiring is exercised by `referral-gate-route.test.tsx`.
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

import {
  REFERRAL_GATE_COPY_LINK_TEST_ID,
  REFERRAL_GATE_KAKAO_SHARE_TEST_ID,
  REFERRAL_GATE_SKIP_TEST_ID,
  ReferralGateScreen,
} from '../src/screens/funnel/ReferralGateScreen';
import {
  REFERRAL_GATE_SHARE_CTA_LABELS,
  REFERRAL_GATE_SKIP_CTA_LABEL,
} from '../src/funnel/referral-gate-ctas';

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

describe('ReferralGateScreen — Kakao share CTA presence (Sub-AC 1.1)', () => {
  it('mounts a host element tagged with the referral-gate-kakao-share testID', () => {
    // The CTA must be reachable via the stable testID exported by the
    // screen module — sibling sub-ACs (copy-link, skip) will rely on
    // this anchor being a known peer in the rendered tree.
    const tree = render(
      React.createElement(ReferralGateScreen, {
        onShareKakao: vi.fn(),
        onCopyLink: vi.fn(),
        onSkip: vi.fn(),
      }),
    );
    expect(findHostByTestId(tree, REFERRAL_GATE_KAKAO_SHARE_TEST_ID)).toBeTruthy();
  });

  it('renders the Korean Kakao share label "카카오톡으로 공유"', () => {
    // The label MUST come from REFERRAL_GATE_SHARE_CTA_LABELS.kakao —
    // never a literal. We pin both the constant value and the rendered
    // accessibilityLabel here so a future drift in either direction
    // (rewrite of the constant or in-component duplication of the
    // string) surfaces as a failing test before reaching production.
    expect(REFERRAL_GATE_SHARE_CTA_LABELS.kakao).toBe('카카오톡으로 공유');
    const tree = render(
      React.createElement(ReferralGateScreen, {
        onShareKakao: vi.fn(),
        onCopyLink: vi.fn(),
        onSkip: vi.fn(),
      }),
    );
    const cta = findHostByTestId(tree, REFERRAL_GATE_KAKAO_SHARE_TEST_ID);
    expect(cta).toBeTruthy();
    expect(cta?.props.accessibilityRole).toBe('button');
    expect(cta?.props.accessibilityLabel).toBe('카카오톡으로 공유');
  });
});

describe('ReferralGateScreen — Kakao share CTA interaction (Sub-AC 1.1)', () => {
  it('invokes onShareKakao exactly once when the CTA is pressed', () => {
    // The seed-level Sub-AC 1.1 acceptance is "the CTA is present AND
    // triggers its handler". Pressing the rendered button must call
    // the prop callback exactly once — never zero (silent
    // disconnection) and never twice (accidental double-binding).
    const onShareKakao = vi.fn();
    const tree = render(
      React.createElement(ReferralGateScreen, {
        onShareKakao,
        onCopyLink: vi.fn(),
      }),
    );
    const cta = findHostByTestId(tree, REFERRAL_GATE_KAKAO_SHARE_TEST_ID);
    const onPress = cta?.props.onPress as (e: unknown) => void;
    expect(typeof onPress).toBe('function');
    act(() => {
      onPress({});
    });
    expect(onShareKakao).toHaveBeenCalledTimes(1);
  });
});

describe('ReferralGateScreen — copy-link CTA presence (Sub-AC 1.2)', () => {
  it('mounts a host element tagged with the referral-gate-copy-link testID', () => {
    // The copy-link CTA is the second share path on referral_gate and
    // must be a sibling of the Kakao CTA in the rendered tree — never
    // re-using the Kakao testID anchor. Asserting both nodes resolve
    // independently catches an accidental copy/paste regression where
    // the new button accidentally shadows the Kakao one.
    const tree = render(
      React.createElement(ReferralGateScreen, {
        onShareKakao: vi.fn(),
        onCopyLink: vi.fn(),
        onSkip: vi.fn(),
      }),
    );
    expect(findHostByTestId(tree, REFERRAL_GATE_COPY_LINK_TEST_ID)).toBeTruthy();
    // Sanity: the Kakao CTA is still present alongside the new one —
    // the new button extends the surface, it does not replace it.
    expect(findHostByTestId(tree, REFERRAL_GATE_KAKAO_SHARE_TEST_ID)).toBeTruthy();
  });

  it('renders the Korean copy-link label "링크 복사"', () => {
    // Same no-literal discipline as the Kakao label: the rendered text
    // must trace back to REFERRAL_GATE_SHARE_CTA_LABELS.copy_link, never
    // a string embedded in the component. Pinning the constant + the
    // rendered accessibilityLabel makes any drift in either direction
    // a visible test failure.
    expect(REFERRAL_GATE_SHARE_CTA_LABELS.copy_link).toBe('링크 복사');
    const tree = render(
      React.createElement(ReferralGateScreen, {
        onShareKakao: vi.fn(),
        onCopyLink: vi.fn(),
        onSkip: vi.fn(),
      }),
    );
    const cta = findHostByTestId(tree, REFERRAL_GATE_COPY_LINK_TEST_ID);
    expect(cta).toBeTruthy();
    expect(cta?.props.accessibilityRole).toBe('button');
    expect(cta?.props.accessibilityLabel).toBe('링크 복사');
  });
});

describe('ReferralGateScreen — copy-link CTA interaction (Sub-AC 1.2)', () => {
  it('invokes onCopyLink exactly once when the copy-link CTA is pressed', () => {
    // The seed-level Sub-AC 1.2 acceptance is "the CTA is present AND
    // triggers its handler". Pressing the rendered button must call
    // `onCopyLink` exactly once and must NOT call `onShareKakao` — the
    // two callbacks are independent paths and a cross-wiring would
    // silently misroute the Phase 2.4 analytics surface.
    const onShareKakao = vi.fn();
    const onCopyLink = vi.fn();
    const tree = render(
      React.createElement(ReferralGateScreen, {
        onShareKakao,
        onCopyLink,
        onSkip: vi.fn(),
      }),
    );
    const cta = findHostByTestId(tree, REFERRAL_GATE_COPY_LINK_TEST_ID);
    const onPress = cta?.props.onPress as (e: unknown) => void;
    expect(typeof onPress).toBe('function');
    act(() => {
      onPress({});
    });
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    expect(onShareKakao).not.toHaveBeenCalled();
  });
});

describe('ReferralGateScreen — skip CTA presence (Sub-AC 1.3)', () => {
  it('mounts a host element tagged with the referral-gate-skip testID', () => {
    // The skip CTA is the soft-gate bypass on referral_gate and must
    // be a sibling of both share CTAs in the rendered tree — never
    // re-using either share-CTA testID anchor. Asserting all three
    // nodes resolve independently catches an accidental copy/paste
    // regression where the new control accidentally shadows one of
    // the existing share buttons. Per the Seed constraint "All 3
    // screens are soft gates with skip options — no hard gating
    // blocks progression", the skip control is always present.
    const tree = render(
      React.createElement(ReferralGateScreen, {
        onShareKakao: vi.fn(),
        onCopyLink: vi.fn(),
        onSkip: vi.fn(),
      }),
    );
    expect(findHostByTestId(tree, REFERRAL_GATE_SKIP_TEST_ID)).toBeTruthy();
    // Sanity: both share CTAs are still present alongside the new
    // skip control — the new button extends the surface, it does not
    // replace either share path.
    expect(findHostByTestId(tree, REFERRAL_GATE_KAKAO_SHARE_TEST_ID)).toBeTruthy();
    expect(findHostByTestId(tree, REFERRAL_GATE_COPY_LINK_TEST_ID)).toBeTruthy();
  });

  it('renders the Korean skip label "나중에 할게요"', () => {
    // Same no-literal discipline as the share labels: the rendered
    // text must trace back to REFERRAL_GATE_SKIP_CTA_LABEL, never a
    // string embedded in the component. Pinning the constant + the
    // rendered accessibilityLabel makes any drift in either direction
    // (rewrite of the constant or in-component duplication of the
    // string) a visible test failure.
    expect(REFERRAL_GATE_SKIP_CTA_LABEL).toBe('나중에 할게요');
    const tree = render(
      React.createElement(ReferralGateScreen, {
        onShareKakao: vi.fn(),
        onCopyLink: vi.fn(),
        onSkip: vi.fn(),
      }),
    );
    const cta = findHostByTestId(tree, REFERRAL_GATE_SKIP_TEST_ID);
    expect(cta).toBeTruthy();
    expect(cta?.props.accessibilityRole).toBe('button');
    expect(cta?.props.accessibilityLabel).toBe('나중에 할게요');
  });
});

describe('ReferralGateScreen — skip CTA interaction (Sub-AC 1.3)', () => {
  it('invokes onSkip exactly once when the skip CTA is pressed', () => {
    // The seed-level Sub-AC 1.3 acceptance is "the skip control is
    // present AND triggers its handler". Pressing the rendered
    // button must call `onSkip` exactly once and must NOT call either
    // share handler — the three callbacks are independent paths and
    // a cross-wiring would silently misroute either the referral
    // analytics surface or the skip-vs-share state-write path on
    // `FunnelStateProvider`.
    const onShareKakao = vi.fn();
    const onCopyLink = vi.fn();
    const onSkip = vi.fn();
    const tree = render(
      React.createElement(ReferralGateScreen, {
        onShareKakao,
        onCopyLink,
        onSkip,
      }),
    );
    const cta = findHostByTestId(tree, REFERRAL_GATE_SKIP_TEST_ID);
    const onPress = cta?.props.onPress as (e: unknown) => void;
    expect(typeof onPress).toBe('function');
    act(() => {
      onPress({});
    });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onShareKakao).not.toHaveBeenCalled();
    expect(onCopyLink).not.toHaveBeenCalled();
  });
});
