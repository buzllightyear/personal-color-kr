/**
 * `SocialEvolutionSharedTrueBranch` — Phase 2.4 step-11 (`social_evolution`)
 * presentational component rendered when `funnelState.referral.shared === true`
 * (i.e. the user completed a share action — Kakao share or copy-link — on the
 * preceding `referral_gate` screen).
 *
 * AC 4 scope (this file):
 *   The shared=true branch renders three vertical sections inside the shared
 *   `FunnelScreenLayout` frame:
 *
 *     1. Share confirmation — a short Korean acknowledgement (
 *        `공유해주셔서 감사합니다!`) confirming that the user's share action on
 *        `referral_gate` registered. This sits just below the standard
 *        FunnelHeadline/subhead pair so the screen still anchors visually on
 *        the canonical `FUNNEL_SCREENS.social_evolution` headline.
 *     2. Empty friend-list empty state — an emoji placeholder illustration
 *        (`👥`) above the Korean copy `아직 친구가 참여하지 않았어요`. Phase
 *        2.4 does NOT integrate a real friend-list / viral coefficient
 *        aggregator (Seed constraint: "No server-side viral coefficient
 *        aggregation or friend list lookup"), so the empty state is the
 *        permanent rendered branch in this phase. Phase 2.5+ may swap the
 *        emoji + copy for a real friend roster when the aggregator lands.
 *     3. Skip CTA — a single primary CTA (`다음으로`, sourced from
 *        `SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL`) that advances the funnel to
 *        `payment_model`. In the shared=true branch the user already
 *        completed the share action, so the screen carries no further task;
 *        the CTA reads as a "proceed past this soft gate" affordance. This
 *        is the soft-gate skip option that Seed pins on every Phase 2.4
 *        screen ("All 3 screens are soft gates with skip options — no hard
 *        gating blocks progression").
 *
 * What this branch is NOT:
 *   - Not a share surface. The user already shared at `referral_gate`. The
 *     Seed pins all share controls to `referral_gate` ("no duplicate share
 *     functionality on social_evolution") so this branch never re-renders
 *     a share button.
 *   - Not a friend-list viewer. The empty-state copy is intentionally a
 *     PLACEHOLDER — no Kakao friend API, no aggregator client. The Seed
 *     bans server-side viral coefficient aggregation in Phase 2.4 and pins
 *     all SDK calls to console.log + TODO(phase-2.5).
 *   - Not a payment surface. The "다음으로" CTA only navigates forward; the
 *     payment-method radio + `결제하기` CTA live on `payment_model` (step
 *     12) per the Seed funnel ordering.
 *   - Not a route file. This is a pure presentational component — props in,
 *     callbacks out. The Expo Router wrapper at
 *     `app/(funnel)/social-evolution.tsx` is responsible for picking the
 *     branch based on `funnelState.referral.shared` and wiring
 *     `onContinue` to `router.push('/(funnel)/payment-model')` (per Seed
 *     navigation contract: `social_evolution → payment_model` uses
 *     `router.push`, not `router.replace`).
 *
 * Why a dedicated branch component file (and not branch logic inlined in a
 * single `SocialEvolutionScreen`):
 *   - The shared=true and shared=false branches have visually disjoint
 *     layouts. shared=true renders an empty-state acknowledgement; shared=
 *     false renders an upsell card with a back-to-share CTA. Keeping each
 *     branch in its own file lets the parallel sibling AC (shared=false)
 *     ship its component without touching this one — zero merge conflict
 *     between the two AC implementations.
 *   - Each branch comes out at ~120 lines including documentation; a single
 *     combined file would push the screen past the 200-line file-size
 *     comfort threshold the codebase uses for funnel screens.
 *   - Future code-review readability: a reviewer can audit the shared=true
 *     empty-state rendering surgically without scrolling past the unrelated
 *     shared=false upsell layout.
 *
 * Why the emoji + Korean text empty state (and not an Image asset):
 *   - The Seed constraint "no real Kakao SDK integration" extends
 *     practically to "no design assets shipped in this phase" — the focus
 *     is UI shell rendering, not visual polish. A single Unicode emoji
 *     (`👥`, U+1F465 BUSTS IN SILHOUETTE) is the lightest possible
 *     placeholder illustration that still conveys "this is where a friend
 *     list would go" — no Image import, no asset pipeline, no bundle
 *     weight, no licensing.
 *   - The Korean copy is a frozen string literal inside this file (rather
 *     than another `social-evolution-*.ts` constants module) because both
 *     pieces of copy here are RENDERED EXCLUSIVELY by this branch — there
 *     is no second consumer to share the constant with. The
 *     `SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL` constant is imported because
 *     that label is shared with the route file's CTA navigation telemetry.
 *
 * Why the empty-state emoji is marked `accessibilityElementsHidden`:
 *   - The emoji is purely decorative — the meaningful information for a
 *     screen-reader user is in the accompanying Korean text
 *     (`아직 친구가 참여하지 않았어요`). VoiceOver / TalkBack reading "two
 *     people emoji" aloud before the actual message would be noise. Hiding
 *     the emoji from the accessibility tree keeps the spoken experience
 *     focused on the substantive copy.
 *
 * Accessibility surface (Seed constraint "accessibility_minimum_met"):
 *   - The `FunnelScreenLayout` root carries an `accessibilityLabel` so the
 *     branch announces as "공유 완료" to assistive tech, matching the
 *     visible-on-screen narrative (the user has shared).
 *   - The share-confirmation `<Text>` and the empty-state text `<Text>` use
 *     their visible Korean copy as the screen-reader announcement (no
 *     synthesised `accessibilityLabel` needed; the rendered string IS the
 *     announcement).
 *   - The primary CTA inherits `FunnelPrimaryButton`'s a11y contract:
 *     `accessibilityRole="button"`, `accessibilityLabel` defaults to the
 *     visible label, `accessibilityState.disabled` mirrors the (always
 *     `false` here) `disabled` prop.
 *
 * Testing contract:
 *   The companion test file
 *   (`tests/social-evolution-shared-true-branch.test.tsx`) pins two
 *   minimum-tests (Seed constraint: "Each new screen requires minimum 2
 *   tests — snapshot + state transition or interaction"):
 *     1. Snapshot-style render assertion that every documented section is
 *        present in the rendered tree (headline, subhead, share-
 *        confirmation row, empty-state emoji + text, skip CTA).
 *     2. Interaction assertion that pressing the skip CTA invokes the
 *        `onContinue` callback exactly once.
 *
 * @see {@link SocialEvolutionSharedTrueBranchProps} for the prop contract.
 * @see `tests/social-evolution-shared-true-branch.test.tsx` for behavioural
 *      assertions.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import { SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL } from '../../funnel/social-evolution-ctas';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

/**
 * Props for {@link SocialEvolutionSharedTrueBranch}.
 *
 * All fields are `readonly` to align with the immutable-data convention used
 * elsewhere in the funnel presentational layer (FunnelScreenLayout props,
 * FunnelPrimaryButton props, ...). The component is intentionally a pure
 * callback receiver — no internal navigation, no Context reads — so unit
 * tests can mount it with a `vi.fn()` callback and inspect the call exactly
 * once when the skip CTA fires.
 */
export interface SocialEvolutionSharedTrueBranchProps {
  /**
   * Invoked when the user taps the soft-gate skip CTA (`다음으로`). The
   * parent (`app/(funnel)/social-evolution.tsx` route component) wires this
   * to `router.push('/(funnel)/payment-model')` — push (not replace), per
   * the Seed navigation contract for `social_evolution → payment_model`, so
   * back-swipe to `social_evolution` remains possible from
   * `payment_model`.
   *
   * The component invokes the callback exactly once per press; double-tap
   * protection is delegated to `FunnelPrimaryButton`'s underlying
   * `Pressable` (which de-dupes rapid successive presses at the platform
   * layer).
   */
  readonly onContinue: () => void;
}

/**
 * Korean share-confirmation copy shown immediately below the headline group.
 *
 * Phrased as a thank-you (`감사합니다`) rather than a status indicator
 * (`공유됨`) so it reads as part of the celebratory empty-state surface
 * rather than a system message. Frozen here as a module-level constant so
 * the test file can assert against it without re-stringing the literal.
 */
export const SOCIAL_EVOLUTION_SHARE_CONFIRMATION_TEXT =
  '공유해주셔서 감사합니다!' as const;

/**
 * Korean empty-state copy for the "no friends have joined yet" row.
 *
 * Phase 2.4 ships this as the permanent rendered string — there is no
 * server-side aggregation in this phase (Seed constraint), so the screen
 * stays in the empty state regardless of any real-world share activity. The
 * Korean phrasing reads as a gentle observation (`아직 ... 않았어요`) rather
 * than a hard "no friends" failure state so the soft-gate vibe of the
 * screen carries through.
 */
export const SOCIAL_EVOLUTION_EMPTY_FRIEND_LIST_TEXT =
  '아직 친구가 참여하지 않았어요' as const;

/**
 * Emoji glyph used as the empty-state placeholder illustration.
 *
 * `👥` (U+1F465 BUSTS IN SILHOUETTE) is a single-codepoint Unicode emoji
 * that renders consistently across iOS (Apple Color Emoji) and Android
 * (Noto Color Emoji) without an Image asset. Marked as a constant so the
 * test file can assert against the literal codepoint rather than the
 * rendered glyph (which differs between iOS / Android font tables).
 */
export const SOCIAL_EVOLUTION_EMPTY_FRIEND_LIST_EMOJI = '👥' as const;

const SCREEN = FUNNEL_SCREENS.social_evolution;

/**
 * Renders the shared=true branch of step 11 (`social_evolution`).
 *
 * Mounted under the `(funnel)` Expo Router group; the route wrapper picks
 * this branch when `funnelState.referral.shared === true`. The component is
 * a pure callback receiver — see the docblock at the top of this file for
 * the full responsibility contract.
 *
 * @see SocialEvolutionSharedTrueBranchProps for prop documentation.
 */
export function SocialEvolutionSharedTrueBranch(
  props: SocialEvolutionSharedTrueBranchProps,
): React.ReactElement {
  const { onContinue } = props;
  return (
    <FunnelScreenLayout
      testID="social-evolution-shared-true-screen"
      accessibilityLabel="공유 완료"
    >
      <View style={styles.body}>
        <FunnelHeadline
          headline={SCREEN.headline}
          subhead={SCREEN.subhead}
          testIDPrefix="social-evolution"
        />
        <View
          style={styles.confirmation}
          testID="social-evolution-share-confirmation"
        >
          <Text style={styles.confirmationText}>
            {SOCIAL_EVOLUTION_SHARE_CONFIRMATION_TEXT}
          </Text>
        </View>
        <View
          style={styles.emptyState}
          testID="social-evolution-empty-friend-list"
        >
          <Text
            style={styles.emptyEmoji}
            testID="social-evolution-empty-friend-list-emoji"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {SOCIAL_EVOLUTION_EMPTY_FRIEND_LIST_EMOJI}
          </Text>
          <Text
            style={styles.emptyText}
            testID="social-evolution-empty-friend-list-text"
          >
            {SOCIAL_EVOLUTION_EMPTY_FRIEND_LIST_TEXT}
          </Text>
        </View>
      </View>
      <View style={styles.ctaWrapper}>
        <FunnelPrimaryButton
          label={SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL}
          onPress={onContinue}
          testID="social-evolution-shared-true-skip-cta"
          accessibilityLabel={SOCIAL_EVOLUTION_CONTINUE_CTA_LABEL}
        />
      </View>
    </FunnelScreenLayout>
  );
}

/**
 * StyleSheet — derived entirely from design tokens. No hard-coded sizes,
 * colours, or spacing values except the emoji glyph fontSize, which sits at
 * 48px (~equivalent to `SPACING.xxl`) so the placeholder illustration reads
 * as a discrete illustration rather than just a larger inline text run. The
 * emoji fontSize is intentionally NOT a typography token — typography
 * tokens cap at 28pt (headline) and pushing the scale higher just for one
 * emoji glyph would inflate the token surface for a single consumer.
 *
 * Vertical rhythm:
 *   - `body` is `flex: 1` with `justifyContent: 'center'` so the three
 *     content blocks (headline, confirmation, empty-state) compose as a
 *     vertically-centred stack with `SPACING.lg` gaps between them.
 *   - `ctaWrapper` sits at the bottom with `SPACING.xl` bottom-padding to
 *     leave room above the home-indicator safe-area inset.
 */
const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: SPACING.lg,
    justifyContent: 'center',
  },
  confirmation: {
    alignItems: 'center',
  },
  confirmationText: {
    ...TYPOGRAPHY.body.medium,
    color: COLORS.grayscale.text,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.xl,
  },
  emptyEmoji: {
    fontSize: 48,
    textAlign: 'center',
  },
  emptyText: {
    ...TYPOGRAPHY.body.regular,
    color: COLORS.grayscale.disabled,
    textAlign: 'center',
  },
  ctaWrapper: {
    paddingBottom: SPACING.xl,
  },
});
