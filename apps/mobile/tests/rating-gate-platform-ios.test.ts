/**
 * Unit test — Platform.select branching in
 * `apps/mobile/app/(funnel)/rating-gate.tsx`, iOS branch (Sub-AC 5.1).
 *
 * Contract pinned by this file:
 *   "Platform.select 분기 모듈(step 4 rating-gate)이 iOS에서 default
 *    컴포넌트를 반환하는 단위 테스트."
 *
 *   When `Platform.OS === 'ios'`, `selectRatingGateVariant()` MUST return
 *   the `RatingGateDefaultVariant` component reference — not a string, not
 *   the secondary variant, not `undefined`.
 *
 * Why the iOS branch is the **default** variant:
 *   The Glam Up funnel's step-4 verbatim spec targets iOS first (the iOS
 *   native `SKStoreReviewController` rating dialog). Picking the iOS path
 *   as the named "default" preserves the canonical Glam Up wording in
 *   `FUNNEL_SCREENS.rating_gate.metadata.dialogType === 'ios_native'` while
 *   still allowing a separate Android secondary path (asserted in a sibling
 *   Sub-AC test).
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
// Platform-aware ESM mock pinned to `OS: 'ios'`.
//
// `Platform.select` is implemented to mirror react-native's documented
// selection order:
//   1. Exact OS match (here: `ios`)
//   2. `native` (matches when running on a native platform — irrelevant here)
//   3. `default`  (matches when no other key fires)
// The function is generic so the call-site at `selectRatingGateVariant()`
// retains its component-type narrowing.
// ---------------------------------------------------------------------------
// Phase 2.2: rating-gate.tsx now imports RatingGateContent (which transitively
// pulls in react-native-safe-area-context via FunnelScreenLayout) and
// `useRouter` from expo-router. Stub both so the Platform.select branching
// test can load the route module without dragging in the real source.
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
    Promise.resolve({ attempted: false, available: false, platform: 'ios' }),
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
    // OS is pinned to 'ios' in this test file — return the iOS slot if
    // provided, otherwise fall back to the documented selection chain.
    if (specifics.ios !== undefined) return specifics.ios;
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
      OS: 'ios' as const,
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
// is registered first). We pull both `selectRatingGateVariant` and the
// `RatingGateDefaultVariant` reference so the iOS assertion can compare by
// identity, not by name or shape.
// ---------------------------------------------------------------------------
import {
  RatingGateDefaultVariant,
  RatingGateSecondaryVariant,
  selectRatingGateVariant,
} from '../app/(funnel)/rating-gate';

describe('rating-gate Platform.select branching — iOS', () => {
  it('returns the default variant component when Platform.OS === "ios"', () => {
    // The core contract of Sub-AC 5.1: iOS → default. We compare by
    // reference to `RatingGateDefaultVariant` so a future refactor that
    // wraps the variant in a HOC (changing the function identity) is
    // flagged here rather than silently passing.
    const Variant = selectRatingGateVariant();

    expect(Variant).toBe(RatingGateDefaultVariant);
  });

  it('does not return the Android secondary variant on iOS', () => {
    // Defence-in-depth: a slot-swap bug (e.g. `{ ios: Secondary,
    // android: Default }`) would still produce a function reference, so
    // the previous `toBe(Default)` assertion already catches it. This
    // explicit negative anchor makes the failure message clearer when it
    // does regress.
    const Variant = selectRatingGateVariant();

    expect(Variant).not.toBe(RatingGateSecondaryVariant);
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
    expect(first).toBe(RatingGateDefaultVariant);
  });
});
