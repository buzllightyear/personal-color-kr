/**
 * `trackPaywallError` — Phase 2.5 placeholder analytics helper for the
 * step-12 `payment_model` Superwall paywall-trigger error event (AC 16).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that the `payment_model`
 *   CTA handler (wired by AC 14) invokes when the wrapper-mediated
 *   `triggerPaywall(PLACEMENT_PAYMENT_MODEL_UNLOCK)` call rejects with a
 *   `SuperwallTriggerError` (or any other paywall-load failure). The event
 *   captures the *placement* that failed and the user-facing Korean inline
 *   error message that the screen surfaces, so a downstream PostHog query
 *   can attribute paywall-error rate to a specific trigger surface and
 *   correlate it with the exact copy shown to the user. In Phase 2.5 the
 *   helper is a NO-OP wrapper around `console.log` — the real
 *   `posthog.capture('paywall_error', payload)` wiring lands in Phase 2.6+
 *   once the analytics surface is approved.
 *
 * Why a sibling module rather than a single multi-event helper:
 *   The Seed constraint "PostHog event names use snake_case + verb form for
 *   Phase 2.5 reuse" wants each event to own its name constant, payload
 *   shape, and Phase 2.5+ swap site. Co-locating multiple events in one
 *   module would couple their evolution and force a wider blast radius for
 *   the future PostHog wiring. The Phase 2.4 sibling modules
 *   `src/analytics/track-payment-completed.ts`,
 *   `src/analytics/track-referral-shared.ts`,
 *   `src/analytics/track-referral-skipped.ts`, and
 *   `src/analytics/track-social-evolution-skipped.ts` set the precedent —
 *   this file mirrors their shape so the helpers stay structurally
 *   identical and reviewable side-by-side. The Phase 2.5 sibling
 *   `src/analytics/track-payment-skipped.ts` lands alongside this module
 *   in the same parallel-execution wave.
 *
 * Why a placeholder rather than the real PostHog call:
 *   - Seed evaluation principle "analytics_separation": funnel-level
 *     placeholder events (`payment_completed`, `payment_skipped`,
 *     `paywall_error`) are kept separate from Superwall-internal dashboard
 *     events (`paywall_open`, `paywall_close`, `transaction_complete`).
 *     This helper covers exclusively the *funnel-side* observation that a
 *     trigger attempt failed — it does NOT replace any of Superwall's own
 *     dashboard telemetry.
 *   - Phase boundary: production analytics wiring is out of scope for
 *     Phase 2.5 (which ships the paywall trigger + sandbox subscription
 *     surface only). The placeholder is shaped so the future swap is a
 *     one-line edit: replace the `console.log(...)` body with
 *     `posthog.capture(PAYWALL_ERROR_EVENT_NAME, payload)` (and inject
 *     the client). The exported event-name constant prevents drift between
 *     the placeholder log and the future capture call.
 *
 * Why the payload shape is `{ placement: SuperwallPlacement; errorMessage: string }`:
 *   The error event has two domain-meaningful dimensions in Phase 2.5:
 *
 *     1. `placement` — *which* Superwall trigger surface failed. Reusing the
 *        {@link SuperwallPlacement} union from `src/superwall/placements.ts`
 *        (rather than re-declaring `'payment_model_unlock'` here) means a
 *        future widening of the placement surface in `placements.ts` is
 *        enforced as a compile error on every analytics call site until the
 *        new placement is handled. This mirrors the precedent set by
 *        `trackPaymentCompleted`, which keys
 *        on the {@link PaymentMethod} union from the funnel-state contract
 *        for the same compile-time-coupling reason.
 *
 *     2. `errorMessage` — the user-facing Korean inline error text the
 *        screen surfaced. Capturing the *exact* string shown to the user
 *        (rather than the raw `Error.message` from the native SDK) lets a
 *        downstream PostHog query measure which copy variants the user saw
 *        on failure, without leaking any opaque/PII-tainted native error
 *        detail. The Seed constraint "User-friendly Korean inline error
 *        text shown on SuperwallTriggerError" pins this exact string as
 *        the analytics surface as well.
 *
 *   Together these two fields constitute the minimum "error context" a
 *   downstream PostHog dashboard needs to attribute paywall-load failures
 *   to a trigger surface and a user-visible copy variant — without
 *   leaking PII (no `transaction_id`, no `receipt_token`, no email; no raw
 *   native exception stack — per the Seed constraint "No PII
 *   (transaction_id, receipt token, customer email) in payment slice or
 *   analytics payloads").
 *
 * Why `placement` is typed `SuperwallPlacement` (not a bare `string`):
 *   The Seed ontology pins `placement` to a closed enum of registered
 *   Superwall placement identifiers (Phase 2.5 has exactly one:
 *   `'payment_model_unlock'`). Narrowing the payload's `placement` field
 *   to the {@link SuperwallPlacement} union makes "fire this event with
 *   an unregistered placement string" a compile error at the call site.
 *   The wrapper module `src/superwall/client.ts` uses the same union to
 *   constrain its `triggerPaywall(placement)` parameter, so the analytics
 *   surface and the trigger surface stay structurally aligned.
 *
 * Why `errorMessage` is a bare `string` (not a branded type or an enum):
 *   Phase 2.5 surfaces Korean copy that may evolve through copy review
 *   without a code change in the analytics layer. Branding the string
 *   (`type KoreanErrorCopy = string & { __brand: 'KoreanError' }`) or
 *   narrowing it to a closed union would couple the analytics module to
 *   every copy edit and add no actual type safety in this phase (only one
 *   writer — the screen — exists). A future copy-key-based dictionary
 *   (Phase 4+ i18n) can widen this field additively without breaking
 *   existing call sites.
 *
 * Why no `errorCode` / `errorStack` / native-exception field:
 *   - PII / opaque-error leakage: native SDK exception strings may embed
 *     transaction tokens, sandbox account hints, or device identifiers,
 *     which the Seed constraint "No PII in analytics payloads" forbids.
 *   - Phase scope: a structured `errorCode` enum requires mapping the
 *     native `SuperwallTriggerError` taxonomy onto an app-side code space,
 *     which is Phase 2.6+ work. The placeholder shape is deliberately
 *     additive-friendly: when the code-mapping ships, an optional
 *     `errorCode?: PaywallErrorCode` field can be appended without
 *     breaking existing call sites.
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
 *   This module imports only the placement *identifier* type from
 *   `src/superwall/placements.ts`, which is a pure-string domain module
 *   with no native imports — so the analytics surface remains importable
 *   and testable under the vitest Node runner without resolving the
 *   native SDK.
 */
import type { PostHog } from 'posthog-react-native';

import type { SuperwallPlacement } from '../superwall/placements';

/**
 * Structured payload accompanying every `paywall_error` placeholder
 * event. Shaped to match a future
 * `posthog.capture('paywall_error', payload)` call signature 1-to-1.
 *
 * `readonly` end-to-end so a downstream consumer cannot mutate the object
 * after handing it to `trackPaywallError` — matches the immutability
 * stance enforced across the rest of the funnel contracts (e.g.
 * `FunnelStateValue` in `src/contracts/funnel-state.ts`) and the sibling
 * analytics payloads ({@link TrackPaymentCompletedPayload} in
 * `src/analytics/track-payment-completed.ts`,
 * {@link TrackReferralSharedPayload} in
 * `src/analytics/track-referral-shared.ts`).
 *
 * Fields:
 *   - `placement`    — the Superwall placement identifier whose
 *                      `triggerPaywall()` call failed (Phase 2.5 has
 *                      exactly one valid value, `'payment_model_unlock'`).
 *   - `errorMessage` — the user-facing Korean inline error string the
 *                      screen surfaced to the user on the failure.
 *
 * Phase 2.6+ may widen this additively (e.g.
 * `{ placement; errorMessage; errorCode?: PaywallErrorCode; retryCount?: number }`)
 * without changing existing call sites, because optional fields default
 * to `undefined` under `exactOptionalPropertyTypes`.
 */
export interface TrackPaywallErrorPayload {
  readonly placement: SuperwallPlacement;
  readonly errorMessage: string;
}

/**
 * Snake_case event-name literal used both by the Phase 2.5 placeholder
 * `console.log` and (in Phase 2.6+) by the real `posthog.capture(...)`
 * call. Exported so unit tests can assert against the constant rather
 * than a duplicated string literal — drift between the placeholder and
 * the future capture call becomes a compile-time failure once a single
 * import-site catches the rename.
 *
 * The verb-noun form (`paywall_error`, noun outcome) matches the
 * `payment_completed`, `referral_shared`, `referral_skipped`, and
 * `social_evolution_skipped` precedents,
 * satisfying the Seed constraint "PostHog event names use snake_case +
 * verb form for Phase 2.5 reuse". The `paywall_*` prefix scope-isolates
 * this event from the `payment_*` funnel-outcome events so that
 * downstream dashboards can group "trigger surface failures" separately
 * from "transaction-state changes".
 *
 * Naming note: this event-name literal is intentionally distinct from any
 * Superwall-internal dashboard event (`paywall_open`, `paywall_close`,
 * `transaction_complete` etc.) per the Seed evaluation principle
 * "analytics_separation" — funnel-side observation events live in the
 * app's PostHog surface, Superwall-internal events live in the Superwall
 * dashboard, and the two surfaces are not merged or aliased here.
 */
export const PAYWALL_ERROR_EVENT_NAME = 'paywall_error' as const;

/**
 * Phase 2.5 placeholder for the PostHog `paywall_error` capture.
 *
 * Logs the event name + payload to the console and returns nothing. In
 * Phase 2.6+ the body becomes
 * `posthog.capture(PAYWALL_ERROR_EVENT_NAME, payload)`; the public
 * signature stays identical so no call-site change is required.
 *
 * @param payload - structured event properties; see
 *   {@link TrackPaywallErrorPayload}.
 */
export function trackPaywallError(
  posthog: PostHog | undefined,
  payload: TrackPaywallErrorPayload,
): void {
  // Client pass-through DI: the caller (a React component using
  // `usePostHog()` from `src/providers/PostHogProvider.tsx`) supplies the
  // singleton PostHog client; pure-TS modules like this one stay free of
  // React/hook coupling and remain trivially testable under vitest.
  //
  // Degraded mode (posthog === undefined) silently no-ops — no throw, no
  // console output, capture call count is 0 — per the Seed constraint
  // "Degraded mode posthog undefined must produce silent no-op".
  posthog?.capture(PAYWALL_ERROR_EVENT_NAME, payload);
}
