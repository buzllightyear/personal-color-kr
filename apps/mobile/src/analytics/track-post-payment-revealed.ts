/**
 * `trackPostPaymentRevealed` — Phase 3.3 analytics helper for the
 * post-payment first-touch `diagnosis-reveal` screen (Sub-AC 13.1).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that the
 *   `(post-payment)/diagnosis-reveal.tsx` screen invokes exactly once,
 *   on first-install entry, immediately after the diagnosis fixture
 *   resolves to a Season. The event marks "user has crossed the
 *   paywall into the post-payment content surface" and seeds the
 *   downstream funnel analysis for activation rate.
 *
 * Why a sibling module rather than a single multi-event helper:
 *   Phase 3.3 ships 4 PostHog events
 *   ({@link POST_PAYMENT_REVEALED_EVENT_NAME `post_payment_revealed`},
 *   `post_payment_tab_viewed`, `tone_switched`, `post_payment_content_engaged`)
 *   and the Seed constraint locks the
 *   `apps/mobile/src/analytics/track-*.ts` precedent of 1 module = 1
 *   event = its own `_EVENT_NAME` constant + payload type + tracker
 *   function export. Co-locating events would couple their evolution
 *   and widen the blast radius of any payload-shape change.
 *
 * Why the payload carries only `season` (no PII, no image bytes):
 *   - Seed constraint: "No PII rendered on screens (Season name +
 *     content text only)" — analytics payloads inherit the same
 *     no-PII boundary. Season is a closed enum (4 values), not a
 *     user-identifying dimension.
 *   - Activation analysis needs only the season distribution to
 *     measure whether one tone over-converts vs. another; per-user
 *     attribution is handled by PostHog's distinct-id layer, not by
 *     custom payload fields.
 *
 * Why `Season` is defined locally rather than imported from a shared
 * contract:
 *   At Phase 3.3 / Sub-AC 13.1 boundary no shared TS `Season` alias
 *   exists yet — the closed enum lives in
 *   `packages/core-python/src/personal_color/preset_mapping.py`
 *   (`_PRESET_TO_PROMPT` keys) and the per-screen subset slices
 *   (`DiagnosisView` / `EditView` / `GuideView` / `CurationView`,
 *   landing in parallel sub-ACs) will introduce the shared TS alias.
 *   Defining `Season` locally here keeps this module independently
 *   compilable + testable and matches the 1-module-per-event
 *   self-containment precedent set by
 *   `src/analytics/track-referral-shared.ts`. Once a shared
 *   `Season` lands, a single one-line import swap replaces this
 *   alias — call sites are unaffected because the underlying string
 *   literal union is identical.
 *
 * Why a `PostHog | undefined` DI parameter (not module-level import
 * of the singleton):
 *   - The `src/providers/PostHogProvider.tsx` singleton degrades
 *     gracefully to `undefined` when `POSTHOG_API_KEY` is absent
 *     (e.g. local dev, CI). The optional-chain (`?.`) in the body
 *     produces a silent no-op in that mode — matches the precedent
 *     in `track-referral-shared.ts` / `track-referral-skipped.ts`.
 *   - DI keeps this module a pure TS function trivially testable in
 *     vitest's node environment without mocking
 *     `posthog-react-native` at the module-graph level.
 */
import type { PostHog } from 'posthog-react-native';

/**
 * Closed enum of the 4 Korean personal-color seasons used across the
 * post-payment surface. Mirrors the keys of
 * `_PRESET_TO_PROMPT` in
 * `packages/core-python/src/personal_color/preset_mapping.py` so the
 * TS analytics dimension stays 1-to-1 aligned with the Python
 * diagnosis pipeline.
 *
 * The hyphenated kebab-case form (`spring-warm`, not `springWarm`) is
 * the wire format that flows end-to-end from the Python
 * `DiagnosisResult` through PostHog into downstream BI — keeping the
 * literal identical avoids a translation layer.
 */
export type Season =
  | 'spring-warm'
  | 'summer-cool'
  | 'autumn-warm'
  | 'winter-cool';

/**
 * Structured payload for every `post_payment_revealed` event. Shaped
 * to match the future `posthog.capture('post_payment_revealed', payload)`
 * call signature 1-to-1.
 *
 * `readonly` end-to-end so a downstream consumer cannot mutate the
 * object after handing it to {@link trackPostPaymentRevealed} —
 * matches the immutability stance enforced across the rest of the
 * analytics surface (e.g. `TrackReferralSharedPayload`).
 */
export interface TrackPostPaymentRevealedPayload {
  readonly season: Season;
}

/**
 * Snake_case event-name literal used by both this module and the
 * companion vitest assertions. Exported so tests assert against the
 * constant rather than a duplicated string literal — drift between
 * the tracker and the future BI dashboard becomes a compile-time
 * failure once a single import-site catches a rename.
 *
 * Verb-form (`*_revealed`, past tense) matches the existing PostHog
 * surface (`funnel_step_entered`, `referral_shared`, `referral_skipped`)
 * and satisfies the Seed constraint "analytics events follow the
 * snake_case + verb form precedent".
 */
export const POST_PAYMENT_REVEALED_EVENT_NAME =
  'post_payment_revealed' as const;

/**
 * Emit the PostHog `post_payment_revealed` event from the
 * `diagnosis-reveal` screen on first-install entry.
 *
 * Degraded mode (`posthog === undefined`) silently no-ops — no throw,
 * no console output, capture call count is 0 — per the established
 * provider-degradation precedent in `track-referral-shared.ts`.
 *
 * @param posthog - singleton PostHog client supplied by the caller
 *   (typically via `usePostHog()` from
 *   `src/providers/PostHogProvider.tsx`); `undefined` when the
 *   provider is in degraded mode.
 * @param payload - structured event properties; see
 *   {@link TrackPostPaymentRevealedPayload}.
 */
export function trackPostPaymentRevealed(
  posthog: PostHog | undefined,
  payload: TrackPostPaymentRevealedPayload,
): void {
  // Spread into a fresh object literal so the `readonly` +
  // literal-typed payload widens to the `PostHogEventProperties`
  // (`{ [key: string]: JsonType }`) shape expected by
  // `posthog.capture`. Values are unchanged.
  posthog?.capture(POST_PAYMENT_REVEALED_EVENT_NAME, { ...payload });
}
