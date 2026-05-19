/**
 * Unit test — `ResultRevealScreen` primary-CTA conditional visibility
 * (Phase 2.4 Sub-AC 11.2).
 *
 * Sub-AC 11.2 contract:
 *   The "친구와 공유하고 잠금 해제" primary CTA on `result_reveal` is HIDDEN
 *   whenever `isPreviewMode === true` OR `isPremium === true`. The CTA only
 *   renders in the default branch (`isPreviewMode === false` AND
 *   `isPremium === false`, asserted in Sub-AC 11.1).
 *
 *   The OR semantics matter: the Phase 2.4 Seed pins isPreviewMode and
 *   isPremium as mutually exclusive at the consumer boundary
 *   ("isPreviewMode and isPremium are mutually exclusive — premium entry
 *   invalidates preview branch"). The screen's render logic must be
 *   defensive: even if both flags are accidentally `true`, the CTA stays
 *   hidden — a clickable share-to-unlock affordance must never surface on
 *   a preview-mode session.
 *
 * Why a dedicated test file (not appended to `result-reveal-screen.test.tsx`):
 *   - Mirrors the AC 12 sibling pattern (`result-reveal-screen-premium-branch.test.tsx`):
 *     each Phase 2.4 sub-AC that extends the screen test surface lives in
 *     its own file to avoid edit-conflict churn with parallel Phase 2.4
 *     work.
 *   - Pins the conditional-visibility contract in one place — every visible
 *     branch (default, preview-only, premium-only, both-true defensive) is
 *     asserted in this file as a coherent truth-table, instead of being
 *     scattered across the headline / locked-asset / CTA-label tests.
 *
 * Truth-table asserted here:
 *
 *   isPreviewMode | isPremium | CTA rendered?
 *   ──────────────┼───────────┼───────────────
 *        false    |   false   | YES  (covered in result-reveal-screen.test.tsx Sub-AC 11.1)
 *        true     |   false   | no
 *        false    |   true    | no
 *        true     |   true    | no  (defensive — mutual-exclusion violation)
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

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('SafeAreaView', props, props.children),
}));

import { ResultRevealScreen } from '../src/screens/funnel/ResultRevealScreen';

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

const NO_OP = (): void => undefined;

// Pin the CTA testID and rendered Korean label here (instead of importing
// from the component) so the assertion is authoritative about what
// "the share-to-unlock CTA" means in the Sub-AC 11.2 contract — a future
// rename of the constant in the component must still satisfy this test.
const UNLOCK_CTA_TEST_ID = 'result-reveal-unlock-cta';
const SHARE_UNLOCK_CTA_LABEL_TEXT = '친구와 공유하고 잠금 해제';

/**
 * Walk the rendered tree for a <Text> host whose string children exactly
 * match the share-to-unlock CTA copy. Used as a belt-and-suspenders check
 * alongside `findHostByTestId(UNLOCK_CTA_TEST_ID)`: even if a future
 * refactor changes the testID, this asserts that the Korean copy itself
 * is not present anywhere on the surface in the hidden branches.
 */
function findTextNodesWithLabel(
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): readonly TestInstance[] {
  return tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      node.type === 'Text' &&
      typeof node.props?.children === 'string' &&
      node.props.children === label,
  ) as unknown as readonly TestInstance[];
}

describe('ResultRevealScreen — Sub-AC 11.2 CTA conditional visibility', () => {
  it(
    'hides the share-to-unlock CTA when isPreviewMode=true AND isPremium=false ' +
      '(preview-only branch, OR semantics, left side)',
    () => {
      const tree = render(
        React.createElement(ResultRevealScreen, {
          isPreviewMode: true,
          isPremium: false,
          onUnlock: NO_OP,
        }),
      );
      // (a) the CTA testID is absent from the tree
      expect(findHostByTestId(tree, UNLOCK_CTA_TEST_ID)).toBeNull();
      // (b) the Korean copy is not rendered as a <Text> anywhere — there
      // is no orphaned label left behind by a partial-omit refactor
      expect(findTextNodesWithLabel(tree, SHARE_UNLOCK_CTA_LABEL_TEXT)).toHaveLength(0);
    },
  );

  it(
    'hides the share-to-unlock CTA when isPreviewMode=false AND isPremium=true ' +
      '(premium-only branch, OR semantics, right side)',
    () => {
      const tree = render(
        React.createElement(ResultRevealScreen, {
          isPreviewMode: false,
          isPremium: true,
          onUnlock: NO_OP,
        }),
      );
      expect(findHostByTestId(tree, UNLOCK_CTA_TEST_ID)).toBeNull();
      expect(findTextNodesWithLabel(tree, SHARE_UNLOCK_CTA_LABEL_TEXT)).toHaveLength(0);
    },
  );

  it(
    'hides the share-to-unlock CTA when isPreviewMode=true AND isPremium=true ' +
      '(defensive — guards mutual-exclusion violation per Seed constraint)',
    () => {
      // The Phase 2.4 Seed pins the contract: "isPreviewMode and isPremium
      // are mutually exclusive — premium entry invalidates preview branch."
      // This test asserts that if the consumer ever lets both flags reach
      // the screen as `true` (an upstream violation), the screen still
      // refuses to render a clickable share-to-unlock affordance — i.e. the
      // hidden-branch semantics is OR, not XOR, on the render side.
      const tree = render(
        React.createElement(ResultRevealScreen, {
          isPreviewMode: true,
          isPremium: true,
          onUnlock: NO_OP,
        }),
      );
      expect(findHostByTestId(tree, UNLOCK_CTA_TEST_ID)).toBeNull();
      expect(findTextNodesWithLabel(tree, SHARE_UNLOCK_CTA_LABEL_TEXT)).toHaveLength(0);
    },
  );

  it(
    'never invokes onUnlock when isPreviewMode=true OR isPremium=true ' +
      '(the hidden CTA cannot fire the navigation callback)',
    () => {
      // The CTA wires `router.push('/(funnel)/referral-gate')` at the route
      // boundary. If the CTA were rendered in any hidden branch, a stray
      // press would side-effect into the funnel state. Render each hidden
      // branch and confirm `onUnlock` is never observed by the parent —
      // i.e. there is no `onPress` handler reachable.
      const branches: readonly { isPreviewMode: boolean; isPremium: boolean }[] = [
        { isPreviewMode: true, isPremium: false },
        { isPreviewMode: false, isPremium: true },
        { isPreviewMode: true, isPremium: true },
      ];
      for (const branch of branches) {
        const onUnlock = vi.fn();
        const tree = render(
          React.createElement(ResultRevealScreen, {
            isPreviewMode: branch.isPreviewMode,
            isPremium: branch.isPremium,
            onUnlock,
          }),
        );
        const cta = findHostByTestId(tree, UNLOCK_CTA_TEST_ID);
        // The CTA must be absent; if it ever surfaces, this is the failure
        // we want to see first — it pinpoints the regression source.
        expect(
          cta,
          `CTA must be hidden for isPreviewMode=${branch.isPreviewMode}, isPremium=${branch.isPremium}`,
        ).toBeNull();
        // Defensive: onUnlock cannot have been called because there is no
        // surface to press, but assert it explicitly so a future refactor
        // that accidentally invokes the callback at mount-time is caught.
        expect(onUnlock).not.toHaveBeenCalled();
      }
    },
  );
});

describe('ResultRevealScreen — Sub-AC 11.2 regression guard (default branch)', () => {
  it(
    'still renders the share-to-unlock CTA when isPreviewMode=false AND isPremium=false ' +
      '(regression guard against accidentally always-hiding the CTA)',
    () => {
      const tree = render(
        React.createElement(ResultRevealScreen, {
          isPreviewMode: false,
          isPremium: false,
          onUnlock: NO_OP,
        }),
      );
      const cta = findHostByTestId(tree, UNLOCK_CTA_TEST_ID);
      expect(cta).toBeTruthy();
      // And the Korean copy is present as a <Text> child on the rendered
      // surface — the default branch should not regress into a label-less
      // button.
      const labels = findTextNodesWithLabel(tree, SHARE_UNLOCK_CTA_LABEL_TEXT);
      expect(labels.length).toBeGreaterThan(0);
    },
  );
});
