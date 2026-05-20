/**
 * `placements.ts` — frozen Superwall placement-identifier constants for the
 * Phase 2.5 paywall-trigger surface.
 *
 * Why this module exists (AC 4):
 *   Seed constraint: "All native @superwall/react-native-superwall imports
 *   confined to single wrapper file apps/mobile/src/superwall/client.ts".
 *   Placement *identifiers* however are pure-string domain values that are
 *   meaningful to both the Superwall dashboard AND the app's analytics /
 *   routing layer — they must therefore be exportable from a native-free
 *   module so that:
 *
 *     1. Route components (e.g. `app/(funnel)/payment-model.tsx`) can import
 *        the identifier WITHOUT pulling in the native SDK transitively.
 *     2. vitest tests can assert against the constant under the Node test
 *        runner without resolving `@superwall/react-native-superwall`.
 *     3. The wrapper `client.ts` itself imports the same identifier when
 *        forwarding `triggerPaywall(placement)` calls to the native module,
 *        guaranteeing a single source of truth.
 *
 * Why a sibling module rather than co-located inside `client.ts`:
 *   The wrapper is the *only* file allowed to import the native package
 *   (Seed constraint). If the placement identifier lived in `client.ts`
 *   alongside the native import, every consumer that needs the identifier
 *   would either (a) re-export it through the wrapper (which would force the
 *   wrapper to be loaded in vitest, defeating the test-isolation seam), or
 *   (b) hardcode the string literal at each call site (which would create
 *   drift between the dashboard placement name and the app's trigger call).
 *   A separate placements module breaks the cycle: it carries no native
 *   import, so any module — including vitest tests — may consume it freely.
 *
 * Why `'payment_model_unlock'` is the only placement in Phase 2.5:
 *   Seed ontology: "placement [string]: Superwall placement identifier —
 *   'payment_model_unlock' is the only value in Phase 2.5". The step-12
 *   `payment_model` screen is the single Phase 2.5 paywall-trigger surface;
 *   no other funnel step opens a paywall in this phase. Future phases may
 *   add additional placements (e.g. `'tier_upgrade'`, `'feature_gate'`) by
 *   appending new `as const` exports here — the additive shape keeps every
 *   existing consumer compatible.
 *
 * Naming convention — snake_case + scope_action:
 *   The dashboard-side placement string must match exactly what is
 *   registered in the Superwall dashboard. `payment_model_unlock` follows
 *   the project-wide snake_case + verb-form convention already established
 *   by analytics event names (`payment_completed`, `payment_skipped`,
 *   `paywall_error`) and screen identifiers (`payment_model`), so the
 *   Phase 2.5 dashboard + app + analytics surfaces all share the same
 *   identifier alphabet.
 *
 * Why no native imports:
 *   Seed constraint: "core-ts package remains pure JS/TS with no native
 *   dependencies" — applied analogously to this module so the placement
 *   surface remains testable in the vitest Node runner. The wrapper module
 *   (`./client.ts`) is the single seam where native imports may appear.
 */

/**
 * Superwall placement identifier for the step-12 `payment_model` paywall
 * trigger.
 *
 * Wired by the CTA handler in `app/(funnel)/payment-model.tsx` —
 * `triggerPaywall(PLACEMENT_PAYMENT_MODEL_UNLOCK)` — and must match the
 * placement name registered in the Superwall dashboard. The literal type
 * (`as const`) prevents accidental widening to `string`, so any renaming
 * is forced through this single constant rather than through scattered
 * string-literal call sites.
 *
 * Why exported as a top-level named constant (not a const-object member):
 *   Phase 2.5 has exactly one placement. Exporting it as a single named
 *   constant rather than wrapping it in a const object (`PLACEMENTS.PAYMENT_MODEL_UNLOCK`)
 *   keeps consumer call sites short — `triggerPaywall(PLACEMENT_PAYMENT_MODEL_UNLOCK)`
 *   reads more clearly than `triggerPaywall(PLACEMENTS.PAYMENT_MODEL_UNLOCK)`
 *   for a single-value surface. If/when additional placements land in a
 *   future phase, the additive shape is to export each one as its own
 *   `PLACEMENT_<NAME>` constant — preserving the established import pattern
 *   for existing call sites.
 *
 * @see app/(funnel)/payment-model.tsx for the CTA wiring (Phase 2.5).
 * @see apps/mobile/src/superwall/client.ts for the wrapper that forwards
 *   this identifier to the native `@superwall/react-native-superwall`
 *   `Superwall.shared.register({ placement })` call.
 */
export const PLACEMENT_PAYMENT_MODEL_UNLOCK = 'payment_model_unlock' as const;

/**
 * Union of every valid Superwall placement identifier the app may pass to
 * the wrapper's `triggerPaywall()` function. In Phase 2.5 the union has a
 * single member; later phases widen it additively (e.g.
 * `| typeof PLACEMENT_TIER_UPGRADE`) so the wrapper's parameter type
 * automatically stays in sync with the placement surface without manual
 * edits at the wrapper site.
 *
 * Exported as a named type so the wrapper module (`./client.ts`) can pin
 * its `triggerPaywall(placement: SuperwallPlacement)` signature to this
 * union, statically guaranteeing that only registered placements reach the
 * native SDK call.
 */
export type SuperwallPlacement = typeof PLACEMENT_PAYMENT_MODEL_UNLOCK;
