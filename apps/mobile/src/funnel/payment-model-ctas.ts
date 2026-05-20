/**
 * `payment-model-ctas.ts` — frozen Korean CTA text constants AND the
 * hardcoded `PAYMENT_AMOUNT_KRW` price constant for the step-12
 * `payment_model` screen (Phase 2.4, KR variant).
 *
 * Why this module exists (Sub-AC 26):
 *   Two distinct Seed constraints converge in a single isolated file:
 *
 *     1. "Hardcoded constants isolated in dedicated selector/options
 *        files" — the four Korean CTAs (KakaoPay radio label, Toss radio
 *        label, unlock primary CTA, soft-gate skip CTA) must NOT be
 *        inlined as string literals inside the screen component.
 *     2. "Payment price is hardcoded constant (PAYMENT_AMOUNT_KRW)
 *        isolated in a selector file" — the one-time premium-unlock
 *        price must NOT be inlined either. Co-locating it with the
 *        CTA labels keeps the entire step-12 copy surface in one
 *        import-site so the Phase 2.5 swap to Superwall (subscriptions,
 *        price tiers, trial copy) is a single-file edit.
 *
 * Why no subscription / trial fields:
 *   Seed constraint: "No subscription model, price tiers, discount codes,
 *   or free trials — single one-time unlock only". The legacy
 *   `FUNNEL_SCREENS.payment_model` registry entry (v0.2) carries
 *   `monthlyUsd: 12`, `annualUsd: 59`, `freeTrialDays: 37` metadata —
 *   Phase 2.4 deliberately ignores those fields and ships a single
 *   one-time KRW price instead. The metadata stays in `screens.ts`
 *   purely for the Phase 2.5 subscription rewrite; the active
 *   payment_model screen reads only from this file.
 *
 * Why a `formatPaymentAmountKrw()` selector (not the raw number alone):
 *   The Korean price line on the unlock button reads
 *   "₩9,900 결제하고 잠금 해제" (currency symbol + grouped digits + verb
 *   form). Centralising the formatter here means the screen, the unlock
 *   CTA test, and any future analytics surface ("price_displayed_krw"
 *   placeholder event) all stringify the same amount the same way.
 *   Using `Intl.NumberFormat('ko-KR')` keeps the digit grouping
 *   locale-correct without a third-party i18n dependency.
 */
import type { PaymentMethod } from '../contracts/funnel-state';

/**
 * Hardcoded one-time premium-unlock price in Korean won (KRW).
 *
 * Phase 2.4 ships a single tier — no monthly / annual split, no
 * free-trial discount. The integer literal is deliberately kept at a
 * "realistic Korean micropayment" price point (₩9,900 ≈ USD $7) so
 * the screen renders a believable amount in QA without any pricing
 * decision leaking into the codebase prematurely.
 *
 * Why `as const`:
 *   Pins the literal type so any future widening (e.g. a price-tier
 *   union) becomes a TypeScript error here until the type narrows
 *   intentionally — preventing a silent regression where a numeric
 *   variable replaces the constant.
 *
 * Why isolated in this file (and not `FUNNEL_SCREENS.payment_model`):
 *   `FUNNEL_SCREENS.payment_model.metadata` describes the *legacy*
 *   subscription pricing (monthlyUsd / annualUsd / freeTrialDays).
 *   Phase 2.4's one-time KRW price is a distinct concept; co-mingling
 *   them inside the registry would blur the Phase 2.5 migration
 *   boundary (Seed: "Code structure supports Phase 2.5 Superwall
 *   subscription replacement with minimal refactoring").
 */
export const PAYMENT_AMOUNT_KRW = 9_900 as const;

/**
 * Frozen map from payment method → Korean radio label rendered on the
 * matching payment-method option in the payment_model screen.
 *
 *   - `kakao` → "카카오페이" (KakaoPay placeholder).
 *   - `toss`  → "토스"      (Toss placeholder).
 *
 * Keyed on {@link PaymentMethod} (from `src/contracts/funnel-state.ts`)
 * so a future widening of the payment-method domain becomes a
 * TypeScript error on this map until the corresponding Korean label is
 * added — the same compile-time-coupling we use for
 * {@link REFERRAL_GATE_SHARE_CTA_LABELS} on referral_gate.
 *
 * Frozen so a test that accidentally mutates it fails loud rather than
 * silently corrupting other tests via the shared reference.
 */
export const PAYMENT_MODEL_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> =
  Object.freeze({
    kakao: '카카오페이',
    toss: '토스',
  });

/**
 * Korean label rendered on the primary "unlock premium" CTA.
 *
 * Phase 2.5 (Superwall integration) note:
 *   In Phase 2.4 this constant was the *suffix* fragment of a composed
 *   "<price> 결제하고 잠금 해제" label — the in-app CTA inlined the
 *   ₩9,900 amount alongside the verb form. Phase 2.5 hands price
 *   display ownership to the Superwall paywall sheet, which renders
 *   the ASC-registered subscription price natively. The app CTA must
 *   therefore stop duplicating the amount; {@link formatUnlockCtaLabel}
 *   now returns this verb-form fragment alone so no hardcoded ₩9,900
 *   substring leaks into the app UI (price_single_source invariant).
 *
 * Why the "SUFFIX" name is retained:
 *   Renaming the export to `PAYMENT_MODEL_UNLOCK_CTA_LABEL` would force
 *   churn on every analytics / a11y test that imports the constant by
 *   its current name. The "SUFFIX" suffix is now historically named —
 *   the symbol denotes the full CTA label string in Phase 2.5.
 */
export const PAYMENT_MODEL_UNLOCK_CTA_SUFFIX = '결제하고 잠금 해제' as const;

/**
 * Korean label rendered on the soft-gate skip control. Phrased
 * identically to the sibling step-10 / step-11 skip labels
 * ("나중에 할게요") so the soft-gate rhythm reads consistent across the
 * three Phase 2.4 post-result screens. Per Seed: "All 3 screens are
 * soft gates with skip options — no hard gating blocks progression".
 *
 * The route handler advances via `router.replace` to `result-reveal`
 * (skip path) — replace (not push) so the user lands on the
 * non-premium result-reveal with a clean history stack.
 */
export const PAYMENT_MODEL_SKIP_CTA_LABEL = '나중에 할게요' as const;

/**
 * Locale-aware formatter for {@link PAYMENT_AMOUNT_KRW}. Returns the
 * canonical Korean rendering — "₩9,900" — with thousands grouping
 * driven by `Intl.NumberFormat('ko-KR')`.
 *
 * Why a function (and not a precomputed string constant):
 *   `Intl.NumberFormat` resolves the locale at call time; precomputing
 *   at module load would freeze the format against the *test*
 *   environment's locale rather than the Korean locale every call site
 *   asks for explicitly. The function is pure + cheap (no allocation
 *   beyond the formatter result string), so screen + tests can call
 *   it freely without memoisation.
 */
export function formatPaymentAmountKrw(): string {
  // `style: 'currency'` + `currency: 'KRW'` produces "₩9,900" on Node's
  // ICU build. `maximumFractionDigits: 0` is the implicit KRW default
  // (KRW has no minor units) but we set it explicitly so a future
  // change of the price to a non-integer would surface as a rounding
  // bug in the test, not a silent format change.
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(PAYMENT_AMOUNT_KRW);
}

/**
 * Return the primary unlock CTA label rendered on the in-app
 * payment_model step-12 screen.
 *
 * Example output: "결제하고 잠금 해제".
 *
 * Phase 2.5 contract (Superwall):
 *   The Superwall paywall sheet is now the *single source of truth* for
 *   subscription price display — the ASC-registered product price
 *   (com.personalcolorkr.monthly.premium) is rendered inside the
 *   Superwall-controlled UI, not on the app CTA. This function
 *   therefore returns the bare verb-form label (no "₩9,900" prefix);
 *   prefixing the locale-formatted price here would duplicate price
 *   information across two UI surfaces and break the
 *   `price_single_source` invariant (see Seed Evaluation Principles).
 *
 * Why a function (and not a re-exported string constant):
 *   Two reasons retained from Phase 2.4:
 *     1. Existing call-sites (`payment-model.tsx`, `PriceCard.tsx`
 *        tests, analytics fixtures) invoke it as a function. Preserving
 *        the function signature keeps the Phase 2.5 diff minimal and
 *        avoids cascading rename churn through every consumer.
 *     2. A future re-introduction of dynamic copy (A/B variants,
 *        localised verb forms, etc.) is a one-file edit — the call-
 *        site contract stays stable.
 */
export function formatUnlockCtaLabel(): string {
  return PAYMENT_MODEL_UNLOCK_CTA_SUFFIX;
}
