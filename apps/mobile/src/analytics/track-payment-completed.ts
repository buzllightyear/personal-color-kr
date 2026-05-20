/**
 * `trackPaymentCompleted` — Phase 2.4 placeholder analytics helper for
 * the step-12 `payment_model` payment-success event (Sub-AC 18.5).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that the `payment_model`
 *   "결제하기" CTA handler (wired in a downstream sub-AC) invokes once the
 *   250ms placeholder `setTimeout` simulator resolves successfully — i.e.
 *   immediately before the `router.replace('/(funnel)/result-reveal?premium=true')`
 *   navigation that re-enters `result_reveal` on the unlocked branch. In
 *   Phase 2.4 the helper is a NO-OP wrapper around `console.log` — the real
 *   `posthog.capture('payment_completed', payload)` wiring lands in Phase 2.5
 *   once the analytics surface is approved.
 *
 * Why a sibling module rather than a single multi-event helper:
 *   The Seed constraint "PostHog event names use snake_case + verb form for
 *   Phase 2.5 reuse" wants each event to own its name constant, payload
 *   shape, and Phase 2.5 swap site. Co-locating multiple events in one
 *   module would couple their evolution and force a wider blast radius for
 *   the future PostHog wiring. The parallel modules
 *   `src/analytics/track-referral-shared.ts` (Sub-AC 18.1),
 *   `src/analytics/track-referral-skipped.ts` (Sub-AC 18.2),
 *   `src/analytics/track-social-evolution-skipped.ts` (Sub-AC 18.3), and
 *   `src/analytics/track-payment-method-selected.ts` (Sub-AC 18.4) set the
 *   precedent — this file mirrors their shape so the helpers stay
 *   structurally identical and reviewable side-by-side.
 *
 * Why a placeholder rather than the real PostHog call:
 *   - Seed constraint: "All external SDK interactions are noop placeholders
 *     with TODO comments" — Phase 2.4 ships UI shells only.
 *   - Seed constraint: "console.log placeholder + TODO comment pattern for
 *     unimplemented SDK integrations" — codifies exactly this wrapper.
 *   - Seed constraint: "No real KakaoPay or Toss SDK calls — payment
 *     simulated via console.log + 250ms setTimeout". This helper logs the
 *     *analytics* completion event; the simulated payment side itself is
 *     a separate `setTimeout`-based placeholder wired into the CTA handler.
 *   - The placeholder is shaped so the Phase 2.5 swap is a one-line edit:
 *     replace the `console.log(...)` body with
 *     `posthog.capture(PAYMENT_COMPLETED_EVENT_NAME, payload)` (and inject
 *     the client). The exported event-name constant prevents drift between
 *     the placeholder log and the future capture call.
 *
 * Why the payload shape is `{ method: PaymentMethod; amountKrw: number }`:
 *   The completion event has two domain-meaningful transaction dimensions in
 *   Phase 2.4:
 *
 *     1. `method` — *which* payment provider the placeholder simulator was
 *        "operating against" (KakaoPay or Toss). Reusing the
 *        {@link PaymentMethod} union from the funnel-state contract (rather
 *        than re-declaring `'kakao' | 'toss'` here) means a future widening
 *        of the payment-method domain in `src/contracts/funnel-state.ts` is
 *        enforced as a compile error on every analytics call site until the
 *        new method is handled. This mirrors the precedent set by
 *        `trackPaymentMethodSelected` (Sub-AC 18.4) and
 *        {@link PAYMENT_MODEL_METHOD_LABELS} in
 *        `src/funnel/payment-model-ctas.ts`, which key on the same union
 *        for the same compile-time-coupling reason.
 *
 *     2. `amountKrw` — the integer KRW price the user "paid". In Phase 2.4
 *        every successful placeholder completion charges exactly
 *        {@link PAYMENT_AMOUNT_KRW} (the hardcoded ₩9,900 constant isolated
 *        in `src/funnel/payment-model-ctas.ts`), but exposing the amount as
 *        a payload field — rather than letting the analytics layer reach
 *        back into the price constant itself — keeps this helper
 *        dependency-free of `payment-model-ctas.ts` and lets a future
 *        price-tier rollout (Phase 2.5+) widen the value without touching
 *        the analytics module. The Phase 2.5 Superwall swap will pass a
 *        real transaction amount through this same field.
 *
 *   Together these two fields constitute the minimum "transaction
 *   properties" a downstream PostHog query needs to reconstruct revenue per
 *   method — without leaking PII (no `transaction_id`, no `payment_token`,
 *   no email — per the Seed constraint "PII (referral_code, payment_token)
 *   must never appear in route params" which extends conceptually to the
 *   analytics surface in this phase).
 *
 * Why `null` is NOT a legal value for `method` in this payload:
 *   The funnel-state contract allows `payment.selectedMethod` to be `null`
 *   (initial unselected state), but the completion event only fires after
 *   the user has *successfully* completed a transaction — null would be a
 *   logic error in the caller (you cannot complete a payment without
 *   selecting a method). Narrowing the payload's `method` field to
 *   `PaymentMethod` (no `| null`) makes "fire this event with no selected
 *   method" a compile error at the call site, surfacing any caller-side
 *   logic bug before Phase 2.5.
 *
 * Why `amountKrw` is a bare `number` (not a branded type):
 *   Phase 2.4 ships a single integer constant — branding it (`type
 *   KrwAmount = number & { __brand: 'KRW' }`) would couple the helper to
 *   the constant's module without adding type safety (only one writer
 *   exists). Phase 2.5 introduces price tiers; if branding becomes
 *   warranted then, the additive change here is widening the field type
 *   alone, which leaves every existing call site compatible.
 *
 * Why no PostHog dependency import:
 *   Phase 2.4 deliberately keeps this module dependency-free so it is
 *   trivially testable in vitest's node environment without mocking
 *   `posthog-react-native`. The Phase 2.5 swap will introduce a thin
 *   wrapper that accepts the client via DI rather than module-level
 *   coupling, mirroring the singleton-via-hook pattern already used in
 *   `src/providers/PostHogProvider.tsx`.
 */
import type { PaymentMethod } from '../contracts/funnel-state';

/**
 * Structured payload accompanying every `payment_completed` placeholder
 * event. Shaped to match a future
 * `posthog.capture('payment_completed', payload)` call signature 1-to-1.
 *
 * `readonly` end-to-end so a downstream consumer cannot mutate the object
 * after handing it to `trackPaymentCompleted` — matches the immutability
 * stance enforced across the rest of the funnel contracts (e.g.
 * `FunnelStateValue` in `src/contracts/funnel-state.ts`) and the sibling
 * analytics payloads ({@link TrackReferralSharedPayload} in
 * `src/analytics/track-referral-shared.ts`,
 * {@link TrackPaymentMethodSelectedPayload} in
 * `src/analytics/track-payment-method-selected.ts`).
 *
 * Fields:
 *   - `method`    — *(deprecated in Phase 2.5)* the placeholder payment
 *                   provider the Phase 2.4 simulator completed against
 *                   (KakaoPay or Toss). Retained for forward compatibility
 *                   with any in-flight Phase 2.4 call site; Phase 2.5 Superwall
 *                   call sites SHOULD omit this field (StoreKit is the only
 *                   provider). Final removal is scheduled for Phase 2.6 once
 *                   the deprecated `selectedMethod` slice field is also
 *                   removed from `FunnelPayment`. See Phase 2.5 Seed constraint:
 *                   "method field on TrackPaymentCompletedPayload deprecated
 *                   but not removed (forward compat)".
 *   - `amountKrw` — the integer KRW amount "charged" (placeholder in Phase 2.4;
 *                   Superwall-reported transaction amount in Phase 2.5).
 *   - `restored`  — *(added in Phase 2.5, Sub-AC 18)* `true` when the
 *                   Superwall paywall completion outcome was the
 *                   `restored` discriminant (i.e. the user already owned an
 *                   active App Store subscription and the paywall restored
 *                   the entitlement without re-charging). `false` (or omitted)
 *                   when the outcome was a fresh `purchased` transaction.
 *                   The purchased-path Superwall callback MUST pass
 *                   `restored: false` so downstream dashboards can compute a
 *                   restored-vs-purchased breakdown without inferring from
 *                   `undefined`. Optional under
 *                   `exactOptionalPropertyTypes` so legacy Phase 2.4
 *                   placeholder call sites that pre-date the Superwall
 *                   wiring stay type-compatible (an absent field is
 *                   interpreted as `false` downstream — same semantics
 *                   as the explicit-false purchased path).
 *
 * Phase 2.5+ may widen this additively (e.g.
 * `{ method?; amountKrw; restored?; currency?: 'KRW' | 'USD'; tier?: 'monthly' | 'annual' }`)
 * without changing existing call sites, because optional fields default to
 * `undefined` under `exactOptionalPropertyTypes`.
 */
export interface TrackPaymentCompletedPayload {
  /**
   * @deprecated Phase 2.5 — the Superwall + StoreKit subscription flow
   * removes the KakaoPay/Toss provider choice (StoreKit is the only
   * Phase 2.5 surface). The field is retained as required (not optional)
   * for backward compatibility with the Phase 2.4 placeholder call sites
   * still landing on this branch; Phase 2.6 will widen it to optional and
   * Phase 2.7 will remove it. Phase 2.5 Superwall completion call sites
   * SHOULD continue to pass *some* `PaymentMethod` value (e.g. a sentinel
   * `'kakao'`) until the field is dropped — choosing a sentinel rather
   * than widening the field today avoids a breaking change to every
   * existing Phase 2.4 call site mid-phase.
   */
  readonly method: PaymentMethod;
  readonly amountKrw: number;
  /**
   * Discriminator for the Superwall `purchased` vs `restored` completion
   * outcomes (Sub-AC 18). `true` indicates a `restored` outcome (existing
   * subscription re-attached, no new charge); `false` (or absent)
   * indicates a fresh `purchased` outcome. The purchased path defaults to
   * `false` — see field-level docstring on
   * {@link TrackPaymentCompletedPayload} for the absence-vs-explicit-false
   * semantics.
   */
  readonly restored?: boolean;
}

/**
 * Snake_case event-name literal used both by the Phase 2.4 placeholder
 * `console.log` and (in Phase 2.5) by the real `posthog.capture(...)`
 * call. Exported so unit tests can assert against the constant rather
 * than a duplicated string literal — drift between the placeholder and
 * the future capture call becomes a compile-time failure once a single
 * import-site catches the rename.
 *
 * The verb form (`*_completed`, past tense) matches `referral_shared`,
 * `referral_skipped`, `social_evolution_skipped`,
 * `payment_method_selected`, and the root-layout `funnel_step_entered`
 * precedent, satisfying the Seed constraint "PostHog event names use
 * snake_case + verb form for Phase 2.5 reuse".
 *
 * Naming note: this event-name literal collides intentionally with the
 * `'payment_completed'` rating-action string in
 * `packages/core-ts/src/funnel/rating-gate.ts`. The collision is by
 * design — both surfaces describe the same domain moment ("a paid
 * transaction completed") and Phase 2.5 will plumb a single emission site
 * into both the rating gate and the PostHog client.
 */
export const PAYMENT_COMPLETED_EVENT_NAME = 'payment_completed' as const;

/**
 * Phase 2.4 placeholder for the PostHog `payment_completed` capture.
 *
 * Logs the event name + payload to the console and returns nothing. In
 * Phase 2.5 the body becomes
 * `posthog.capture(PAYMENT_COMPLETED_EVENT_NAME, payload)`; the public
 * signature stays identical so no call-site change is required.
 *
 * @param payload - structured event properties; see
 *   {@link TrackPaymentCompletedPayload}.
 */
export function trackPaymentCompleted(
  payload: TrackPaymentCompletedPayload,
): void {
  // TODO(phase-2.5): Replace this console.log with the real PostHog call:
  //   const posthog = usePostHog(); // or DI'd client
  //   posthog?.capture(PAYMENT_COMPLETED_EVENT_NAME, payload);
  // The placeholder prefix `[analytics:placeholder]` makes the no-op
  // visible in dev logs without polluting the structured event-name slot —
  // tests assert against `PAYMENT_COMPLETED_EVENT_NAME` and `payload`,
  // not the prefix, so it can be tweaked freely.
  // eslint-disable-next-line no-console
  console.log('[analytics:placeholder]', PAYMENT_COMPLETED_EVENT_NAME, payload);
}
