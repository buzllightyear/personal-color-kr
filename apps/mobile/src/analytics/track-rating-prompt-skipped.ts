/**
 * `trackRatingPromptSkipped` — PostHog analytics helper for the step-4
 * `rating_gate` skip CTA (store-review wiring).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that the rating-gate skip
 *   handler invokes when the user dismisses the soft gate WITHOUT triggering
 *   the native store-review prompt. Critically, the skip path NEVER calls
 *   `requestStoreReview()` — it only records the dismissal and advances to
 *   `fake-loader`. This helper is therefore the skip path's sole side effect
 *   beyond navigation.
 *
 * Why the payload carries only `platform`:
 *   The skip event has no `attempted` / `available` dimensions to report —
 *   no native call was ever made, so the only domain dimension worth
 *   capturing is which OS the dismissal happened on (kept narrow at
 *   `ios | android | other` so the analytics dimension stays queryable). This
 *   mirrors the {@link RatingPromptSkippedEvent} concept: skip = `{ platform }`
 *   only, completed = `{ attempted, available, platform }`.
 *
 * Why a sibling module rather than a single multi-event helper:
 *   The Seed constraint "PostHog event names use snake_case, track file names
 *   use kebab-case (Phase 2.6 pattern)" wants each event to own its name
 *   constant, payload shape, and capture site. This file mirrors
 *   `src/analytics/track-rating-prompt-completed.ts` so the pair stays
 *   structurally identical and reviewable side-by-side.
 *
 * Why the client is passed in (DI):
 *   The caller (the rating-gate route, a React component) supplies the
 *   singleton via `usePostHog()`; keeping this module free of React/hook
 *   coupling makes it trivially testable under vitest. Degraded mode
 *   (`posthog === undefined`) silently no-ops — no throw, no console output,
 *   capture call count is 0.
 */
import type { PostHog } from 'posthog-react-native';

import type { StoreReviewPlatform } from '../store-review/request-store-review';

/**
 * Structured payload accompanying every `rating_prompt_skipped` event.
 *
 * Carries only the narrowed `platform` — the skip path makes no native SDK
 * call, so there is no `attempted` / `available` outcome to report.
 */
export interface TrackRatingPromptSkippedPayload {
  readonly platform: StoreReviewPlatform;
}

/**
 * Snake_case event-name literal. Exported so call sites and unit tests assert
 * against the constant rather than a duplicated string literal.
 */
export const RATING_PROMPT_SKIPPED_EVENT_NAME =
  'rating_prompt_skipped' as const;

/**
 * Capture the PostHog `rating_prompt_skipped` event.
 *
 * @param posthog - the singleton PostHog client (or `undefined` in degraded
 *   mode); supplied via DI by the calling component's `usePostHog()`.
 * @param payload - structured event properties; see
 *   {@link TrackRatingPromptSkippedPayload}.
 */
export function trackRatingPromptSkipped(
  posthog: PostHog | undefined,
  payload: TrackRatingPromptSkippedPayload,
): void {
  // Degraded mode (posthog === undefined) silently no-ops via optional chain.
  posthog?.capture(RATING_PROMPT_SKIPPED_EVENT_NAME, { ...payload });
}
