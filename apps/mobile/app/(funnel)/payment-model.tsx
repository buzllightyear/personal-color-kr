/**
 * Funnel route — `payment_model` (Phase 2.5, step 12 of 12, KR variant).
 *
 * Composition contract:
 *   - Renders `PriceCard` (now a value-proposition card after Phase 2.5
 *     transformation — no hardcoded KRW price; the price is owned by the
 *     Superwall paywall surface).
 *   - Renders a "결제하고 잠금 해제" primary CTA (label from
 *     `formatUnlockCtaLabel()`) — tapping it opens the Superwall paywall.
 *   - Renders a subdued "나중에 할게요" soft-gate skip control.
 *   - Renders an inline Korean error Text on `SuperwallTriggerError`
 *     (subdued red, no toast component — Seed "error_transparency").
 *
 * Phase 2.5 Superwall integration:
 *   1. CTA tap → `setPaymentProcessing(true)` (disables both CTAs).
 *   2. `await triggerPaywall(PLACEMENT_PAYMENT_MODEL_UNLOCK)` — opens the
 *      Superwall paywall modal in sandbox/production.
 *   3. Branch on outcome:
 *      - `purchased`: setIsPremium(true) + trackPaymentCompleted (restored=false)
 *        + router.replace('/(funnel)/result-reveal?premium=true')
 *      - `restored`: identical to purchased + trackPaymentCompleted (restored=true)
 *      - `declined`: stay on payment-model, CTA re-enabled, no analytics
 *        (Superwall internal paywall_close event covers it)
 *      - `SuperwallTriggerError`: catch, set inline error text, CTA
 *        re-enabled, trackPaywallError fired
 *   4. In all cases `setPaymentProcessing(false)` runs in the finally
 *      block so the CTA always re-enables.
 *
 * Skip flow (Phase 2.5 AC 10):
 *   "나중에 할게요" tap → trackPaymentSkipped({}) +
 *   router.replace('/(funnel)/result-reveal') (locked, no premium=true).
 *   This skip path is intentionally distinct from the Superwall paywall
 *   *modal dismiss* (the `declined` outcome) — modal-dismiss retains the
 *   user on payment_model and does NOT fire `trackPaymentSkipped` per
 *   Seed evaluation principle `analytics_separation`.
 *
 * What this route is NOT:
 *   - It does NOT import @superwall/react-native-superwall directly.
 *     The wrapper at apps/mobile/src/superwall/client.ts is the single
 *     test-mock seam — Seed: "All native @superwall/react-native-superwall
 *     imports confined to single wrapper file".
 *   - It does NOT manage `isPremium` via route params. The
 *     `?premium=true` on the result-reveal target is a navigation
 *     trigger only — `payment.isPremium` lives in the
 *     FunnelStateProvider.
 *   - It does NOT block hardware back. Per Phase 2.4 Seed:
 *     "payment_model back button naturally returns to social_evolution
 *     (no BackHandler blocking)".
 *
 * External deep-link invariant:
 *   `payment-model` is one of the 9 INTERNAL-ONLY funnel kebab slugs.
 *   External deep links to this slug must be redirected to
 *   `welcome-hook` per the `src/internal-only-routes.ts` allowlist.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';

import { trackPaymentCompleted } from '../../src/analytics/track-payment-completed';
import { trackPaymentSkipped } from '../../src/analytics/track-payment-skipped';
import { trackPaywallError } from '../../src/analytics/track-paywall-error';
import { PriceCard } from '../../src/components/funnel/PriceCard';
import { FunnelPrimaryButton } from '../../src/components/funnel/FunnelPrimaryButton';
import { FunnelHeadline } from '../../src/components/FunnelHeadline';
import { FunnelScreenLayout } from '../../src/funnel/FunnelScreenLayout';
import {
  PAYMENT_AMOUNT_KRW,
  PAYMENT_MODEL_SKIP_CTA_LABEL,
  formatUnlockCtaLabel,
} from '../../src/funnel/payment-model-ctas';
import { useFunnelState } from '../../src/hooks/use-funnel-state';
import {
  PLACEMENT_PAYMENT_MODEL_UNLOCK,
  SuperwallTriggerError,
  triggerPaywall,
} from '../../src/superwall/client';
import { COLORS, SPACING, TYPOGRAPHY } from '../../src/theme';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

const SCREEN = FUNNEL_SCREENS.payment_model;

const PAYWALL_ERROR_INLINE_TEXT =
  '결제 연결에 실패했어요. 잠시 후 다시 시도해 주세요.' as const;

export default function PaymentModelRoute(): React.ReactElement {
  const router = useRouter();
  const { payment, setPaymentProcessing, setIsPremium } = useFunnelState();
  const { isProcessing } = payment;
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  // `usePostHog()` returns `PostHog | undefined` — degraded mode contract
  // (no api key in `.env` → provider degrades to fragment, no context).
  // The track helpers optional-chain on `capture`, so passing `undefined`
  // is a silent no-op (no throw, no console output, capture count 0) per
  // Seed constraint "Degraded mode posthog undefined must produce silent
  // no-op".
  const posthog = usePostHog();

  const handleUnlock = React.useCallback(async (): Promise<void> => {
    if (isProcessing) {
      return;
    }
    setErrorMessage(null);
    setPaymentProcessing(true);
    try {
      const result = await triggerPaywall(PLACEMENT_PAYMENT_MODEL_UNLOCK);
      if (result.outcome === 'purchased' || result.outcome === 'restored') {
        // `method` is the Phase 2.4 deprecated sentinel (Phase 2.5 surface
        // owns the actual provider choice via Superwall + StoreKit).
        trackPaymentCompleted(posthog, {
          method: 'kakao',
          amountKrw: PAYMENT_AMOUNT_KRW,
          restored: result.outcome === 'restored',
        });
        setIsPremium(true);
        setPaymentProcessing(false);
        router.replace('/(funnel)/result-reveal?premium=true');
        return;
      }
      // declined — user dismissed the Superwall modal without completing.
      // Stay on payment-model, CTA re-enabled. No analytics fired here;
      // Superwall's internal paywall_close event covers it per
      // analytics_separation.
      setPaymentProcessing(false);
    } catch (error) {
      const placement = PLACEMENT_PAYMENT_MODEL_UNLOCK;
      const errMsg =
        error instanceof SuperwallTriggerError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      trackPaywallError(posthog, { placement, errorMessage: errMsg });
      setErrorMessage(PAYWALL_ERROR_INLINE_TEXT);
      setPaymentProcessing(false);
    }
  }, [isProcessing, posthog, setPaymentProcessing, setIsPremium, router]);

  const handleSkip = React.useCallback((): void => {
    if (isProcessing) {
      return;
    }
    trackPaymentSkipped(posthog, {});
    router.replace('/(funnel)/result-reveal');
  }, [isProcessing, posthog, router]);

  return (
    <FunnelScreenLayout
      testID="payment-model-screen"
      accessibilityLabel="결제로 잠금 해제"
    >
      <View style={styles.body}>
        <FunnelHeadline
          headline={SCREEN.headline}
          subhead={SCREEN.subhead}
          testIDPrefix="payment-model"
        />
        <View style={styles.priceWrapper}>
          <PriceCard />
        </View>
        {errorMessage !== null ? (
          <Text
            style={styles.errorText}
            testID="payment-model-error-text"
            accessibilityLiveRegion="polite"
          >
            {errorMessage}
          </Text>
        ) : null}
      </View>
      <View style={styles.ctaStack}>
        <FunnelPrimaryButton
          label={formatUnlockCtaLabel()}
          onPress={() => {
            void handleUnlock();
          }}
          disabled={isProcessing}
          testID="payment-model-unlock-cta"
          accessibilityLabel={formatUnlockCtaLabel()}
        />
        <Pressable
          onPress={handleSkip}
          style={styles.skipButton}
          testID="payment-model-skip-cta"
          accessibilityRole="button"
          accessibilityLabel={PAYMENT_MODEL_SKIP_CTA_LABEL}
          disabled={isProcessing}
        >
          <Text style={styles.skipLabel}>{PAYMENT_MODEL_SKIP_CTA_LABEL}</Text>
        </Pressable>
      </View>
    </FunnelScreenLayout>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  priceWrapper: {
    alignItems: 'stretch',
  },
  ctaStack: {
    gap: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  skipButton: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipLabel: {
    ...TYPOGRAPHY.button.medium,
    color: COLORS.grayscale.disabled,
  },
  errorText: {
    ...TYPOGRAPHY.body.regular,
    // Subdued red — Phase 2.5 introduces the only error-state surface in
    // the funnel. Hex literal (not a theme token) since `COLORS` does not
    // yet expose a semantic.error slot; if more error surfaces land, the
    // theme can be extended in a follow-up phase.
    color: '#C44569',
    textAlign: 'center',
  },
});
