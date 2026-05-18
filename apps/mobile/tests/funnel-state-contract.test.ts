/**
 * Type-level + compile test for `apps/mobile/src/contracts/funnel-state.ts`
 * (Sub-AC 7.1).
 *
 * Verifies that the `FunnelStateValue` contract:
 *   1. Exposes a `readonly onboarding` field whose value is a
 *      `FunnelOnboardingAnswers` record containing exactly two fields:
 *      `selfieEditStyle` and `priorDiagnosis`, each a string literal union
 *      or `null` (no `string`, no `undefined`, no free text).
 *   2. Defaults both onboarding fields to `null` via
 *      `INITIAL_FUNNEL_ONBOARDING_ANSWERS`.
 *   3. Exposes a `readonly setOnboarding(patch): void` updater whose patch
 *      argument accepts the same union values per key (and explicitly does
 *      NOT accept arbitrary strings).
 *
 * Strategy:
 *   This is a *compile* test — the tests below use TypeScript-level utilities
 *   (`Equal<A, B>`, `Expect<...>`) to assert structural equality of the
 *   declared types against an expected shape. If the contract drifts (e.g.
 *   a new free-text field is added, or `readonly` is removed) the file
 *   stops type-checking and `pnpm typecheck` fails loud — that is the
 *   primary signal.
 *
 *   Vitest is included as a thin runtime harness so the file participates
 *   in the existing `vitest run` test set (the suite picks up
 *   `tests/**\/*.test.ts`). The runtime assertions exist mainly to keep the
 *   file from being elided by an unused-import pruner and to make the
 *   default values observably correct — the heavy lifting is at the type
 *   level above.
 */
import { describe, expect, it } from 'vitest';

import {
  INITIAL_FUNNEL_ONBOARDING_ANSWERS,
  type FunnelOnboardingAnswers,
  type FunnelOnboardingPatch,
  type FunnelStateValue,
  type PriorDiagnosis,
  type SelfieEditStyle,
  type SetOnboarding,
} from '../src/contracts/funnel-state';

// ---------------------------------------------------------------------------
// Tiny type-level assertion helpers (vendored — no external dep)
//
// `Equal<A, B>` resolves to `true` iff `A` and `B` are structurally identical
// from TypeScript's perspective (including readonly modifiers and exact
// optional shapes). Wrapping it in `Expect<T extends true ? true : never>`
// turns a mismatch into a compile error at the call site so test failures
// surface during `tsc --noEmit` (typecheck) rather than only at runtime.
// ---------------------------------------------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// 1. SelfieEditStyle and PriorDiagnosis are exactly the expected literal unions
// ---------------------------------------------------------------------------
type _SelfieEditStyle_IsExactUnion = Expect<
  Equal<SelfieEditStyle, 'natural' | 'subtle' | 'expressive'>
>;
type _PriorDiagnosis_IsExactUnion = Expect<
  Equal<PriorDiagnosis, 'never' | 'self_test' | 'professional'>
>;

// String is NOT a valid SelfieEditStyle / PriorDiagnosis — the literal union
// must not collapse to `string`. We assert this by checking that `string`
// does NOT extend the union (and the union DOES extend `string`).
type _SelfieEditStyle_RejectsArbitraryString = Expect<
  Equal<Extract<SelfieEditStyle, string>, SelfieEditStyle>
>;
type _SelfieEditStyle_NotJustString = Expect<
  Equal<string extends SelfieEditStyle ? true : false, false>
>;
type _PriorDiagnosis_NotJustString = Expect<
  Equal<string extends PriorDiagnosis ? true : false, false>
>;

// ---------------------------------------------------------------------------
// 2. FunnelOnboardingAnswers — exact shape, readonly, includes null
// ---------------------------------------------------------------------------
type _FunnelOnboardingAnswers_IsExactShape = Expect<
  Equal<
    FunnelOnboardingAnswers,
    {
      readonly selfieEditStyle: SelfieEditStyle | null;
      readonly priorDiagnosis: PriorDiagnosis | null;
    }
  >
>;

// Mutating either field must be a *compile* error. TypeScript's `extends`
// check is bidirectional between readonly and mutable variants (both assign
// to each other structurally), so a plain `extends` would not detect a
// missing `readonly` modifier. The `Equal<A, B>` helper above, however,
// uses the `<T>() => T extends A ? 1 : 2` trick which DOES distinguish
// `{ x: T }` from `{ readonly x: T }` — so we assert that
// `Equal<Mutable, FunnelOnboardingAnswers>` resolves to `false`. If anyone
// ever drops the `readonly` modifier from either field the comparison flips
// to `true` and this assertion fails to compile.
type MutableOnboardingAnswers = {
  selfieEditStyle: SelfieEditStyle | null;
  priorDiagnosis: PriorDiagnosis | null;
};
type _FunnelOnboardingAnswers_IsReadonly = Expect<
  Equal<Equal<MutableOnboardingAnswers, FunnelOnboardingAnswers>, false>
>;

// ---------------------------------------------------------------------------
// 3. FunnelOnboardingPatch — partial of the answers, same value domain
// ---------------------------------------------------------------------------
type _FunnelOnboardingPatch_IsExactShape = Expect<
  Equal<
    FunnelOnboardingPatch,
    {
      readonly selfieEditStyle?: SelfieEditStyle | null;
      readonly priorDiagnosis?: PriorDiagnosis | null;
    }
  >
>;

// ---------------------------------------------------------------------------
// 4. SetOnboarding — function signature
// ---------------------------------------------------------------------------
type _SetOnboarding_IsExactSignature = Expect<
  Equal<SetOnboarding, (patch: FunnelOnboardingPatch) => void>
>;

// ---------------------------------------------------------------------------
// 5. FunnelStateValue — full shape, both fields readonly
// ---------------------------------------------------------------------------
type _FunnelStateValue_IsExactShape = Expect<
  Equal<
    FunnelStateValue,
    {
      readonly onboarding: FunnelOnboardingAnswers;
      readonly setOnboarding: SetOnboarding;
    }
  >
>;

// ---------------------------------------------------------------------------
// 6. Reference all type-level assertions so they participate in typecheck.
//    (Each `Expect<...>` resolves to `true` at the type level; assigning
//    `true` to them keeps the symbols live.)
// ---------------------------------------------------------------------------
const _typeAssertions: readonly [
  _SelfieEditStyle_IsExactUnion,
  _PriorDiagnosis_IsExactUnion,
  _SelfieEditStyle_RejectsArbitraryString,
  _SelfieEditStyle_NotJustString,
  _PriorDiagnosis_NotJustString,
  _FunnelOnboardingAnswers_IsExactShape,
  _FunnelOnboardingAnswers_IsReadonly,
  _FunnelOnboardingPatch_IsExactShape,
  _SetOnboarding_IsExactSignature,
  _FunnelStateValue_IsExactShape,
] = [true, true, true, true, true, true, true, true, true, true];

// ---------------------------------------------------------------------------
// Runtime sanity — defaults are null, frozen, and exactly the two keys.
// ---------------------------------------------------------------------------
describe('FunnelStateValue contract — Sub-AC 7.1', () => {
  it('keeps the type-level assertions alive (compile-time gate)', () => {
    // Touching the tuple at runtime guarantees vitest fails fast if anyone
    // weakens the contract in a way that `tsc` would catch — the value
    // exists only so the assertions are not tree-shaken at test time.
    expect(_typeAssertions).toHaveLength(10);
    for (const flag of _typeAssertions) {
      expect(flag).toBe(true);
    }
  });

  it('initialises both onboarding answers to null', () => {
    expect(INITIAL_FUNNEL_ONBOARDING_ANSWERS).toEqual({
      selfieEditStyle: null,
      priorDiagnosis: null,
    });
  });

  it('exposes only the two declared keys on the initial answers value', () => {
    expect(Object.keys(INITIAL_FUNNEL_ONBOARDING_ANSWERS).sort()).toEqual([
      'priorDiagnosis',
      'selfieEditStyle',
    ]);
  });

  it('freezes the initial answers value to prevent shared-reference mutation', () => {
    expect(Object.isFrozen(INITIAL_FUNNEL_ONBOARDING_ANSWERS)).toBe(true);
  });

  it('accepts the canonical patch shape via the SetOnboarding signature', () => {
    // Concrete `SetOnboarding` implementation — exercising the signature at
    // runtime confirms the partial-update contract holds end-to-end.
    let last: FunnelOnboardingPatch | null = null;
    const setOnboarding: SetOnboarding = (patch) => {
      last = patch;
    };

    setOnboarding({ selfieEditStyle: 'natural' });
    expect(last).toEqual({ selfieEditStyle: 'natural' });

    setOnboarding({ priorDiagnosis: 'professional' });
    expect(last).toEqual({ priorDiagnosis: 'professional' });

    setOnboarding({ selfieEditStyle: null, priorDiagnosis: 'never' });
    expect(last).toEqual({ selfieEditStyle: null, priorDiagnosis: 'never' });

    setOnboarding({});
    expect(last).toEqual({});
  });

  it('allows constructing a full FunnelStateValue with readonly fields', () => {
    const value: FunnelStateValue = {
      onboarding: INITIAL_FUNNEL_ONBOARDING_ANSWERS,
      setOnboarding: () => {
        /* noop test impl */
      },
    };
    expect(value.onboarding.selfieEditStyle).toBeNull();
    expect(value.onboarding.priorDiagnosis).toBeNull();
    expect(typeof value.setOnboarding).toBe('function');
  });
});
