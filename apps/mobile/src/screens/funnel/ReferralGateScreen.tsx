/**
 * Funnel step 10 — `referral_gate` presentational screen (Sub-AC 1.1 + 1.2 + 1.3, KR variant).
 *
 * Phase 2.4 introduces the post-result engagement loop (steps 10-12 of the
 * Korean variant funnel). `referral_gate` is the first of those three soft
 * gates: it invites the user to share the result with a friend before
 * continuing forward to `social_evolution` (step 11). Per the Seed
 * constraint "All 3 screens are soft gates with skip options — no hard
 * gating blocks progression", this screen never blocks the user; the
 * "나중에 할게요" skip control rendered as a third control on this surface
 * provides the always-available bypass path.
 *
 * Sub-AC 1.1 scope (Kakao share CTA):
 *   - Render the canonical headline + subhead from
 *     `FUNNEL_SCREENS.referral_gate` (Korean copy lives in
 *     `core-ts/funnel/screens.ts` — never embedded as a literal here, per
 *     the brownfield "no copy-in-component" convention shared by
 *     `WelcomeHookScreen`, `ValuePropsScreen`, etc.).
 *   - Render the Kakao share CTA using the
 *     `REFERRAL_GATE_SHARE_CTA_LABELS.kakao` Korean label ("카카오톡으로
 *     공유"). The CTA is a thin wrapper over `FunnelPrimaryButton` so the
 *     coral-fill + white-bold-label rhythm matches every other primary CTA
 *     in the funnel.
 *   - Expose an `onShareKakao` callback prop so the parent route wires the
 *     side effects (placeholder `console.log` SDK call, state write,
 *     navigation) without this presentational component carrying any of
 *     that logic. Mirrors `WelcomeHookScreen`'s `onNext` shape.
 *
 * Sub-AC 1.2 scope (copy-link CTA — this revision):
 *   - Render a second CTA — the copy-link button — using the
 *     `REFERRAL_GATE_SHARE_CTA_LABELS.copy_link` Korean label ("링크 복사").
 *     The button sits as a sibling of the Kakao share CTA inside the same
 *     `ctaStack` View so the SPACING.md gap between them is consistent
 *     with the rhythm of every other multi-CTA funnel surface.
 *   - Expose an `onCopyLink` callback prop. Sibling shape to `onShareKakao`
 *     so the route file's handler symmetry stays clean: each handler will
 *     emit the placeholder `trackReferralShared({ method: 'copy_link' })`
 *     PostHog log, flip the `referral.shared` flag on `FunnelStateProvider`,
 *     and `router.replace` to `/(funnel)/social-evolution`. The component
 *     itself stays pure props-in / callbacks-out.
 *   - Surface a stable `testID` (`referral-gate-copy-link`) so the Sub-AC
 *     1.2 unit test (and later integration tests) can pin the button
 *     without duplicating the kebab-case spelling. Mirrors
 *     `REFERRAL_GATE_KAKAO_SHARE_TEST_ID`.
 *
 * Why the copy-link CTA shares `FunnelPrimaryButton` (not a "secondary"
 * variant):
 *   The Seed scope for Phase 2.4 is "UI shells with placeholder SDK
 *   interactions". A bespoke secondary-button component is out-of-scope
 *   (no design tokens exist for it in the Phase 2.3 theme). Reusing the
 *   primary button keeps the rendering consistent and defers any
 *   primary/secondary visual hierarchy to a later phase. Both CTAs are
 *   share paths — the choice between Kakao and copy-link is a method
 *   preference, not a hierarchy of importance.
 *
 * Sub-AC 1.3 scope (skip CTA — this revision):
 *   - Render a third control — the soft-gate skip button — using the
 *     `REFERRAL_GATE_SKIP_CTA_LABEL` Korean label ("나중에 할게요"). The
 *     control sits as a sibling of the two share CTAs inside the same
 *     `ctaStack` View so the SPACING.md gap rhythm carries through, but
 *     it renders as a subdued text-only `Pressable` (no coral pill fill)
 *     rather than a `FunnelPrimaryButton`. The subdued styling matches
 *     the step-4 `rating_gate` "나중에" pattern exactly — `TYPOGRAPHY.button.medium`
 *     + `COLORS.grayscale.disabled` so the control reads as an opt-out
 *     rather than a competing primary action. Per the Seed constraint
 *     "All 3 screens are soft gates with skip options — no hard gating
 *     blocks progression", this is the always-available bypass.
 *   - Expose an `onSkip` callback prop. Sibling shape to `onShareKakao`
 *     and `onCopyLink`. The route file's handler will:
 *       (a) emit the placeholder `trackReferralSkipped({})` PostHog log,
 *       (b) flip the `referral.skipUsed` flag on `FunnelStateProvider`,
 *       (c) `router.push` to `/(funnel)/social-evolution`. None of those
 *     side effects live in this presentational component.
 *   - Surface a stable `testID` (`referral-gate-skip`) so the Sub-AC 1.3
 *     unit test (and later integration tests) can pin the button without
 *     duplicating the kebab-case spelling. Mirrors the existing
 *     `REFERRAL_GATE_KAKAO_SHARE_TEST_ID` and
 *     `REFERRAL_GATE_COPY_LINK_TEST_ID` exports.
 *
 * Why the skip CTA is a plain Pressable (not a FunnelPrimaryButton):
 *   The Korean copy "나중에 할게요" is intentionally subdued so it reads as
 *   opt-out rather than a competing primary action. Rendering it on the
 *   same coral pill as the share CTAs would visually equate it to the
 *   share path — exactly the wrong affordance hierarchy for a soft gate.
 *   The step-4 `rating_gate` already established the subdued
 *   text-only-pressable pattern for skip controls (see
 *   `RatingGateContent.tsx`); we reuse it verbatim so the post-result
 *   engagement loop reads consistently with the earlier funnel rhythm.
 *
 * What this component is NOT:
 *   - Not a Kakao SDK integration. The `onShareKakao` callback is the
 *     extension point — the route file's handler will `console.log` a
 *     placeholder + `TODO(phase-2.5)` until the real SDK lands. Seed
 *     constraint: "No real Kakao SDK integration — all share actions are
 *     console.log noop placeholders".
 *   - Not a clipboard adapter. `onCopyLink` is the extension point — the
 *     route file's handler will `console.log` + `TODO(phase-2.5)` until
 *     the real `expo-clipboard` integration lands. Seed contract pins
 *     every external SDK touch as a placeholder in Phase 2.4.
 *   - Not a navigation wiring. `router.replace` to `social-evolution` on
 *     share completion (and `router.push` on skip) belongs to the route
 *     file, not here. This screen stays pure props-in / callbacks-out to
 *     keep it unit-testable without `expo-router` or
 *     `FunnelStateProvider` context.
 *
 * Why a presentational component (not an in-route render):
 *   The brownfield convention pinned by `WelcomeHookScreen`,
 *   `ValuePropsScreen`, `OnboardingPrimingScreen`, `DiagnosisInputScreen`,
 *   `FakeLoaderScreen`, `FakeScanAnimationScreen`, `ResultRevealScreen`,
 *   etc. is: route files are thin wrappers that pull hooks (router,
 *   funnel state) and forward primitive callbacks to a sibling
 *   presentational module under `src/screens/funnel/`. The presentational
 *   module exports props-in/callbacks-out so the unit test can render it
 *   with a `vi.fn()` callback and assert UI structure + interaction
 *   wiring without booting expo-router. This file keeps that pattern.
 *
 * Why import Korean labels from `referral-gate-ctas.ts`:
 *   Seed constraint: "Hardcoded constants isolated in dedicated
 *   selector/options files". `REFERRAL_GATE_SHARE_CTA_LABELS.kakao` is
 *   the single import-site for the Kakao CTA copy — a future
 *   localisation pass or A/B copy variant changes one file. The
 *   companion `referral-gate-ctas.test.ts` already pins the literal
 *   string at "카카오톡으로 공유"; this component's interaction test
 *   asserts that label is *what reaches the rendered button*, closing
 *   the loop end-to-end.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

import { FunnelHeadline } from '../../components/FunnelHeadline';
import { FunnelPrimaryButton } from '../../components/funnel/FunnelPrimaryButton';
import { FunnelScreenLayout } from '../../funnel/FunnelScreenLayout';
import {
  REFERRAL_GATE_SHARE_CTA_LABELS,
  REFERRAL_GATE_SKIP_CTA_LABEL,
} from '../../funnel/referral-gate-ctas';
import { COLORS, SPACING, TYPOGRAPHY } from '../../theme';

/**
 * Stable testID for the Kakao share CTA. Exported as a named constant so
 * unit tests can pin the button without re-stringing the kebab-case
 * literal (matches the same convention as
 * `FUNNEL_PRIMARY_BUTTON_DEFAULT_TEST_ID` on `FunnelPrimaryButton`).
 */
export const REFERRAL_GATE_KAKAO_SHARE_TEST_ID = 'referral-gate-kakao-share';

/**
 * Stable testID for the copy-link CTA (Sub-AC 1.2). Same naming convention
 * as {@link REFERRAL_GATE_KAKAO_SHARE_TEST_ID} — kebab-case, screen-scoped,
 * descriptive of the affordance rather than the handler shape.
 */
export const REFERRAL_GATE_COPY_LINK_TEST_ID = 'referral-gate-copy-link';

/**
 * Stable testID for the soft-gate skip CTA (Sub-AC 1.3). Mirrors the
 * `rating-gate-skip` naming the step-4 funnel screen established, so a
 * cross-screen test that asserts "every soft gate exposes a skip control"
 * can rely on the `<screen>-skip` kebab convention.
 */
export const REFERRAL_GATE_SKIP_TEST_ID = 'referral-gate-skip';

/**
 * Props for {@link ReferralGateScreen}.
 *
 * Three mandatory callbacks for Sub-AC 1.1 + 1.2 + 1.3. All fields are
 * `readonly` to match the immutability convention used across the rest of
 * the funnel component surface (see `WelcomeHookScreenProps`,
 * `RatingGateContentProps`).
 */
export interface ReferralGateScreenProps {
  /**
   * Invoked when the user taps the Kakao share CTA. The route file
   * wires this to a handler that:
   *   (a) emits the placeholder `trackReferralShared({ method: 'kakao' })`
   *       PostHog log,
   *   (b) flips the `referral.shared` flag on `FunnelStateProvider`,
   *   (c) `router.replace`s to `/(funnel)/social-evolution`.
   * None of those side effects live in this component.
   */
  readonly onShareKakao: () => void;
  /**
   * Invoked when the user taps the copy-link CTA (Sub-AC 1.2). The route
   * file wires this to a handler that:
   *   (a) emits the placeholder
   *       `trackReferralShared({ method: 'copy_link' })` PostHog log,
   *   (b) flips the `referral.shared` flag on `FunnelStateProvider`,
   *   (c) `router.replace`s to `/(funnel)/social-evolution`.
   * The actual clipboard write (`expo-clipboard`) is itself a
   * `console.log` + `TODO(phase-2.5)` placeholder per the Seed contract —
   * no real clipboard API is touched in Phase 2.4.
   */
  readonly onCopyLink: () => void;
  /**
   * Invoked when the user taps the soft-gate skip CTA (Sub-AC 1.3). The
   * route file wires this to a handler that:
   *   (a) emits the placeholder `trackReferralSkipped({})` PostHog log,
   *   (b) flips the `referral.skipUsed` flag on `FunnelStateProvider`,
   *   (c) `router.push`es to `/(funnel)/social-evolution`.
   * `router.push` (not `router.replace`) on skip so the back-stack
   * preserves `referral_gate` — the user can return to it from
   * `social_evolution`'s `shared=false` upsell branch (Seed contract:
   * "shared=false social_evolution links back to referral_gate for
   * sharing — no duplicate share functionality on social_evolution").
   */
  readonly onSkip: () => void;
}

const SCREEN = FUNNEL_SCREENS.referral_gate;

export function ReferralGateScreen(
  props: ReferralGateScreenProps,
): React.ReactElement {
  const { onShareKakao, onCopyLink, onSkip } = props;
  return (
    <FunnelScreenLayout
      testID="referral-gate-screen"
      accessibilityLabel="친구에게 공유하기"
    >
      <View style={styles.body}>
        <FunnelHeadline
          headline={SCREEN.headline}
          subhead={SCREEN.subhead}
          testIDPrefix="referral-gate"
        />
      </View>
      <View style={styles.ctaStack}>
        <FunnelPrimaryButton
          label={REFERRAL_GATE_SHARE_CTA_LABELS.kakao}
          onPress={onShareKakao}
          testID={REFERRAL_GATE_KAKAO_SHARE_TEST_ID}
          accessibilityLabel={REFERRAL_GATE_SHARE_CTA_LABELS.kakao}
        />
        <FunnelPrimaryButton
          label={REFERRAL_GATE_SHARE_CTA_LABELS.copy_link}
          onPress={onCopyLink}
          testID={REFERRAL_GATE_COPY_LINK_TEST_ID}
          accessibilityLabel={REFERRAL_GATE_SHARE_CTA_LABELS.copy_link}
        />
        <Pressable
          onPress={onSkip}
          style={styles.skipButton}
          testID={REFERRAL_GATE_SKIP_TEST_ID}
          accessibilityRole="button"
          accessibilityLabel={REFERRAL_GATE_SKIP_CTA_LABEL}
        >
          <Text style={styles.skipLabel}>{REFERRAL_GATE_SKIP_CTA_LABEL}</Text>
        </Pressable>
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  ctaStack: {
    gap: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  // Skip-button styling mirrors `RatingGateContent.tsx` verbatim — the
  // step-4 `rating_gate` already established the subdued text-only
  // pressable pattern for soft-gate "나중에" controls, and re-using it
  // here keeps the post-result engagement loop reading consistently
  // with the earlier funnel rhythm. No coral pill, no border — the
  // control is intentionally subdued so it reads as opt-out, not a
  // competing primary action.
  skipButton: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipLabel: {
    ...TYPOGRAPHY.button.medium,
    color: COLORS.grayscale.disabled,
  },
});
