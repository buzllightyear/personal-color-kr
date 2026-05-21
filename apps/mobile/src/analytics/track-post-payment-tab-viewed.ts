/**
 * `trackPostPaymentTabViewed` — Phase 3.3 analytics helper for the
 * post-payment 4-tab content surface (Sub-AC 13.2).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that the
 *   `(post-payment)/(tabs)/_layout.tsx` Tab navigator invokes on every
 *   tab-focus transition (including the initial `edit` mount and every
 *   subsequent user-driven switch). The event drives the engagement
 *   funnel inside the post-payment surface: which tabs users actually
 *   reach, the order of traversal, and the drop-off shape between
 *   reveal and the secondary tabs.
 *
 * Why a sibling module rather than a single multi-event helper:
 *   Phase 3.3 ships 4 PostHog events
 *   (`post_payment_revealed`,
 *    {@link POST_PAYMENT_TAB_VIEWED_EVENT_NAME `post_payment_tab_viewed`},
 *    `tone_switched`, `post_payment_content_engaged`)
 *   and the Seed constraint locks the
 *   `apps/mobile/src/analytics/track-*.ts` precedent of 1 module = 1
 *   event = its own `_EVENT_NAME` constant + payload type + tracker
 *   function export. Co-locating events would couple their evolution
 *   and widen the blast radius of any payload-shape change.
 *
 * Why the payload carries only `tab` (no PII, no season, no timing):
 *   - Seed constraint: "No PII rendered on screens (Season name +
 *     content text only)" — analytics payloads inherit the same
 *     no-PII boundary. `tab` is a closed enum (4 values), not a
 *     user-identifying dimension.
 *   - Tab-traversal analysis needs only the destination key; the
 *     ordering is reconstructed downstream from PostHog's per-distinct-id
 *     event timeline rather than from a redundant client-side
 *     `previous_tab` field.
 *   - Tone is already covered by `tone_switched`; bundling tone into
 *     every tab-view event would inflate cardinality without adding
 *     analytic signal.
 *
 * Why `PostPaymentTabKey` is defined locally rather than imported from
 * a shared layout module:
 *   At Phase 3.3 / Sub-AC 13.2 boundary the
 *   `(post-payment)/(tabs)/_layout.tsx` Tab navigator lands in a
 *   parallel sub-AC; no shared TS `TabKey` alias exists yet. Defining
 *   the closed-enum literal union locally here keeps this module
 *   independently compilable + testable and matches the
 *   1-module-per-event self-containment precedent set by
 *   `src/analytics/track-post-payment-revealed.ts`. Once the layout
 *   sub-AC introduces a shared `PostPaymentTabKey` alias, a single
 *   one-line import swap replaces this declaration — call sites are
 *   unaffected because the underlying string literal union is
 *   identical.
 *
 * Why a `PostHog | undefined` DI parameter (not module-level import
 * of the singleton):
 *   - The `src/providers/PostHogProvider.tsx` singleton degrades
 *     gracefully to `undefined` when `POSTHOG_API_KEY` is absent
 *     (e.g. local dev, CI). The optional-chain (`?.`) in the body
 *     produces a silent no-op in that mode — matches the precedent
 *     in `track-post-payment-revealed.ts` / `track-referral-shared.ts`.
 *   - DI keeps this module a pure TS function trivially testable in
 *     vitest's node environment without mocking
 *     `posthog-react-native` at the module-graph level.
 */
import type { PostHog } from 'posthog-react-native';

/**
 * Closed enum of the 4 tab keys exposed by the post-payment surface,
 * in display order. Matches the `TabKey` ontology concept defined by
 * the Phase 3.3 Seed (`{edit, diagnosis, guide, curation}` with `edit`
 * as the initial route).
 *
 * The snake_case-compatible bare-word form (`edit`, not `edit_tab`)
 * keeps the wire value identical to the Expo Router file-route segment
 * name under `(post-payment)/(tabs)/<tab>.tsx`, which simplifies
 * cross-referencing PostHog timelines with router state in downstream
 * BI.
 */
export type PostPaymentTabKey =
  | 'edit'
  | 'diagnosis'
  | 'guide'
  | 'curation';

/**
 * Structured payload for every `post_payment_tab_viewed` event. Shaped
 * to match the future `posthog.capture('post_payment_tab_viewed', payload)`
 * call signature 1-to-1.
 *
 * `readonly` end-to-end so a downstream consumer cannot mutate the
 * object after handing it to {@link trackPostPaymentTabViewed} —
 * matches the immutability stance enforced across the rest of the
 * analytics surface (e.g. `TrackPostPaymentRevealedPayload`).
 */
export interface TrackPostPaymentTabViewedPayload {
  readonly tab: PostPaymentTabKey;
}

/**
 * Snake_case event-name literal used by both this module and the
 * companion vitest assertions. Exported so tests assert against the
 * constant rather than a duplicated string literal — drift between
 * the tracker and the future BI dashboard becomes a compile-time
 * failure once a single import-site catches a rename.
 *
 * Verb-form (`*_viewed`, past tense) matches the existing PostHog
 * surface (`funnel_step_entered`, `referral_shared`, `referral_skipped`,
 * `post_payment_revealed`) and satisfies the Seed constraint
 * "analytics events follow the snake_case + verb form precedent".
 */
export const POST_PAYMENT_TAB_VIEWED_EVENT_NAME =
  'post_payment_tab_viewed' as const;

/**
 * Emit the PostHog `post_payment_tab_viewed` event from the
 * `(post-payment)/(tabs)/_layout.tsx` Tab navigator on every
 * tab-focus transition.
 *
 * Degraded mode (`posthog === undefined`) silently no-ops — no throw,
 * no console output, capture call count is 0 — per the established
 * provider-degradation precedent in `track-post-payment-revealed.ts`.
 *
 * @param posthog - singleton PostHog client supplied by the caller
 *   (typically via `usePostHog()` from
 *   `src/providers/PostHogProvider.tsx`); `undefined` when the
 *   provider is in degraded mode.
 * @param payload - structured event properties; see
 *   {@link TrackPostPaymentTabViewedPayload}.
 */
export function trackPostPaymentTabViewed(
  posthog: PostHog | undefined,
  payload: TrackPostPaymentTabViewedPayload,
): void {
  // Spread into a fresh object literal so the `readonly` +
  // literal-typed payload widens to the `PostHogEventProperties`
  // (`{ [key: string]: JsonType }`) shape expected by
  // `posthog.capture`. Values are unchanged.
  posthog?.capture(POST_PAYMENT_TAB_VIEWED_EVENT_NAME, { ...payload });
}
