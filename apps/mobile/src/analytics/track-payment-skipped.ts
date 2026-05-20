/**
 * `trackPaymentSkipped` — Phase 2.5 placeholder analytics helper for the
 * step-12 `payment_model` explicit-skip event (AC 17).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that the `payment_model`
 *   "나중에 할게요" (skip) `Pressable` handler (wired by AC 14) invokes when
 *   the user explicitly opts out of the Superwall paywall flow — distinct
 *   from the user *dismissing* the Superwall paywall modal itself (which is
 *   represented by the `declined` outcome and tracked, if at all, via
 *   Superwall's own dashboard events per the Seed evaluation principle
 *   "analytics_separation"). In Phase 2.5 the helper is a NO-OP wrapper
 *   around `console.log` — the real `posthog.capture('payment_skipped',
 *   payload)` wiring lands in Phase 2.6+ once the analytics surface is
 *   approved.
 *
 * Why a sibling module rather than a single multi-event helper:
 *   The Seed constraint "PostHog event names use snake_case + verb form for
 *   Phase 2.5 reuse" wants each event to own its name constant, payload
 *   shape, and Phase 2.5+ swap site. Co-locating multiple events in one
 *   module would couple their evolution and force a wider blast radius for
 *   the future PostHog wiring. The Phase 2.4 sibling modules
 *   `src/analytics/track-payment-completed.ts`,
 *   `src/analytics/track-referral-shared.ts`,
 *   `src/analytics/track-referral-skipped.ts`,
 *   `src/analytics/track-social-evolution-skipped.ts`, and
 *   `src/analytics/track-payment-method-selected.ts` set the precedent —
 *   this file mirrors their shape so the helpers stay structurally
 *   identical and reviewable side-by-side. The Phase 2.5 sibling
 *   `src/analytics/track-paywall-error.ts` lands alongside this module in
 *   the same parallel-execution wave.
 *
 * Why a placeholder rather than the real PostHog call:
 *   - Seed evaluation principle "analytics_separation": funnel-level
 *     placeholder events (`payment_completed`, `payment_skipped`,
 *     `paywall_error`) are kept separate from Superwall-internal dashboard
 *     events (`paywall_open`, `paywall_close`, `transaction_complete`).
 *     This helper covers exclusively the *funnel-side* observation that the
 *     user explicitly skipped — it does NOT replace any of Superwall's own
 *     dashboard telemetry, and it is intentionally NOT fired on Superwall
 *     modal dismiss (the `declined` outcome retains the user on
 *     `payment_model` and does not navigate to the locked result-reveal).
 *   - Phase boundary: production analytics wiring is out of scope for
 *     Phase 2.5 (which ships the paywall trigger + sandbox subscription
 *     surface only). The placeholder is shaped so the future swap is a
 *     one-line edit: replace the `console.log(...)` body with
 *     `posthog.capture(PAYMENT_SKIPPED_EVENT_NAME, payload)` (and inject
 *     the client). The exported event-name constant prevents drift between
 *     the placeholder log and the future capture call.
 *
 * Why the state contract does not track a `payment_skip_used` flag:
 *   The funnel-state `payment` slice tracks the `isPremium` and
 *   `isProcessing` flags exclusively — the skip path navigates to the
 *   locked `result_reveal` branch (premium=false) and does not require
 *   downstream branching off "did the user reach result-reveal via skip vs.
 *   Superwall-decline". The skip outcome is captured exclusively here, in
 *   the analytics surface, so the state contract and the analytics
 *   contract remain orthogonal — mirroring the precedent set by
 *   `trackReferralSkipped` (whose skip outcome is also analytics-only).
 *
 * Why the payload is an empty `Record<string, never>` (not `{}` or an
 * `interface { ... }` with optional fields):
 *   - In Phase 2.5 the explicit-skip event has no domain dimensions to
 *     capture: a single binary outcome ("user tapped 나중에 할게요 on
 *     payment_model") that needs no discriminator the way
 *     `trackPaymentCompleted`'s `method` field does. The placement of the
 *     skip CTA is fixed (step-12 `payment_model`) and Phase 2.5 has exactly
 *     one valid placement (`'payment_model_unlock'`), so threading a
 *     `placement` field through the payload would add noise without
 *     conveying information.
 *   - `Record<string, never>` enforces "literally no own properties" at
 *     the type level — `{}` in TS strict means "any non-nullish value",
 *     which would silently accept stray fields the test never inspected.
 *   - Phase 2.6+ widens this type by replacing the alias with an explicit
 *     `{ dwell_ms?: number; ... }` shape; downstream call sites that today
 *     pass `{}` keep compiling because optional fields default to
 *     `undefined` under `exactOptionalPropertyTypes`.
 *
 * Why no `method` field analogous to `trackPaymentCompleted`:
 *   The Phase 2.4 `PaymentMethod` union (`'kakao' | 'toss'`) is deprecated
 *   in Phase 2.5 because Superwall + StoreKit collapse the payment-method
 *   choice into the paywall UI itself — the app no longer owns the
 *   discriminator. Reintroducing a `method` field on the skip event would
 *   either resurrect the deprecated union or invent a new
 *   `'superwall-skip'` sentinel that no Phase 2.5 query would ever group
 *   by. Keeping the payload empty preserves the option to widen additively
 *   in Phase 2.6+ once the analytics surface and any tier-branching domain
 *   is firmed up.
 *
 * Why no PostHog dependency import:
 *   Phase 2.5 deliberately keeps this module dependency-free so it is
 *   trivially testable in vitest's node environment without mocking
 *   `posthog-react-native`. The Phase 2.6+ swap will introduce a thin
 *   wrapper that accepts the client via DI rather than module-level
 *   coupling, mirroring the singleton-via-hook pattern already used in
 *   `src/providers/PostHogProvider.tsx`.
 *
 * Why no `@superwall/react-native-superwall` import:
 *   Seed constraint: "All native @superwall/react-native-superwall imports
 *   confined to single wrapper file apps/mobile/src/superwall/client.ts".
 *   This module has no dependency on the native SDK — the skip event fires
 *   *before* any `triggerPaywall()` invocation, so the analytics surface
 *   remains importable and testable under the vitest Node runner without
 *   resolving the native SDK.
 */
import type { PostHog } from 'posthog-react-native';

/**
 * Structured payload accompanying every `payment_skipped` placeholder
 * event. Shaped to match a future
 * `posthog.capture('payment_skipped', payload)` call signature 1-to-1.
 *
 * In Phase 2.5 the type alias resolves to `Record<string, never>` — the
 * explicit-skip path has no domain metadata to capture (unlike
 * `trackPaymentCompleted`, whose `method` field discriminated KakaoPay vs.
 * Toss in Phase 2.4 before being deprecated in Phase 2.5). The call site
 * passes `{}` and the unit test asserts the empty object is logged
 * alongside the event-name constant.
 *
 * Phase 2.6+ may widen this to `{ dwell_ms?: number; seen_paywall?: boolean }`
 * additively; callers that pass `{}` today will still compile because
 * `exactOptionalPropertyTypes` treats absent optional fields as
 * `undefined`, not as a type mismatch.
 */
export type TrackPaymentSkippedPayload = Record<string, never>;

/**
 * Snake_case event-name literal used both by the Phase 2.5 placeholder
 * `console.log` and (in Phase 2.6+) by the real `posthog.capture(...)`
 * call. Exported so unit tests can assert against the constant rather
 * than a duplicated string literal — drift between the placeholder and
 * the future capture call becomes a compile-time failure once a single
 * import-site catches the rename.
 *
 * The verb form (`*_skipped`, past tense) matches `referral_skipped`,
 * `social_evolution_skipped`, `payment_completed`, `referral_shared`,
 * `payment_method_selected`, `paywall_error`, and the root-layout
 * `funnel_step_entered` precedent, satisfying the Seed constraint
 * "PostHog event names use snake_case + verb form for Phase 2.5 reuse".
 *
 * Naming note: this event-name literal is intentionally distinct from
 * `'paywall_close'` / `'paywall_dismiss'` (Superwall-internal dashboard
 * events) per the Seed evaluation principle "analytics_separation" —
 * `payment_skipped` denotes the user-funnel-level outcome "explicit skip
 * tap on payment_model" and is fired ONLY on the dedicated 나중에 할게요
 * `Pressable`, NOT on Superwall paywall modal dismiss (the `declined`
 * outcome retains the user on payment_model and does not navigate).
 */
export const PAYMENT_SKIPPED_EVENT_NAME = 'payment_skipped' as const;

/**
 * Phase 2.5 placeholder for the PostHog `payment_skipped` capture.
 *
 * Logs the event name + payload to the console and returns nothing. In
 * Phase 2.6+ the body becomes
 * `posthog.capture(PAYMENT_SKIPPED_EVENT_NAME, payload)`; the public
 * signature stays identical so no call-site change is required.
 *
 * @param payload - structured event properties; see
 *   {@link TrackPaymentSkippedPayload}.
 */
export function trackPaymentSkipped(
  posthog: PostHog | undefined,
  payload: TrackPaymentSkippedPayload,
): void {
  // Client pass-through DI: the caller (a React component using
  // `usePostHog()` from `src/providers/PostHogProvider.tsx`) supplies the
  // singleton PostHog client; pure-TS modules like this one stay free of
  // React/hook coupling and remain trivially testable under vitest.
  //
  // Degraded mode (posthog === undefined) silently no-ops — no throw, no
  // console output, capture call count is 0 — per the Seed constraint
  // "Degraded mode posthog undefined must produce silent no-op".
  posthog?.capture(PAYMENT_SKIPPED_EVENT_NAME, payload);
}
