/**
 * `ResultPreviewScreen` — generation result preview component (Sub-AC 14a-2).
 *
 * Presentational screen that shows users a preview of what the generation
 * pipeline produces BEFORE they submit their own selfie. This is the moat-
 * aligned "결과 프리뷰" component from the funnel:
 *
 *   - **샘플 이미지 슬롯 (sample image slots)**: Three placeholder slots
 *     representing pre-generated sample photos across the spring/autumn/winter
 *     season palettes. The slots are visual affordances showing the *shape* of
 *     the generation output (4:3 cards with season-accent fills) so the user
 *     understands what the pipeline produces before submitting their selfie.
 *     Slot geometry is fixed at 3 cards; the slot content (accent colour + label)
 *     is defined in the module-level `SAMPLE_IMAGE_SLOTS` constant.
 *
 *   - **트렌드 태그 (trend tags)**: Inline tag chips passed in as
 *     `trendTags: readonly string[]`. The parent sources these from the active
 *     trend entity (e.g. `['#가을 웜톤 트렌드', '#셀피 감성']`). The number
 *     of tags is caller-controlled; the component renders all of them
 *     horizontally, wrapping on overflow.
 *
 *   - **생성 예시 텍스트 (generation example text)**: A single copy string
 *     passed in as `generationExampleText`. The caller sources this from the
 *     single voice config (e.g. `getSelectionPrompt()` from
 *     `core-ts/generation/funnel-copy.ts`). The string is rendered verbatim —
 *     the component is copy-agnostic.
 *
 * Visual rhythm:
 *
 *   ┌───────────────────────────────────────┐
 *   │ Headline: 이런 사진이 나와요             │
 *   │ Subhead:  퍼스널 컬러 recipe로 보정된 예시 │
 *   │                                       │
 *   │ [#가을 웜톤 트렌드] [#셀피 감성] …       │  ← trend tags (chips)
 *   │                                       │
 *   │ ┌──────────┐ ┌──────────┐ ┌──────────┐ │  ← sample image slots
 *   │ │ 봄 예시   │ │ 가을 예시  │ │ 겨울 예시  │ │    (horizontal scroll)
 *   │ └──────────┘ └──────────┘ └──────────┘ │
 *   │                                       │
 *   │ "마음에 드는 한 장을 고르세요"            │  ← generation example text
 *   │                                       │
 *   │ [ 내 셀카로 생성하기 ]                  │  ← primary CTA
 *   └───────────────────────────────────────┘
 *
 * Design contract (Seed Sub-AC 14a-2):
 *   - Pure props-in / callbacks-out. The route file owns any router / context
 *     coupling; this screen receives `trendTags`, `generationExampleText`, and
 *     `onGenerate` as plain props so it unit-tests without any router context.
 *   - No raw AI output surfaces on this screen — sample slots are static design
 *     placeholders, NOT live Fal.ai calls (Seed: "생짜 Fal.ai 출력 금지").
 *   - Korean headline and subhead are hardcoded per the "Korean text hardcoded
 *     (no i18n)" convention; they are invariant across personal-colour segments.
 *   - The `trendTags` and `generationExampleText` props are intentionally left
 *     to the caller so the trend data (recipe-derived tags) and voice config
 *     copy flow through the same pipeline that drives the rest of the app.
 *   - Pure StyleSheet.create + RN built-ins. No expo-blur, SVG, NativeWind,
 *     or Tamagui (Seed constraint: pure RN).
 *
 * Accessibility:
 *   - Layout root: `accessibilityLabel="결과 프리뷰"` — screen reader announces
 *     the screen purpose on focus.
 *   - Each sample slot carries an `accessibilityLabel` naming the season
 *     example (e.g. "봄 웜톤 생성 예시") so VoiceOver/TalkBack describes the
 *     content.
 *   - Trend tag chips carry the tag string as the accessible label (the
 *     rendered text IS the announcement).
 *   - Generation example text is a plain `<Text>` node — screen reader reads
 *     the string content verbatim.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { COLORS, SPACING, TYPOGRAPHY, type SeasonKey } from '../../theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single sample image slot configuration.
 *
 * Slots are static design affordances (NOT live AI output) that show the
 * *shape* of the generation pipeline's output across three seasonal palettes.
 * The `seasonAccent` drives the card background colour from the `COLORS.season`
 * token; the `label` is the Korean string rendered inside the card and used as
 * the accessibility label.
 */
interface SampleImageSlotConfig {
  /** Stable slot identifier (kebab-case). */
  readonly slotId: string;
  /** Season palette accent for the slot background fill. */
  readonly seasonAccent: SeasonKey;
  /** Korean label describing this sample (also the a11y label). */
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Static slot data
// ---------------------------------------------------------------------------

/**
 * Three static sample image slots — one per season palette used in the funnel.
 *
 * Summer is intentionally absent in v1 (3-slot horizontal layout fits the
 * standard phone width; 4 slots would require horizontal scroll or shrink the
 * cards). Spring, autumn, and winter cover the warm/cool split that the majority
 * of Korean personal-color diagnostics resolve to.
 *
 * Slot order is canonical: spring (brightest/warmest) → autumn (warm-deep) →
 * winter (cool-deep). This follows the standard 4-season Korean personal-color
 * ordering taught in professional diagnosis courses.
 */
export const SAMPLE_IMAGE_SLOTS: readonly SampleImageSlotConfig[] = [
  {
    slotId: 'spring',
    seasonAccent: 'spring',
    label: '봄 웜톤 생성 예시',
  },
  {
    slotId: 'autumn',
    seasonAccent: 'autumn',
    label: '가을 웜톤 생성 예시',
  },
  {
    slotId: 'winter',
    seasonAccent: 'winter',
    label: '겨울 쿨톤 생성 예시',
  },
];

// ---------------------------------------------------------------------------
// Screen-level copy constants
// ---------------------------------------------------------------------------

/**
 * Korean headline rendered at the top of the screen.
 * Hardcoded per the "Korean text hardcoded (no i18n)" convention — this copy
 * is invariant across personal-colour segments and trend variants.
 */
export const RESULT_PREVIEW_HEADLINE = '이런 사진이 나와요';

/**
 * Korean subhead rendered immediately below the headline.
 * Describes the moat — "퍼스널 컬러 recipe로 보정된 생성 예시" signals that
 * the samples are de-slop-enhanced, not raw AI output.
 */
export const RESULT_PREVIEW_SUBHEAD = '퍼스널 컬러 recipe로 보정된 생성 예시';

/**
 * Korean CTA label.
 * "내 셀카로 생성하기" is the invitation to start the selfie upload + generation
 * pipeline. The verb "생성하기" (to generate) is the moat-aligned frame —
 * the user's selfie becomes a generated photo, not a filtered one.
 */
export const RESULT_PREVIEW_CTA_LABEL = '내 셀카로 생성하기';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ResultPreviewScreenProps {
  /**
   * Trend tag strings displayed as inline chips above the sample slots.
   *
   * The caller sources these from the active trend entity's recipe
   * (e.g. `['#가을 웜톤 트렌드', '#셀피 감성']`). An empty array is valid —
   * the chip row is simply not rendered. The component does NOT derive tags
   * from the voice config; tag content is trend-specific data that flows
   * through the trend → recipe pipeline.
   */
  readonly trendTags: readonly string[];
  /**
   * Copy string for the "generation example text" block below the sample
   * slots.
   *
   * The caller sources this from the single voice config, typically via
   * `getSelectionPrompt()` from `core-ts/generation/funnel-copy.ts`
   * (e.g. `"마음에 드는 한 장을 고르세요"`). The string is rendered verbatim —
   * the component is copy-agnostic and has no fallback.
   */
  readonly generationExampleText: string;
  /**
   * CTA callback. Parent wires this to proceed to the next funnel step
   * (typically the selfie upload / diagnosis_input step). The button always
   * renders (not gated by any flag); the parent is responsible for showing
   * this screen only when the user should be invited to generate.
   */
  readonly onGenerate: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the generation result preview screen.
 *
 * Shows three sample image slots (static palette placeholders), trend tag
 * chips, generation example copy, and a "내 셀카로 생성하기" CTA — all
 * without touching a live AI call (Seed: 생짜 Fal.ai 출력 금지).
 *
 * @see ResultPreviewScreenProps
 */
export function ResultPreviewScreen(
  props: ResultPreviewScreenProps,
): React.ReactElement {
  const { trendTags, generationExampleText, onGenerate } = props;

  return (
    <FunnelScreenLayout
      testID="result-preview-screen"
      accessibilityLabel="결과 프리뷰"
    >
      <FunnelHeadline
        headline={RESULT_PREVIEW_HEADLINE}
        subhead={RESULT_PREVIEW_SUBHEAD}
        testIDPrefix="result-preview"
      />

      {/* ─── Trend tag chips ──────────────────────────────────────────────── */}
      {trendTags.length > 0 && (
        <View style={styles.trendTagRow} testID="result-preview-trend-tag-list">
          {trendTags.map((tag, index) => (
            <View
              key={index}
              style={styles.trendTag}
              testID={`result-preview-trend-tag-${index}`}
              accessibilityLabel={tag}
            >
              <Text style={styles.trendTagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ─── Sample image slots (horizontal scroll) ───────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.sampleSlotScroll}
        contentContainerStyle={styles.sampleSlotScrollContent}
        testID="result-preview-sample-slot-list"
      >
        {SAMPLE_IMAGE_SLOTS.map((slot) => (
          <View
            key={slot.slotId}
            style={[
              styles.sampleSlot,
              { backgroundColor: COLORS.season[slot.seasonAccent] },
            ]}
            testID={`result-preview-sample-slot-${slot.slotId}`}
            accessibilityLabel={slot.label}
          >
            <Text style={styles.sampleSlotLabel}>{slot.label}</Text>
          </View>
        ))}
      </ScrollView>

      {/* ─── Generation example text ──────────────────────────────────────── */}
      <Text
        style={styles.generationExampleText}
        testID="result-preview-generation-example-text"
      >
        {generationExampleText}
      </Text>

      {/* ─── Primary CTA ──────────────────────────────────────────────────── */}
      <View style={styles.ctaWrapper}>
        <FunnelPrimaryButton
          label={RESULT_PREVIEW_CTA_LABEL}
          onPress={onGenerate}
          testID="result-preview-cta"
          accessibilityLabel={RESULT_PREVIEW_CTA_LABEL}
        />
      </View>
    </FunnelScreenLayout>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Height of each sample image slot card. 4:3 aspect on a 120px-wide card. */
const SAMPLE_SLOT_WIDTH = 120;
const SAMPLE_SLOT_HEIGHT = 90;

const styles = StyleSheet.create({
  trendTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  trendTag: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
    borderRadius: 999,
    backgroundColor: COLORS.base.blush,
    borderWidth: 1,
    borderColor: COLORS.base.coral,
  },
  trendTagText: {
    ...TYPOGRAPHY.caption.regular,
    color: COLORS.grayscale.text,
  },
  sampleSlotScroll: {
    marginTop: SPACING.lg,
  },
  sampleSlotScrollContent: {
    gap: SPACING.md,
    paddingBottom: SPACING.xs,
  },
  sampleSlot: {
    width: SAMPLE_SLOT_WIDTH,
    height: SAMPLE_SLOT_HEIGHT,
    borderRadius: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xs,
  },
  sampleSlotLabel: {
    ...TYPOGRAPHY.caption.regular,
    color: COLORS.grayscale.background,
    textAlign: 'center',
  },
  generationExampleText: {
    ...TYPOGRAPHY.body.regular,
    color: COLORS.grayscale.text,
    marginTop: SPACING.lg,
    textAlign: 'center',
  },
  ctaWrapper: {
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
});
