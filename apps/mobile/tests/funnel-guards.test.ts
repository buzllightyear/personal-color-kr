/**
 * Unit tests — `apps/mobile/app/(funnel)/_guards.ts`.
 *
 * Covers Sub-AC 6.1 (`shouldDismissRating`), Sub-AC 6.2
 * (`shouldBypassReferral`), and Sub-AC 6.3 (`shouldSkipFunnelSubscribed`):
 *   "<guard> 함수가 _guards.ts에 export되어 false를 반환하고 호출 시
 *    console.warn으로 fail-loud 경고를 출력하며, 이를 검증하는 단위
 *    테스트가 존재한다."
 *
 * Each guard exists to make a state-dependent navigation decision but the
 * underlying state (AsyncStorage rating-skip count for `shouldDismissRating`,
 * Supabase referral redemption + PostHog A/B flag for `shouldBypassReferral`,
 * Supabase `subscription_active` for `shouldSkipFunnelSubscribed`) is not
 * yet wired (Phase 3/4 work). Until then, all three stubs:
 *
 *   1. Return the conservative default `false` so the funnel SHOWS the
 *      affected step rather than silently skipping it. Choosing `false`
 *      keeps the linear 1→12 navigation invariant intact until real state
 *      lookup is implemented.
 *   2. Emit a `console.warn` on every call ("fail-loud") so that any caller
 *      relying on these stubs in production gets a noisy, traceable signal
 *      instead of a quietly-defaulted result.
 *
 * Why unit tests instead of integration tests:
 *   - Each guard has zero external dependencies (no AsyncStorage, no Zustand
 *     store, no network) — they are pure functions whose entire contract is
 *     "return value + side effect". A unit test pins both halves cleanly.
 *   - Mocking `console.warn` via `vi.spyOn` lets us assert the fail-loud
 *     side effect without polluting test output.
 *
 * The (funnel) Expo Router group folder uses parentheses, which is shell-
 * legal but requires no special handling in the TypeScript import path —
 * vitest's resolver follows the same Node module-resolution rules as the
 * Metro bundler, so `../app/(funnel)/_guards` resolves identically.
 */
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  shouldBypassReferral,
  shouldDismissRating,
  shouldSkipFunnelSubscribed,
} from '../app/(funnel)/_guards';

describe('shouldDismissRating (funnel guard stub)', () => {
  // `console.warn`'s real signature is
  // `(message?: any, ...optionalParams: any[]) => void`. We narrow the spy
  // generics to that exact shape so `.mock.calls[0]` is typed as
  // `[any?, ...any[]]` (not `unknown[]`) and the assertions below compile
  // under TS strict.
  let warnSpy: MockInstance<[message?: unknown, ...optionalParams: unknown[]], void>;

  beforeEach(() => {
    // Silence + capture console.warn so the fail-loud signal is observable
    // without leaking into the vitest console output.
    warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined) as MockInstance<
      [message?: unknown, ...optionalParams: unknown[]],
      void
    >;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the conservative default `false`', () => {
    // Conservative default: do NOT skip the rating step until real state
    // lookup is wired. Returning `false` preserves the linear 12-step
    // funnel invariant.
    const result = shouldDismissRating();

    expect(result).toBe(false);
  });

  it('returns a primitive boolean (typeof === "boolean")', () => {
    // Guards must return primitive booleans — no truthy/falsy objects, no
    // null/undefined — so downstream `if (guard())` branches behave
    // identically in TS strict and at runtime.
    const result: boolean = shouldDismissRating();

    expect(typeof result).toBe('boolean');
  });

  it('emits a console.warn fail-loud signal on every call', () => {
    shouldDismissRating();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The warning message must mention the guard name so a developer
    // grepping logs can locate the stub immediately.
    const [firstArg] = warnSpy.mock.calls[0]!;
    expect(String(firstArg)).toMatch(/shouldDismissRating/);
  });

  it('warns once per call (no batching, no debouncing)', () => {
    // Calling the guard three times must produce three warnings — silent
    // failures are exactly what fail-loud is meant to prevent, so we
    // explicitly forbid any "warn once then stay quiet" optimisation.
    shouldDismissRating();
    shouldDismissRating();
    shouldDismissRating();

    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('warning message mentions "stub" or "not implemented" so the placeholder status is obvious', () => {
    shouldDismissRating();

    const [firstArg] = warnSpy.mock.calls[0]!;
    const message = String(firstArg).toLowerCase();
    // Either word makes the placeholder status unambiguous in log output.
    expect(message).toMatch(/stub|not implemented|placeholder/);
  });
});

describe('shouldBypassReferral (funnel guard stub)', () => {
  // Mirror the `MockInstance` typing used above so the spy's `.mock.calls`
  // tuple is typed precisely and the message assertions compile under TS
  // strict.
  let warnSpy: MockInstance<[message?: unknown, ...optionalParams: unknown[]], void>;

  beforeEach(() => {
    // Silence + capture console.warn so the fail-loud signal is observable
    // without leaking into the vitest console output.
    warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined) as MockInstance<
      [message?: unknown, ...optionalParams: unknown[]],
      void
    >;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the conservative default `false`', () => {
    // Conservative default: do NOT bypass the referral / invited-state
    // step (step 10) until real state lookup is wired. Returning `false`
    // preserves the linear 12-step funnel invariant — exactly the same
    // contract as `shouldDismissRating`, just applied to a different
    // state-dependent branch.
    const result = shouldBypassReferral();

    expect(result).toBe(false);
  });

  it('returns a primitive boolean (typeof === "boolean")', () => {
    // Guards must return primitive booleans — no truthy/falsy objects, no
    // null/undefined — so downstream `if (guard())` branches behave
    // identically in TS strict and at runtime.
    const result: boolean = shouldBypassReferral();

    expect(typeof result).toBe('boolean');
  });

  it('emits a console.warn fail-loud signal on every call', () => {
    shouldBypassReferral();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The warning message must mention the guard name so a developer
    // grepping logs can locate the stub immediately.
    const [firstArg] = warnSpy.mock.calls[0]!;
    expect(String(firstArg)).toMatch(/shouldBypassReferral/);
  });

  it('warns once per call (no batching, no debouncing)', () => {
    // Calling the guard three times must produce three warnings — silent
    // failures are exactly what fail-loud is meant to prevent, so we
    // explicitly forbid any "warn once then stay quiet" optimisation.
    shouldBypassReferral();
    shouldBypassReferral();
    shouldBypassReferral();

    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('warning message mentions "stub" or "not implemented" so the placeholder status is obvious', () => {
    shouldBypassReferral();

    const [firstArg] = warnSpy.mock.calls[0]!;
    const message = String(firstArg).toLowerCase();
    // Either word makes the placeholder status unambiguous in log output.
    expect(message).toMatch(/stub|not implemented|placeholder/);
  });

  it('mentions the referral / invited-state domain in the warning so its purpose is greppable', () => {
    // The warning should make it obvious which navigation decision the
    // stub is standing in for — otherwise a developer triaging an
    // unexpected warning in production logs would have to open the
    // source file to find out. Matching either "referral" or
    // "invited" keeps the assertion robust against minor copy edits.
    shouldBypassReferral();

    const [firstArg] = warnSpy.mock.calls[0]!;
    const message = String(firstArg).toLowerCase();
    expect(message).toMatch(/referral|invited/);
  });

  it('is independent of `shouldDismissRating` (no shared mutable state)', () => {
    // Defensive regression check: future refactors must not introduce a
    // module-level "warn-once" cache that ties the two guards together.
    // Calling one must not silence the other.
    shouldDismissRating();
    shouldBypassReferral();

    expect(warnSpy).toHaveBeenCalledTimes(2);
    const firstMessage = String(warnSpy.mock.calls[0]![0]);
    const secondMessage = String(warnSpy.mock.calls[1]![0]);
    expect(firstMessage).toMatch(/shouldDismissRating/);
    expect(secondMessage).toMatch(/shouldBypassReferral/);
  });
});

describe('shouldSkipFunnelSubscribed (funnel guard stub)', () => {
  // Mirror the `MockInstance` typing used above so the spy's `.mock.calls`
  // tuple is typed precisely and the message assertions compile under TS
  // strict.
  let warnSpy: MockInstance<[message?: unknown, ...optionalParams: unknown[]], void>;

  beforeEach(() => {
    // Silence + capture console.warn so the fail-loud signal is observable
    // without leaking into the vitest console output.
    warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined) as MockInstance<
      [message?: unknown, ...optionalParams: unknown[]],
      void
    >;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the conservative default `false`', () => {
    // Conservative default: do NOT skip the funnel for any user until real
    // `subscription_active` lookup is wired. Returning `false` preserves
    // the linear 12-step invariant — silently bypassing the funnel for an
    // under-specified user would break revenue attribution and skip the
    // acquisition flow entirely.
    const result = shouldSkipFunnelSubscribed();

    expect(result).toBe(false);
  });

  it('returns a primitive boolean (typeof === "boolean")', () => {
    // Guards must return primitive booleans — no truthy/falsy objects, no
    // null/undefined — so downstream `if (guard())` branches behave
    // identically in TS strict and at runtime.
    const result: boolean = shouldSkipFunnelSubscribed();

    expect(typeof result).toBe('boolean');
  });

  it('emits a console.warn fail-loud signal on every call', () => {
    shouldSkipFunnelSubscribed();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The warning message must mention the guard name so a developer
    // grepping logs can locate the stub immediately.
    const [firstArg] = warnSpy.mock.calls[0]!;
    expect(String(firstArg)).toMatch(/shouldSkipFunnelSubscribed/);
  });

  it('warns once per call (no batching, no debouncing)', () => {
    // Calling the guard three times must produce three warnings — silent
    // failures are exactly what fail-loud is meant to prevent, so we
    // explicitly forbid any "warn once then stay quiet" optimisation.
    shouldSkipFunnelSubscribed();
    shouldSkipFunnelSubscribed();
    shouldSkipFunnelSubscribed();

    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('warning message mentions "stub" or "not implemented" so the placeholder status is obvious', () => {
    shouldSkipFunnelSubscribed();

    const [firstArg] = warnSpy.mock.calls[0]!;
    const message = String(firstArg).toLowerCase();
    // Either word makes the placeholder status unambiguous in log output.
    expect(message).toMatch(/stub|not implemented|placeholder/);
  });

  it('mentions the subscription / returning-user domain in the warning so its purpose is greppable', () => {
    // The warning should make it obvious which navigation decision the
    // stub is standing in for — otherwise a developer triaging an
    // unexpected warning in production logs would have to open the
    // source file to find out. Matching any of "subscription",
    // "subscribed", or "returning" keeps the assertion robust against
    // minor copy edits while still anchoring the message to its domain.
    shouldSkipFunnelSubscribed();

    const [firstArg] = warnSpy.mock.calls[0]!;
    const message = String(firstArg).toLowerCase();
    expect(message).toMatch(/subscription|subscribed|returning/);
  });

  it('is independent of the other two guards (no shared mutable state)', () => {
    // Defensive regression check: future refactors must not introduce a
    // module-level "warn-once" cache that ties any guards together.
    // Calling each guard once must produce three distinct warnings — one
    // per guard — preserving the fail-loud contract across the trio.
    shouldDismissRating();
    shouldBypassReferral();
    shouldSkipFunnelSubscribed();

    expect(warnSpy).toHaveBeenCalledTimes(3);
    const firstMessage = String(warnSpy.mock.calls[0]![0]);
    const secondMessage = String(warnSpy.mock.calls[1]![0]);
    const thirdMessage = String(warnSpy.mock.calls[2]![0]);
    expect(firstMessage).toMatch(/shouldDismissRating/);
    expect(secondMessage).toMatch(/shouldBypassReferral/);
    expect(thirdMessage).toMatch(/shouldSkipFunnelSubscribed/);
  });
});
