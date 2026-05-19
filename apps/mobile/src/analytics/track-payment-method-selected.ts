/**
 * `trackPaymentMethodSelected` — Phase 2.4 placeholder analytics helper for
 * the step-12 `payment_model` radio-selection event (Sub-AC 18.4).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that the `payment_model`
 *   radio-selection handler (wired in a downstream sub-AC) invokes when the
 *   user taps a payment-method radio option (KakaoPay or Toss). In
 *   Phase 2.4 the helper is a NO-OP wrapper around `console.log` — the real
 *   `posthog.capture('payment_method_selected', payload)` wiring lands in
 *   Phase 2.5 once the analytics surface is approved.
 *
 * Why a sibling module rather than a single multi-event helper:
 *   The Seed constraint "PostHog event names use snake_case + verb form for
 *   Phase 2.5 reuse" wants each event to own its name constant, payload
 *   shape, and Phase 2.5 swap site. Co-locating multiple events in one
 *   module would couple their evolution and force a wider blast radius for
 *   the future PostHog wiring. The parallel modules
 *   `src/analytics/track-referral-shared.ts` (Sub-AC 18.1),
 *   `src/analytics/track-referral-skipped.ts` (Sub-AC 18.2), and
 *   `src/analytics/track-social-evolution-skipped.ts` (Sub-AC 18.3) set the
 *   precedent — this file mirrors their shape so the helpers stay
 *   structurally identical and reviewable side-by-side.
 *
 * Why a placeholder rather than the real PostHog call:
 *   - Seed constraint: "All external SDK interactions are noop placeholders
 *     with TODO comments" — Phase 2.4 ships UI shells only.
 *   - Seed constraint: "console.log placeholder + TODO comment pattern for
 *     unimplemented SDK integrations" — codifies exactly this wrapper.
 *   - The placeholder is shaped so the Phase 2.5 swap is a one-line edit:
 *     replace the `console.log(...)` body with
 *     `posthog.capture(PAYMENT_METHOD_SELECTED_EVENT_NAME, payload)` (and
 *     inject the client). The exported event-name constant prevents drift
 *     between the placeholder log and the future capture call.
 *
 * Why the payload shape is `{ method: PaymentMethod }`:
 *   The radio-selection UI has a single binary outcome dimension — which of
 *   the two methods (KakaoPay or Toss) the user tapped. Reusing the
 *   {@link PaymentMethod} union from the funnel-state contract (rather than
 *   re-declaring `'kakao' | 'toss'` here) means a future widening of the
 *   payment-method domain in `src/contracts/funnel-state.ts` is enforced as
 *   a compile error on every analytics call site until the new method is
 *   handled. This mirrors the precedent set by
 *   {@link PAYMENT_MODEL_METHOD_LABELS} in
 *   `src/funnel/payment-model-ctas.ts`, which keys on the same union for
 *   the same compile-time-coupling reason.
 *
 *   Note: this event intentionally does NOT mirror
 *   `trackReferralShared`'s `ReferralShareMethod` union (`'kakao' |
 *   'copy_link'`). Despite the surface similarity ("kakao" in both), the
 *   two domains are distinct — referral-share methods are share-channel
 *   choices, while payment methods are payment-provider choices. Tying
 *   them to the same union would couple two unrelated migrations.
 *
 * Why no `selectedMethod === null` case in the payload:
 *   The state contract allows `payment.selectedMethod` to be `null`
 *   (initial unselected state), but the analytics event only fires when a
 *   user *taps* a radio option — null is the "no action yet" state, not a
 *   user choice. Narrowing the payload to `PaymentMethod` (no `| null`)
 *   makes "fire this event with no selected method" a compile error,
 *   surfacing any caller-side logic bug before Phase 2.5.
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
 * Structured payload accompanying every `payment_method_selected`
 * placeholder event. Shaped to match a future
 * `posthog.capture('payment_method_selected', payload)` call signature
 * 1-to-1.
 *
 * `readonly` end-to-end so a downstream consumer cannot mutate the object
 * after handing it to `trackPaymentMethodSelected` — matches the
 * immutability stance enforced across the rest of the funnel contracts
 * (e.g. `FunnelStateValue` in `src/contracts/funnel-state.ts`) and the
 * sibling analytics payloads
 * ({@link TrackReferralSharedPayload} in
 * `src/analytics/track-referral-shared.ts`).
 *
 * Phase 2.5 may widen this additively (e.g. `{ method; dwell_ms?: number }`)
 * without changing the call site, because optional fields default to
 * `undefined` under `exactOptionalPropertyTypes`.
 */
export interface TrackPaymentMethodSelectedPayload {
  readonly method: PaymentMethod;
}

/**
 * Snake_case event-name literal used both by the Phase 2.4 placeholder
 * `console.log` and (in Phase 2.5) by the real `posthog.capture(...)`
 * call. Exported so unit tests can assert against the constant rather
 * than a duplicated string literal — drift between the placeholder and
 * the future capture call becomes a compile-time failure once a single
 * import-site catches the rename.
 *
 * The verb form (`*_selected`, past tense) matches `referral_shared`,
 * `referral_skipped`, `social_evolution_skipped`, and the root-layout
 * `funnel_step_entered` precedent, satisfying the Seed constraint
 * "PostHog event names use snake_case + verb form for Phase 2.5 reuse".
 */
export const PAYMENT_METHOD_SELECTED_EVENT_NAME =
  'payment_method_selected' as const;

/**
 * Phase 2.4 placeholder for the PostHog `payment_method_selected` capture.
 *
 * Logs the event name + payload to the console and returns nothing. In
 * Phase 2.5 the body becomes
 * `posthog.capture(PAYMENT_METHOD_SELECTED_EVENT_NAME, payload)`; the
 * public signature stays identical so no call-site change is required.
 *
 * @param payload - structured event properties; see
 *   {@link TrackPaymentMethodSelectedPayload}.
 */
export function trackPaymentMethodSelected(
  payload: TrackPaymentMethodSelectedPayload,
): void {
  // TODO(phase-2.5): Replace this console.log with the real PostHog call:
  //   const posthog = usePostHog(); // or DI'd client
  //   posthog?.capture(PAYMENT_METHOD_SELECTED_EVENT_NAME, payload);
  // The placeholder prefix `[analytics:placeholder]` makes the no-op
  // visible in dev logs without polluting the structured event-name slot —
  // tests assert against `PAYMENT_METHOD_SELECTED_EVENT_NAME` and `payload`,
  // not the prefix, so it can be tweaked freely.
  // eslint-disable-next-line no-console
  console.log('[analytics:placeholder]', PAYMENT_METHOD_SELECTED_EVENT_NAME, payload);
}
