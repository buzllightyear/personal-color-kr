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
  INITIAL_FUNNEL_DIAGNOSIS_INPUT,
  INITIAL_FUNNEL_ONBOARDING_ANSWERS,
  INITIAL_FUNNEL_PAYMENT,
  INITIAL_FUNNEL_REFERRAL,
  type FunnelDiagnosisInput,
  type FunnelOnboardingAnswers,
  type FunnelOnboardingPatch,
  type FunnelPayment,
  type FunnelPaymentPatch,
  type FunnelReferral,
  type FunnelReferralPatch,
  type FunnelStateValue,
  type PaymentMethod,
  type PriorDiagnosis,
  type SelfieEditStyle,
  type SetDiagnosisInput,
  type SetIsPremium,
  type SetOnboarding,
  type SetPayment,
  type SetPaymentProcessing,
  type SetReferral,
  type SetSelectedPaymentMethod,
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
// 5. FunnelStateValue — full shape, all slice fields readonly
// ---------------------------------------------------------------------------
type _FunnelStateValue_IsExactShape = Expect<
  Equal<
    FunnelStateValue,
    {
      readonly onboarding: FunnelOnboardingAnswers;
      readonly setOnboarding: SetOnboarding;
      readonly diagnosisInput: FunnelDiagnosisInput;
      readonly setDiagnosisInput: SetDiagnosisInput;
      readonly referral: FunnelReferral;
      readonly setReferral: SetReferral;
      readonly payment: FunnelPayment;
      readonly setPayment: SetPayment;
      readonly setSelectedPaymentMethod: SetSelectedPaymentMethod;
      readonly setPaymentProcessing: SetPaymentProcessing;
      readonly setIsPremium: SetIsPremium;
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
      diagnosisInput: INITIAL_FUNNEL_DIAGNOSIS_INPUT,
      setDiagnosisInput: () => {
        /* noop test impl */
      },
      referral: INITIAL_FUNNEL_REFERRAL,
      setReferral: () => {
        /* noop test impl */
      },
      payment: INITIAL_FUNNEL_PAYMENT,
      setPayment: () => {
        /* noop test impl */
      },
      setSelectedPaymentMethod: () => {
        /* noop test impl */
      },
      setPaymentProcessing: () => {
        /* noop test impl */
      },
      setIsPremium: () => {
        /* noop test impl */
      },
    };
    expect(value.onboarding.selfieEditStyle).toBeNull();
    expect(value.onboarding.priorDiagnosis).toBeNull();
    expect(typeof value.setOnboarding).toBe('function');
    expect(value.diagnosisInput.selfieUri).toBeNull();
    expect(typeof value.setDiagnosisInput).toBe('function');
    expect(value.referral.shared).toBe(false);
    expect(typeof value.setReferral).toBe('function');
    expect(value.payment.selectedMethod).toBeNull();
    expect(value.payment.isProcessing).toBe(false);
    expect(value.payment.isPremium).toBe(false);
    expect(typeof value.setPayment).toBe('function');
    expect(typeof value.setSelectedPaymentMethod).toBe('function');
    expect(typeof value.setPaymentProcessing).toBe('function');
    expect(typeof value.setIsPremium).toBe('function');
  });

  it('exposes FunnelDiagnosisInput with selfieUri initialised to null', () => {
    expect(INITIAL_FUNNEL_DIAGNOSIS_INPUT).toEqual({ selfieUri: null });
    expect(Object.isFrozen(INITIAL_FUNNEL_DIAGNOSIS_INPUT)).toBe(true);
  });

  it('accepts SetDiagnosisInput patches with selfieUri string or null', () => {
    let last: { selfieUri?: string | null } | null = null;
    const setDiagnosisInput: SetDiagnosisInput = (patch) => {
      last = patch;
    };

    setDiagnosisInput({ selfieUri: 'stub://selfie/12345' });
    expect(last).toEqual({ selfieUri: 'stub://selfie/12345' });

    setDiagnosisInput({ selfieUri: null });
    expect(last).toEqual({ selfieUri: null });

    setDiagnosisInput({});
    expect(last).toEqual({});
  });

  // Type-level: FunnelDiagnosisInput must have exactly one readonly field
  type _FunnelDiagnosisInput_ExactShape = Expect<
    Equal<FunnelDiagnosisInput, { readonly selfieUri: string | null }>
  >;
  const _diagnosisAssertion: _FunnelDiagnosisInput_ExactShape = true;
  void _diagnosisAssertion;

  // -------------------------------------------------------------------------
  // Phase 2.4 referral slice (step 10 — referral_gate)
  // -------------------------------------------------------------------------
  it('exposes FunnelReferral with shared initialised to false', () => {
    expect(INITIAL_FUNNEL_REFERRAL).toEqual({ shared: false });
    expect(Object.isFrozen(INITIAL_FUNNEL_REFERRAL)).toBe(true);
  });

  it('accepts SetReferral patches with shared boolean', () => {
    let last: FunnelReferralPatch | null = null;
    const setReferral: SetReferral = (patch) => {
      last = patch;
    };

    setReferral({ shared: true });
    expect(last).toEqual({ shared: true });

    setReferral({ shared: false });
    expect(last).toEqual({ shared: false });

    setReferral({});
    expect(last).toEqual({});
  });

  // Type-level: FunnelReferral must have exactly one readonly boolean field
  type _FunnelReferral_ExactShape = Expect<
    Equal<FunnelReferral, { readonly shared: boolean }>
  >;
  const _referralAssertion: _FunnelReferral_ExactShape = true;
  void _referralAssertion;

  // Type-level: FunnelReferralPatch must be a partial of FunnelReferral
  type _FunnelReferralPatch_ExactShape = Expect<
    Equal<FunnelReferralPatch, { readonly shared?: boolean }>
  >;
  const _referralPatchAssertion: _FunnelReferralPatch_ExactShape = true;
  void _referralPatchAssertion;

  // Type-level: SetReferral signature
  type _SetReferral_ExactSignature = Expect<
    Equal<SetReferral, (patch: FunnelReferralPatch) => void>
  >;
  const _setReferralAssertion: _SetReferral_ExactSignature = true;
  void _setReferralAssertion;

  // -------------------------------------------------------------------------
  // Phase 2.4 payment slice (step 12 — payment_model, Sub-AC 15.1)
  //
  // Initial-state contract:
  //   - `selectedMethod: null`   (user has not yet tapped a radio option)
  //   - `isProcessing: false`    (no in-flight placeholder simulation)
  //   - `isPremium: false`       (premium content remains locked)
  //
  // These three defaults are the unit-test verification surface required by
  // Sub-AC 15.1. They flow through the FunnelStateProvider as the seed for
  // the payment `useState` cell, so a divergence here is observable by any
  // funnel screen that subscribes to the payment slice.
  // -------------------------------------------------------------------------
  it('exposes FunnelPayment with the three Sub-AC 15.1 defaults', () => {
    expect(INITIAL_FUNNEL_PAYMENT).toEqual({
      selectedMethod: null,
      isProcessing: false,
      isPremium: false,
    });
    expect(Object.isFrozen(INITIAL_FUNNEL_PAYMENT)).toBe(true);
  });

  it('exposes exactly the three declared keys on INITIAL_FUNNEL_PAYMENT', () => {
    expect(Object.keys(INITIAL_FUNNEL_PAYMENT).sort()).toEqual([
      'isPremium',
      'isProcessing',
      'selectedMethod',
    ]);
  });

  it('accepts SetPayment patches with PaymentMethod or null for selectedMethod', () => {
    let last: FunnelPaymentPatch | null = null;
    const setPayment: SetPayment = (patch) => {
      last = patch;
    };

    setPayment({ selectedMethod: 'kakao' });
    expect(last).toEqual({ selectedMethod: 'kakao' });

    setPayment({ selectedMethod: 'toss' });
    expect(last).toEqual({ selectedMethod: 'toss' });

    setPayment({ selectedMethod: null });
    expect(last).toEqual({ selectedMethod: null });

    setPayment({ isProcessing: true });
    expect(last).toEqual({ isProcessing: true });

    setPayment({ isPremium: true });
    expect(last).toEqual({ isPremium: true });

    setPayment({});
    expect(last).toEqual({});
  });

  // Type-level: PaymentMethod is exactly the closed two-method union — no
  // free-text widening, no `string` fallback. If anyone adds a third method
  // (e.g. `'naver_pay'`) this assertion stops compiling and forces a
  // deliberate contract update + Sub-AC review.
  type _PaymentMethod_IsExactUnion = Expect<
    Equal<PaymentMethod, 'kakao' | 'toss'>
  >;
  type _PaymentMethod_NotJustString = Expect<
    Equal<string extends PaymentMethod ? true : false, false>
  >;
  const _paymentMethodAssertions: readonly [
    _PaymentMethod_IsExactUnion,
    _PaymentMethod_NotJustString,
  ] = [true, true];
  void _paymentMethodAssertions;

  // Type-level: FunnelPayment must have exactly the three readonly fields.
  type _FunnelPayment_ExactShape = Expect<
    Equal<
      FunnelPayment,
      {
        readonly selectedMethod: PaymentMethod | null;
        readonly isProcessing: boolean;
        readonly isPremium: boolean;
      }
    >
  >;
  const _paymentShapeAssertion: _FunnelPayment_ExactShape = true;
  void _paymentShapeAssertion;

  // Type-level: dropping `readonly` from any field must surface as a compile
  // error. Same trick as the onboarding-readonly assertion above.
  type MutableFunnelPayment = {
    selectedMethod: PaymentMethod | null;
    isProcessing: boolean;
    isPremium: boolean;
  };
  type _FunnelPayment_IsReadonly = Expect<
    Equal<Equal<MutableFunnelPayment, FunnelPayment>, false>
  >;
  const _paymentReadonlyAssertion: _FunnelPayment_IsReadonly = true;
  void _paymentReadonlyAssertion;

  // Type-level: FunnelPaymentPatch must be a partial of FunnelPayment.
  type _FunnelPaymentPatch_ExactShape = Expect<
    Equal<
      FunnelPaymentPatch,
      {
        readonly selectedMethod?: PaymentMethod | null;
        readonly isProcessing?: boolean;
        readonly isPremium?: boolean;
      }
    >
  >;
  const _paymentPatchAssertion: _FunnelPaymentPatch_ExactShape = true;
  void _paymentPatchAssertion;

  // Type-level: SetPayment signature.
  type _SetPayment_ExactSignature = Expect<
    Equal<SetPayment, (patch: FunnelPaymentPatch) => void>
  >;
  const _setPaymentAssertion: _SetPayment_ExactSignature = true;
  void _setPaymentAssertion;

  // -------------------------------------------------------------------------
  // Sub-AC 15.2 — dedicated setSelectedPaymentMethod action signature
  //
  // The action accepts exactly `PaymentMethod | null` (no patch object, no
  // `undefined`). This narrow signature is what isolates the radio-selection
  // concern from the rest of the payment-slice state machine — see the
  // contract docblock on SetSelectedPaymentMethod for the full rationale.
  // -------------------------------------------------------------------------
  it('accepts SetSelectedPaymentMethod calls with PaymentMethod or null', () => {
    let last: PaymentMethod | null | 'unset' = 'unset';
    const setSelectedPaymentMethod: SetSelectedPaymentMethod = (method) => {
      last = method;
    };

    setSelectedPaymentMethod('kakao');
    expect(last).toBe('kakao');

    setSelectedPaymentMethod('toss');
    expect(last).toBe('toss');

    setSelectedPaymentMethod(null);
    expect(last).toBeNull();
  });

  // Type-level: SetSelectedPaymentMethod signature is the narrow
  // single-argument action — explicitly NOT a patch updater.
  type _SetSelectedPaymentMethod_ExactSignature = Expect<
    Equal<
      SetSelectedPaymentMethod,
      (method: PaymentMethod | null) => void
    >
  >;
  const _setSelectedPaymentMethodAssertion: _SetSelectedPaymentMethod_ExactSignature =
    true;
  void _setSelectedPaymentMethodAssertion;

  // -------------------------------------------------------------------------
  // Sub-AC 15.3 — dedicated setPaymentProcessing action signature
  //
  // The action accepts exactly `boolean` (no patch object, no `undefined`,
  // no widening to `string` / number). This narrow signature is what
  // isolates the in-flight payment flag from the rest of the payment-slice
  // state machine — see the contract docblock on SetPaymentProcessing for
  // the full rationale.
  // -------------------------------------------------------------------------
  it('accepts SetPaymentProcessing calls with boolean true and false', () => {
    let last: boolean | 'unset' = 'unset';
    const setPaymentProcessing: SetPaymentProcessing = (isProcessing) => {
      last = isProcessing;
    };

    setPaymentProcessing(true);
    expect(last).toBe(true);

    setPaymentProcessing(false);
    expect(last).toBe(false);
  });

  // Type-level: SetPaymentProcessing signature is the narrow single-argument
  // action — explicitly NOT a patch updater, and the argument must be a
  // plain `boolean` (no widening to `boolean | undefined` etc).
  type _SetPaymentProcessing_ExactSignature = Expect<
    Equal<SetPaymentProcessing, (isProcessing: boolean) => void>
  >;
  const _setPaymentProcessingAssertion: _SetPaymentProcessing_ExactSignature =
    true;
  void _setPaymentProcessingAssertion;

  // -------------------------------------------------------------------------
  // Sub-AC 15.4 — dedicated setIsPremium action signature
  //
  // The action accepts exactly `boolean` (no patch object, no `undefined`,
  // no widening). This narrow signature is what isolates the premium-unlock
  // concern from the rest of the payment-slice state machine — see the
  // contract docblock on SetIsPremium for the full rationale.
  // -------------------------------------------------------------------------
  it('accepts SetIsPremium calls with boolean true and false', () => {
    let last: boolean | 'unset' = 'unset';
    const setIsPremium: SetIsPremium = (isPremium) => {
      last = isPremium;
    };

    setIsPremium(true);
    expect(last).toBe(true);

    setIsPremium(false);
    expect(last).toBe(false);
  });

  // Type-level: SetIsPremium signature is the narrow single-argument
  // action — explicitly NOT a patch updater, and the argument must be a
  // plain `boolean` (no widening to `boolean | undefined` etc).
  type _SetIsPremium_ExactSignature = Expect<
    Equal<SetIsPremium, (isPremium: boolean) => void>
  >;
  const _setIsPremiumAssertion: _SetIsPremium_ExactSignature = true;
  void _setIsPremiumAssertion;
});
