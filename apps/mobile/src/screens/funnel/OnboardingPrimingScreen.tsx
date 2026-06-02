/**
 * Funnel step 3 — `onboarding_priming` presentational screen.
 *
 * Two single-select segmented-control questions wired to
 * `FunnelStateContext.onboarding`. The consistency-lever priming mechanism
 * (metadata.primingMechanism) requires both questions answered before the
 * primary CTA enables — `setOnboarding` persists each answer immediately so
 * the rating_gate downstream sees the latched selection.
 *
 * Korean option labels are owned by this screen (the contract module
 * declares the enum domain; the screen surfaces the user-facing copy).
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';
import type {
  FunnelOnboardingAnswers,
  PriorDiagnosis,
  SelfieEditStyle,
} from '../../contracts/funnel-state';

export interface OnboardingPrimingScreenProps {
  readonly onboarding: FunnelOnboardingAnswers;
  readonly onSelectSelfieEditStyle: (value: SelfieEditStyle) => void;
  readonly onSelectPriorDiagnosis: (value: PriorDiagnosis) => void;
  readonly onNext: () => void;
}

const SCREEN = FUNNEL_SCREENS.onboarding_priming;

function requirePrimaryCta(): { readonly label: string } {
  const cta = SCREEN.ctas[0];
  if (cta === undefined) {
    throw new Error('FUNNEL_SCREENS.onboarding_priming is missing its primary CTA');
  }
  return cta;
}

const PRIMARY_CTA = requirePrimaryCta();

interface SelfieEditOption {
  readonly value: SelfieEditStyle;
  readonly label: string;
  readonly testIdSuffix: string;
}
interface PriorDiagnosisOption {
  readonly value: PriorDiagnosis;
  readonly label: string;
  readonly testIdSuffix: string;
}

const SELFIE_EDIT_OPTIONS: readonly SelfieEditOption[] = [
  { value: 'natural', label: '자연스럽게', testIdSuffix: 'natural' },
  { value: 'subtle', label: '가볍게', testIdSuffix: 'subtle' },
  { value: 'expressive', label: '적극적으로', testIdSuffix: 'expressive' },
];

const PRIOR_DIAGNOSIS_OPTIONS: readonly PriorDiagnosisOption[] = [
  { value: 'never', label: '처음이에요', testIdSuffix: 'never' },
  { value: 'self_test', label: '셀프 테스트', testIdSuffix: 'self-test' },
  { value: 'professional', label: '전문가 진단', testIdSuffix: 'professional' },
];

export function OnboardingPrimingScreen(
  props: OnboardingPrimingScreenProps,
): React.ReactElement {
  const { onboarding, onSelectSelfieEditStyle, onSelectPriorDiagnosis, onNext } = props;

  const bothAnswered =
    onboarding.selfieEditStyle !== null && onboarding.priorDiagnosis !== null;

  return (
    <FunnelScreenLayout
      testID="onboarding-priming-screen"
      accessibilityLabel="온보딩 질문"
    >
      <FunnelHeadline
        headline={SCREEN.headline}
        subhead={SCREEN.subhead}
        testIDPrefix="onboarding-priming"
      />
      <View style={styles.questionStack}>
        <View testID="onboarding-priming-q1">
          <Text style={styles.questionLabel}>당신의 셀카 편집 스타일은?</Text>
          <View style={styles.optionRow}>
            {SELFIE_EDIT_OPTIONS.map((option) => {
              const selected = onboarding.selfieEditStyle === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onSelectSelfieEditStyle(option.value)}
                  style={[styles.optionPill, selected && styles.optionPillSelected]}
                  testID={`onboarding-priming-q1-option-${option.testIdSuffix}`}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[styles.optionLabel, selected && styles.optionLabelSelected]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View testID="onboarding-priming-q2">
          <Text style={styles.questionLabel}>
            퍼스널 컬러 진단을 받아본 적이 있나요?
          </Text>
          <View style={styles.optionRow}>
            {PRIOR_DIAGNOSIS_OPTIONS.map((option) => {
              const selected = onboarding.priorDiagnosis === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onSelectPriorDiagnosis(option.value)}
                  style={[styles.optionPill, selected && styles.optionPillSelected]}
                  testID={`onboarding-priming-q2-option-${option.testIdSuffix}`}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[styles.optionLabel, selected && styles.optionLabelSelected]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      <View style={styles.ctaWrapper}>
        <FunnelPrimaryButton
          label={PRIMARY_CTA.label}
          onPress={onNext}
          disabled={!bothAnswered}
          testID="onboarding-priming-submit"
          accessibilityLabel="계속"
        />
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  questionStack: {
    flex: 1,
    gap: SPACING.xl,
    paddingTop: SPACING.lg,
  },
  questionLabel: {
    ...TYPOGRAPHY.body.bold,
    color: COLORS.grayscale.text,
    marginBottom: SPACING.sm,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  optionPill: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.grayscale.border,
    backgroundColor: COLORS.grayscale.background,
  },
  optionPillSelected: {
    backgroundColor: COLORS.base.coral,
    borderColor: COLORS.base.coral,
  },
  optionLabel: {
    ...TYPOGRAPHY.button.medium,
    color: COLORS.grayscale.text,
  },
  optionLabelSelected: {
    color: COLORS.grayscale.background,
  },
  ctaWrapper: {
    paddingBottom: SPACING.xl,
  },
});
