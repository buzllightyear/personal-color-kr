/**
 * Funnel route — `payment_model` (Phase 2.4, step 12 of 12, KR variant).
 *
 * Composition contract:
 *   - Renders `PriceCard` (hardcoded `PAYMENT_AMOUNT_KRW` from
 *     `payment-model-ctas.ts`).
 *   - Renders `PaymentMethodRadio` bound to `payment.selectedMethod` from
 *     `FunnelStateProvider` and `setSelectedPaymentMethod` for writes.
 *   - Renders a "결제하기" primary CTA (label sourced from
 *     `formatUnlockCtaLabel()`) that is `disabled` until a method has
 *     been selected.
 *   - Renders a subdued "나중에 할게요" soft-gate skip control matching
 *     the rhythm of step-4 `rating_gate` and step-10 `referral_gate`.
 *
 * Payment placeholder flow (Seed:
 *   "payment_model CTA triggers 250ms setTimeout noop + sets
 *    payment.isPremium=true + router.replace to result-reveal"):
 *   1. Tap "결제하기" → set `payment.isProcessing = true` (locks the radio
 *      and disables both CTAs).
 *   2. After a 250ms `setTimeout` placeholder:
 *      - `trackPaymentCompleted({ method })` (console.log placeholder).
 *      - `setIsPremium(true)`.
 *      - `setPaymentProcessing(false)`.
 *      - `router.replace('/(funnel)/result-reveal?premium=true')`. The
 *        `?premium=true` query param is a navigation TRIGGER only; the
 *        actual `isPremium` source-of-truth lives in the
 *        `FunnelStateProvider` payment slice per the Seed contract.
 *   3. The `setTimeout` handle is captured in a `useRef` and cleared in
 *      the effect cleanup so an early unmount (back-swipe, route
 *      change) does NOT later trigger state writes against an unmounted
 *      component.
 *
 * Skip flow:
 *   "나중에 할게요" → `router.replace('/(funnel)/result-reveal')`
 *   (locked state — `isPremium` stays `false`).
 *   Replace (not push) so back-swipe from `result-reveal` cannot
 *   re-enter payment_model (the Seed names this the soft-gate exit).
 *
 * What this route is NOT:
 *   - It does NOT import KakaoPay or Toss SDKs, make network calls,
 *     or process real transactions. Every external SDK touch is a
 *     `console.log` + `TODO(phase-2.5)` placeholder.
 *   - It does NOT manage `isPremium` via route params. The
 *     `?premium=true` on the result-reveal target is a navigation
 *     trigger only — `payment.isPremium` lives in the
 *     FunnelStateProvider.
 *   - It does NOT block hardware back. Per the Seed: "payment_model
 *     back button naturally returns to social_evolution (no
 *     BackHandler blocking)". The only BackHandler in Phase 2.4 lives
 *     on the premium branch of `result-reveal`.
 *
 * External deep-link invariant:
 *   `payment-model` is one of the 9 INTERNAL-ONLY funnel kebab slugs.
 *   External deep links to this slug must be redirected to
 *   `welcome-hook` per the `src/internal-only-routes.ts` allowlist
 *   (Phase 2.1 security invariant preserved — payment-related routes
 *   especially must not be reachable cold from a URL).
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { trackPaymentCompleted } from '../../src/analytics/track-payment-completed';
import { PaymentMethodRadio } from '../../src/components/funnel/PaymentMethodRadio';
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
import { COLORS, SPACING, TYPOGRAPHY } from '../../src/theme';
import { FUNNEL_SCREENS } from 'core-ts/funnel';

const SCREEN = FUNNEL_SCREENS.payment_model;

const PAYMENT_PLACEHOLDER_TIMEOUT_MS = 250;

export default function PaymentModelRoute(): React.ReactElement {
  const router = useRouter();
  const {
    payment,
    setSelectedPaymentMethod,
    setPaymentProcessing,
    setIsPremium,
  } = useFunnelState();
  const { selectedMethod, isProcessing } = payment;

  // Capture the in-flight placeholder timer so an unmount (back-swipe,
  // route change) clears it before the deferred state writes fire — per
  // the Seed constraint "setTimeout(250ms) payment placeholder must
  // have useEffect cleanup for unmount safety".
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleUnlock = React.useCallback((): void => {
    if (selectedMethod === null || isProcessing) {
      return;
    }
    setPaymentProcessing(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      trackPaymentCompleted({
        method: selectedMethod,
        amountKrw: PAYMENT_AMOUNT_KRW,
      });
      setIsPremium(true);
      setPaymentProcessing(false);
      router.replace('/(funnel)/result-reveal?premium=true');
    }, PAYMENT_PLACEHOLDER_TIMEOUT_MS);
  }, [
    selectedMethod,
    isProcessing,
    setPaymentProcessing,
    setIsPremium,
    router,
  ]);

  const handleSkip = React.useCallback((): void => {
    if (isProcessing) {
      return;
    }
    router.replace('/(funnel)/result-reveal');
  }, [isProcessing, router]);

  const unlockDisabled = selectedMethod === null || isProcessing;

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
        <View style={styles.radioWrapper}>
          <PaymentMethodRadio
            value={selectedMethod}
            onChange={setSelectedPaymentMethod}
            disabled={isProcessing}
          />
        </View>
      </View>
      <View style={styles.ctaStack}>
        <FunnelPrimaryButton
          label={formatUnlockCtaLabel()}
          onPress={handleUnlock}
          disabled={unlockDisabled}
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
  radioWrapper: {
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
});
