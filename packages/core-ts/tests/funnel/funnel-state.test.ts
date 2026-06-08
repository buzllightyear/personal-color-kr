/**
 * Unit tests — `createFunnelState` 팩토리 함수 (Sub-AC 1)
 *
 * Verifies:
 *   1. 반환 형태: step === 0, status === 'idle'
 *   2. 순수 함수: 매 호출마다 같은 shape 반환 (equal 하지만 독립 참조)
 *   3. 불변 객체: Object.isFrozen(result) === true
 *   4. 타입 level: FunnelStateObject 인터페이스와 FunnelStatusValue union 계약 검증
 */
import { describe, expect, it } from 'vitest';

import {
  advance,
  createFunnelState,
  reset,
  retreat,
  type FunnelStateObject,
  type FunnelStatusValue,
} from '../../src/funnel/funnel-state.js';

// ---------------------------------------------------------------------------
// Type-level assertion helpers (vendored — no external dep)
// ---------------------------------------------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// Type-level contracts
// ---------------------------------------------------------------------------

// FunnelStatusValue must be the exact four-member literal union.
type _FunnelStatusValue_IsExactUnion = Expect<
  Equal<FunnelStatusValue, 'idle' | 'active' | 'completed' | 'abandoned'>
>;
type _FunnelStatusValue_NotJustString = Expect<
  Equal<string extends FunnelStatusValue ? true : false, false>
>;

// FunnelStateObject must have exactly two readonly fields with the right types.
type _FunnelStateObject_IsExactShape = Expect<
  Equal<
    FunnelStateObject,
    { readonly step: number; readonly status: FunnelStatusValue }
  >
>;

// Keep the type-level assertions alive by touching them at runtime.
const _typeAssertions: readonly [
  _FunnelStatusValue_IsExactUnion,
  _FunnelStatusValue_NotJustString,
  _FunnelStateObject_IsExactShape,
] = [true, true, true];

// ---------------------------------------------------------------------------
// Runtime tests
// ---------------------------------------------------------------------------

describe('createFunnelState — Sub-AC 1', () => {
  it('keeps type-level contract assertions alive (compile-time gate)', () => {
    expect(_typeAssertions).toHaveLength(3);
    for (const flag of _typeAssertions) {
      expect(flag).toBe(true);
    }
  });

  it('returns step === 0 (퍼널 진입 전 초기값)', () => {
    const state = createFunnelState();
    expect(state.step).toBe(0);
  });

  it("returns status === 'idle' (퍼널 미진입 상태)", () => {
    const state = createFunnelState();
    expect(state.status).toBe('idle');
  });

  it('returns an object with exactly the two declared keys', () => {
    const state = createFunnelState();
    expect(Object.keys(state).sort()).toEqual(['status', 'step']);
  });

  it('returns a frozen (immutable) object', () => {
    const state = createFunnelState();
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('is a pure function — subsequent calls return equal values', () => {
    const a = createFunnelState();
    const b = createFunnelState();
    expect(a).toEqual(b);
  });

  it('each call returns a distinct reference (no singleton side-effect)', () => {
    const a = createFunnelState();
    const b = createFunnelState();
    // Values are equal but references are independent — each caller gets its own object.
    expect(a).not.toBe(b);
  });

  it('produces an object conforming to FunnelStateObject interface', () => {
    const state: FunnelStateObject = createFunnelState();
    // TypeScript narrowing: both fields must satisfy their declared types.
    expect(typeof state.step).toBe('number');
    expect(typeof state.status).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// advance — Sub-AC 2: 경계값 단위 테스트
// ---------------------------------------------------------------------------

describe('advance — Sub-AC 2 (전진 전이 순수 함수)', () => {
  // -------------------------------------------------------------------------
  // 경계값: 0 → 1 (idle에서 첫 단계 진입)
  // -------------------------------------------------------------------------

  it('0 → 1: step 0(idle)에서 advance하면 step 1, status active 반환', () => {
    const initial = createFunnelState(); // { step: 0, status: 'idle' }
    const next = advance(initial);

    expect(next.step).toBe(1);
    expect(next.status).toBe('active');
  });

  it('0 → 1: 반환 객체는 불변(frozen)이다', () => {
    const next = advance(createFunnelState());

    expect(Object.isFrozen(next)).toBe(true);
  });

  it('0 → 1: 원본 상태를 변이하지 않는다 (순수 함수)', () => {
    const original = createFunnelState();
    advance(original);

    expect(original.step).toBe(0);
    expect(original.status).toBe('idle');
  });

  it('0 → 1: 반환 객체는 원본과 다른 참조(reference)다', () => {
    const original = createFunnelState();
    const next = advance(original);

    expect(next).not.toBe(original);
  });

  // -------------------------------------------------------------------------
  // 경계값: 11 → 12 (마지막 단계 진입)
  // -------------------------------------------------------------------------

  it('11 → 12: step 11에서 advance하면 step 12, status active 반환', () => {
    const state: FunnelStateObject = Object.freeze({ step: 11, status: 'active' });
    const next = advance(state);

    expect(next.step).toBe(12);
    expect(next.status).toBe('active');
  });

  it('11 → 12: 반환 객체는 불변(frozen)이다', () => {
    const state: FunnelStateObject = Object.freeze({ step: 11, status: 'active' });
    const next = advance(state);

    expect(Object.isFrozen(next)).toBe(true);
  });

  it('11 → 12: 원본 상태를 변이하지 않는다', () => {
    const state: FunnelStateObject = Object.freeze({ step: 11, status: 'active' });
    advance(state);

    expect(state.step).toBe(11);
    expect(state.status).toBe('active');
  });

  // -------------------------------------------------------------------------
  // 경계값: 12 → 완료 status 전환
  // -------------------------------------------------------------------------

  it('12 → 완료: step 12에서 advance하면 status completed로 전환', () => {
    const state: FunnelStateObject = Object.freeze({ step: 12, status: 'active' });
    const next = advance(state);

    expect(next.status).toBe('completed');
  });

  it('12 → 완료: step은 12로 유지된다 (step이 13이 되지 않음)', () => {
    const state: FunnelStateObject = Object.freeze({ step: 12, status: 'active' });
    const next = advance(state);

    expect(next.step).toBe(12);
  });

  it('12 → 완료: 반환 객체는 불변(frozen)이다', () => {
    const state: FunnelStateObject = Object.freeze({ step: 12, status: 'active' });
    const next = advance(state);

    expect(Object.isFrozen(next)).toBe(true);
  });

  it('12 → 완료: 원본 상태를 변이하지 않는다', () => {
    const state: FunnelStateObject = Object.freeze({ step: 12, status: 'active' });
    advance(state);

    expect(state.step).toBe(12);
    expect(state.status).toBe('active');
  });

  // -------------------------------------------------------------------------
  // 경계값: 완료 상태에서 advance 무효 (no-op)
  // -------------------------------------------------------------------------

  it('완료 → 무효: status completed 상태에서 advance하면 동일 상태 반환(no-op)', () => {
    const completed: FunnelStateObject = Object.freeze({
      step: 12,
      status: 'completed',
    });
    const next = advance(completed);

    expect(next).toBe(completed); // 동일 참조 반환 (cheap no-op)
    expect(next.step).toBe(12);
    expect(next.status).toBe('completed');
  });

  it('완료 → 무효: 연속 advance 호출도 동일 상태 유지', () => {
    const completed: FunnelStateObject = Object.freeze({
      step: 12,
      status: 'completed',
    });
    const once = advance(completed);
    const twice = advance(once);
    const thrice = advance(twice);

    expect(thrice.step).toBe(12);
    expect(thrice.status).toBe('completed');
  });

  // -------------------------------------------------------------------------
  // 중간 단계 전이 (step 1..10)
  // -------------------------------------------------------------------------

  it('중간 단계: step 1에서 advance하면 step 2, status active', () => {
    const state: FunnelStateObject = Object.freeze({ step: 1, status: 'active' });
    const next = advance(state);

    expect(next.step).toBe(2);
    expect(next.status).toBe('active');
  });

  it('중간 단계: step 5에서 advance하면 step 6, status active', () => {
    const state: FunnelStateObject = Object.freeze({ step: 5, status: 'active' });
    const next = advance(state);

    expect(next.step).toBe(6);
    expect(next.status).toBe('active');
  });

  it('중간 단계: step 10에서 advance하면 step 11, status active', () => {
    const state: FunnelStateObject = Object.freeze({ step: 10, status: 'active' });
    const next = advance(state);

    expect(next.step).toBe(11);
    expect(next.status).toBe('active');
  });

  // -------------------------------------------------------------------------
  // 완전 순회: step 0 → 12 → completed
  // -------------------------------------------------------------------------

  it('전체 순회: step 0에서 12번 advance하면 step 12(active), 1번 더하면 completed', () => {
    let state = createFunnelState(); // { step: 0, status: 'idle' }

    // 12번 advance: step 0 → 1 → 2 → ... → 12
    for (let i = 0; i < 12; i++) {
      state = advance(state);
    }

    expect(state.step).toBe(12);
    expect(state.status).toBe('active');

    // 한 번 더 advance: step 12 → completed
    state = advance(state);
    expect(state.step).toBe(12);
    expect(state.status).toBe('completed');
  });

  // -------------------------------------------------------------------------
  // 순수 함수 속성
  // -------------------------------------------------------------------------

  it('순수 함수: 동일 입력에 동일 출력 (참조가 아닌 값 동일성)', () => {
    const input: FunnelStateObject = Object.freeze({ step: 5, status: 'active' });
    const a = advance(input);
    const b = advance(input);

    expect(a).toEqual(b);
    expect(a.step).toBe(b.step);
    expect(a.status).toBe(b.status);
  });

  it('순수 함수: 반환 객체는 FunnelStateObject 계약을 준수한다', () => {
    const next: FunnelStateObject = advance(createFunnelState());

    expect(typeof next.step).toBe('number');
    expect(typeof next.status).toBe('string');
    expect(Object.keys(next).sort()).toEqual(['status', 'step']);
  });
});

// ---------------------------------------------------------------------------
// retreat — Sub-AC 3: 후퇴 전이 순수 함수 경계값 단위 테스트
// ---------------------------------------------------------------------------

describe('retreat — Sub-AC 3 (후퇴 전이 순수 함수)', () => {
  // -------------------------------------------------------------------------
  // 경계값: step 1 → 0 (첫 단계에서 idle로 복귀)
  // -------------------------------------------------------------------------

  it('1 → 0: step 1에서 retreat하면 step 0, status idle 반환', () => {
    const state: FunnelStateObject = Object.freeze({ step: 1, status: 'active' });
    const prev = retreat(state);

    expect(prev.step).toBe(0);
    expect(prev.status).toBe('idle');
  });

  it('1 → 0: 반환 객체는 불변(frozen)이다', () => {
    const state: FunnelStateObject = Object.freeze({ step: 1, status: 'active' });
    const prev = retreat(state);

    expect(Object.isFrozen(prev)).toBe(true);
  });

  it('1 → 0: 원본 상태를 변이하지 않는다 (순수 함수)', () => {
    const state: FunnelStateObject = Object.freeze({ step: 1, status: 'active' });
    retreat(state);

    expect(state.step).toBe(1);
    expect(state.status).toBe('active');
  });

  it('1 → 0: 반환 객체는 원본과 다른 참조(reference)다', () => {
    const state: FunnelStateObject = Object.freeze({ step: 1, status: 'active' });
    const prev = retreat(state);

    expect(prev).not.toBe(state);
  });

  // advance 후 retreat으로 원점 복귀
  it('1 → 0: advance(initial)로 얻은 step 1에서 retreat하면 초기 상태와 동일한 값', () => {
    const initial = createFunnelState(); // { step: 0, status: 'idle' }
    const stepped = advance(initial); // { step: 1, status: 'active' }
    const restored = retreat(stepped); // { step: 0, status: 'idle' }

    expect(restored.step).toBe(initial.step);
    expect(restored.status).toBe(initial.status);
  });

  // -------------------------------------------------------------------------
  // 경계값: step 0 — retreat 불가, 상태 불변
  // -------------------------------------------------------------------------

  it('step 0에서 retreat하면 동일 참조 반환 (no-op)', () => {
    const initial = createFunnelState(); // { step: 0, status: 'idle' }
    const result = retreat(initial);

    // 동일 참조 반환 — 불필요한 객체 생성 없음
    expect(result).toBe(initial);
  });

  it('step 0에서 retreat 후 step은 0으로 유지된다 (상태 불변)', () => {
    const initial = createFunnelState();
    const result = retreat(initial);

    expect(result.step).toBe(0);
    expect(result.status).toBe('idle');
  });

  it('step 0에서 연속 retreat 호출도 동일 상태 유지', () => {
    const initial = createFunnelState();
    const once = retreat(initial);
    const twice = retreat(once);
    const thrice = retreat(twice);

    expect(thrice.step).toBe(0);
    expect(thrice.status).toBe('idle');
    expect(thrice).toBe(initial); // 항상 같은 참조
  });

  // -------------------------------------------------------------------------
  // 경계값: 완료 상태에서 retreat 허용 여부 (no-op)
  // -------------------------------------------------------------------------

  it('완료 상태에서 retreat하면 동일 참조 반환 (no-op — completed는 단말 상태)', () => {
    const completed: FunnelStateObject = Object.freeze({
      step: 12,
      status: 'completed',
    });
    const result = retreat(completed);

    // completed는 단말 상태 — retreat 허용 안 됨, 동일 참조 반환
    expect(result).toBe(completed);
    expect(result.step).toBe(12);
    expect(result.status).toBe('completed');
  });

  it('완료 상태에서 연속 retreat 호출도 동일 상태 유지', () => {
    const completed: FunnelStateObject = Object.freeze({
      step: 12,
      status: 'completed',
    });
    const once = retreat(completed);
    const twice = retreat(once);

    expect(twice.step).toBe(12);
    expect(twice.status).toBe('completed');
    expect(twice).toBe(completed);
  });

  // -------------------------------------------------------------------------
  // 중간 단계 후퇴 전이 (step 2..12)
  // -------------------------------------------------------------------------

  it('중간 단계: step 2에서 retreat하면 step 1, status active', () => {
    const state: FunnelStateObject = Object.freeze({ step: 2, status: 'active' });
    const prev = retreat(state);

    expect(prev.step).toBe(1);
    expect(prev.status).toBe('active');
  });

  it('중간 단계: step 6에서 retreat하면 step 5, status active', () => {
    const state: FunnelStateObject = Object.freeze({ step: 6, status: 'active' });
    const prev = retreat(state);

    expect(prev.step).toBe(5);
    expect(prev.status).toBe('active');
  });

  it('중간 단계: step 12에서 retreat하면 step 11, status active', () => {
    const state: FunnelStateObject = Object.freeze({ step: 12, status: 'active' });
    const prev = retreat(state);

    expect(prev.step).toBe(11);
    expect(prev.status).toBe('active');
  });

  it('중간 단계: retreat 반환 객체는 불변(frozen)이다', () => {
    const state: FunnelStateObject = Object.freeze({ step: 6, status: 'active' });
    const prev = retreat(state);

    expect(Object.isFrozen(prev)).toBe(true);
  });

  it('중간 단계: retreat는 원본 상태를 변이하지 않는다', () => {
    const state: FunnelStateObject = Object.freeze({ step: 6, status: 'active' });
    retreat(state);

    expect(state.step).toBe(6);
    expect(state.status).toBe('active');
  });

  // -------------------------------------------------------------------------
  // 완전 역순회: step 12 → 1 → 0
  // -------------------------------------------------------------------------

  it('역순회: step 12에서 12번 retreat하면 step 0, status idle', () => {
    let state: FunnelStateObject = Object.freeze({ step: 12, status: 'active' });

    // 12번 retreat: step 12 → 11 → ... → 1 → 0
    for (let i = 0; i < 12; i++) {
      state = retreat(state);
    }

    expect(state.step).toBe(0);
    expect(state.status).toBe('idle');
  });

  // -------------------------------------------------------------------------
  // 순수 함수 속성
  // -------------------------------------------------------------------------

  it('순수 함수: 동일 입력에 동일 출력 (참조가 아닌 값 동일성)', () => {
    const input: FunnelStateObject = Object.freeze({ step: 7, status: 'active' });
    const a = retreat(input);
    const b = retreat(input);

    expect(a).toEqual(b);
    expect(a.step).toBe(b.step);
    expect(a.status).toBe(b.status);
  });

  it('순수 함수: 반환 객체는 FunnelStateObject 계약을 준수한다', () => {
    const prev: FunnelStateObject = retreat(
      Object.freeze({ step: 5, status: 'active' }),
    );

    expect(typeof prev.step).toBe('number');
    expect(typeof prev.status).toBe('string');
    expect(Object.keys(prev).sort()).toEqual(['status', 'step']);
  });
});

// ---------------------------------------------------------------------------
// reset — Sub-AC 4: 초기화 순수 함수 단위 테스트
// ---------------------------------------------------------------------------

describe('reset — Sub-AC 4 (초기화 전이 순수 함수)', () => {
  // -------------------------------------------------------------------------
  // 중간 스텝: step 1–11, status 'active'
  // -------------------------------------------------------------------------

  it('중간 스텝 → 초기화: step 5(active)에서 reset하면 step 0, status idle 반환', () => {
    const state: FunnelStateObject = Object.freeze({ step: 5, status: 'active' });
    const result = reset(state);

    expect(result.step).toBe(0);
    expect(result.status).toBe('idle');
  });

  it('중간 스텝 → 초기화: 반환 객체는 불변(frozen)이다', () => {
    const state: FunnelStateObject = Object.freeze({ step: 5, status: 'active' });
    const result = reset(state);

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('중간 스텝 → 초기화: 원본 상태를 변이하지 않는다 (순수 함수)', () => {
    const state: FunnelStateObject = Object.freeze({ step: 5, status: 'active' });
    reset(state);

    expect(state.step).toBe(5);
    expect(state.status).toBe('active');
  });

  it('중간 스텝 → 초기화: 반환 객체는 원본과 다른 참조(reference)다', () => {
    const state: FunnelStateObject = Object.freeze({ step: 5, status: 'active' });
    const result = reset(state);

    expect(result).not.toBe(state);
  });

  it('중간 스텝: step 1(active)에서 reset하면 초기 상태 반환', () => {
    const state: FunnelStateObject = Object.freeze({ step: 1, status: 'active' });
    const result = reset(state);

    expect(result.step).toBe(0);
    expect(result.status).toBe('idle');
  });

  it('중간 스텝: step 11(active)에서 reset하면 초기 상태 반환', () => {
    const state: FunnelStateObject = Object.freeze({ step: 11, status: 'active' });
    const result = reset(state);

    expect(result.step).toBe(0);
    expect(result.status).toBe('idle');
  });

  // -------------------------------------------------------------------------
  // 완료 상태: step 12, status 'completed'
  // -------------------------------------------------------------------------

  it('완료 상태 → 초기화: step 12(completed)에서 reset하면 step 0, status idle 반환', () => {
    const completed: FunnelStateObject = Object.freeze({
      step: 12,
      status: 'completed',
    });
    const result = reset(completed);

    expect(result.step).toBe(0);
    expect(result.status).toBe('idle');
  });

  it('완료 상태 → 초기화: 반환 객체는 불변(frozen)이다', () => {
    const completed: FunnelStateObject = Object.freeze({
      step: 12,
      status: 'completed',
    });
    const result = reset(completed);

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('완료 상태 → 초기화: 원본 상태를 변이하지 않는다', () => {
    const completed: FunnelStateObject = Object.freeze({
      step: 12,
      status: 'completed',
    });
    reset(completed);

    expect(completed.step).toBe(12);
    expect(completed.status).toBe('completed');
  });

  it('완료 상태 → 초기화: 반환 객체는 원본과 다른 참조다', () => {
    const completed: FunnelStateObject = Object.freeze({
      step: 12,
      status: 'completed',
    });
    const result = reset(completed);

    // reset은 retreat와 달리 completed → idle 복귀를 허용한다
    expect(result).not.toBe(completed);
    expect(result.step).toBe(0);
    expect(result.status).toBe('idle');
  });

  // -------------------------------------------------------------------------
  // 이미 초기 상태: step 0, status 'idle'
  // -------------------------------------------------------------------------

  it('이미 초기 상태: reset(초기 상태)는 동일 참조 반환 (idempotent no-op)', () => {
    const initial = createFunnelState(); // { step: 0, status: 'idle' }
    const result = reset(initial);

    // 이미 초기 상태이므로 동일 참조 반환 — 추가 객체 생성 없음
    expect(result).toBe(initial);
  });

  it('이미 초기 상태: 반환값은 step 0, status idle이다', () => {
    const initial = createFunnelState();
    const result = reset(initial);

    expect(result.step).toBe(0);
    expect(result.status).toBe('idle');
  });

  it('이미 초기 상태: 연속 reset 호출도 동일 상태 유지 (idempotent)', () => {
    const initial = createFunnelState();
    const once = reset(initial);
    const twice = reset(once);
    const thrice = reset(twice);

    expect(thrice.step).toBe(0);
    expect(thrice.status).toBe('idle');
    // 초기 상태에서 연속 reset → 항상 같은 참조
    expect(thrice).toBe(initial);
  });

  // -------------------------------------------------------------------------
  // 이탈 상태: abandoned
  // -------------------------------------------------------------------------

  it('이탈 상태 → 초기화: abandoned 상태에서 reset하면 step 0, status idle 반환', () => {
    const abandoned: FunnelStateObject = Object.freeze({
      step: 7,
      status: 'abandoned',
    });
    const result = reset(abandoned);

    expect(result.step).toBe(0);
    expect(result.status).toBe('idle');
  });

  it('이탈 상태 → 초기화: 반환 객체는 불변(frozen)이다', () => {
    const abandoned: FunnelStateObject = Object.freeze({
      step: 3,
      status: 'abandoned',
    });
    const result = reset(abandoned);

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('이탈 상태 → 초기화: 반환 객체는 원본과 다른 참조다', () => {
    const abandoned: FunnelStateObject = Object.freeze({
      step: 3,
      status: 'abandoned',
    });
    const result = reset(abandoned);

    expect(result).not.toBe(abandoned);
  });

  // -------------------------------------------------------------------------
  // 순수 함수 속성
  // -------------------------------------------------------------------------

  it('순수 함수: 동일 입력에 동일 출력 (값 동일성)', () => {
    const input: FunnelStateObject = Object.freeze({ step: 7, status: 'active' });
    const a = reset(input);
    const b = reset(input);

    expect(a).toEqual(b);
    expect(a.step).toBe(b.step);
    expect(a.status).toBe(b.status);
  });

  it('순수 함수: 반환 객체는 FunnelStateObject 계약을 준수한다', () => {
    const result: FunnelStateObject = reset(
      Object.freeze({ step: 6, status: 'active' }),
    );

    expect(typeof result.step).toBe('number');
    expect(typeof result.status).toBe('string');
    expect(Object.keys(result).sort()).toEqual(['status', 'step']);
  });

  it('순수 함수: advance 후 reset하면 초기 상태와 값 동일성 성립', () => {
    const initial = createFunnelState();
    let state = initial;
    for (let i = 0; i < 7; i++) {
      state = advance(state);
    }
    // 7단계 진행 후 reset
    const restored = reset(state);

    expect(restored.step).toBe(0);
    expect(restored.status).toBe('idle');
    expect(restored).toEqual(initial);
  });
});
