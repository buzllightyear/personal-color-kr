/**
 * Unit test — `SuperwallTriggerError` class contract (Phase 2.5 Sub-AC 11.1).
 *
 * Scope:
 *   This file exercises the *real* implementation of the
 *   {@link SuperwallTriggerError} class exported from
 *   `apps/mobile/src/superwall/client.ts`. The class is thrown by the
 *   wrapper's `triggerPaywall(...)` function on SDK-level failures
 *   (network outage, asset CDN unreachable, native onError callback
 *   firing, `Superwall.shared.register` promise rejection) so the
 *   `payment-model.tsx` route file can surface a Korean inline error
 *   message and re-enable the CTA per the Seed evaluation principle
 *   `error_transparency`.
 *
 * Why a dedicated test file (not folded into the wrapper-substitution
 * test or the trigger-paywall outcome test):
 *   - The wrapper-substitution test (`superwall-client-wrapper.test.ts`)
 *     mocks the wrapper module wholesale to pin the test-time
 *     substitution seam used by route-file tests. It exercises a
 *     *substitute* `SuperwallTriggerError`, not the real class.
 *   - The trigger-paywall outcome test
 *     (`superwall-trigger-paywall-outcome.test.ts`) covers the
 *     happy-path discriminated-union mapping (purchased / restored /
 *     declined). The error branch is documented there as belonging to
 *     a sibling completion-state file.
 *   - Pinning the error class' own contract here makes the four
 *     Sub-AC 11.1 invariants — extends Error, instanceof
 *     SuperwallTriggerError, `name === 'SuperwallTriggerError'`, and
 *     `cause` propagation — auditable in a single file with a tight
 *     blast radius. A future refactor of the class lights up failures
 *     locally rather than spreading them across the outcome / route
 *     suites.
 *
 * Contract under test (Sub-AC 11.1):
 *   1. `SuperwallTriggerError` is an exported class from the wrapper.
 *   2. Instances are `instanceof Error` (so route code can match on
 *      the broader `Error` shape in a generic catch handler).
 *   3. Instances are `instanceof SuperwallTriggerError` (so route code
 *      can branch specifically on the trigger-failure path versus
 *      configure failure or any other error).
 *   4. The `name` property is the literal string `'SuperwallTriggerError'`
 *      (so structured logging / stack traces carry a stable identifier
 *      independent of class minification).
 *   5. The `cause` field propagates the originating error verbatim
 *      when supplied (so debugging tooling can walk the chain), and is
 *      `undefined` when omitted (the SDK's `onError` callback supplies
 *      only a string, no upstream Error object — the `cause` slot is
 *      legitimately empty in that path).
 *
 * Mocking strategy:
 *   - `vi.mock('@superwall/react-native-superwall', ...)` replaces the
 *     native SDK module before the wrapper imports it. The replacement
 *     exposes a `default` export with `.configure` + `.shared.register`
 *     stubs and a no-op `PaywallPresentationHandler` class. Neither
 *     spy is invoked in this file — the mock exists purely so the
 *     wrapper's top-level imports resolve cleanly without touching
 *     Flow-typed RN code that Node cannot parse.
 *   - The wrapper module is imported via dynamic `import(...)` so the
 *     mock is fully in place before the wrapper's top-level
 *     `import Superwall from '@superwall/react-native-superwall'` runs.
 *
 * What this test does NOT cover:
 *   - The wrapper's mapping logic that decides *when* to throw
 *     `SuperwallTriggerError` (onError callback, register rejection,
 *     unknown PaywallResult.type). Those branches are pinned in
 *     sibling outcome / completion-state tests where the class is the
 *     observed effect rather than the unit under test.
 *   - The route-level surface that catches the thrown error and
 *     renders the Korean inline error text. Covered by
 *     `payment-model-route.test.tsx` (route integration) and
 *     `funnel-state-payment-error.test.tsx` (slice transition).
 *   - The sibling `SuperwallNotConfiguredError` class. Its own
 *     contract is exercised by the configure-idempotency test where
 *     the rejection path is the natural observation.
 */
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Native SDK mock
//
// The wrapper module's top-level `import Superwall from
// '@superwall/react-native-superwall'` (plus `PaywallPresentationHandler`)
// must resolve to a parseable JS surface — the real package ships
// Objective-C-backed JS shims that Node cannot evaluate. The mock below
// is the *minimum* surface required for module load. No method of the
// mock is invoked in this file; we only construct `SuperwallTriggerError`
// instances directly via `new wrapper.SuperwallTriggerError(...)`.
// ---------------------------------------------------------------------------
vi.mock('@superwall/react-native-superwall', () => {
  const SuperwallDefault = {
    configure: vi.fn().mockResolvedValue(undefined),
    shared: {
      register: vi.fn().mockResolvedValue(undefined),
    },
  };

  // A real-shaped no-op handler class. The wrapper imports it as a
  // named export at module load; we never instantiate it here.
  class PaywallPresentationHandler {
    public onDismiss = (): void => {};
    public onSkip = (): void => {};
    public onError = (): void => {};
  }

  return {
    default: SuperwallDefault,
    PaywallPresentationHandler,
  };
});

/**
 * Lazy loader for the wrapper. Dynamic import ensures the `vi.mock(...)`
 * factory above is fully applied before the wrapper's top-level imports
 * of the native SDK are evaluated. Each test re-uses the same loaded
 * module — the class identity is what we assert on, not module state.
 */
async function loadWrapper(): Promise<typeof import('../src/superwall/client')> {
  return await import('../src/superwall/client');
}

describe('SuperwallTriggerError — class contract (Sub-AC 11.1)', () => {
  it('is an exported class from the wrapper module', async () => {
    const wrapper = await loadWrapper();

    // Sub-AC 11.1 invariant 1: the class is exported. A `function`
    // typeof check is the canonical way to assert "this is a class
    // constructor reference" in JS — `class` declarations evaluate to
    // function objects at runtime.
    expect(typeof wrapper.SuperwallTriggerError).toBe('function');
  });

  it('instances are instanceof Error (generic catch handler match)', async () => {
    const wrapper = await loadWrapper();

    const err = new wrapper.SuperwallTriggerError(
      'paywall failed to present',
      'payment_model_unlock',
    );

    // Sub-AC 11.1 invariant 2: route-file code that wraps the CTA in a
    // broad `catch (e)` block must be able to match on `instanceof
    // Error` and read `message` / `stack` without losing the failure.
    expect(err).toBeInstanceOf(Error);
  });

  it('instances are instanceof SuperwallTriggerError (specific branch match)', async () => {
    const wrapper = await loadWrapper();

    const err = new wrapper.SuperwallTriggerError(
      'paywall failed to present',
      'payment_model_unlock',
    );

    // Sub-AC 11.1 invariant 3: route-file code branches on
    // `instanceof SuperwallTriggerError` to distinguish a transient
    // trigger failure (retry by re-tapping the CTA) from a configure
    // failure or any other Error (which should fail loudly). The
    // discrimination requires this `instanceof` check to hold.
    expect(err).toBeInstanceOf(wrapper.SuperwallTriggerError);
  });

  it("has name === 'SuperwallTriggerError' (stable identifier in logs / stack traces)", async () => {
    const wrapper = await loadWrapper();

    const err = new wrapper.SuperwallTriggerError(
      'paywall failed to present',
      'payment_model_unlock',
    );

    // Sub-AC 11.1 invariant 4: the `name` property is the literal
    // string `'SuperwallTriggerError'`. Asserting on the literal —
    // not on the class' `.name` attribute (which would be circular)
    // — pins the override against accidental removal. The override
    // matters because production bundlers can mangle class names,
    // but `Error.prototype.name`-shaped overrides survive
    // minification of the wrapping class identifier.
    expect(err.name).toBe('SuperwallTriggerError');
  });

  it('propagates the supplied cause verbatim (debugging chain walk)', async () => {
    const wrapper = await loadWrapper();

    // Use a real Error as the cause to mirror the production path
    // (`Superwall.shared.register` promise rejection → wrapper
    // catches → throws SuperwallTriggerError with the rejection
    // reason as cause).
    const originalCause = new Error('underlying network failure');
    const err = new wrapper.SuperwallTriggerError(
      'Superwall.register rejected',
      'payment_model_unlock',
      originalCause,
    );

    // Sub-AC 11.1 invariant 5a: the `cause` slot is populated with
    // the exact reference passed in. Debugging tools (and the
    // forthcoming Phase 4 PostHog error event) walk the chain via
    // `error.cause` recursively — reference identity matters because
    // a clone would discard custom error fields.
    expect(err.cause).toBe(originalCause);
  });

  it('supports non-Error cause values without coercion (SDK string error path)', async () => {
    const wrapper = await loadWrapper();

    // The wrapper's `onError(errorString: string)` handler is the
    // exception path where the underlying cause is a plain string,
    // not an Error. The class signature accepts `cause?: unknown`
    // precisely to keep that path lossless — no `new Error(string)`
    // coercion that would lose the original type information.
    const stringCause: string = 'paywall asset CDN unreachable';
    const err = new wrapper.SuperwallTriggerError(
      'Superwall onError fired',
      'payment_model_unlock',
      stringCause,
    );

    expect(err.cause).toBe(stringCause);
  });

  it('leaves cause undefined when omitted (exactOptionalPropertyTypes compliance)', async () => {
    const wrapper = await loadWrapper();

    // The class' three-arg constructor makes `cause` optional. The
    // implementation guards `if (cause !== undefined) this.cause =
    // cause;` so that the field is never assigned `undefined` —
    // critical under `exactOptionalPropertyTypes: true` where
    // `{ cause: undefined }` and `{}` are distinct types.
    const err = new wrapper.SuperwallTriggerError(
      'paywall failed without upstream cause',
      'payment_model_unlock',
    );

    expect(err.cause).toBeUndefined();
  });

  it('preserves the supplied message and placement fields', async () => {
    const wrapper = await loadWrapper();

    // Not a Sub-AC 11.1 invariant *directly*, but the message + placement
    // fields are the two pieces of state the route file logs and surfaces
    // alongside the Korean inline error. Pinning them here keeps the
    // constructor contract whole — a refactor that, say, swapped argument
    // order would corrupt the placement on every error log.
    const message: string = 'paywall failed to present';
    const placement: string = 'payment_model_unlock';
    const err = new wrapper.SuperwallTriggerError(message, placement);

    expect(err.message).toBe(message);
    expect(err.placement).toBe(placement);
  });

  it('class is distinct from SuperwallNotConfiguredError (separate retry semantics)', async () => {
    const wrapper = await loadWrapper();

    // Cross-class invariant: a `SuperwallTriggerError` is NOT a
    // `SuperwallNotConfiguredError`. Route code uses the distinction
    // to decide retry-vs.-fail-loudly: trigger errors are transient
    // (retry CTA), configure errors mean the .env-shipped key is
    // bad (no retry). If a refactor accidentally collapsed the two
    // classes into a single shared base, this assertion would fail.
    const triggerErr = new wrapper.SuperwallTriggerError(
      'trigger failure',
      'payment_model_unlock',
    );
    const notConfiguredErr = new wrapper.SuperwallNotConfiguredError(
      'configure failure',
    );

    expect(triggerErr).not.toBeInstanceOf(wrapper.SuperwallNotConfiguredError);
    expect(notConfiguredErr).not.toBeInstanceOf(wrapper.SuperwallTriggerError);
    // Both still extend Error — the two `instanceof Error` checks are the
    // baseline for the broader generic-catch contract.
    expect(triggerErr).toBeInstanceOf(Error);
    expect(notConfiguredErr).toBeInstanceOf(Error);
  });
});
