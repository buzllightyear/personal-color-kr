/**
 * Unit test for `apps/mobile/src/superwall/placements.ts` (Sub-AC 6.1).
 *
 * Scope:
 *   Pins the exported `PLACEMENT_PAYMENT_MODEL_UNLOCK` constant to the
 *   exact Seed-approved string literal `'payment_model_unlock'` — the
 *   Superwall dashboard placement identifier wired by the step-12
 *   `payment-model.tsx` CTA handler. Drift between this constant and
 *   the dashboard registration silently breaks the paywall trigger
 *   without any compile error (the dashboard is not type-checked from
 *   the app), so a runtime string-equality assertion is the only
 *   defence the codebase can offer.
 *
 * Why a dedicated test file (rather than relying on the wrapper test):
 *   The sibling `superwall-client-wrapper.test.ts` exercises the
 *   wrapper's *consumption* of this constant via `vi.mock(...)`. Under
 *   that mock the real constant is substituted, so the wrapper test
 *   does not actually verify the literal string. The Seed Sub-AC 6.1
 *   asks for a unit test that asserts the exported string value —
 *   which by definition must import the real module. This file is
 *   that import.
 *
 * Why no native-module concerns here:
 *   `placements.ts` carries zero `@superwall/react-native-superwall`
 *   imports (Seed constraint: "All native @superwall/react-native-superwall
 *   imports confined to single wrapper file apps/mobile/src/superwall/client.ts").
 *   The module is therefore safe to import directly under the vitest
 *   Node runner — no `vi.mock(...)` substitution is required.
 *
 * What this test does NOT cover:
 *   - The wrapper's call to `Superwall.shared.register({ placement })` —
 *     that touches native code and is exercised end-to-end by the EAS
 *     dev client (AC 1).
 *   - Whether the Superwall dashboard has a placement registered under
 *     this identifier — that is a dashboard-side configuration step
 *     verified manually in the Phase 2.5 ASC/Superwall runbook.
 */
import { describe, expect, it } from 'vitest';

import {
  PLACEMENT_PAYMENT_MODEL_UNLOCK,
  type SuperwallPlacement,
} from '../src/superwall/placements';

describe('superwall/placements — PLACEMENT_PAYMENT_MODEL_UNLOCK (Sub-AC 6.1)', () => {
  it('exports the exact string literal "payment_model_unlock"', () => {
    // Direct equality assertion — this is the load-bearing check the
    // Sub-AC requires. The literal must match what is registered in
    // the Superwall dashboard verbatim; any drift here silently breaks
    // the step-12 paywall trigger.
    expect(PLACEMENT_PAYMENT_MODEL_UNLOCK).toBe('payment_model_unlock');
  });

  it('exposes the constant as a primitive string (no boxing, no object)', () => {
    // Guards against an accidental refactor wrapping the value in an
    // object such as `{ value: 'payment_model_unlock' }`. The wrapper's
    // native-SDK call passes this constant directly as the `placement`
    // argument — only a primitive string is accepted there.
    expect(typeof PLACEMENT_PAYMENT_MODEL_UNLOCK).toBe('string');
  });

  it('uses snake_case + verb-form naming (no camelCase, no kebab-case)', () => {
    // The Phase 2.5 dashboard + analytics + screen identifiers all
    // share the snake_case + verb-form alphabet (e.g. `payment_completed`,
    // `payment_skipped`, `paywall_error`, `payment_model`). Pinning the
    // shape with a regex catches a casing drift (e.g. `paymentModelUnlock`
    // or `payment-model-unlock`) before it reaches the dashboard.
    expect(PLACEMENT_PAYMENT_MODEL_UNLOCK).toMatch(/^[a-z]+(_[a-z]+)+$/);
  });

  it('exposes a SuperwallPlacement union assignable from the constant', () => {
    // Type-level pin via a runtime variable. If `SuperwallPlacement`
    // ever widens to `string`, this assignment still compiles — but a
    // future literal addition (e.g. `'tier_upgrade'`) would force the
    // wrapper's signature to be updated to the new union, surfacing
    // the additive change at the wrapper boundary.
    const placement: SuperwallPlacement = PLACEMENT_PAYMENT_MODEL_UNLOCK;
    expect(placement).toBe('payment_model_unlock');
  });
});
