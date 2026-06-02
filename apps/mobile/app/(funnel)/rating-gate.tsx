/**
 * Funnel Step 4 — `rating_gate` route file.
 *
 * Platform.select branching (preserved from Phase 2.1, Sub-AC 5):
 *   The seed pinned `rating-gate` to a single source file with internal
 *   Platform.select branching (NOT a `.ios.tsx` / `.android.tsx` filename
 *   split). The branching maps platforms to two presentational variants:
 *     - iOS      → **default**  variant: SKStoreReviewController stand-in
 *     - Android  → **secondary** variant: Play In-App Review stand-in
 *     - Other    → **default**  variant (web / native fallback)
 *
 *   Phase 2.2 fills in the variants with real Korean copy + CTAs via the
 *   shared `RatingGateContent` component. Both variants share the same
 *   submit + skip CTAs (per FUNNEL_SCREENS.rating_gate metadata); the
 *   variant split exists so the Phase 3+ native bridge can swap in
 *   platform-specific rating dialog wiring without touching the funnel
 *   navigation surface.
 *
 *   Both CTAs (submit_rating + skip) navigate forward to fake-loader.
 *   dismissable:true is satisfied by the always-allowed skip path.
 */
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { usePostHog } from 'posthog-react-native';

import { trackRatingPromptCompleted } from '../../src/analytics/track-rating-prompt-completed';
import { trackRatingPromptSkipped } from '../../src/analytics/track-rating-prompt-skipped';
import { RatingGateContent } from '../../src/screens/funnel/RatingGateContent';
import {
  requestStoreReview,
  type StoreReviewPlatform,
} from '../../src/store-review/request-store-review';

export type RatingGateVariantId = 'default' | 'secondary';

/**
 * Narrow `Platform.OS` to the {@link StoreReviewPlatform} union the skip
 * analytics payload carries (`ios | android | other`).
 *
 * The submit path receives `platform` from the `requestStoreReview()` outcome,
 * but the skip path makes no native call, so it must narrow the OS itself. Read
 * at call time (not module-load) so unit tests can pin `Platform.OS` per case.
 * The store-review helper's own `resolvePlatform` is intentionally NOT exported
 * (it owns the native seam); this route-local narrowing keeps the skip path
 * decoupled from that internal while producing an identical narrowing.
 */
function resolveSkipPlatform(): StoreReviewPlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'other';
}

/**
 * iOS-targeted **default** variant — placeholder for the iOS native
 * `SKStoreReviewController` rating dialog (dismissable). Renders the same
 * shared `RatingGateContent` but tagged with `variant="default"` for
 * downstream testID + analytics distinction.
 */
export function RatingGateDefaultVariant(props: {
  readonly onSubmit: () => void;
  readonly onSkip: () => void;
}): JSX.Element {
  const { onSubmit, onSkip } = props;
  return (
    <RatingGateContent onSubmit={onSubmit} onSkip={onSkip} variant="default" />
  );
}

/**
 * Android-targeted **secondary** variant — placeholder for the Google Play
 * In-App Review API surface.
 */
export function RatingGateSecondaryVariant(props: {
  readonly onSubmit: () => void;
  readonly onSkip: () => void;
}): JSX.Element {
  const { onSubmit, onSkip } = props;
  return (
    <RatingGateContent onSubmit={onSubmit} onSkip={onSkip} variant="secondary" />
  );
}

export type RatingGateVariantComponent =
  | typeof RatingGateDefaultVariant
  | typeof RatingGateSecondaryVariant;

/**
 * Resolve the active rating-gate variant for the current platform.
 *
 * Why a function and not a top-level constant: capturing `Platform.select(...)`
 * in a module-scope constant would freeze the choice at module-load time,
 * defeating unit tests that mock `Platform.OS` per case.
 */
export function selectRatingGateVariant(): RatingGateVariantComponent {
  return (
    Platform.select<RatingGateVariantComponent>({
      ios: RatingGateDefaultVariant,
      android: RatingGateSecondaryVariant,
      default: RatingGateDefaultVariant,
    }) ?? RatingGateDefaultVariant
  );
}

export default function RatingGateRoute(): JSX.Element {
  const router = useRouter();
  const Variant = selectRatingGateVariant();
  // `usePostHog()` returns `PostHog | undefined`. The `undefined` branch is the
  // documented degraded-mode contract (no api key in `.env` → no context
  // value). `trackRatingPromptCompleted` optional-chains on `capture`, so
  // passing `undefined` is a silent no-op by design — no throw, no console
  // output, capture count 0.
  const posthog = usePostHog();

  /**
   * submit_rating CTA handler (both variants — iOS `default` /
   * Android `secondary`). Per the cross-platform-parity contract, both
   * variants invoke the same unified {@link requestStoreReview} helper; the
   * helper itself narrows `Platform.OS` and routes to the correct native
   * surface (`SKStoreReviewController` on iOS, Play In-App Review on Android).
   *
   * Fire-and-forget + navigation-never-blocked contract:
   *   `requestStoreReview()` is dispatched WITHOUT being awaited and its
   *   returned promise can never reject (the helper swallows every SDK
   *   exception internally). Navigation to `fake-loader` therefore happens
   *   immediately and unconditionally — it is never gated on the native
   *   prompt's availability, presentation, or outcome.
   *
   * Analytics (`rating_prompt_completed`):
   *   The helper's resolved {@link StoreReviewOutcome} (`{ attempted,
   *   available, platform }`) is forwarded to `trackRatingPromptCompleted` from
   *   the helper promise's `.then` — this fires AFTER the cheap availability
   *   probe settles (a microtask later) but, crucially, NOT before navigation:
   *   `router.push` runs synchronously below so the analytics capture can never
   *   gate the forward transition. The promise never rejects, so no `.catch` is
   *   required.
   */
  const handleSubmit = (): void => {
    void requestStoreReview().then((outcome) => {
      trackRatingPromptCompleted(posthog, outcome);
    });
    router.push('/(funnel)/fake-loader');
  };

  /**
   * skip CTA handler — advances to `fake-loader` WITHOUT requesting a store
   * review (dismissable: true). The skip path must never dispatch
   * `requestStoreReview`.
   *
   * Analytics (`rating_prompt_skipped`):
   *   Fires `trackRatingPromptSkipped` with a platform-only payload
   *   (`{ platform }`) — there is no `attempted` / `available` outcome because
   *   no native call was made. The capture runs synchronously before
   *   `router.push`, but since it is a fire-once optional-chained `capture`
   *   (silent no-op when `posthog` is `undefined`) it can never block or fail
   *   the forward transition.
   */
  const handleSkip = (): void => {
    trackRatingPromptSkipped(posthog, { platform: resolveSkipPlatform() });
    router.push('/(funnel)/fake-loader');
  };

  return <Variant onSubmit={handleSubmit} onSkip={handleSkip} />;
}
