/**
 * `trackToneSwitched` — Phase 3.3 analytics helper for the post-payment
 * global Tone Switcher (Sub-AC 13.3).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that the global Tone
 *   Switcher invokes on every user-driven season transition inside the
 *   post-payment surface. The event records the `(from, to)` delta of
 *   each switch and drives the downstream funnel analysis for which
 *   seasons users explore beyond their first-install diagnosis default
 *   (the `ToneState` ontology concept established by the Phase 3.3 Seed,
 *   whose `source` field flips from `'diagnosis-default'` to
 *   `'user-switched'` on the very first invocation of this helper).
 *
 * Why a sibling module rather than a single multi-event helper:
 *   Phase 3.3 ships 4 PostHog events
 *   (`post_payment_revealed`,
 *    `post_payment_tab_viewed`,
 *    {@link TONE_SWITCHED_EVENT_NAME `tone_switched`},
 *    `post_payment_content_engaged`)
 *   and the Seed constraint locks the
 *   `apps/mobile/src/analytics/track-*.ts` precedent of 1 module = 1
 *   event = its own `_EVENT_NAME` constant + payload type + tracker
 *   function export. Co-locating events would couple their evolution
 *   and widen the blast radius of any payload-shape change.
 *
 * Why the payload carries `{ from, to }` (not a single `season` field):
 *   - The Seed locks the payload shape to `{ from, to }` so downstream
 *     BI can reconstruct the directed graph of tone transitions
 *     ("how many users move from `summer-cool` → `winter-cool`?") from
 *     the PostHog event stream alone, without joining to the prior
 *     `tone_switched` event.
 *   - Both fields are the closed `Season` enum — no PII, no user-
 *     identifying dimension. Per-user attribution is handled by
 *     PostHog's distinct-id layer, not by custom payload fields.
 *   - The two fields MAY be equal (a no-op re-selection of the
 *     currently active tone). The helper does not filter that case —
 *     filtering belongs at the call site (the Tone Switcher only emits
 *     when `next !== current`), keeping this module a pure pass-through
 *     to PostHog and matching the precedent in
 *     `track-post-payment-revealed.ts` / `track-post-payment-tab-viewed.ts`.
 *
 * Why `Season` is defined locally rather than imported from a shared
 * contract:
 *   At Phase 3.3 / Sub-AC 13.3 boundary no shared TS `Season` alias
 *   exists yet — the closed enum lives in
 *   `packages/core-python/src/personal_color/preset_mapping.py`
 *   (`_PRESET_TO_PROMPT` keys) and the per-screen subset slices
 *   (`DiagnosisView` / `EditView` / `GuideView` / `CurationView`,
 *   landing in parallel sub-ACs) will introduce the shared TS alias.
 *   Defining `Season` locally here keeps this module independently
 *   compilable + testable and matches the 1-module-per-event
 *   self-containment precedent set by
 *   `src/analytics/track-post-payment-revealed.ts` (which declares the
 *   identical union locally for the same reason). Once a shared
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
 *     in `track-post-payment-revealed.ts` / `track-post-payment-tab-viewed.ts`.
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
export type Season = 'spring-warm' | 'summer-cool' | 'autumn-warm' | 'winter-cool';

/**
 * Structured payload for every `tone_switched` event. Shaped to match
 * the future `posthog.capture('tone_switched', payload)` call signature
 * 1-to-1.
 *
 * `readonly` end-to-end so a downstream consumer cannot mutate the
 * object after handing it to {@link trackToneSwitched} — matches the
 * immutability stance enforced across the rest of the analytics
 * surface (e.g. `TrackPostPaymentRevealedPayload`,
 * `TrackPostPaymentTabViewedPayload`).
 *
 * The two fields are the directed `(from, to)` transition the user
 * triggered: `from` is the season that was active immediately before
 * the switch, `to` is the season that became active immediately
 * after. Both fields are required — there is no "unknown previous
 * tone" branch because the global `ToneState` atom is seeded by the
 * first-install diagnosis default before the Tone Switcher mounts.
 */
export interface TrackToneSwitchedPayload {
  readonly from: Season;
  readonly to: Season;
}

/**
 * Snake_case event-name literal used by both this module and the
 * companion vitest assertions. Exported so tests assert against the
 * constant rather than a duplicated string literal — drift between
 * the tracker and the future BI dashboard becomes a compile-time
 * failure once a single import-site catches a rename.
 *
 * Verb-form (`*_switched`, past tense) matches the existing PostHog
 * surface (`funnel_step_entered`, `referral_shared`, `referral_skipped`,
 * `post_payment_revealed`, `post_payment_tab_viewed`) and satisfies
 * the Seed constraint "analytics events follow the snake_case + verb
 * form precedent".
 */
export const TONE_SWITCHED_EVENT_NAME = 'tone_switched' as const;

/**
 * Emit the PostHog `tone_switched` event from the global Tone Switcher
 * on every user-driven season transition inside the post-payment
 * surface.
 *
 * Degraded mode (`posthog === undefined`) silently no-ops — no throw,
 * no console output, capture call count is 0 — per the established
 * provider-degradation precedent in `track-post-payment-revealed.ts`
 * and `track-post-payment-tab-viewed.ts`.
 *
 * @param posthog - singleton PostHog client supplied by the caller
 *   (typically via `usePostHog()` from
 *   `src/providers/PostHogProvider.tsx`); `undefined` when the
 *   provider is in degraded mode.
 * @param payload - structured event properties; see
 *   {@link TrackToneSwitchedPayload}.
 */
export function trackToneSwitched(
  posthog: PostHog | undefined,
  payload: TrackToneSwitchedPayload,
): void {
  // Spread into a fresh object literal so the `readonly` +
  // literal-typed payload widens to the `PostHogEventProperties`
  // (`{ [key: string]: JsonType }`) shape expected by
  // `posthog.capture`. Values are unchanged.
  posthog?.capture(TONE_SWITCHED_EVENT_NAME, { ...payload });
}
