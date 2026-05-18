/**
 * Funnel Step 4 — `rating_gate`
 *
 * Platform.select branching (Sub-AC 5):
 *   The seed pins `rating-gate` to a single source file with internal
 *   Platform.select branching (NOT a `rating-gate.ios.tsx` / `.android.tsx`
 *   filename split) — see Seed constraint:
 *     "rating-gate는 단일 파일 + Platform.select 내부 분기
 *      (platform-specific 파일 분리 아님)".
 *
 *   The branching maps platforms to two presentational variants:
 *     - iOS      → **default**  variant: stands in for the iOS-native
 *                                       `SKStoreReviewController` dialog
 *                                       (dismissable). Chosen as the default
 *                                       because Glam Up's verbatim step-4
 *                                       targets iOS first.
 *     - Android  → **secondary** variant: stands in for the Google Play
 *                                       In-App Review API surface.
 *     - Other    → **default**  variant: web / native fallback resolves to
 *                                       the iOS-style component so the funnel
 *                                       renders something sane on every
 *                                       platform.
 *
 *   The variants are presentational placeholders only — the real native
 *   bridge (rating prompt + skip-count persistence) lands in Phase 3/4 and
 *   will be reached through `shouldDismissRating()` in `_guards.ts`.
 *
 * Testability shape:
 *   `selectRatingGateVariant()` is a pure, parameter-free function that
 *   re-reads `Platform.OS` on every call. This makes Sub-AC 5.1's iOS unit
 *   test trivial: mock `react-native` with `Platform.OS = 'ios'`, call the
 *   function, assert the returned component is `RatingGateDefaultVariant`
 *   by reference. The two variant components are also named exports so the
 *   test can compare references directly without rendering.
 *
 * Route-params contract: none (internal-only screen; not reachable via
 * external deep link).
 */
import { Platform, StyleSheet, Text, View } from 'react-native';

// ---------------------------------------------------------------------------
// Variant components
//
// Each variant is a tiny placeholder that renders its own identifier in the
// dev-info subtitle so a manual smoke test on a device makes the active
// branch obvious without needing dev-tools. The components are exported by
// name so the unit test can identity-check the Platform.select result.
// ---------------------------------------------------------------------------

/**
 * iOS-targeted **default** variant — placeholder for the iOS native
 * `SKStoreReviewController` rating dialog (dismissable). Sub-AC 5.1's iOS
 * test asserts `selectRatingGateVariant()` returns this exact reference.
 */
export function RatingGateDefaultVariant(): JSX.Element {
  return (
    <View style={styles.container} testID="rating-gate-default-variant">
      <Text style={styles.title}>Funnel Step 4 of 12</Text>
      <Text style={styles.subtitle}>rating_gate · iOS default variant</Text>
    </View>
  );
}

/**
 * Android-targeted **secondary** variant — placeholder for the Google Play
 * In-App Review API surface. Wired to `Platform.OS === 'android'` via
 * `Platform.select` below.
 */
export function RatingGateSecondaryVariant(): JSX.Element {
  return (
    <View style={styles.container} testID="rating-gate-secondary-variant">
      <Text style={styles.title}>Funnel Step 4 of 12</Text>
      <Text style={styles.subtitle}>rating_gate · Android secondary variant</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Platform.select branching
// ---------------------------------------------------------------------------

/**
 * Discriminated component type — both variants are JSX-component functions
 * with no required props. Encoding the union explicitly (rather than as a
 * loose `ComponentType`) makes the unit test's reference comparison
 * type-safe end-to-end.
 */
export type RatingGateVariantComponent =
  | typeof RatingGateDefaultVariant
  | typeof RatingGateSecondaryVariant;

/**
 * Resolve the active rating-gate variant for the current platform.
 *
 * Why a function and not a top-level constant:
 *   Capturing `Platform.select(...)` in a module-scope constant would freeze
 *   the choice at module-load time, defeating the unit test (which needs to
 *   exercise both iOS and Android paths). A parameter-free function re-reads
 *   `Platform.OS` on every call, so `vi.mock('react-native', ...)` can
 *   substitute different values per test without `vi.resetModules()` churn.
 *
 * Fallback:
 *   `Platform.select` returns `T | undefined` when no key matches — the
 *   `??` nullish-coalescing on `RatingGateDefaultVariant` makes the fallback
 *   explicit so this function NEVER returns `undefined`. The `default` key
 *   already covers non-ios/android platforms in practice; the `??` is
 *   defence-in-depth for environments where `Platform.select` is itself
 *   mocked without a `default` slot.
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

// ---------------------------------------------------------------------------
// Default Expo Router screen entry
// ---------------------------------------------------------------------------

/**
 * Screen entry point — resolves the platform-specific variant on each render
 * and delegates to it. Expo Router picks this up via the file's default
 * export.
 */
export default function RatingGateScreen(): JSX.Element {
  const Variant = selectRatingGateVariant();
  return <Variant />;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.6, marginTop: 4 },
});
