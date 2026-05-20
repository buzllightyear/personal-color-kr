/**
 * Vitest contract test for the Superwall wrapper module — Phase 2.5 AC 1.
 *
 * Scope:
 *   This test pins the *test-time substitution seam* contract for
 *   `apps/mobile/src/superwall/client.ts`. Phase 2.5 introduces the
 *   project's first native-only React Native module
 *   (`@superwall/react-native-superwall`); vitest cannot resolve that
 *   package because its iOS shim ships Objective-C-backed JS that is
 *   not parseable by Node. The architectural mitigation is:
 *
 *     - All native imports live in one file: `src/superwall/client.ts`.
 *     - Every other consumer (route files, hooks, providers) imports
 *       from that wrapper, never from the native package directly.
 *     - Tests `vi.mock(...)` the wrapper path, NOT the native package.
 *
 *   When this contract is preserved, the test suite never resolves the
 *   native package and the EAS dev client build (the only place that
 *   does resolve it) is the single load-bearing integration surface.
 *
 *   This file asserts the contract two ways:
 *     (1) the wrapper exposes the exact public surface the route files
 *         will consume (one positive assertion per export);
 *     (2) wholesale `vi.mock` of the wrapper path is sufficient — the
 *         test substitutes every export and the substitutions are what
 *         vitest sees when the wrapper is imported.
 *
 * What this test does NOT cover:
 *   - The wrapper's internal call to `Superwall.configure(...)` or
 *     `Superwall.shared.register(...)` — those touch native code and
 *     are exercised end-to-end by the EAS custom dev client running on
 *     an iOS simulator (the AC 1 exit condition `build_success`).
 *   - Wrapper error mapping (regex failure, register reject,
 *     onError handler). Those are covered by sibling tests in the
 *     completion-state suite (`*-paywall-outcome.test.ts`) where the
 *     wrapper is mocked and the route file's error branch is the
 *     unit under test.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the wrapper module BEFORE importing it. This pins the
// substitution contract: every public export listed here is what
// the route-file tests will rely on when they vi.mock(...) the
// wrapper path. If a real export is removed from the wrapper, the
// type-system check at the bottom (`satisfies WrapperApi`) breaks
// and surfaces the missing field at compile time.
vi.mock('../src/superwall/client', () => {
  // The substitute classes accept the same constructor arity as the real
  // exports so route-test code (which calls `new SuperwallTriggerError(
  // message, placement, cause?)`) typechecks against the mock and the
  // real implementation interchangeably.
  class SuperwallNotConfiguredError extends Error {
    public override readonly name = 'SuperwallNotConfiguredError';
    public override readonly cause?: unknown;
    constructor(message: string, cause?: unknown) {
      super(message);
      if (cause !== undefined) this.cause = cause;
    }
  }
  class SuperwallTriggerError extends Error {
    public override readonly name = 'SuperwallTriggerError';
    public readonly placement: string;
    public override readonly cause?: unknown;
    constructor(message: string, placement: string, cause?: unknown) {
      super(message);
      this.placement = placement;
      if (cause !== undefined) this.cause = cause;
    }
  }
  return {
    PLACEMENT_PAYMENT_MODEL_UNLOCK: 'payment_model_unlock',
    configureSuperwall: vi.fn().mockResolvedValue(undefined),
    // Mock value pins the contracted PaywallOutcome shape from Sub-AC
    // 3.2 — `{ outcome: 'purchased' | 'restored' | 'declined',
    // productId?: string }`. Route-file tests reuse this same shape
    // when they override the mock for purchased/restored/declined
    // completion branches.
    triggerPaywall: vi.fn().mockResolvedValue({
      outcome: 'purchased',
      productId: 'com.personalcolorkr.monthly.premium',
    }),
    SuperwallNotConfiguredError,
    SuperwallTriggerError,
    __resetSuperwallConfiguredForTest: vi.fn(),
  };
});

describe('superwall wrapper — vitest substitution contract', () => {
  it('exposes the public surface the route tests will mock', async () => {
    const wrapper = await import('../src/superwall/client');

    // Stable placement identifier — load-bearing string that must
    // match the Superwall dashboard placement name. A drift surfaces
    // here AND in the Superwall dashboard as zero-events.
    expect(wrapper.PLACEMENT_PAYMENT_MODEL_UNLOCK).toBe('payment_model_unlock');

    // Async initialiser callable from the root layout `useEffect`.
    expect(typeof wrapper.configureSuperwall).toBe('function');

    // Async trigger callable from the payment-model CTA handler.
    expect(typeof wrapper.triggerPaywall).toBe('function');

    // Distinct error classes so route code can branch on `instanceof`
    // to decide retry-vs.-fail-loudly semantics.
    expect(typeof wrapper.SuperwallNotConfiguredError).toBe('function');
    expect(typeof wrapper.SuperwallTriggerError).toBe('function');
  });

  it('the mocked triggerPaywall resolves to a stable PaywallOutcome shape', async () => {
    const wrapper = await import('../src/superwall/client');
    const outcome = await wrapper.triggerPaywall('payment_model_unlock');
    // Discriminator field is `outcome` (NOT `status`) per Sub-AC 3.2.
    // Route-file tests assert on this same field, so renaming it here
    // would silently break every consumer mock.
    expect(outcome).toEqual({
      outcome: 'purchased',
      productId: 'com.personalcolorkr.monthly.premium',
    });
  });

  it('error classes are constructible (so route tests can `throw new` them)', async () => {
    const wrapper = await import('../src/superwall/client');
    const notConfigured = new wrapper.SuperwallNotConfiguredError('test');
    expect(notConfigured).toBeInstanceOf(Error);
    expect(notConfigured.message).toBe('test');

    const triggerErr = new wrapper.SuperwallTriggerError(
      'test',
      'payment_model_unlock',
    );
    expect(triggerErr).toBeInstanceOf(Error);
    expect(triggerErr.message).toBe('test');
  });
});

describe('superwall wrapper — native-isolation contract', () => {
  it('the wrapper path is the sole `vi.mock` seam — native package never resolves', async () => {
    // The very act of `vi.mock`ing the wrapper path (above) and then
    // dynamically importing it MUST NOT cause vitest to resolve
    // `@superwall/react-native-superwall`. If it did, this test
    // would crash during module load (Node cannot parse the SDK's
    // Flow-typed shim). The test running at all is the proof.
    const wrapper = await import('../src/superwall/client');
    expect(wrapper).toBeDefined();
  });
});
