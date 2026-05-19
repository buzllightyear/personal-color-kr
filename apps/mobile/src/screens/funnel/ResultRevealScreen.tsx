/**
 * Funnel step 9 — `result_reveal` presentational screen.
 *
 * The locked teaser that ends the Phase 2.3 surface. After the 5,000ms
 * `fake_scan_animation` (step 8) finishes, the user lands here and sees:
 *
 *   - The revealed personal-color category at full fidelity in the headline
 *     ("당신의 카테고리는 ✦ 가을 웜톤 ✦"). This is the *one* piece of
 *     information the user gets for free — it converts the 5-second scan
 *     into a tangible payoff before the unlock CTA.
 *   - The subhead + body copy from `FUNNEL_SCREENS.result_reveal`, both of
 *     which preview *what is still locked* without revealing it: "어울리는
 *     메이크업·코디 + 맞춤 편집 결과는 다음 단계에서 공개돼요" and "전체
 *     진단 카드 · 가이드 텍스트 · 첫 추천 패키지 4종이 잠겨 있어요".
 *   - Three visually distinct locked content assets — one per `assetKey`
 *     listed in `FUNNEL_SCREENS.result_reveal.metadata.lockedAssets`:
 *       1. **full_category_card** — a 16:9 hero card placeholder shaped like
 *          the unlocked full category card a paying user would see.
 *       2. **guide_text** — a stack of three text-line placeholders
 *          representing the locked guide article.
 *       3. **first_curation** — a 2×2 grid of square placeholders
 *          representing the first curation package's 4 items.
 *     Each asset is rendered at `LOCKED_ASSET_PLACEHOLDER_OPACITY` (0.2) so
 *     the *shape* is recognisable but the *content* is suppressed; a
 *     full-bleed overlay at `LOCKED_ASSET_OVERLAY_OPACITY` (0.85) sits on
 *     top and carries the central 🔒 lock icon with an accessibility label
 *     of "잠김" so the screen-reader announces "잠김" instead of the raw
 *     codepoint. No `expo-blur` and no SVG — the Seed constraint pins this
 *     to pure RN built-ins, and the opacity + overlay treatment is what
 *     produces the "you can almost see it" affordance.
 *   - A single primary CTA ("결과 잠금 해제") that advances the funnel to
 *     step 10 (`referral_gate`). The CTA is *hidden* when the screen is
 *     mounted in preview mode (`isPreviewMode === true`) — that branch is
 *     reached via the `/s/<share_token>` recipient deep link and must
 *     remain read-only.
 *
 * Visual rhythm:
 *
 *   ┌───────────────────────────────────────┐
 *   │ Headline:  당신의 카테고리는 ✦ 가을 웜톤 ✦  │
 *   │ Subhead:   어울리는 메이크업·코디 …       │
 *   │ Body:      전체 진단 카드 · 가이드 텍스트 …  │
 *   │                                       │
 *   │ ┌───────────────────────────┐         │  ← full_category_card
 *   │ │ ░░░░░ 16:9 hero card ░░░░ │ 🔒      │     hero placeholder
 *   │ └───────────────────────────┘         │
 *   │                                       │
 *   │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░  🔒      │  ← guide_text (3 lines)
 *   │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░          │
 *   │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░          │
 *   │                                       │
 *   │ ┌────────────┬────────────┐           │  ← first_curation
 *   │ │ ░░░░░░░░░░ │ ░░░░░░░░░░ │   🔒      │     (2×2 grid of squares)
 *   │ ├────────────┼────────────┤           │
 *   │ │ ░░░░░░░░░░ │ ░░░░░░░░░░ │           │
 *   │ └────────────┴────────────┘           │
 *   │                                       │
 *   │ [    결과 잠금 해제    ]                 │  ← primary CTA — hidden
 *   └───────────────────────────────────────┘     in preview mode
 *
 * Constraints (Seed) enforced here:
 *   - Pure StyleSheet.create + RN built-ins. No `expo-blur`,
 *     `react-native-svg`, NativeWind, or Tamagui.
 *   - The 🔒 emoji is a Unicode codepoint in a `<Text>` node with
 *     `accessibilityLabel="잠김"` so screen-readers announce the Korean
 *     word for "locked" rather than the raw glyph.
 *   - Locked asset components are intentionally INTERNAL to this file (not
 *     extracted into `src/components/`). The Seed constraint set explicitly
 *     calls this out: locked assets only render on step 9, so factoring
 *     them into a shared module would create a one-call-site abstraction
 *     for no reuse benefit.
 *   - Preview mode (`isPreviewMode`) is preserved from the Phase 2.1
 *     placeholder behaviour: when active, the CTA is omitted entirely and
 *     the route is read-only. The route wrapper still owns the share_token
 *     → isPreviewMode derivation; this screen receives the flag as a prop.
 *
 * Pattern parity with Phase 2.2 / 2.3 screens:
 *   - Pure props-in / callbacks-out. The route file
 *     (`app/(funnel)/result-reveal.tsx`) is the only place that touches
 *     `expo-router`; this screen receives `isPreviewMode` and `onUnlock`
 *     as plain props so it unit-tests without any router context.
 *   - All Korean copy on the visible content surface flows from
 *     `FUNNEL_SCREENS.result_reveal` (headline, subhead, bodyCopy, primary
 *     CTA label). Internal labels for the locked assets (`'전체 진단 카드'`,
 *     `'가이드 텍스트'`, `'첫 추천 패키지'`) are hardcoded per the constraint
 *     "Korean text hardcoded (no i18n)" — they double as accessibility
 *     labels announcing what is locked behind the overlay.
 *
 * Accessibility:
 *   - The layout root carries `accessibilityLabel="진단 결과 부분 공개"` so
 *     screen-reader users hear the screen's purpose on focus.
 *   - Each locked asset wrapper exposes a stable testID and an
 *     `accessibilityLabel` describing what is locked
 *     (e.g. "전체 진단 카드 잠김"). The 🔒 emoji nested inside has its own
 *     `accessibilityLabel="잠김"` so the locked state is announced
 *     consistently.
 *   - The primary CTA inherits its accessibility surface from
 *     `FunnelPrimaryButton` — VoiceOver/TalkBack announces the Korean CTA
 *     label and the `accessibilityRole="button"` decoration. In preview
 *     mode the CTA is removed from the tree entirely.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

const SCREEN = FUNNEL_SCREENS.result_reveal;

/**
 * Locked asset placeholder opacity (Seed constant). The shape of every
 * locked asset is painted at this opacity so the affordance is *visible*
 * but the content is suppressed.
 */
export const LOCKED_ASSET_PLACEHOLDER_OPACITY = 0.2;

/**
 * Locked asset overlay opacity (Seed constant). A near-opaque overlay
 * sits on top of every locked asset, carrying the 🔒 lock icon. 0.85
 * leaves a faint hint of the underlying placeholder shape visible so the
 * user perceives a layered "behind glass" affordance rather than a flat
 * solid block — without resorting to `expo-blur` (Seed constraint).
 */
export const LOCKED_ASSET_OVERLAY_OPACITY = 0.85;

/**
 * Static metadata-derived asset list. The `lockedAssets` array from
 * FUNNEL_SCREENS.result_reveal.metadata is the source of truth for the
 * three asset keys; we map each key to its visual variant and Korean label
 * here. If FUNNEL_SCREENS ever adds a fourth asset key (Phase 3+), the
 * fail-loud guard below will throw at module load.
 */
type LockedAssetKey = 'full_category_card' | 'guide_text' | 'first_curation';
type LockedAssetVariant = 'hero_card' | 'text_stack' | 'grid_2x2';

interface LockedAssetConfig {
  readonly assetKey: LockedAssetKey;
  readonly variant: LockedAssetVariant;
  readonly koreanLabel: string;
  readonly testID: string;
}

/**
 * Resolve the locked asset list from FUNNEL_SCREENS metadata. Fail-loud at
 * module load if the metadata shape drifts so the build breaks instead of
 * silently rendering the wrong asset set.
 */
function resolveLockedAssets(): readonly LockedAssetConfig[] {
  const metadata = SCREEN.metadata as Readonly<{
    readonly locked: boolean;
    readonly teaserCategory: string;
    readonly lockedAssets: readonly string[];
  }>;
  const keys = metadata.lockedAssets;
  if (keys.length !== 3) {
    throw new Error(
      `FUNNEL_SCREENS.result_reveal expects exactly 3 lockedAssets (got ${keys.length})`,
    );
  }
  const [first, second, third] = keys;
  if (
    first !== 'full_category_card' ||
    second !== 'guide_text' ||
    third !== 'first_curation'
  ) {
    throw new Error(
      `FUNNEL_SCREENS.result_reveal.metadata.lockedAssets order changed: got [${keys.join(', ')}]`,
    );
  }
  return [
    {
      assetKey: 'full_category_card',
      variant: 'hero_card',
      koreanLabel: '전체 진단 카드',
      testID: 'result-reveal-locked-asset-full-category-card',
    },
    {
      assetKey: 'guide_text',
      variant: 'text_stack',
      koreanLabel: '가이드 텍스트',
      testID: 'result-reveal-locked-asset-guide-text',
    },
    {
      assetKey: 'first_curation',
      variant: 'grid_2x2',
      koreanLabel: '첫 추천 패키지',
      testID: 'result-reveal-locked-asset-first-curation',
    },
  ];
}

const LOCKED_ASSETS = resolveLockedAssets();

function requirePrimaryCta(): { readonly label: string } {
  const cta = SCREEN.ctas[0];
  if (cta === undefined) {
    throw new Error('FUNNEL_SCREENS.result_reveal is missing its primary CTA');
  }
  return cta;
}

const PRIMARY_CTA = requirePrimaryCta();

export interface ResultRevealScreenProps {
  /**
   * Phase 2.1 share_token-driven preview mode. When `true`, the primary
   * CTA is omitted entirely so the recipient view (`/s/<share_token>`)
   * stays read-only. Other content (headline, locked assets) renders
   * identically in both modes.
   */
  readonly isPreviewMode: boolean;
  /**
   * Invoked when the user presses the primary "결과 잠금 해제" CTA. Parent
   * wires this to `router.push('/(funnel)/referral-gate')`. Never fires
   * when `isPreviewMode === true` because the CTA is not rendered in that
   * branch.
   */
  readonly onUnlock: () => void;
}

export function ResultRevealScreen(
  props: ResultRevealScreenProps,
): React.ReactElement {
  const { isPreviewMode, onUnlock } = props;

  return (
    <FunnelScreenLayout
      testID="result-reveal-screen"
      accessibilityLabel="진단 결과 부분 공개"
    >
      <FunnelHeadline
        headline={SCREEN.headline}
        subhead={SCREEN.subhead}
        testIDPrefix="result-reveal"
      />
      {SCREEN.bodyCopy !== null && (
        <Text style={styles.bodyCopy} testID="result-reveal-body-copy">
          {SCREEN.bodyCopy}
        </Text>
      )}
      <View style={styles.assetStack} testID="result-reveal-locked-asset-list">
        {LOCKED_ASSETS.map((asset) => (
          <LockedAsset key={asset.assetKey} config={asset} />
        ))}
      </View>
      {!isPreviewMode && (
        <View style={styles.ctaWrapper}>
          <FunnelPrimaryButton
            label={PRIMARY_CTA.label}
            onPress={onUnlock}
            testID="result-reveal-unlock-cta"
            accessibilityLabel={PRIMARY_CTA.label}
          />
        </View>
      )}
    </FunnelScreenLayout>
  );
}

// ---------------------------------------------------------------------------
// Internal locked-asset components — intentionally NOT extracted to
// src/components/funnel/. Per the Seed constraint these only render on step
// 9; extracting them would create a one-call-site abstraction for no reuse.
// ---------------------------------------------------------------------------

interface LockedAssetProps {
  readonly config: LockedAssetConfig;
}

/**
 * Single locked content asset wrapper. Renders the placeholder shape at
 * `LOCKED_ASSET_PLACEHOLDER_OPACITY`, layers the overlay at
 * `LOCKED_ASSET_OVERLAY_OPACITY` on top, and centres the 🔒 lock icon
 * inside the overlay. The wrapper itself carries an `accessibilityLabel`
 * naming what is locked ("전체 진단 카드 잠김") so the screen reader
 * announces the locked state coherently.
 */
function LockedAsset(props: LockedAssetProps): React.ReactElement {
  const { config } = props;
  return (
    <View
      style={styles.lockedAssetWrapper}
      testID={config.testID}
      accessibilityLabel={`${config.koreanLabel} 잠김`}
    >
      <View
        style={[styles.lockedAssetPlaceholder, { opacity: LOCKED_ASSET_PLACEHOLDER_OPACITY }]}
        testID={`${config.testID}-placeholder`}
      >
        <LockedAssetPlaceholderContent variant={config.variant} testIDPrefix={config.testID} />
      </View>
      <View
        style={[styles.lockedAssetOverlay, { opacity: LOCKED_ASSET_OVERLAY_OPACITY }]}
        testID={`${config.testID}-overlay`}
      >
        <Text
          style={styles.lockIcon}
          testID={`${config.testID}-lock-icon`}
          accessibilityLabel="잠김"
        >
          🔒
        </Text>
        <Text style={styles.lockedAssetLabel}>{config.koreanLabel}</Text>
      </View>
    </View>
  );
}

interface LockedAssetPlaceholderContentProps {
  readonly variant: LockedAssetVariant;
  readonly testIDPrefix: string;
}

/**
 * Variant-specific placeholder geometry. Each variant produces a visually
 * distinct shape so the three locked assets read as different content
 * types even at 0.2 opacity behind the overlay:
 *
 *   - `hero_card`  → a single 16:9 block (the full category card).
 *   - `text_stack` → three horizontal bars representing text lines.
 *   - `grid_2x2`   → a 2-column × 2-row grid of square cells representing
 *                    the first curation package's 4 items.
 */
function LockedAssetPlaceholderContent(
  props: LockedAssetPlaceholderContentProps,
): React.ReactElement {
  const { variant, testIDPrefix } = props;
  if (variant === 'hero_card') {
    return (
      <View
        style={styles.heroCardBlock}
        testID={`${testIDPrefix}-hero-card`}
      />
    );
  }
  if (variant === 'text_stack') {
    return (
      <View style={styles.textStack} testID={`${testIDPrefix}-text-stack`}>
        <View style={styles.textLine} />
        <View style={styles.textLine} />
        <View style={styles.textLine} />
      </View>
    );
  }
  // grid_2x2 — 2 columns × 2 rows.
  return (
    <View style={styles.grid2x2} testID={`${testIDPrefix}-grid-2x2`}>
      <View style={styles.gridRow}>
        <View style={styles.gridCell} />
        <View style={styles.gridCell} />
      </View>
      <View style={styles.gridRow}>
        <View style={styles.gridCell} />
        <View style={styles.gridCell} />
      </View>
    </View>
  );
}

const HERO_CARD_ASPECT_HEIGHT = 180;
const TEXT_LINE_HEIGHT = 16;
const GRID_CELL_SIZE = 80;

const styles = StyleSheet.create({
  bodyCopy: {
    ...TYPOGRAPHY.body.regular,
    color: COLORS.grayscale.text,
    paddingTop: SPACING.md,
  },
  assetStack: {
    flex: 1,
    paddingTop: SPACING.lg,
    gap: SPACING.lg,
  },
  lockedAssetWrapper: {
    position: 'relative',
    borderRadius: SPACING.md,
    overflow: 'hidden',
    backgroundColor: COLORS.base.pink,
    borderWidth: 1,
    borderColor: COLORS.grayscale.border,
  },
  lockedAssetPlaceholder: {
    padding: SPACING.md,
  },
  lockedAssetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.grayscale.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
  lockIcon: {
    fontSize: 32,
  },
  lockedAssetLabel: {
    ...TYPOGRAPHY.body.bold,
    color: COLORS.grayscale.text,
    textAlign: 'center',
  },
  heroCardBlock: {
    height: HERO_CARD_ASPECT_HEIGHT,
    borderRadius: SPACING.sm,
    backgroundColor: COLORS.season.autumn,
  },
  textStack: {
    gap: SPACING.sm,
  },
  textLine: {
    height: TEXT_LINE_HEIGHT,
    borderRadius: SPACING.xxs,
    backgroundColor: COLORS.grayscale.text,
  },
  grid2x2: {
    gap: SPACING.sm,
  },
  gridRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  gridCell: {
    width: GRID_CELL_SIZE,
    height: GRID_CELL_SIZE,
    borderRadius: SPACING.sm,
    backgroundColor: COLORS.base.blush,
  },
  ctaWrapper: {
    paddingBottom: SPACING.xl,
  },
});
