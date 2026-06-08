/**
 * Unit tests — `SocialProofScreen` presentational component (Sub-AC 14a-3).
 *
 * Asserts that all three social-proof UI elements render correctly:
 *
 *   1. **리뷰 카드 (Review cards)** — each review card is present with
 *      - the author handle (`testID="social-proof-review-card-<id>-author"`)
 *      - the review text (`testID="social-proof-review-card-<id>-text"`)
 *      - the source tag label (UGC / influencer)
 *      - the star row (`testID="social-proof-review-card-<id>-stars"`)
 *
 *   2. **별점 (Star ratings)** — each star row renders the correct Unicode
 *      glyph string (n × "★") and carries the correct
 *      `accessibilityLabel="별점 <n>점"`.
 *
 *   3. **사용자 수 뱃지 (User count badge)** — the badge is present with the
 *      correct `USER_COUNT_BADGE_TEXT` ("12만+ 사용자") and carries
 *      `accessibilityRole="text"` and the matching `accessibilityLabel`.
 *
 * Interaction:
 *   4. Pressing the primary CTA invokes `onNext` exactly once.
 *
 * Helper:
 *   5. `buildStarString(n)` returns "★" repeated n times.
 *
 * Mocking strategy:
 *   - `react-native`: minimal host-component stubs (View / Text / Pressable /
 *     ScrollView / StyleSheet / Platform) so `react-test-renderer` can mount
 *     the tree without hitting the real `react-native/index.js` entry (which
 *     ships with Flow `import typeof` syntax Node cannot parse natively).
 *   - `react-native-safe-area-context`: tiny `SafeAreaView` stub matching
 *     the surface `FunnelScreenLayout` consumes.
 *   - No `expo-router` mock needed — `SocialProofScreen` is a pure
 *     presentational component with no router imports.
 *   - No `core-ts` mock needed — `FUNNEL_SCREENS` resolves to the compiled
 *     core-ts package (already in `node_modules`) without any native module.
 *
 * Test pattern rationale:
 *   The `render` / `interaction` split mirrors
 *   `tests/social-evolution-shared-true-branch.test.tsx` and
 *   `tests/onboarding-priming-screen.test.tsx`. Separating concerns keeps
 *   a failing interaction test from re-running the entire render suite.
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

// Import the component AFTER mocks are registered so that all
// `import { ... } from 'react-native'` statements inside the component and
// its shared dependencies resolve to the mocked surface above.
import {
  buildStarString,
  REVIEW_CARDS,
  SocialProofScreen,
  SOURCE_LABELS,
  SOCIAL_PROOF_CTA_LABEL,
  STAR_GLYPH,
  USER_COUNT_BADGE_TEXT,
} from '../src/screens/funnel/SocialProofScreen';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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
 * mixed array of strings and child instances.
 */
function collectText(node: TestInstance | null): string {
  if (node === null) return '';
  let out = '';
  for (const child of node.children) {
    if (typeof child === 'string') {
      out += child;
    } else if (child && typeof child === 'object') {
      out += collectText(child as TestInstance);
    }
  }
  return out;
}

const NO_OP = (): void => undefined;

// ---------------------------------------------------------------------------
// Test suite: render — layout and headline
// ---------------------------------------------------------------------------

describe('SocialProofScreen — render: layout & headline', () => {
  it('renders the screen layout root with testID="social-proof-screen"', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    expect(findHostByTestId(tree, 'social-proof-screen')).toBeTruthy();
  });

  it('renders the FunnelHeadline group from FUNNEL_SCREENS.social_evolution', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    // FunnelHeadline renders a group container with testIDPrefix-headline-group.
    expect(findHostByTestId(tree, 'social-proof-headline-group')).toBeTruthy();
  });

  it('renders the Korean headline from FUNNEL_SCREENS.social_evolution', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    const headline = findHostByTestId(tree, 'social-proof-headline');
    expect(headline).toBeTruthy();
    // The social_evolution headline is the documented Korean copy.
    expect(headline?.props.children).toBe('@user_kim · @beautymee 가 직접 쓴 후기');
  });

  it('renders the Korean subhead from FUNNEL_SCREENS.social_evolution', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    const subhead = findHostByTestId(tree, 'social-proof-subhead');
    expect(subhead).toBeTruthy();
    expect(subhead?.props.children).toBe('실제 UGC + 인플루언서 인용 + 12만+ 사용자 진단 누적');
  });
});

// ---------------------------------------------------------------------------
// Test suite: render — user count badge (사용자 수 뱃지)
// ---------------------------------------------------------------------------

describe('SocialProofScreen — render: user count badge', () => {
  it('renders the user count badge with testID="social-proof-user-count-badge"', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    expect(findHostByTestId(tree, 'social-proof-user-count-badge')).toBeTruthy();
  });

  it('badge carries accessibilityRole="text"', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    const badge = findHostByTestId(tree, 'social-proof-user-count-badge');
    expect(badge?.props.accessibilityRole).toBe('text');
  });

  it('badge carries accessibilityLabel matching USER_COUNT_BADGE_TEXT', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    const badge = findHostByTestId(tree, 'social-proof-user-count-badge');
    expect(badge?.props.accessibilityLabel).toBe(USER_COUNT_BADGE_TEXT);
    expect(badge?.props.accessibilityLabel).toBe('12만+ 사용자');
  });

  it('renders the badge text node with USER_COUNT_BADGE_TEXT content', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    const badgeText = findHostByTestId(tree, 'social-proof-user-count-badge-text');
    expect(badgeText).toBeTruthy();
    expect(badgeText?.props.children).toBe(USER_COUNT_BADGE_TEXT);
  });

  it('USER_COUNT_BADGE_TEXT constant equals "12만+ 사용자"', () => {
    // Pin the exported constant so a future update to the Korean copy flows
    // through this assertion rather than silently shipping a regression.
    expect(USER_COUNT_BADGE_TEXT).toBe('12만+ 사용자');
  });
});

// ---------------------------------------------------------------------------
// Test suite: render — review cards (리뷰 카드)
// ---------------------------------------------------------------------------

describe('SocialProofScreen — render: review cards', () => {
  it('renders exactly 3 review cards matching REVIEW_CARDS length', () => {
    expect(REVIEW_CARDS).toHaveLength(3);
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    for (const card of REVIEW_CARDS) {
      expect(
        findHostByTestId(tree, `social-proof-review-card-${card.id}`),
        `card "${card.id}" should be present`,
      ).toBeTruthy();
    }
  });

  it('renders the review list container with testID="social-proof-review-list"', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    expect(findHostByTestId(tree, 'social-proof-review-list')).toBeTruthy();
  });

  it('each review card has accessibilityRole="text"', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    for (const card of REVIEW_CARDS) {
      const cardNode = findHostByTestId(tree, `social-proof-review-card-${card.id}`);
      expect(cardNode?.props.accessibilityRole).toBe('text');
    }
  });

  it('each review card renders the correct author handle', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    for (const card of REVIEW_CARDS) {
      const authorNode = findHostByTestId(
        tree,
        `social-proof-review-card-${card.id}-author`,
      );
      expect(authorNode, `author node for "${card.id}"`).toBeTruthy();
      expect(authorNode?.props.children).toBe(card.authorHandle);
    }
  });

  it('each review card renders the correct review text', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    for (const card of REVIEW_CARDS) {
      const textNode = findHostByTestId(
        tree,
        `social-proof-review-card-${card.id}-text`,
      );
      expect(textNode, `text node for "${card.id}"`).toBeTruthy();
      expect(textNode?.props.children).toBe(card.reviewText);
    }
  });

  it('each review card renders the correct source tag label', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    for (const card of REVIEW_CARDS) {
      const sourceTagNode = findHostByTestId(
        tree,
        `social-proof-review-card-${card.id}-source-tag`,
      );
      expect(sourceTagNode, `source tag for "${card.id}"`).toBeTruthy();
      // The source tag label is the Korean text inside the pill.
      const labelText = collectText(sourceTagNode);
      expect(labelText).toBe(SOURCE_LABELS[card.source]);
    }
  });
});

// ---------------------------------------------------------------------------
// Test suite: render — star ratings (별점)
// ---------------------------------------------------------------------------

describe('SocialProofScreen — render: star ratings', () => {
  it('each review card renders a star row node', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    for (const card of REVIEW_CARDS) {
      const starsNode = findHostByTestId(
        tree,
        `social-proof-review-card-${card.id}-stars`,
      );
      expect(starsNode, `stars node for "${card.id}"`).toBeTruthy();
    }
  });

  it('each star row renders the correct glyph string (STAR_GLYPH × starCount)', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    for (const card of REVIEW_CARDS) {
      const starsNode = findHostByTestId(
        tree,
        `social-proof-review-card-${card.id}-stars`,
      );
      const expected = buildStarString(card.starCount);
      expect(starsNode?.props.children).toBe(expected);
    }
  });

  it('each star row carries the correct accessibilityLabel "별점 <n>점"', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    for (const card of REVIEW_CARDS) {
      const starsNode = findHostByTestId(
        tree,
        `social-proof-review-card-${card.id}-stars`,
      );
      expect(starsNode?.props.accessibilityLabel).toBe(`별점 ${card.starCount}점`);
    }
  });

  it('all MVP review cards have starCount === 5 (five-star proof)', () => {
    // Seed constraint: "가짜 별점 패턴 버림 — real proof only".
    // In the MVP all cards are 5-star genuine claims.
    for (const card of REVIEW_CARDS) {
      expect(card.starCount).toBe(5);
    }
  });

  it('star rows for 5-star cards contain exactly 5 glyph occurrences', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    for (const card of REVIEW_CARDS) {
      if (card.starCount !== 5) continue;
      const starsNode = findHostByTestId(
        tree,
        `social-proof-review-card-${card.id}-stars`,
      );
      const glyphs = (starsNode?.props.children as string)
        .split('')
        .filter((c: string) => c === STAR_GLYPH);
      expect(glyphs).toHaveLength(5);
    }
  });
});

// ---------------------------------------------------------------------------
// Test suite: render — CTA
// ---------------------------------------------------------------------------

describe('SocialProofScreen — render: CTA', () => {
  it('renders the primary CTA with testID="social-proof-cta"', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    expect(findHostByTestId(tree, 'social-proof-cta')).toBeTruthy();
  });

  it('CTA carries accessibilityLabel matching SOCIAL_PROOF_CTA_LABEL', () => {
    const tree = render(React.createElement(SocialProofScreen, { onNext: NO_OP }));
    const cta = findHostByTestId(tree, 'social-proof-cta');
    expect(cta?.props.accessibilityLabel).toBe(SOCIAL_PROOF_CTA_LABEL);
    expect(SOCIAL_PROOF_CTA_LABEL).toBe('계속');
  });
});

// ---------------------------------------------------------------------------
// Test suite: interaction
// ---------------------------------------------------------------------------

describe('SocialProofScreen — interaction: CTA', () => {
  it('invokes onNext exactly once when the primary CTA is pressed', () => {
    const onNext = vi.fn();
    const tree = render(
      React.createElement(SocialProofScreen, { onNext }),
    );

    const cta = findHostByTestId(tree, 'social-proof-cta');
    expect(cta).toBeTruthy();

    // `FunnelPrimaryButton` wraps the press handler in `useCallback`; the
    // rendered Pressable's `onPress` is that wrapped function. Calling it
    // inside `act(...)` simulates a single tap.
    const onPress = cta?.props.onPress as (e: unknown) => void;
    expect(typeof onPress).toBe('function');
    act(() => onPress({}));

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onNext when the tree renders without any press', () => {
    const onNext = vi.fn();
    render(React.createElement(SocialProofScreen, { onNext }));
    expect(onNext).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test suite: buildStarString helper
// ---------------------------------------------------------------------------

describe('buildStarString helper', () => {
  it('returns "★" repeated n times for n=1', () => {
    expect(buildStarString(1)).toBe('★');
  });

  it('returns "★★★★★" for n=5 (standard 5-star rating)', () => {
    expect(buildStarString(5)).toBe('★★★★★');
  });

  it('returns "★★★" for n=3 (mid-range rating)', () => {
    expect(buildStarString(3)).toBe('★★★');
  });

  it('returns empty string for n=0', () => {
    expect(buildStarString(0)).toBe('');
  });

  it('STAR_GLYPH constant is the Unicode filled-star character "★"', () => {
    expect(STAR_GLYPH).toBe('★');
    expect(STAR_GLYPH.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test suite: REVIEW_CARDS data contract
// ---------------------------------------------------------------------------

describe('REVIEW_CARDS data contract', () => {
  it('has exactly 3 entries', () => {
    expect(REVIEW_CARDS).toHaveLength(3);
  });

  it('all card IDs are unique kebab-case strings', () => {
    const ids = REVIEW_CARDS.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    for (const id of ids) {
      expect(/^[a-z0-9-]+$/.test(id)).toBe(true);
    }
  });

  it('all cards have at least one source of type "ugc" or "influencer"', () => {
    const sources = REVIEW_CARDS.map((c) => c.source);
    expect(sources).toContain('ugc');
    expect(sources).toContain('influencer');
  });

  it('all cards have non-empty authorHandle, reviewText', () => {
    for (const card of REVIEW_CARDS) {
      expect(card.authorHandle.length).toBeGreaterThan(0);
      expect(card.reviewText.length).toBeGreaterThan(0);
    }
  });

  it('all cards have starCount in range 1..5', () => {
    for (const card of REVIEW_CARDS) {
      expect(card.starCount).toBeGreaterThanOrEqual(1);
      expect(card.starCount).toBeLessThanOrEqual(5);
    }
  });

  it('SOURCE_LABELS maps both "ugc" and "influencer" to Korean strings', () => {
    expect(SOURCE_LABELS.ugc).toBe('실제 사용자');
    expect(SOURCE_LABELS.influencer).toBe('인플루언서');
  });
});
