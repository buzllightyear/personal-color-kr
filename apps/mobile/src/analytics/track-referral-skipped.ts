/**
 * `trackReferralSkipped` — Phase 2.4 placeholder analytics helper for the
 * step-10 `referral_gate` skip-button event (Sub-AC 18.2).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that the referral_gate
 *   "skip" handler (wired in a downstream sub-AC) invokes when the user
 *   dismisses the soft gate without completing a share action. In Phase 2.4
 *   the helper is a NO-OP wrapper around `console.log` — the real
 *   `posthog.capture('referral_skipped', payload)` wiring lands in Phase 2.5
 *   once the analytics surface is approved.
 *
 * Why a sibling module rather than a single multi-event helper:
 *   The Seed constraint "PostHog event names use snake_case + verb form for
 *   Phase 2.5 reuse" wants each event to own its name constant, payload
 *   shape, and Phase 2.5 swap site. Co-locating the skip and share events
 *   in one module would couple their evolution and force a wider blast
 *   radius for the future PostHog wiring. The parallel module
 *   `src/analytics/track-referral-shared.ts` (Sub-AC 18.1) sets the
 *   precedent — this file mirrors its shape so the two helpers stay
 *   structurally identical and reviewable side-by-side.
 *
 * Why a placeholder rather than the real PostHog call:
 *   - Seed constraint: "All external SDK interactions are noop placeholders
 *     with TODO comments" — Phase 2.4 ships UI shells only.
 *   - Seed constraint: "console.log placeholder + TODO comment pattern for
 *     unimplemented SDK integrations" — codifies exactly this wrapper.
 *   - The placeholder is shaped so the Phase 2.5 swap is a one-line edit:
 *     replace the `console.log(...)` body with
 *     `posthog.capture(REFERRAL_SKIPPED_EVENT_NAME, payload)` (and inject
 *     the client). The exported event-name constant prevents drift between
 *     the placeholder log and the future capture call.
 *
 * Why the state contract does not track `referral_skip_used`:
 *   See `FunnelReferral` in `src/contracts/funnel-state.ts` — the slice
 *   intentionally tracks only the positive `shared` outcome because
 *   social_evolution does not need to branch off the skip path. The skip
 *   is captured exclusively here, in the analytics surface, so the state
 *   contract and the analytics contract remain orthogonal.
 *
 * Why the payload is an empty `Record<string, never>` (not `{}` or an
 * `interface { ... }` with optional fields):
 *   - In Phase 2.4 the skip event has no domain dimensions to capture: a
 *     single binary outcome ("user tapped skip on referral_gate") that
 *     needs no `method` discriminator the way `referral_shared` does.
 *   - `Record<string, never>` enforces "literally no own properties" at
 *     the type level — `{}` in TS strict means "any non-nullish value",
 *     which would silently accept stray fields the test never inspected.
 *   - Phase 2.5 widens this type by replacing the alias with an explicit
 *     `{ dwell_ms?: number; ... }` shape; downstream call sites that today
 *     pass `{}` keep compiling because optional fields default to
 *     `undefined` under `exactOptionalPropertyTypes`.
 *
 * Why no PostHog dependency import:
 *   Phase 2.4 deliberately keeps this module dependency-free so it is
 *   trivially testable in vitest's node environment without mocking
 *   `posthog-react-native`. The Phase 2.5 swap will introduce a thin
 *   wrapper that accepts the client via DI rather than module-level
 *   coupling, mirroring the singleton-via-hook pattern already used in
 *   `src/providers/PostHogProvider.tsx`.
 */

/**
 * Structured payload accompanying every `referral_skipped` placeholder
 * event. Shaped to match a future
 * `posthog.capture('referral_skipped', payload)` call signature 1-to-1.
 *
 * In Phase 2.4 the type alias resolves to `Record<string, never>` — the
 * skip path has no domain metadata to capture (unlike `referral_shared`,
 * whose `method` field discriminates Kakao vs. copy-link). The call site
 * passes `{}` and the unit test asserts the empty object is logged
 * alongside the event-name constant.
 *
 * Phase 2.5 may widen this to `{ dwell_ms?: number; seen_methods?: ... }`
 * additively; callers that pass `{}` today will still compile because
 * `exactOptionalPropertyTypes` treats absent optional fields as
 * `undefined`, not as a type mismatch.
 */
export type TrackReferralSkippedPayload = Record<string, never>;

/**
 * Snake_case event-name literal used both by the Phase 2.4 placeholder
 * `console.log` and (in Phase 2.5) by the real `posthog.capture(...)`
 * call. Exported so unit tests can assert against the constant rather
 * than a duplicated string literal — drift between the placeholder and
 * the future capture call becomes a compile-time failure once a single
 * import-site catches the rename.
 *
 * The verb form (`*_skipped`, past tense) matches `referral_shared` and
 * the root-layout `funnel_step_entered` precedent, satisfying the Seed
 * constraint "PostHog event names use snake_case + verb form for Phase
 * 2.5 reuse".
 */
export const REFERRAL_SKIPPED_EVENT_NAME = 'referral_skipped' as const;

/**
 * Phase 2.4 placeholder for the PostHog `referral_skipped` capture.
 *
 * Logs the event name + payload to the console and returns nothing. In
 * Phase 2.5 the body becomes
 * `posthog.capture(REFERRAL_SKIPPED_EVENT_NAME, payload)`; the public
 * signature stays identical so no call-site change is required.
 *
 * @param payload - structured event properties; see
 *   {@link TrackReferralSkippedPayload}.
 */
export function trackReferralSkipped(payload: TrackReferralSkippedPayload): void {
  // TODO(phase-2.5): Replace this console.log with the real PostHog call:
  //   const posthog = usePostHog(); // or DI'd client
  //   posthog?.capture(REFERRAL_SKIPPED_EVENT_NAME, payload);
  // The placeholder prefix `[analytics:placeholder]` makes the no-op
  // visible in dev logs without polluting the structured event-name slot —
  // tests assert against `REFERRAL_SKIPPED_EVENT_NAME` and `payload`, not
  // the prefix, so it can be tweaked freely.
  // eslint-disable-next-line no-console
  console.log('[analytics:placeholder]', REFERRAL_SKIPPED_EVENT_NAME, payload);
}
