/**
 * Unit test — `SocialEvolutionSharedFalseBranch` presentational component
 * (Phase 2.4, step 11 — shared=false branch).
 *
 * Asserts:
 *   1. Renders the canonical FUNNEL_SCREENS.social_evolution headline +
 *      subhead via FunnelHeadline (so the social-proof framing matches
 *      the shared=true branch).
 *   2. Renders the upsell card (title + body) with the frozen Korean copy
 *      constants exported from the screen module.
 *   3. Renders the "친구에게 공유하기" primary CTA with the
 *      SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL label and a stable testID.
 *   4. Renders the "나중에 할게요" skip CTA with the
 *      SOCIAL_EVOLUTION_SKIP_CTA_LABEL label and a stable testID.
 *   5. Pressing the primary CTA invokes `onShareAgain` exactly once and
 *      does NOT invoke `onSkip` (callback isolation).
 *   6. Pressing the skip CTA invokes `onSkip` exactly once and does NOT
 *      invoke `onShareAgain` (callback isolation).
 *   7. The branch's layout root carries the stable
 *      `social-evolution-shared-false-branch` testID so route-level
 *      tests can detect "shared=false branch is mounted" without
 *      re-asserting interior structure.
 *
 * Pure props-in / callbacks-out — no FunnelStateProvider wrapping needed
 * (the branch component does not read context; the route file owns the
 * branch selection).
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

import {
  SOCIAL_EVOLUTION_UPSELL_BODY,
  SOCIAL_EVOLUTION_UPSELL_TITLE,
  SocialEvolutionSharedFalseBranch,
} from '../src/screens/funnel/SocialEvolutionSharedFalseBranch';
import {
  SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL,
  SOCIAL_EVOLUTION_SKIP_CTA_LABEL,
} from '../src/funnel/social-evolution-ctas';

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

const NO_OP = (): void => undefined;

describe('SocialEvolutionSharedFalseBranch — render', () => {
  it('renders the canonical social_evolution headline + subhead via FunnelHeadline', () => {
    const tree = render(
      React.createElement(SocialEvolutionSharedFalseBranch, {
        onShareAgain: NO_OP,
        onSkip: NO_OP,
      }),
    );
    const headline = findHostByTestId(
      tree,
      'social-evolution-shared-false-headline',
    );
    const subhead = findHostByTestId(
      tree,
      'social-evolution-shared-false-subhead',
    );
    // Source-of-truth alignment with FUNNEL_SCREENS.social_evolution — the
    // shared=false branch reuses the canonical social-proof headline so the
    // user reads the same framing whether they shared or not.
    expect(headline?.props.children).toBe(
      '@user_kim · @beautymee 가 직접 쓴 후기',
    );
    expect(subhead?.props.children).toBe(
      '실제 UGC + 인플루언서 인용 + 12만+ 사용자 진단 누적',
    );
  });

  it('renders the upsell card with title + body from frozen Korean constants', () => {
    const tree = render(
      React.createElement(SocialEvolutionSharedFalseBranch, {
        onShareAgain: NO_OP,
        onSkip: NO_OP,
      }),
    );
    const card = findHostByTestId(
      tree,
      'social-evolution-shared-false-upsell-card',
    );
    const title = findHostByTestId(
      tree,
      'social-evolution-shared-false-upsell-title',
    );
    const body = findHostByTestId(
      tree,
      'social-evolution-shared-false-upsell-body',
    );
    // Card container must mount — anchors the soft-pink nudge surface.
    expect(card).toBeTruthy();
    // Title + body bind to the exported constants so a Phase 2.5 copy
    // review changes one line per concept.
    expect(title?.props.children).toBe(SOCIAL_EVOLUTION_UPSELL_TITLE);
    expect(body?.props.children).toBe(SOCIAL_EVOLUTION_UPSELL_BODY);
  });

  it('renders share-again CTA with SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL and accessibility', () => {
    const tree = render(
      React.createElement(SocialEvolutionSharedFalseBranch, {
        onShareAgain: NO_OP,
        onSkip: NO_OP,
      }),
    );
    const shareAgain = findHostByTestId(
      tree,
      'social-evolution-shared-false-share-again',
    );
    expect(shareAgain).toBeTruthy();
    expect(shareAgain?.props.accessibilityRole).toBe('button');
    expect(shareAgain?.props.accessibilityLabel).toBe(
      SOCIAL_EVOLUTION_SHARE_AGAIN_CTA_LABEL,
    );
  });

  it('renders skip CTA with SOCIAL_EVOLUTION_SKIP_CTA_LABEL and accessibility', () => {
    const tree = render(
      React.createElement(SocialEvolutionSharedFalseBranch, {
        onShareAgain: NO_OP,
        onSkip: NO_OP,
      }),
    );
    const skip = findHostByTestId(
      tree,
      'social-evolution-shared-false-skip',
    );
    expect(skip).toBeTruthy();
    expect(skip?.props.accessibilityRole).toBe('button');
    expect(skip?.props.accessibilityLabel).toBe(
      SOCIAL_EVOLUTION_SKIP_CTA_LABEL,
    );
  });

  it('mounts a stable testID on the branch layout root', () => {
    const tree = render(
      React.createElement(SocialEvolutionSharedFalseBranch, {
        onShareAgain: NO_OP,
        onSkip: NO_OP,
      }),
    );
    // The route file uses this testID to detect "shared=false branch is
    // mounted" without re-asserting interior structure.
    expect(
      findHostByTestId(tree, 'social-evolution-shared-false-branch'),
    ).toBeTruthy();
  });
});

describe('SocialEvolutionSharedFalseBranch — interaction', () => {
  it('invokes onShareAgain exactly once when the primary CTA is pressed (and does NOT invoke onSkip)', () => {
    const onShareAgain = vi.fn();
    const onSkip = vi.fn();
    const tree = render(
      React.createElement(SocialEvolutionSharedFalseBranch, {
        onShareAgain,
        onSkip,
      }),
    );
    const shareAgain = findHostByTestId(
      tree,
      'social-evolution-shared-false-share-again',
    );
    const onPress = shareAgain?.props.onPress as ((e: unknown) => void) | undefined;
    expect(typeof onPress).toBe('function');
    act(() => {
      (onPress as (e: unknown) => void)({});
    });
    expect(onShareAgain).toHaveBeenCalledTimes(1);
    // Callback isolation — pressing share-again must NOT bleed into skip.
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('invokes onSkip exactly once when the skip CTA is pressed (and does NOT invoke onShareAgain)', () => {
    const onShareAgain = vi.fn();
    const onSkip = vi.fn();
    const tree = render(
      React.createElement(SocialEvolutionSharedFalseBranch, {
        onShareAgain,
        onSkip,
      }),
    );
    const skip = findHostByTestId(
      tree,
      'social-evolution-shared-false-skip',
    );
    const onPress = skip?.props.onPress as (() => void) | undefined;
    expect(typeof onPress).toBe('function');
    act(() => {
      (onPress as () => void)();
    });
    expect(onSkip).toHaveBeenCalledTimes(1);
    // Callback isolation — pressing skip must NOT bleed into share-again.
    expect(onShareAgain).not.toHaveBeenCalled();
  });
});
