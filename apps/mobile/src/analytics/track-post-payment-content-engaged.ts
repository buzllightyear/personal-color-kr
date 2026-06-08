/**
 * `trackPostPaymentContentEngaged` — Phase 3.3 analytics helper for
 * within-tab interactions in the post-payment surface (Sub-AC 13.4).
 *
 * Responsibility:
 *   Surface a typed entry point that any of the 4 tab screens
 *   (edit / diagnosis / guide / curation) invokes when the user performs
 *   a meaningful interaction inside that tab (e.g., guide tile opened,
 *   curation item tapped, edit CTA pressed). The event drives the
 *   downstream content-engagement funnel and product-team retention
 *   analysis.
 *
 * Why one event with `{ tab, action }` rather than per-tab events:
 *   The Seed locks the 4-event PostHog surface; surfacing every per-tab
 *   interaction as its own event name would explode the event registry
 *   and force a new analytics module / migration each time a screen
 *   gains an interactable. The structured `(tab, action)` shape keeps
 *   the surface stable while the BI team filters on `action` for
 *   per-screen funnels.
 *
 * Why `action` is a free-form `string` and not a closed enum:
 *   Phase 3.3 ships fixture screens; the realistic action vocabulary
 *   crystallizes only as the actual UI lands. Locking the enum now
 *   would either (a) force a follow-up seed for each new action, or
 *   (b) cause the enum to drift away from real usage. A free-form
 *   string keeps the contract additive in Phase 4 — call sites narrow
 *   it locally via their own const literals. The shared
 *   {@link POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME} still pins the
 *   event-name half so the BI dashboard never collides with funnel
 *   events.
 *
 * Why DI of the PostHog client + graceful undefined no-op:
 *   Identical to the sibling track-*.ts modules
 *   (track-post-payment-revealed, track-post-payment-tab-viewed).
 *   The provider degrades to undefined when POSTHOG_API_KEY is absent —
 *   the optional chain silently produces capture-count 0 without throwing,
 *   matching the precedent set by `track-referral-shared.ts`.
 */
import type { PostHog } from 'posthog-react-native';

/**
 * Closed enum of the 4 post-payment tab identifiers used across the
 * (post-payment)/(tabs) surface. Mirrors the `TabKey` ontology field in
 * the Phase 3.3 seed.
 *
 * Defined locally rather than imported from a shared contract for the
 * same reason `Season` is local to {@link
 * ./track-post-payment-revealed.ts}: at Phase 3.3 / Sub-AC 13.4
 * boundary no shared `TabKey` alias exists yet; the per-tab routes
 * land in parallel sub-ACs. A future shared alias is a 1-line import
 * swap with no call-site change.
 */
export type Tab = 'edit' | 'diagnosis' | 'guide' | 'curation';

/**
 * Structured payload for every `post_payment_content_engaged` event.
 * Shaped to match `posthog.capture('post_payment_content_engaged',
 * payload)` 1-to-1.
 */
export interface TrackPostPaymentContentEngagedPayload {
  readonly tab: Tab;
  readonly action: string;
}

/**
 * Snake_case event-name literal. Verb-form (`*_engaged`, past tense)
 * matches the existing PostHog surface (`funnel_step_entered`,
 * `referral_shared`).
 */
export const POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME =
  'post_payment_content_engaged' as const;

/**
 * Emit the PostHog `post_payment_content_engaged` event when the user
 * interacts inside any post-payment tab.
 *
 * Degraded mode (`posthog === undefined`) silently no-ops.
 *
 * @param posthog - singleton PostHog client supplied via
 *   `usePostHog()`; `undefined` when the provider degraded.
 * @param payload - structured event properties; see
 *   {@link TrackPostPaymentContentEngagedPayload}.
 */
export function trackPostPaymentContentEngaged(
  posthog: PostHog | undefined,
  payload: TrackPostPaymentContentEngagedPayload,
): void {
  posthog?.capture(POST_PAYMENT_CONTENT_ENGAGED_EVENT_NAME, { ...payload });
}
