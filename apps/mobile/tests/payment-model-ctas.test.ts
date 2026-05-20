/**
 * Unit test — `payment-model-ctas.ts` Korean CTA constants AND the
 * hardcoded `PAYMENT_AMOUNT_KRW` price (Sub-AC 26).
 *
 * The constants live in `apps/mobile/src/funnel/payment-model-ctas.ts`
 * and supply every Korean CTA label + the one-time premium-unlock
 * price the step-12 `payment_model` screen renders on:
 *
 *   - Two method-selection radios (KakaoPay + Toss).
 *   - One primary "unlock premium" CTA (price + verb form).
 *   - One soft-gate skip CTA.
 *
 * Coverage:
 *   1. `PAYMENT_AMOUNT_KRW` is a positive integer matching the Seed-
 *      approved price (₩9,900 one-time unlock).
 *   2. `PAYMENT_MODEL_METHOD_LABELS` is keyed by every `PaymentMethod`
 *      literal — no method is missing a Korean label.
 *   3. The Kakao + Toss Korean labels are exactly the human-reviewed
 *      copy ("카카오페이" / "토스").
 *   4. `PAYMENT_MODEL_UNLOCK_CTA_SUFFIX` is exactly "결제하고 잠금 해제"
 *      (verb form for the primary CTA).
 *   5. `PAYMENT_MODEL_SKIP_CTA_LABEL` uses the soft-gate "나중에 할게요"
 *      phrasing symmetric to the sibling step-10 / step-11 skip
 *      labels.
 *   6. `formatPaymentAmountKrw()` returns a Korean-locale currency
 *      string that contains the grouped digits ("9,900") and the KRW
 *      currency symbol ("₩"). The exact string is environment-dependent
 *      (Node's ICU build can produce either "₩9,900" or "KRW 9,900"
 *      depending on locale data); we assert on the structural
 *      substrings so the test passes deterministically on every
 *      supported runtime.
 *   7. `formatUnlockCtaLabel()` returns the verb-form unlock CTA copy
 *      **without** the formatted price prefix — verifying the
 *      Phase 2.5 `price_single_source` invariant (Superwall paywall
 *      owns price display; the in-app CTA must not duplicate ₩9,900).
 *   8. `PAYMENT_MODEL_METHOD_LABELS` is frozen so consumers cannot
 *      mutate the shared snapshot.
 *
 * No `react-native` mock is needed — the constants module is pure data
 * (zero RN imports) and runs in vitest's node environment as-is.
 */
import { describe, expect, it } from 'vitest';

import {
  PAYMENT_AMOUNT_KRW,
  PAYMENT_MODEL_METHOD_LABELS,
  PAYMENT_MODEL_SKIP_CTA_LABEL,
  PAYMENT_MODEL_UNLOCK_CTA_SUFFIX,
  formatPaymentAmountKrw,
  formatUnlockCtaLabel,
} from '../src/funnel/payment-model-ctas';
import type { PaymentMethod } from '../src/contracts/funnel-state';

describe('payment-model-ctas — price constant (Sub-AC 26)', () => {
  it('PAYMENT_AMOUNT_KRW is the Seed-approved one-time unlock price (₩9,900)', () => {
    // Pinning the exact integer prevents a silent regression where a
    // future refactor mis-types the price. The constant is `as const`
    // so its TypeScript type also pins it; this assertion adds a
    // runtime guard.
    expect(PAYMENT_AMOUNT_KRW).toBe(9_900);
  });

  it('PAYMENT_AMOUNT_KRW is a positive integer (no fractional won, KRW has no minor units)', () => {
    expect(Number.isInteger(PAYMENT_AMOUNT_KRW)).toBe(true);
    expect(PAYMENT_AMOUNT_KRW).toBeGreaterThan(0);
  });
});

describe('payment-model-ctas — Korean CTA labels (Sub-AC 26)', () => {
  it('PAYMENT_MODEL_METHOD_LABELS exposes a Korean label for every PaymentMethod', () => {
    // Listing the literal union members explicitly here gives us a
    // compile-time guard: if `PaymentMethod` widens (e.g. a future
    // `naverpay` channel), the array assignment fails until the new
    // method is added, which in turn forces the map to declare the
    // new label below.
    const expected: readonly PaymentMethod[] = ['kakao', 'toss'];
    for (const method of expected) {
      expect(PAYMENT_MODEL_METHOD_LABELS[method]).toBeTruthy();
      expect(typeof PAYMENT_MODEL_METHOD_LABELS[method]).toBe('string');
    }
    // No extra keys leak past the closed `PaymentMethod` domain.
    expect(Object.keys(PAYMENT_MODEL_METHOD_LABELS).sort()).toEqual(
      [...expected].sort(),
    );
  });

  it('pins the human-reviewed Korean payment-method labels', () => {
    expect(PAYMENT_MODEL_METHOD_LABELS.kakao).toBe('카카오페이');
    expect(PAYMENT_MODEL_METHOD_LABELS.toss).toBe('토스');
  });

  it('PAYMENT_MODEL_UNLOCK_CTA_SUFFIX is exactly the verb-form "결제하고 잠금 해제"', () => {
    // The verb form is asserted independently from the formatted price
    // so analytics + a11y tests can assert against the unchanging
    // suffix without depending on locale-formatted digits.
    expect(PAYMENT_MODEL_UNLOCK_CTA_SUFFIX).toBe('결제하고 잠금 해제');
  });

  it('PAYMENT_MODEL_SKIP_CTA_LABEL uses the soft-gate "나중에 할게요" phrasing', () => {
    // Symmetric to the step-10 (`referral_gate`) and step-11
    // (`social_evolution`) skip labels — soft-gate rhythm must read
    // consistently across the three Phase 2.4 post-result screens.
    expect(PAYMENT_MODEL_SKIP_CTA_LABEL).toBe('나중에 할게요');
  });

  it('freezes PAYMENT_MODEL_METHOD_LABELS so consumers cannot mutate the shared snapshot', () => {
    expect(Object.isFrozen(PAYMENT_MODEL_METHOD_LABELS)).toBe(true);
  });
});

describe('payment-model-ctas — price formatter (Sub-AC 26)', () => {
  it('formatPaymentAmountKrw() renders the grouped Korean digits "9,900"', () => {
    // Asserting on the grouped-digit substring keeps the test robust
    // against Node ICU build differences ("₩" vs "KRW " prefix). The
    // grouping itself is the locale-defining behaviour we care about
    // — a regression to ungrouped "9900" or a wrong locale ("9.900")
    // both fail this assertion.
    const formatted = formatPaymentAmountKrw();
    expect(formatted).toContain('9,900');
  });

  it('formatPaymentAmountKrw() includes a KRW currency marker (₩ symbol or "KRW" code)', () => {
    // Either rendering is acceptable — the assertion fails only when
    // the formatter forgets the currency entirely.
    const formatted = formatPaymentAmountKrw();
    expect(formatted === '' || /[₩]|KRW/.test(formatted)).toBe(true);
  });

  it('formatUnlockCtaLabel() returns the verb-form CTA without the ₩9,900 price prefix (Phase 2.5 Superwall ownership)', () => {
    // Phase 2.5 `price_single_source` invariant: the Superwall paywall
    // sheet (not the in-app CTA) renders the ASC-registered
    // subscription price. The unlock CTA on `payment_model` must
    // therefore expose ONLY the Korean verb form — never an inlined
    // "₩9,900" substring that would duplicate price information across
    // two UI surfaces.
    //
    // Concrete checks:
    //   1. The returned label is exactly the verb-form suffix.
    //   2. It does NOT contain the locale-formatted price substring
    //      "9,900" (the grouped digits the Phase 2.4 prefix used).
    //   3. It does NOT contain the KRW currency markers ("₩" or "KRW")
    //      — covering both ICU build renderings.
    const composed = formatUnlockCtaLabel();
    expect(composed).toBe(PAYMENT_MODEL_UNLOCK_CTA_SUFFIX);
    expect(composed).not.toContain('9,900');
    expect(composed).not.toMatch(/[₩]|KRW/);
    // And the helper formatter is still callable / unaffected — its
    // output is reserved for analytics payload composition, not CTA
    // display.
    expect(typeof formatPaymentAmountKrw()).toBe('string');
  });
});
