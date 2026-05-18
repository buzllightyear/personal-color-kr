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

import { RatingGateContent } from '../../src/screens/funnel/RatingGateContent';

export type RatingGateVariantId = 'default' | 'secondary';

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
  const handleAdvance = (): void => {
    router.push('/(funnel)/fake-loader');
  };
  return <Variant onSubmit={handleAdvance} onSkip={handleAdvance} />;
}
