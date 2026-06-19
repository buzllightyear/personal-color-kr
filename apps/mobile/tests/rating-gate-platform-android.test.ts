/**
 * Unit test — Platform.select branching in
 * `apps/mobile/app/(funnel)/rating-gate.tsx`, Android branch (Sub-AC 5.2).
 *
 * Contract pinned by this file:
 *   "Platform.select 분기 모듈(step 4 rating-gate)이 Android에서 secondary
 *    컴포넌트를 반환하는 단위 테스트."
 *
 *   When `Platform.OS === 'android'`, `selectRatingGateVariant()` MUST return
 *   the `RatingGateSecondaryVariant` component reference — not a string, not
 *   the iOS default variant, not `undefined`.
 *
 * Why the Android branch is the **secondary** variant:
 *   The Glam Up funnel's step-4 verbatim spec targets the iOS native
 *   `SKStoreReviewController` dialog as the canonical experience (hence the
 *   iOS "default" variant). Android receives a distinct presentational
 *   placeholder that will later wire into the Google Play In-App Review API —
 *   represented in the source by `RatingGateSecondaryVariant`. Pinning the
 *   Android branch to `secondary` (rather than the bare `default` fallback)
 *   prevents a future regression where someone accidentally drops the
 *   `android:` slot and silently inherits the iOS variant on Android devices.
 *
 * Why this test is a sibling of `rating-gate-platform-ios.test.ts` rather
 * than parameterised inside one file:
 *   - `vi.mock('react-native', ...)` is hoisted to the top of each FILE.
 *     A single file pinning `Platform.OS` to two different values would have
 *     to call `vi.resetModules()` between cases AND re-import the SUT, which
 *     in vitest hoist semantics is brittle (the second `vi.mock` factory is
 *     not re-evaluated automatically). One file per platform is the simplest
 *     way to keep each case deterministic.
 *   - It also matches how the seed describes the verifications: a per-branch
 *     unit test pinning the per-branch contract, with independent failure
 *     modes when one branch regresses.
 *
 * Mocking strategy — why `vi.mock('react-native', ...)` instead of relying
 * on `tests/__stubs__/setup-rn-stub.ts`:
 *   - The repo-wide setup stub exists ONLY so
 *     `@testing-library/react-native`'s helper modules survive Node's CJS
 *     parser (those modules do `require('react-native')` for type-only
 *     enums and would crash on Flow syntax otherwise). It deliberately
 *     omits `Platform` because no other test exercises platform branching.
 *   - This test needs an actual `Platform` shape with `OS` and `select`, so
 *     we override the import with `vi.mock` here. Vitest's `vi.mock` is
 *     hoisted to the top of the file before any imports, so the rating-gate
 *     module sees this mock the first time it `import`s `react-native` — no
 *     `vi.resetModules()` dance required.
 *   - We also re-export the host-component stubs (`View`, `Text`,
 *     `StyleSheet`) from this mock because `rating-gate.tsx` imports them
 *     alongside `Platform`. They are noop functions / pass-throughs because
 *     this test never `render()`s a component — it only inspects the
 *     `selectRatingGateVariant()` return value as a function reference.
 *
 * Why we compare by reference (`toBe(...)`) instead of by render output:
 *   - The test's contract is the Platform.select wiring, not the visual
 *     output. Comparing references catches refactors that accidentally
 *     swap the iOS/Android slots (e.g. `{ ios: Secondary, android: Default }`)
 *     which a render-based test could miss if the two variants render
 *     similar copy.
 *   - It also keeps the test pure-Node (no `react-test-renderer` instance,
 *     no JSX in the test file, no transitive react copy pinning concerns),
 *     which is faster and more deterministic.
 */
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.mock — `react-native`
//
// Hoisted by vitest's transformer to run BEFORE the `rating-gate` import
// below. Replaces the workspace-wide stub for THIS test only with a
// Platform-aware ESM mock pinned to `OS: 'android'`.
//
// `Platform.select` is implemented to mirror react-native's documented
// selection order:
//   1. Exact OS match (here: `android`)
//   2. `native` (matches when running on a native platform — irrelevant here)
//   3. `default`  (matches when no other key fires)
// The function is generic so the call-site at `selectRatingGateVariant()`
// retains its component-type narrowing.
// ---------------------------------------------------------------------------
// Phase 2.2: rating-gate.tsx now imports RatingGateContent (which transitively
// pulls in react-native-safe-area-context via FunnelScreenLayout) and
// `useRouter` from expo-router. Stub both.
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (): null => null,
}));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

// Phase 3 store-review wiring: rating-gate.tsx now imports the cross-platform
// `requestStoreReview` helper, which transitively imports the native
// `expo-store-review` SDK. Per the Seed isolation boundary ("route-level tests
// mock the helper module, NOT expo-store-review directly"), we stub the helper
// so loading the route module never resolves the native package. This test
// only inspects `selectRatingGateVariant()`, so a no-op stub suffices.
vi.mock('../src/store-review/request-store-review', () => ({
  requestStoreReview: () =>
    Promise.resolve({ attempted: false, available: false, platform: 'android' }),
}));

// Mock `posthog-react-native` so loading the rating-gate route does NOT pull in
// PostHog's real CJS dist, whose top-level `require('react-native')` would load
// react-native through Node's CommonJS loader. Combined with the
// `vi.mock('react-native')` ESM mock below, that dual CJS+ESM load of the same
// module specifier trips a hard Node `ERR_INTERNAL_ASSERTION` ("module imported
// again after being required") on Node ≥ 20.19 / 22 / 25. The route uses
// `usePostHog()` only for analytics (optional-chained, undefined = silent no-op),
// so an undefined stub is faithful to its degraded-mode contract.
vi.mock('posthog-react-native', () => ({
  usePostHog: () => undefined,
}));

vi.mock('react-native', () => {
  type PlatformSelectSpec<T> = {
    ios?: T;
    android?: T;
    web?: T;
    native?: T;
    default?: T;
  };

  function platformSelect<T>(specifics: PlatformSelectSpec<T>): T | undefined {
    // OS is pinned to 'android' in this test file — return the Android slot
    // if provided, otherwise fall back to the documented selection chain.
    // Critically, we do NOT fall through to `ios` even though it is also a
    // key in the call-site object: that would defeat the entire purpose of
    // this test (which exists to prove the Android slot is reachable
    // independently of the iOS slot).
    if (specifics.android !== undefined) return specifics.android;
    if (specifics.native !== undefined) return specifics.native;
    return specifics.default;
  }

  // Host-component stubs. They're never rendered in this test, but the
  // module-level `import { Platform, StyleSheet, Text, View } from
  // 'react-native'` in `rating-gate.tsx` still resolves them at import
  // time, so they must exist as named exports of the mock.
  const noopComponent = (): null => null;
  return {
    Platform: {
      OS: 'android' as const,
      select: platformSelect,
    },
    View: noopComponent,
    Text: noopComponent,
    Pressable: noopComponent,
    ScrollView: noopComponent,
    ActivityIndicator: noopComponent,
    StyleSheet: {
      create: <T>(stylesheet: T): T => stylesheet,
    },
  };
});

// ---------------------------------------------------------------------------
// System under test — imported AFTER `vi.mock` (hoisting guarantees the mock
// is registered first). We pull both `selectRatingGateVariant` and both
// variant references so the Android assertion can compare by identity, not
// by name or shape, AND assert the iOS default is NOT returned.
// ---------------------------------------------------------------------------
import {
  RatingGateDefaultVariant,
  RatingGateSecondaryVariant,
  selectRatingGateVariant,
} from '../app/(funnel)/rating-gate';

describe('rating-gate Platform.select branching — Android', () => {
  it('returns the secondary variant component when Platform.OS === "android"', () => {
    // The core contract of Sub-AC 5.2: Android → secondary. We compare by
    // reference to `RatingGateSecondaryVariant` so a future refactor that
    // wraps the variant in a HOC (changing the function identity) is
    // flagged here rather than silently passing.
    const Variant = selectRatingGateVariant();

    expect(Variant).toBe(RatingGateSecondaryVariant);
  });

  it('does not return the iOS default variant on Android', () => {
    // Defence-in-depth: a slot-swap bug (e.g. `{ ios: Secondary,
    // android: Default }`) would still produce a function reference, so
    // the previous `toBe(Secondary)` assertion already catches it. This
    // explicit negative anchor makes the failure message clearer when it
    // does regress — and it directly guards against the silent
    // "Android falls through to default" bug that would otherwise be
    // visually indistinguishable in a screenshot test.
    const Variant = selectRatingGateVariant();

    expect(Variant).not.toBe(RatingGateDefaultVariant);
  });

  it('returns a function (the variant is a renderable React component)', () => {
    // The Platform.select contract promises a component back, not a
    // string variant tag. Pinning `typeof` to `'function'` rules out
    // accidental returns of a config object or a string identifier in
    // future refactors.
    const Variant = selectRatingGateVariant();

    expect(typeof Variant).toBe('function');
  });

  it('returns the same reference on repeated calls (stable identity)', () => {
    // Calling the resolver twice must yield the same component reference
    // when `Platform.OS` is unchanged. This forbids any future "wrap on
    // every call" pattern that would defeat React reconciliation by
    // changing the component identity between renders.
    const first = selectRatingGateVariant();
    const second = selectRatingGateVariant();

    expect(first).toBe(second);
    expect(first).toBe(RatingGateSecondaryVariant);
  });

  it('returns a variant distinct from the iOS default (variants are not aliased)', () => {
    // Cross-check the module-level invariant that the two named variant
    // exports are NOT the same function. If a future refactor collapses
    // both variants into a shared component, this assertion fails loudly
    // before the Android-specific contract can become meaningless. Without
    // this anchor, `toBe(Secondary)` and `not.toBe(Default)` could both
    // hold even after an accidental `Secondary = Default` re-export.
    expect(RatingGateSecondaryVariant).not.toBe(RatingGateDefaultVariant);
  });
});
