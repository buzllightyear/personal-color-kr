/**
 * Funnel step 2 — `value_props` presentational screen.
 *
 * 3 vertical-stack cards inside a ScrollView, sourced from
 * `FUNNEL_SCREENS.value_props.metadata.valueProps` (3 keys). Each card pairs
 * a Korean title + description with an emoji glyph and a season accent
 * border. CTA "다음" advances to step 3 (onboarding_priming).
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { COLORS, SPACING, TYPOGRAPHY, type SeasonKey } from '../../theme';

export interface ValuePropsScreenProps {
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

interface CardConfig {
  readonly key: string;
  readonly emoji: string;
  readonly title: string;
  readonly description: string;
  readonly season: SeasonKey;
}

/**
 * Card content sourced from FUNNEL_SCREENS.value_props.metadata.valueProps
 * keys ['trend_matched_editing', 'monthly_curated_magazine',
 * 'personal_color_preset_library'].  The Korean copy + emoji + season accent
 * are owned by this screen (the metadata only carries the identifier keys).
 */
const CARDS: readonly CardConfig[] = [
  {
    key: 'trend_matched_editing',
    emoji: '🎨',
    title: '트렌드를 내 얼굴에',
    description: '퍼스널 컬러 기반 자동 편집 preset',
    season: 'spring',
  },
  {
    key: 'monthly_curated_magazine',
    emoji: '📖',
    title: '매월 새로운 스타일',
    description: '엄선된 컬러 매거진을 매월 업데이트',
    season: 'summer',
  },
  {
    key: 'personal_color_preset_library',
    emoji: '🎭',
    title: '내 컬러 preset 라이브러리',
    description: '저장하고 언제든 적용하는 맞춤 preset',
    season: 'autumn',
  },
];

export function ValuePropsScreen(
  props: ValuePropsScreenProps,
): React.ReactElement {
  const { onNext } = props;
  return (
    <FunnelScreenLayout
      testID="value-props-screen"
      accessibilityLabel="가치 제안"
    >
      <FunnelHeadline
        headline={SCREEN.headline}
        subhead={SCREEN.subhead}
        testIDPrefix="value-props"
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="value-props-card-list"
      >
        {CARDS.map((card) => (
          <View
            key={card.key}
            style={[
              styles.card,
              { borderLeftColor: COLORS.season[card.season] },
            ]}
            testID={`value-props-card-${card.key.replace(/_/g, '-')}`}
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
          testID="value-props-cta"
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
