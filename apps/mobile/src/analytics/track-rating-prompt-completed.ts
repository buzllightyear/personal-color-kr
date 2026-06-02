/**
 * `trackRatingPromptCompleted` — PostHog analytics helper for the step-4
 * `rating_gate` submit CTA (store-review wiring).
 *
 * Responsibility:
 *   Surface a typed, snake_case-named entry point that the rating-gate
 *   submit handler invokes immediately after dispatching the native store
 *   review prompt via `requestStoreReview()`. The payload carries the
 *   {@link StoreReviewOutcome} fields so a downstream PostHog query can
 *   distinguish "prompt actually dispatched" (`attempted`) from "OS reported
 *   the prompt available" (`available`) per platform.
 *
 * Why a sibling module rather than a single multi-event helper:
 *   The Seed constraint "PostHog event names use snake_case, track file names
 *   use kebab-case (Phase 2.6 pattern)" wants each event to own its name
 *   constant, payload shape, and capture site. The parallel module
 *   `src/analytics/track-rating-prompt-skipped.ts` sets the precedent — this
 *   file mirrors its shape so the two helpers stay structurally identical and
 *   reviewable side-by-side, matching the established
 *   `track-referral-shared.ts` / `track-referral-skipped.ts` split.
 *
 * Why the client is passed in (DI) rather than resolved internally:
 *   The caller (the rating-gate route, a React component) supplies the
 *   singleton via `usePostHog()` from `src/providers/PostHogProvider.tsx`;
 *   keeping this module free of React/hook coupling makes it trivially
 *   testable under vitest's node environment without mocking
 *   `posthog-react-native`. Degraded mode (`posthog === undefined`) silently
 *   no-ops — no throw, no console output, capture call count is 0.
 */
import type { PostHog } from 'posthog-react-native';

import type { StoreReviewPlatform } from '../store-review/request-store-review';

/**
 * Structured payload accompanying every `rating_prompt_completed` event.
 * Shaped 1-to-1 with the {@link StoreReviewOutcome} returned by
 * `requestStoreReview()` so the submit handler can forward the outcome
 * verbatim.
 *
 * Fields:
 *   - `attempted` — whether `requestReview()` was actually dispatched to the
 *     native SDK (only ever `true` when `available` is `true`).
 *   - `available` — the resolved result of the SDK's `isAvailableAsync()`
 *     capability probe (`false` when the probe threw).
 *   - `platform`  — the narrowed OS (`ios | android | other`) the attempt ran
 *     on.
 */
export interface TrackRatingPromptCompletedPayload {
  readonly attempted: boolean;
  readonly available: boolean;
  readonly platform: StoreReviewPlatform;
}

/**
 * Snake_case event-name literal. Exported so call sites and unit tests assert
 * against the constant rather than a duplicated string literal — any rename
 * becomes a single-point compile-time change.
 */
export const RATING_PROMPT_COMPLETED_EVENT_NAME =
  'rating_prompt_completed' as const;

/**
 * Capture the PostHog `rating_prompt_completed` event.
 *
 * @param posthog - the singleton PostHog client (or `undefined` in degraded
 *   mode); supplied via DI by the calling component's `usePostHog()`.
 * @param payload - structured event properties; see
 *   {@link TrackRatingPromptCompletedPayload}.
 */
export function trackRatingPromptCompleted(
  posthog: PostHog | undefined,
  payload: TrackRatingPromptCompletedPayload,
): void {
  // Degraded mode (posthog === undefined) silently no-ops via optional chain.
  // Spread into a fresh literal so the readonly payload widens to the
  // `{ [key: string]: JsonType }` shape `capture` expects; values unchanged.
  posthog?.capture(RATING_PROMPT_COMPLETED_EVENT_NAME, { ...payload });
}
