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
 *
 *     Phase 2.4 AC 12 adds a premium branch: when `isPremium === true` the
 *     overlay (and its 🔒 emoji with `accessibilityLabel="잠김"`) is
 *     stripped from every asset, the wrapper `accessibilityLabel` no longer
 *     contains "잠김", and the placeholder shape renders at full opacity.
 *     The placeholder geometry itself is preserved across both branches
 *     because Phase 2.5 is where real unlocked content replaces the
 *     placeholders — AC 12's contract is strictly the removal of the lock
 *     surface, not content replacement.
 *   - A single primary CTA ("친구와 공유하고 잠금 해제") that advances the
 *     funnel to step 10 (`referral_gate`). The CTA is *hidden* when the
 *     screen is mounted in preview mode (`isPreviewMode === true`) — that
 *     branch is reached via the `/s/<share_token>` recipient deep link and
 *     must remain read-only. Phase 2.4 adds a second hidden-branch: when
 *     `isPremium === true` (the user has completed the placeholder payment
 *     flow), the share-to-unlock CTA is also omitted because the content
 *     is no longer locked. The CTA therefore renders exactly when
 *     `isPreviewMode === false` AND `isPremium === false`.
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
 *   │ [ 친구와 공유하고 잠금 해제 ]              │  ← primary CTA — hidden
 *   └───────────────────────────────────────┘     when isPreviewMode=true
 *                                                  OR isPremium=true
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
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
} from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { SPACING } from '../../theme';
import { FONT, INK } from '../../theme/editorial';
import { LockIcon } from '../../components/icons/LockIcon';
import { buildResultHeadline } from '../../diagnosis-category';
import type { DiagnosisResult } from '../../request-diagnosis';

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

// `PRIMARY_CTA` (sourced from `FUNNEL_SCREENS.result_reveal.ctas[0]`) carries
// the legacy Phase 2.3 label "결과 잠금 해제". It is intentionally retained as
// a module-level binding so the fail-loud guard for missing CTA metadata still
// runs at module load and so any future analytics consumer that wants the
// canonical CTA-action string ("unlock_result") can still read it from the
// FUNNEL_SCREENS source of truth. The rendered button label, however, is the
// hardcoded `SHARE_UNLOCK_CTA_LABEL` below — see Phase 2.4 rationale.
//
// Note: keeping `requirePrimaryCta()` invoked at module load (rather than
// inlined into the render path) preserves the build-time invariant: if
// FUNNEL_SCREENS.result_reveal.ctas[0] ever disappears, the module fails to
// load instead of silently rendering a button with no analytics action.
void requirePrimaryCta();

/**
 * Hardcoded Phase 2.4 CTA label rendered on the primary "share-to-unlock"
 * button when the screen is in the default (non-preview, non-premium) branch.
 *
 * Why this is a module-level constant (and not sourced from FUNNEL_SCREENS):
 *   - The Seed-derived Phase 2.4 flow re-frames the unlock CTA from a generic
 *     "결과 잠금 해제" into the *referral-gated* "친구와 공유하고 잠금 해제"
 *     — the CTA now advertises the upcoming share step rather than the
 *     abstract unlock. FUNNEL_SCREENS.result_reveal.ctas[0].label still reads
 *     as the canonical Phase 2.3 label so analytics and other surfaces are
 *     undisturbed; the UI surface for this screen now renders the new
 *     Phase 2.4 label.
 *   - Hardcoding the new label here (instead of editing FUNNEL_SCREENS)
 *     follows the Seed pattern "Korean text hardcoded (no i18n)" used for
 *     locked-asset labels and matches the established pattern of
 *     "screen-local Korean copy that is not part of the shared analytics
 *     contract".
 *   - Hoisted as a `const` (not a function) so the value is referentially
 *     stable across re-renders, which keeps `FunnelPrimaryButton`'s
 *     `accessibilityLabel` reference comparison cheap and predictable.
 */
export const SHARE_UNLOCK_CTA_LABEL = '친구와 공유하고 잠금 해제';

/**
 * Secondary CTA label that enters the content-generation home (recipe
 * catalog). The diagnosis result is the moment the user has just signed in
 * (the Apple Sign In gate is funnel step 7, upstream of this step 9), so this
 * is the earliest point a real JWT exists — which the auth-gated catalog
 * (`GET /v1/recipes`) needs. The catalog is deliberately decoupled from the
 * funnel's share-to-unlock / payment path: browsing trends is free after
 * sign-in; payment gates *generation*, not browsing.
 */
export const TRENDS_ENTRY_CTA_LABEL = '트렌드 시작하기';

/** Stable testID for the secondary trends-entry CTA. */
export const TRENDS_ENTRY_CTA_TEST_ID = 'result-reveal-trends-cta';

export interface ResultRevealScreenProps {
  /**
   * Phase 2.1 share_token-driven preview mode. When `true`, the primary
   * CTA is omitted entirely so the recipient view (`/s/<share_token>`)
   * stays read-only. Other content (headline, locked assets) renders
   * identically in both modes.
   *
   * Mutually exclusive with {@link isPremium} at the consumer boundary —
   * the Phase 2.4 Seed constraint pins this invariant ("isPreviewMode and
   * isPremium are mutually exclusive — premium entry invalidates preview
   * branch"). The render logic in this component is defensive: if both
   * flags are `true` the CTA stays hidden either way, so the
   * mutual-exclusion violation cannot accidentally surface a clickable
   * share-to-unlock CTA on a preview-mode session.
   */
  readonly isPreviewMode: boolean;
  /**
   * Phase 2.4 premium-unlocked branch flag, sourced from the
   * `FunnelStateProvider` payment slice (`payment.isPremium`). When `true`,
   * the user has completed the placeholder payment flow and the
   * "share-to-unlock" CTA is no longer rendered — the screen instead
   * shows the unlocked content (lock overlay removal is wired in a sibling
   * sub-AC). When `false`, the CTA renders with the hardcoded Phase 2.4
   * label {@link SHARE_UNLOCK_CTA_LABEL} ("친구와 공유하고 잠금 해제").
   *
   * Sub-AC 11.1 specifically pins the render contract: CTA renders with
   * the new label exactly when `isPreviewMode === false` AND
   * `isPremium === false`.
   */
  readonly isPremium: boolean;
  /**
   * Invoked when the user presses the primary share-to-unlock CTA. Parent
   * wires this to `router.push('/(funnel)/referral-gate')`. Never fires
   * when `isPreviewMode === true` OR `isPremium === true` because the CTA
   * is not rendered in either branch.
   */
  readonly onUnlock: () => void;
  /**
   * The live diagnosis result from the real `POST /v1/diagnose` round-trip
   * (read from the `FunnelStateProvider` diagnosis slice). When non-null, the
   * headline renders the diagnosed category dynamically (e.g.
   * "당신의 카테고리는 ✦ 봄 웜톤 ✦"). When `null` — no token, no real selfie,
   * or the call is still pending / failed — the screen falls back to the
   * static `FUNNEL_SCREENS.result_reveal.headline` teaser so the existing
   * fake-scan behaviour is preserved. Defaults to `null`.
   */
  readonly diagnosisResult?: DiagnosisResult | null;
  /**
   * Invoked when the user presses the secondary "트렌드 시작하기" CTA, which
   * enters the content-generation home (recipe catalog). Parent wires this to
   * `router.push('/(generate)/(tabs)/catalog')`. Rendered whenever
   * `isPreviewMode === false` (both premium and non-premium branches) — the
   * only branch without it is the read-only share-recipient preview. Optional
   * with a no-op default so the screen stays renderable in unit tests without
   * wiring navigation (mirrors {@link diagnosisResult}); the route always
   * supplies the real handler.
   */
  readonly onBrowseTrends?: () => void;
}

export function ResultRevealScreen(props: ResultRevealScreenProps): React.ReactElement {
  const {
    isPreviewMode,
    isPremium,
    onUnlock,
    diagnosisResult = null,
    onBrowseTrends = (): void => undefined,
  } = props;

  // Headline source: prefer the live diagnosed category from the real
  // `/v1/diagnose` round-trip; fall back to the static teaser
  // (`FUNNEL_SCREENS.result_reveal.headline`) when no result is present yet
  // (no token / stub selfie / pending / errored). The subhead + body copy are
  // unchanged across both branches — only the category line is dynamic.
  const headline =
    diagnosisResult !== null
      ? buildResultHeadline(diagnosisResult.season, diagnosisResult.tone)
      : SCREEN.headline;

  // The share-to-unlock CTA is only rendered on the default branch: the user
  // is neither viewing through a share_token preview link nor has completed
  // the placeholder payment flow. Combining both flags here keeps the render
  // contract for Sub-AC 11.1 ("CTA visible only when isPreviewMode=false AND
  // isPremium=false") in one place.
  const shouldRenderUnlockCta = !isPreviewMode && !isPremium;

  // The secondary trends-entry CTA (→ recipe catalog) renders on every
  // non-preview branch: both the default (pre-payment) user and the premium
  // user can browse trends. Only the read-only share-recipient preview
  // (`isPreviewMode === true`) omits it.
  const shouldRenderTrendsCta = !isPreviewMode;

  return (
    <FunnelScreenLayout
      testID="result-reveal-screen"
      accessibilityLabel="진단 결과 부분 공개"
    >
      <FunnelHeadline
        headline={headline}
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
          <LockedAsset key={asset.assetKey} config={asset} isPremium={isPremium} />
        ))}
      </View>
      {shouldRenderUnlockCta && (
        <View style={styles.ctaWrapper}>
          <FunnelPrimaryButton
            label={SHARE_UNLOCK_CTA_LABEL}
            onPress={onUnlock}
            testID="result-reveal-unlock-cta"
            accessibilityLabel={SHARE_UNLOCK_CTA_LABEL}
          />
        </View>
      )}
      {shouldRenderTrendsCta && (
        <View style={styles.trendsCtaWrapper}>
          <TrendsEntryButton onPress={onBrowseTrends} />
        </View>
      )}
    </FunnelScreenLayout>
  );
}

// ---------------------------------------------------------------------------
// Secondary "트렌드 시작하기" CTA — the in-app entry into the content-generation
// home (recipe catalog). Kept screen-local (like the locked assets below): it
// renders only on step 9, so a shared component would be a one-call-site
// abstraction. An understated monochrome OUTLINE button (paper fill, ink line)
// so it stays visually subordinate to the solid primary share-to-unlock CTA.
// ---------------------------------------------------------------------------

interface TrendsEntryButtonProps {
  readonly onPress: () => void;
}

function TrendsEntryButton(props: TrendsEntryButtonProps): React.ReactElement {
  const { onPress } = props;
  // Function-form `style` to dip the fill on press without an animation lib —
  // mirrors the FunnelPrimaryButton press-feedback idiom.
  const buttonStyle = React.useCallback(
    (state: PressableStateCallbackType) =>
      state.pressed
        ? [styles.trendsButton, styles.trendsButtonPressed]
        : styles.trendsButton,
    [],
  );
  return (
    <Pressable
      onPress={onPress}
      style={buttonStyle}
      testID={TRENDS_ENTRY_CTA_TEST_ID}
      accessibilityRole="button"
      accessibilityLabel={TRENDS_ENTRY_CTA_LABEL}
    >
      <Text style={styles.trendsButtonLabel}>{TRENDS_ENTRY_CTA_LABEL}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Internal locked-asset components — intentionally NOT extracted to
// src/components/funnel/. Per the Seed constraint these only render on step
// 9; extracting them would create a one-call-site abstraction for no reuse.
// ---------------------------------------------------------------------------

interface LockedAssetProps {
  readonly config: LockedAssetConfig;
  /**
   * Phase 2.4 AC 12 premium-unlock branch flag (mirrored from
   * `ResultRevealScreenProps.isPremium`). When `true`, the lock overlay
   * (and its 🔒 emoji with `accessibilityLabel="잠김"`) is removed, the
   * wrapper's `accessibilityLabel` no longer says "잠김", and the
   * placeholder layer renders at full opacity instead of the suppressed
   * `LOCKED_ASSET_PLACEHOLDER_OPACITY` value. The placeholder *shape*
   * itself remains — Phase 2.5 will replace it with the real unlocked
   * content; AC 12 only strips the locked surface.
   */
  readonly isPremium: boolean;
}

/**
 * Single content-asset wrapper. In the default (locked) branch it renders
 * the placeholder shape at `LOCKED_ASSET_PLACEHOLDER_OPACITY`, layers the
 * overlay at `LOCKED_ASSET_OVERLAY_OPACITY` on top, and centres the 🔒
 * lock icon inside the overlay. The wrapper carries an
 * `accessibilityLabel` naming what is locked ("전체 진단 카드 잠김") so
 * the screen reader announces the locked state coherently.
 *
 * In the Phase 2.4 premium branch (`isPremium === true`) the locked
 * surface is stripped per AC 12:
 *   - The overlay `<View>` (and the nested 🔒 emoji `<Text>` with
 *     `accessibilityLabel="잠김"`) is omitted from the tree entirely — no
 *     element on the screen carries `accessibilityLabel="잠김"` anymore.
 *   - The wrapper's `accessibilityLabel` drops the "잠김" suffix and just
 *     names the content section (e.g. "전체 진단 카드").
 *   - The placeholder layer renders at full opacity (1) instead of 0.2,
 *     because the lock affordance is gone and the suppressed-opacity
 *     treatment is no longer meaningful.
 *
 * The placeholder *shape* (hero card / text stack / 2x2 grid) is preserved
 * across both branches — Phase 2.5 will replace it with the real unlocked
 * content; AC 12's contract is strictly about removing the lock surface.
 */
function LockedAsset(props: LockedAssetProps): React.ReactElement {
  const { config, isPremium } = props;
  const placeholderOpacity = isPremium ? 1 : LOCKED_ASSET_PLACEHOLDER_OPACITY;
  const wrapperAccessibilityLabel = isPremium
    ? config.koreanLabel
    : `${config.koreanLabel} 잠김`;
  return (
    <View
      style={styles.lockedAssetWrapper}
      testID={config.testID}
      accessibilityLabel={wrapperAccessibilityLabel}
    >
      <View
        style={[styles.lockedAssetPlaceholder, { opacity: placeholderOpacity }]}
        testID={`${config.testID}-placeholder`}
      >
        <LockedAssetPlaceholderContent
          variant={config.variant}
          testIDPrefix={config.testID}
        />
      </View>
      {!isPremium && (
        <View
          style={[styles.lockedAssetOverlay, { opacity: LOCKED_ASSET_OVERLAY_OPACITY }]}
          testID={`${config.testID}-overlay`}
        >
          <LockIcon
            size={28}
            color={INK.muted}
            testID={`${config.testID}-lock-icon`}
            accessibilityLabel="잠김"
          />
          <Text style={styles.lockedAssetLabel}>{config.koreanLabel}</Text>
        </View>
      )}
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
    return <View style={styles.heroCardBlock} testID={`${testIDPrefix}-hero-card`} />;
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
    fontFamily: FONT.regular,
    fontSize: 15,
    lineHeight: 24,
    color: INK.primary,
    paddingTop: SPACING.md,
  },
  assetStack: {
    flex: 1,
    paddingTop: SPACING.lg,
    gap: SPACING.lg,
  },
  lockedAssetWrapper: {
    position: 'relative',
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: INK.wash,
    borderWidth: 1,
    borderColor: INK.line,
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
    backgroundColor: INK.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
  lockedAssetLabel: {
    fontFamily: FONT.medium,
    fontSize: 15,
    color: INK.primary,
    textAlign: 'center',
  },
  // Neutral skeleton placeholders for the (locked) generated assets — the
  // real result image fills these post-unlock; the editorial skeleton is a
  // monochrome wash, not a season tint.
  heroCardBlock: {
    height: HERO_CARD_ASPECT_HEIGHT,
    borderRadius: 2,
    backgroundColor: INK.wash,
  },
  textStack: {
    gap: SPACING.sm,
  },
  textLine: {
    height: TEXT_LINE_HEIGHT,
    borderRadius: SPACING.xxs,
    backgroundColor: INK.line,
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
    borderRadius: 2,
    backgroundColor: INK.wash,
  },
  ctaWrapper: {
    paddingBottom: SPACING.xl,
  },
  trendsCtaWrapper: {
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xl,
  },
  // Secondary outline CTA — monochrome editorial, subordinate to the solid
  // primary. Same 18pt vertical tap target + near-square corners as the
  // primary button; differentiated by paper fill + ink hairline border.
  trendsButton: {
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 2,
    backgroundColor: INK.paper,
    borderWidth: 1,
    borderColor: INK.line,
    alignItems: 'center',
  },
  trendsButtonPressed: {
    backgroundColor: INK.wash,
  },
  trendsButtonLabel: {
    fontFamily: FONT.medium,
    fontSize: 16,
    color: INK.primary,
  },
});
