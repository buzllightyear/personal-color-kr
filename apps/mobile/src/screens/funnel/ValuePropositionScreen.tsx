/**
 * Funnel step 2 — `value_props` presentational screen (moat rework).
 *
 * ValuePropositionScreen replaces the old ValuePropsScreen, removing the
 * "월간 매거진" benefit (월간 매거진 포맷 금지) and aligning the three
 * benefit cards with the new moat direction:
 *
 *   1. 트렌드 맞춤 사진 생성 — core generation moat
 *   2. 트렌드 드롭 알림     — refresh/retention engine
 *   3. 내 컬러 recipe 추천  — personal-colour wedge hook
 *
 * Headline + CTA label are sourced from `FUNNEL_SCREENS.value_props` (single
 * source of truth for funnel copy). Card content is defined in-module so the
 * moat copy never references magazine cadence or appearance language.
 *
 * Moat note: "monthly_curated_magazine" is intentionally absent — the
 * retention vehicle is trend drops (event-triggered), not monthly cadence
 * (Seed constraint: 월간 매거진 포맷 금지, retention = 트렌드 드롭).
 *
 * Generation pipeline awareness: benefits surface the generation pipeline
 * (raw → enhancer → pick) as value, not raw AI output — consistent with the
 * Seed moat (생짜 Fal.ai 출력 금지, de-slop enhancer 세공 층 필수).
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { COLORS, SPACING, TYPOGRAPHY, type SeasonKey } from '../../theme';

export interface ValuePropositionScreenProps {
  readonly onNext: () => void;
}

const SCREEN = FUNNEL_SCREENS.value_props;

function requirePrimaryCta(): { readonly label: string } {
  const cta = SCREEN.ctas[0];
  if (cta === undefined) {
    throw new Error('FUNNEL_SCREENS.value_props is missing its primary CTA');
  }
  return cta;
}

const PRIMARY_CTA = requirePrimaryCta();

interface BenefitCardConfig {
  readonly key: string;
  readonly emoji: string;
  readonly title: string;
  readonly description: string;
  readonly season: SeasonKey;
}

/**
 * Moat-aligned benefit cards (3 items, no monthly magazine).
 *
 * Key           → moat axis
 * ──────────────────────────────────────────────────────────────────────────
 * trend_matched_generation → core generation pipeline (raw→enhancer→pick)
 * trend_drop_freshness     → retention engine (트렌드 드롭 이벤트 트리거)
 * personal_color_recipe    → entry wedge / hook (퍼스널 컬러 진단)
 *
 * Intentionally absent: monthly_curated_magazine (Seed: 월간 매거진 포맷 금지).
 */
const BENEFIT_CARDS: readonly BenefitCardConfig[] = [
  {
    key: 'trend_matched_generation',
    emoji: '🎨',
    title: '트렌드 맞춤 사진 생성',
    description: '퍼스널 컬러 기반 recipe로 셀카 1장을 바로 생성',
    season: 'spring',
  },
  {
    key: 'trend_drop_freshness',
    emoji: '🔔',
    title: '트렌드 드롭 알림',
    description: '새 트렌드가 뜰 때마다 먼저 알려드려요',
    season: 'summer',
  },
  {
    key: 'personal_color_recipe',
    emoji: '🎭',
    title: '내 컬러 recipe 추천',
    description: '퍼스널 컬러로 자동 매칭된 de-slop 보정 결과',
    season: 'autumn',
  },
];

export function ValuePropositionScreen(
  props: ValuePropositionScreenProps,
): React.ReactElement {
  const { onNext } = props;
  return (
    <FunnelScreenLayout
      testID="value-proposition-screen"
      accessibilityLabel="가치 제안"
    >
      <FunnelHeadline
        headline={SCREEN.headline}
        subhead={SCREEN.subhead}
        testIDPrefix="value-proposition"
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="value-proposition-benefit-list"
      >
        {BENEFIT_CARDS.map((card) => (
          <View
            key={card.key}
            style={[styles.card, { borderLeftColor: COLORS.season[card.season] }]}
            testID={`value-proposition-benefit-${card.key.replace(/_/g, '-')}`}
            accessibilityRole="text"
          >
            <Text style={styles.emoji}>{card.emoji}</Text>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardDescription}>{card.description}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.ctaWrapper}>
        <FunnelPrimaryButton
          label={PRIMARY_CTA.label}
          onPress={onNext}
          testID="value-proposition-cta"
          accessibilityLabel="다음"
        />
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    marginTop: SPACING.lg,
  },
  scrollContent: {
    gap: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  card: {
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.md,
    borderLeftWidth: 4,
    borderRadius: SPACING.sm,
    backgroundColor: COLORS.base.pink,
    alignItems: 'center',
  },
  emoji: {
    fontSize: 32,
  },
  cardText: {
    flex: 1,
    gap: SPACING.xxs,
  },
  cardTitle: {
    ...TYPOGRAPHY.body.bold,
    color: COLORS.grayscale.text,
  },
  cardDescription: {
    ...TYPOGRAPHY.caption.regular,
    color: COLORS.grayscale.text,
  },
  ctaWrapper: {
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
});
