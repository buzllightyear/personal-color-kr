/**
 * Funnel step 2 — `value_props` presentational screen.
 *
 * 3 value propositions sourced from
 * `FUNNEL_SCREENS.value_props.metadata.valueProps` keys, rendered as an
 * editorial/VSCO list: a tracked index numeral + Korean title + muted
 * description per row, separated by hairlines. No card fills, season borders,
 * or emoji (see docs/DESIGN.md — chrome is monochrome, icons are line/none).
 * CTA "다음" advances to step 3 (onboarding_priming).
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { SPACING } from '../../theme';
import { FONT, INK } from '../../theme/editorial';

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
  readonly title: string;
  readonly description: string;
}

/**
 * Value-prop content sourced from FUNNEL_SCREENS.value_props.metadata.valueProps
 * keys ['trend_matched_editing', 'monthly_curated_magazine',
 * 'personal_color_preset_library']. The Korean copy is owned by this screen
 * (the metadata only carries the identifier keys).
 */
const CARDS: readonly CardConfig[] = [
  {
    key: 'trend_matched_editing',
    title: '트렌드를 내 얼굴에',
    description: '퍼스널 컬러 기반 자동 편집 preset',
  },
  {
    key: 'monthly_curated_magazine',
    title: '매월 새로운 스타일',
    description: '엄선된 컬러 매거진을 매월 업데이트',
  },
  {
    key: 'personal_color_preset_library',
    title: '내 컬러 preset 라이브러리',
    description: '저장하고 언제든 적용하는 맞춤 preset',
  },
];

/** Two-digit tracked index numeral, e.g. 0 → "01". */
function indexLabel(i: number): string {
  return String(i + 1).padStart(2, '0');
}

export function ValuePropsScreen(props: ValuePropsScreenProps): React.ReactElement {
  const { onNext } = props;
  return (
    <FunnelScreenLayout testID="value-props-screen" accessibilityLabel="가치 제안">
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
        {CARDS.map((card, i) => (
          <View
            key={card.key}
            style={styles.row}
            testID={`value-props-card-${card.key.replace(/_/g, '-')}`}
            accessibilityRole="text"
          >
            <Text style={styles.index}>{indexLabel(i)}</Text>
            <View style={styles.rowText}>
              <Text style={styles.title}>{card.title}</Text>
              <Text style={styles.description}>{card.description}</Text>
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
    marginTop: SPACING.xl,
  },
  scrollContent: {
    paddingBottom: SPACING.lg,
  },
  row: {
    flexDirection: 'row',
    gap: SPACING.md,
    paddingVertical: SPACING.lg,
    alignItems: 'flex-start',
    // Hairline divider above each row — editorial table, not cards.
    borderTopWidth: 1,
    borderTopColor: INK.line,
  },
  index: {
    fontFamily: FONT.regular,
    fontSize: 13,
    letterSpacing: 1,
    lineHeight: 22,
    color: INK.faint,
  },
  rowText: {
    flex: 1,
    gap: SPACING.xxs,
  },
  title: {
    fontFamily: FONT.medium,
    fontSize: 16,
    lineHeight: 22,
    color: INK.primary,
  },
  description: {
    fontFamily: FONT.regular,
    fontSize: 13,
    lineHeight: 20,
    color: INK.muted,
  },
  ctaWrapper: {
    paddingTop: SPACING.lg,
  },
});
