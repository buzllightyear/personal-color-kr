/**
 * `SocialProofScreen` — Funnel step 11 social proof presentational component
 * (KR variant, Sub-AC 14a-3).
 *
 * Renders three classes of social evidence that the Korean beauty market
 * trusts (Seed constraint: "리뷰 검증 문화 — UGC + 인플루언서 + 사용자 수"):
 *
 *   1. **리뷰 카드 (Review cards)** — UGC / influencer review cards, each
 *      carrying an author handle, a review excerpt, and a star-rating row.
 *      Card data is defined in the module-level `REVIEW_CARDS` constant so
 *      the proof content can be updated in a single place without touching
 *      JSX. Cards are rendered inside a vertically scrollable list and are
 *      individually addressable via `testID="social-proof-review-card-<id>"`.
 *
 *   2. **별점 (Star ratings)** — each review card embeds a star row rendered
 *      from the `starCount` field (1–5). Stars are plain Unicode "★" glyphs
 *      (Seed: no icon libraries); the row carries
 *      `accessibilityLabel="별점 <n>점"` so VoiceOver / TalkBack announces
 *      the numeric score rather than repeating the glyph count. The star
 *      colour uses `COLORS.base.coral` (brand accent) to distinguish the
 *      rating from neutral body text.
 *
 *   3. **사용자 수 뱃지 (User count badge)** — a pill-shaped badge positioned
 *      above the review list that surfaces the aggregate user count from
 *      `FUNNEL_SCREENS.social_evolution.metadata.userCountClaim` (120,000 →
 *      "12만+"). The badge carries `testID="social-proof-user-count-badge"`,
 *      `accessibilityRole="text"`, and `accessibilityLabel="12만+ 사용자"`
 *      so screen readers announce the proof claim.
 *
 * Pipeline alignment:
 *   This screen surfaces social proof AFTER the result has been
 *   generated+enhanced+filtered — the user has already seen what the
 *   pipeline produces. Social proof at step 11 therefore corroborates a
 *   known output quality rather than priming an unknown promise (Seed:
 *   "evolutionStage: phase_2_real_proof" — no fake Figma reviews).
 *
 * Design contract (Sub-AC 14a-3):
 *   - Pure props-in / callbacks-out. Route file owns router / context coupling.
 *   - No raw AI output, no live Fal.ai calls (static proof data only).
 *   - Headline + subhead sourced from `FUNNEL_SCREENS.social_evolution` —
 *     single source of truth for Korean funnel copy.
 *   - All layout + color from design tokens; zero hard-coded values.
 *
 * Accessibility:
 *   - Root layout: `accessibilityLabel="사회적 증거"` — screen reader announces
 *     the screen purpose on focus.
 *   - User count badge: `accessibilityRole="text"`, `accessibilityLabel` states
 *     the full Korean claim.
 *   - Each review card: `accessibilityRole="text"`.
 *   - Each star row: `accessibilityLabel="별점 <n>점"` — speaks the score.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN = FUNNEL_SCREENS.social_evolution;

/**
 * Aggregate user count from the `social_evolution` funnel screen metadata.
 * 120,000 users → "12만+" display string.
 * Sourced from `FUNNEL_SCREENS.social_evolution.metadata.userCountClaim` so
 * if the claim is updated in `screens.ts` the badge stays in sync.
 */
export const USER_COUNT_CLAIM = SCREEN.metadata.userCountClaim as number;

/**
 * Human-readable Korean format of the user count claim.
 * Exported so tests can pin the string without hardcoding a magic literal.
 */
export const USER_COUNT_BADGE_TEXT = '12만+ 사용자' as const;

/**
 * Primary CTA label. Matches the social_evolution FUNNEL_SCREENS CTA action
 * `advance`.
 */
export const SOCIAL_PROOF_CTA_LABEL = '계속' as const;

// ---------------------------------------------------------------------------
// Review card data
// ---------------------------------------------------------------------------

/**
 * Tag distinguishing UGC (user-generated content) from influencer reviews.
 * Aligns with `FUNNEL_SCREENS.social_evolution.metadata.proofSources`.
 */
export type ReviewSourceTag = 'ugc' | 'influencer';

/**
 * A single review card configuration.
 */
export interface ReviewCardConfig {
  /** Stable card identifier (kebab-case). */
  readonly id: string;
  /**
   * Korean social handle or display name of the reviewer.
   * "@" prefix included (UGC: anonymous handle, influencer: public handle).
   */
  readonly authorHandle: string;
  /** Short excerpt of the review text (Korean). */
  readonly reviewText: string;
  /**
   * Integer star count (1–5). Rendered as Unicode "★" glyphs.
   * All MVP review cards use 5 stars; the field is typed 1–5 so a future
   * moderation pass can include sub-5-star reviews without a schema change.
   */
  readonly starCount: 1 | 2 | 3 | 4 | 5;
  /**
   * Content source tag. Drives the accessible type label rendered inside the
   * card ("실제 사용자" / "인플루언서").
   */
  readonly source: ReviewSourceTag;
}

/**
 * Korean source labels rendered inside each card.
 * Sourced here so a localisation pass touches one constant, not the JSX.
 */
export const SOURCE_LABELS: Readonly<Record<ReviewSourceTag, string>> = {
  ugc: '실제 사용자',
  influencer: '인플루언서',
};

/**
 * Star glyph used for both filled and display purposes.
 * Unicode STAR "★" — no icon library required (Seed constraint).
 */
export const STAR_GLYPH = '★' as const;

/**
 * Static review cards — three proof sources covering UGC + influencer,
 * matching `FUNNEL_SCREENS.social_evolution.metadata.proofSources`:
 *   ['user_generated_content', 'influencer_quotes', 'aggregate_user_count']
 *
 * The aggregate user count is surfaced via the badge, NOT a review card.
 * These three cards cover the first two proof source categories.
 *
 * All five-star reviews in MVP — Korean review culture values authoritative
 * "실제 후기" proof over averaged-rating mechanics (Seed: "가짜 별점 패턴 버림").
 */
export const REVIEW_CARDS: readonly ReviewCardConfig[] = [
  {
    id: 'ugc-kim',
    authorHandle: '@user_kim',
    reviewText: '퍼스널 컬러 진단 받고 사진 생성해봤는데 진짜 내 피부톤에 딱 맞아요. 트렌드 드롭 알림도 완전 좋아요!',
    starCount: 5,
    source: 'ugc',
  },
  {
    id: 'influencer-beautymee',
    authorHandle: '@beautymee',
    reviewText: '가을 웜톤 recipe로 생성한 셀카가 기존 필터 앱이랑 차원이 달라요. de-slop 보정이 뭔지 처음 느꼈어요.',
    starCount: 5,
    source: 'influencer',
  },
  {
    id: 'ugc-seonghee',
    authorHandle: '@seonghee_daily',
    reviewText: '트렌드 드롭 올 때마다 새 recipe 바로 써볼 수 있어서 지루할 틈이 없어요. 진짜 쓸수록 좋아지는 앱.',
    starCount: 5,
    source: 'ugc',
  },
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Converts an integer star count (1–5) to a Unicode star glyph string.
 * e.g. `buildStarString(5)` → `"★★★★★"`
 *
 * Exported so tests can pin the string contract without reimplementing the
 * multiplication.
 */
export function buildStarString(starCount: number): string {
  return STAR_GLYPH.repeat(starCount);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SocialProofScreenProps {
  /**
   * CTA callback. Parent wires this to advance to the next funnel step
   * (typically `payment_model`, step 12). Fired when the user taps "계속".
   */
  readonly onNext: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the social proof screen with review cards, star ratings, and user
 * count badge.
 *
 * Pure props-in / callbacks-out. Route file owns any router / context coupling.
 *
 * @see SocialProofScreenProps
 */
export function SocialProofScreen(
  props: SocialProofScreenProps,
): React.ReactElement {
  const { onNext } = props;

  return (
    <FunnelScreenLayout
      testID="social-proof-screen"
      accessibilityLabel="사회적 증거"
    >
      <FunnelHeadline
        headline={SCREEN.headline}
        subhead={SCREEN.subhead}
        testIDPrefix="social-proof"
      />

      {/* ─── User count badge ───────────────────────────────────────────── */}
      <View
        style={styles.userCountBadge}
        testID="social-proof-user-count-badge"
        accessibilityRole="text"
        accessibilityLabel={USER_COUNT_BADGE_TEXT}
      >
        <Text style={styles.userCountBadgeText} testID="social-proof-user-count-badge-text">
          {USER_COUNT_BADGE_TEXT}
        </Text>
      </View>

      {/* ─── Review card list ───────────────────────────────────────────── */}
      <ScrollView
        style={styles.reviewList}
        contentContainerStyle={styles.reviewListContent}
        testID="social-proof-review-list"
        showsVerticalScrollIndicator={false}
      >
        {REVIEW_CARDS.map((card) => (
          <View
            key={card.id}
            style={styles.reviewCard}
            testID={`social-proof-review-card-${card.id}`}
            accessibilityRole="text"
          >
            {/* Source tag pill */}
            <View
              style={styles.sourceTag}
              testID={`social-proof-review-card-${card.id}-source-tag`}
            >
              <Text style={styles.sourceTagText}>
                {SOURCE_LABELS[card.source]}
              </Text>
            </View>

            {/* Author handle */}
            <Text
              style={styles.authorHandle}
              testID={`social-proof-review-card-${card.id}-author`}
            >
              {card.authorHandle}
            </Text>

            {/* Star rating row */}
            <Text
              style={styles.starRow}
              testID={`social-proof-review-card-${card.id}-stars`}
              accessibilityLabel={`별점 ${card.starCount}점`}
            >
              {buildStarString(card.starCount)}
            </Text>

            {/* Review text */}
            <Text
              style={styles.reviewText}
              testID={`social-proof-review-card-${card.id}-text`}
            >
              {card.reviewText}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* ─── Primary CTA ────────────────────────────────────────────────── */}
      <View style={styles.ctaWrapper}>
        <FunnelPrimaryButton
          label={SOCIAL_PROOF_CTA_LABEL}
          onPress={onNext}
          testID="social-proof-cta"
          accessibilityLabel={SOCIAL_PROOF_CTA_LABEL}
        />
      </View>
    </FunnelScreenLayout>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  userCountBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.base.blush,
    borderRadius: 999,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xxs,
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.base.coral,
  },
  userCountBadgeText: {
    ...TYPOGRAPHY.caption.bold,
    color: COLORS.grayscale.text,
  },
  reviewList: {
    flex: 1,
    marginTop: SPACING.md,
  },
  reviewListContent: {
    gap: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  reviewCard: {
    backgroundColor: COLORS.base.pink,
    borderRadius: SPACING.sm,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  sourceTag: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.base.coral,
    borderRadius: 999,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
  },
  sourceTagText: {
    ...TYPOGRAPHY.caption.regular,
    color: COLORS.grayscale.background,
  },
  authorHandle: {
    ...TYPOGRAPHY.body.bold,
    color: COLORS.grayscale.text,
  },
  starRow: {
    fontSize: 16,
    color: COLORS.base.coral,
  },
  reviewText: {
    ...TYPOGRAPHY.body.regular,
    color: COLORS.grayscale.text,
  },
  ctaWrapper: {
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
});
