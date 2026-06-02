/**
 * `products.ts` — frozen App Store Connect subscription product constants
 * for the Phase 2.5 Superwall + StoreKit integration (AC 15).
 *
 * Why this module exists:
 *   Seed AC 15: "ASC sandbox subscription product registered with product
 *   ID com.personalcolorkr.monthly.premium at baseline price ₩9,900 in
 *   subscription group personal_color_premium".
 *
 *   The ASC dashboard is the ultimate registration surface, but the
 *   *contract* — product ID literal, group name, baseline price, currency,
 *   bundle identifier linkage — must be pinned in code so that:
 *
 *     1. The local StoreKit configuration file
 *        (`apps/mobile/storekit/PersonalColorKR.storekit`) used by Xcode
 *        for simulator-side purchase testing stays in lock-step with the
 *        ASC product. A vitest test parses the .storekit JSON and asserts
 *        each field equals the constant exported here — a drift between
 *        the two surfaces fails CI rather than silently breaking the
 *        sandbox purchase flow.
 *     2. Any future code that references the product (Superwall product
 *        binding in the dashboard, receipt-validation telemetry in
 *        Phase 4, the runbook in `docs/PHASE-2.5-ASC-SUBSCRIPTION.md`)
 *        imports a single named constant instead of inlining the string
 *        literal — preventing typos like `monthly.premuim` from reaching
 *        production.
 *     3. The Superwall wrapper (`./client.ts`) and placement constant
 *        (`./placements.ts`) co-locate with this product surface inside
 *        `src/superwall/`, mirroring the directory pattern: placements
 *        describe *what to trigger*, products describe *what is sold*.
 *
 * Why no native imports:
 *   Seed constraint: "All native @superwall/react-native-superwall imports
 *   confined to single wrapper file apps/mobile/src/superwall/client.ts".
 *   This module is pure data (string + number literals); it carries zero
 *   runtime side effects and zero native imports. Tests can import it
 *   directly under the vitest node runner without resolving the native
 *   package.
 *
 * Phase 2.5 scope:
 *   ASC sandbox only. No production product registration (Phase 7 Launch).
 *   No subscription tier branching (single monthly product). No intro
 *   offer / free trial (Phase 4+). Android billing OUT OF SCOPE (iOS only).
 *
 * Source-of-truth ordering (when drift is detected):
 *   1. This TypeScript module ← canonical literals for the app surface
 *   2. `storekit/PersonalColorKR.storekit` ← Xcode simulator testing
 *   3. `docs/PHASE-2.5-ASC-SUBSCRIPTION.md` ← human runbook
 *   4. ASC dashboard ← live product (resolved manually per runbook)
 *
 *   The vitest cross-check enforces (1) ↔ (2). The runbook (3) restates
 *   the literals as a human-readable checklist. ASC (4) is the only
 *   surface I cannot pin programmatically — the runbook + sandbox tester
 *   verification step is the seam between the code-side contract and the
 *   Apple-side resource.
 *
 * Runtime-safety contract:
 *   This module is bundled into the RN app via Metro and must NOT
 *   transitively import Node-only modules. The bundle identifier
 *   declared below is a *string literal copy* of the value owned by
 *   `apps/mobile/app.config.ts`; importing `app.config.ts` directly
 *   here would pull in `dotenv` + `node:path` and break the Metro
 *   bundle. The vitest cross-check
 *   (`tests/superwall-products.test.ts`) is the single guard that
 *   keeps the two literals in sync — a mismatch surfaces as a CI
 *   failure rather than a runtime crash.
 */

/**
 * App Store Connect product identifier — the canonical ID Apple uses to
 * route in-app purchase transactions to a specific subscription / product
 * record. Must match exactly:
 *
 *   - The product ID registered in App Store Connect under the bundle
 *     identifier `com.personalcolorkr.app`.
 *   - The product ID listed inside the local StoreKit configuration file
 *     (`storekit/PersonalColorKR.storekit`).
 *   - The product ID bound inside the Superwall dashboard paywall.
 *
 * Naming convention — reverse-DNS + scope + tier:
 *   `<bundle-prefix>.<billing-period>.<tier>`. Phase 2.5 ships a single
 *   monthly premium subscription. Future tiers (annual, lifetime, etc.)
 *   land in Phase 4+ and follow the same convention
 *   (`com.personalcolorkr.annual.premium`, etc.).
 *
 * Why `as const`:
 *   Pins the literal type so any future widening (e.g. a tier-id union)
 *   becomes a TypeScript error here until the type narrows intentionally
 *   — preventing a silent regression where a numeric variable replaces
 *   the constant.
 */
export const SUBSCRIPTION_PRODUCT_ID = 'com.personalcolorkr.monthly.premium' as const;

/**
 * App Store Connect subscription group name — the logical container in
 * ASC that groups mutually-exclusive subscription products (so a user
 * who is subscribed to "monthly premium" cannot accidentally also be
 * subscribed to "annual premium"). Group-level upgrade / downgrade /
 * crossgrade rules are governed by Apple based on this grouping.
 *
 * Why a single group named `personal_color_premium`:
 *   Phase 2.5 ships one product. Future products (annual / family /
 *   trial) will land inside the SAME group so Apple's upgrade flow
 *   ("subscribed to monthly, wants to switch to annual") works without
 *   the user cancelling first.
 *
 * The group name itself never reaches the runtime UI — it is metadata
 * visible only inside ASC and the .storekit config file. It is exported
 * here purely for the cross-check test and documentation runbook.
 */
export const SUBSCRIPTION_GROUP_NAME = 'personal_color_premium' as const;

/**
 * Baseline subscription price in Korean won (KRW), used as the ASC
 * "base territory" price tier. Apple computes localised prices in other
 * territories from this anchor.
 *
 * Why ₩9,900:
 *   Mirrors `PAYMENT_AMOUNT_KRW` from
 *   `src/funnel/payment-model-ctas.ts` (the Phase 2.4 placeholder
 *   one-time unlock price), preserving the same "realistic Korean
 *   micropayment" anchor while migrating from a one-time IAP to a
 *   monthly subscription. The number is the same; only the billing
 *   period changed.
 *
 * Why this constant is exported even though Superwall renders the
 *   actual price string:
 *   Seed evaluation principle `price_single_source` requires that no
 *   hardcoded price string leak into the app UI (PriceCard, CTA, etc.) —
 *   the Superwall paywall sheet owns price *display*. This constant is
 *   NOT a display string; it is metadata used only by:
 *     (a) the local .storekit config (which mirrors what ASC will show),
 *     (b) the vitest cross-check that asserts the two are in sync,
 *     (c) the registration runbook so the human operator types the
 *         correct number into ASC.
 *   No screen / component in the funnel imports this constant.
 */
export const SUBSCRIPTION_BASELINE_PRICE_KRW = 9_900 as const;

/**
 * ISO-4217 currency code for {@link SUBSCRIPTION_BASELINE_PRICE_KRW}.
 * KRW has no minor units; the .storekit file represents the price as
 * the integer won count, not a decimal string.
 */
export const SUBSCRIPTION_BASELINE_PRICE_CURRENCY = 'KRW' as const;

/**
 * ASC subscription billing period — a "P1M" (ISO-8601 duration) monthly
 * recurring product. Apple's StoreKit subscription period units are
 * `day` / `week` / `month` / `year` with an integer multiplier. Phase 2.5
 * uses `month` × 1.
 *
 * Why exposed as a structured object (not the ISO-8601 string):
 *   The .storekit JSON format uses {`unit`, `value`} pairs. Mirroring
 *   the shape here lets the cross-check test compare field-by-field
 *   rather than parsing the ISO string at test time.
 */
export const SUBSCRIPTION_BILLING_PERIOD: {
  readonly unit: 'month';
  readonly value: 1;
} = Object.freeze({
  unit: 'month',
  value: 1,
});

/**
 * The bundle identifier the ASC product is registered against.
 *
 * Why declared as a literal here (not re-exported from `app.config.ts`):
 *   `app.config.ts` is the canonical source of truth, but it imports
 *   Node-only modules (`dotenv`, `node:path`) at module-load time
 *   because Expo CLI evaluates it under Node, not Metro. Importing it
 *   from this module would transitively pull those imports into the RN
 *   bundle and break the Metro build.
 *
 *   Instead we copy the literal here and let the vitest cross-check at
 *   `tests/superwall-products.test.ts` import BOTH this constant AND
 *   `IOS_BUNDLE_IDENTIFIER` from `app.config.ts`, asserting equality.
 *   The vitest runtime runs under Node so it can safely import the
 *   dotenv-laden config — and any drift between the two literals
 *   surfaces as a CI failure.
 *
 * Drift risk: if a future contributor changes the bundle ID in
 * `app.config.ts` without also updating this constant, the cross-check
 * fires. If the literals are aligned but the ASC product is not
 * re-registered against the new bundle, sandbox purchases fail
 * silently — recovery is documented in the runbook's "Drift Recovery"
 * section.
 */
export const SUBSCRIPTION_BUNDLE_IDENTIFIER = 'com.personalcolorkr.app' as const;

/**
 * Locale identifier used for the primary subscription localisation in
 * ASC + StoreKit. Apple ASC requires at least one localised display
 * name + description per subscription; ko-KR is the Phase 2.5 primary
 * locale matching the Korean-only funnel UI copy.
 */
export const SUBSCRIPTION_PRIMARY_LOCALE = 'ko' as const;

/**
 * Human-facing display name registered in ASC under the primary locale.
 * Renders in the App Store subscription management screen + Superwall
 * paywall sheet. Korean per the project's KR-market focus.
 */
export const SUBSCRIPTION_DISPLAY_NAME_KO = '퍼스널컬러 프리미엄' as const;

/**
 * Human-facing description registered in ASC under the primary locale.
 * Apple requires a description >= 10 chars; the copy below pins what the
 * human operator must type into ASC verbatim so the runbook + dashboard
 * + .storekit file stay in lock-step.
 */
export const SUBSCRIPTION_DESCRIPTION_KO =
  '월간 퍼스널컬러 진단·콘텐츠 패키지 구독' as const;

/**
 * Frozen aggregate record exposing every product field as a single
 * object, used by the cross-check test to compare against the parsed
 * .storekit JSON without re-importing each constant individually.
 *
 * Why a separate aggregate rather than asserting per-constant in tests:
 *   The aggregate mirrors the .storekit schema shape (which is a nested
 *   object), so a structural equality assertion catches missing-field
 *   drift (e.g. a contributor adds a new ASC field but forgets to update
 *   the test) the same way `toEqual()` catches it for plain objects.
 */
export const SUBSCRIPTION_PRODUCT: Readonly<{
  readonly productId: typeof SUBSCRIPTION_PRODUCT_ID;
  readonly groupName: typeof SUBSCRIPTION_GROUP_NAME;
  readonly priceKrw: typeof SUBSCRIPTION_BASELINE_PRICE_KRW;
  readonly currency: typeof SUBSCRIPTION_BASELINE_PRICE_CURRENCY;
  readonly billingPeriod: typeof SUBSCRIPTION_BILLING_PERIOD;
  readonly bundleIdentifier: typeof SUBSCRIPTION_BUNDLE_IDENTIFIER;
  readonly primaryLocale: typeof SUBSCRIPTION_PRIMARY_LOCALE;
  readonly displayNameKo: typeof SUBSCRIPTION_DISPLAY_NAME_KO;
  readonly descriptionKo: typeof SUBSCRIPTION_DESCRIPTION_KO;
}> = Object.freeze({
  productId: SUBSCRIPTION_PRODUCT_ID,
  groupName: SUBSCRIPTION_GROUP_NAME,
  priceKrw: SUBSCRIPTION_BASELINE_PRICE_KRW,
  currency: SUBSCRIPTION_BASELINE_PRICE_CURRENCY,
  billingPeriod: SUBSCRIPTION_BILLING_PERIOD,
  bundleIdentifier: SUBSCRIPTION_BUNDLE_IDENTIFIER,
  primaryLocale: SUBSCRIPTION_PRIMARY_LOCALE,
  displayNameKo: SUBSCRIPTION_DISPLAY_NAME_KO,
  descriptionKo: SUBSCRIPTION_DESCRIPTION_KO,
});
