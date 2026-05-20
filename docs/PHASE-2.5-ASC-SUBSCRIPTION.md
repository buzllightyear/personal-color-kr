# Phase 2.5 — ASC Sandbox Subscription Registration Runbook

> **Acceptance Criterion 15:** ASC sandbox subscription product registered
> with product ID `com.personalcolorkr.monthly.premium` at baseline price
> ₩9,900 in subscription group `personal_color_premium`.
>
> **Scope:** This runbook captures the manual App Store Connect
> registration steps that cannot be automated from the codebase. The
> *contract* (product ID, group, price, bundle linkage) is pinned in
> code at `apps/mobile/src/superwall/products.ts` and mirrored in the
> local StoreKit configuration file
> `apps/mobile/storekit/PersonalColorKR.storekit`. The vitest cross-check
> at `apps/mobile/tests/superwall-products.test.ts` keeps the three
> code-side surfaces drift-proof against each other; this runbook is the
> human-side seam between the code contract and the live ASC resource.

---

## 1 — Prerequisites

Before starting the registration, confirm:

| Check                              | Expected value                          | Where to verify                                   |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------- |
| Apple Developer Program membership | Active ($99/yr individual or org)        | <https://developer.apple.com/account>             |
| App Store Connect access           | Admin or App Manager role                | <https://appstoreconnect.apple.com/access/users>  |
| Bundle identifier registered       | `com.personalcolorkr.app`                | Identifiers → App IDs                             |
| App record created in ASC          | Bundle ID matches above                  | My Apps → personal-color-kr                       |
| Paid Apps Agreement signed         | Status = "Active"                        | Business → Agreements, Tax, and Banking           |
| Banking + tax info complete        | Status = "Active"                        | Business → Agreements, Tax, and Banking           |

> The **Paid Apps Agreement** must be active before in-app purchase
> products will appear to sandbox testers. A common phase-2.5 stall
> is a pending agreement blocking sandbox purchase availability —
> verify here first.

---

## 2 — Register the Subscription Group

ASC subscription products live inside a **subscription group**.
Apple uses the group to enforce mutual-exclusion + upgrade/downgrade
rules (a user subscribed to "monthly premium" cannot also be subscribed
to a future "annual premium" inside the same group — they switch
between them via Apple's billing UI instead of cancelling first).

**Steps:**

1. Open <https://appstoreconnect.apple.com> → **My Apps** →
   **personal-color-kr** → **Monetization** → **Subscriptions**.
2. Under **Subscription Groups**, click **Create**.
3. Enter the group reference name:

   ```text
   personal_color_premium
   ```

   This name is internal to ASC and is NOT visible to end-users.
   It MUST match `SUBSCRIPTION_GROUP_NAME` exported from
   `apps/mobile/src/superwall/products.ts`.

4. Save.

**Verification:** the new group appears in the Subscription Groups list
with reference name `personal_color_premium` and zero products.

---

## 3 — Register the Monthly Premium Subscription Product

**Steps:**

1. Inside the `personal_color_premium` group, click **+** next to
   **Subscriptions** to add a new product.
2. Enter the reference name:

   ```text
   Personal Color Premium Monthly
   ```

   Internal ASC label — not visible to end-users.

3. Enter the product ID:

   ```text
   com.personalcolorkr.monthly.premium
   ```

   This MUST match `SUBSCRIPTION_PRODUCT_ID` exported from
   `apps/mobile/src/superwall/products.ts`. **Apple does not allow
   renaming a product ID after creation** — typo recovery requires
   creating a new product, so double-check before saving.

4. Set the subscription duration:

   ```text
   1 Month
   ```

   ISO-8601 representation: `P1M`. Matches
   `SUBSCRIPTION_BILLING_PERIOD = { unit: 'month', value: 1 }` in
   `apps/mobile/src/superwall/products.ts`.

5. Save the draft. The product will move into a "Missing Metadata"
   state until the remaining fields (price, localisation, review
   screenshot) are populated below.

---

## 4 — Set the Baseline Price

Apple uses a single **base territory price** as the anchor for
auto-computed prices in every other territory.

**Steps:**

1. Open the new subscription record → **Subscription Prices** → **Add Subscription Price**.
2. Set the base territory to **Korea, Republic of**.
3. Set the price to **₩9,900** (Apple tier KRW-9900).

   - Decimal: `9900`
   - Currency: `KRW` (Korean won — no minor units)
   - Matches `SUBSCRIPTION_BASELINE_PRICE_KRW = 9_900` exported from
     `apps/mobile/src/superwall/products.ts`.

4. Apply to the territory list — for the Phase 2.5 sandbox scope, **all
   non-KR territories may be left at their auto-computed prices**.
   Localisation tuning is a Phase 7 launch concern.
5. Save.

**Verification:** the **Subscription Prices** table shows
₩9,900 / KRW for Korea, Republic of with a "Current" effective-date
band starting today.

---

## 5 — Add the Korean Localisation

ASC requires at least one localised display name + description per
subscription. Phase 2.5 ships Korean only.

**Steps:**

1. Inside the subscription record → **Subscription Localizations** →
   **+ Add Localization** → choose `Korean` (locale code `ko`).
2. Display Name (visible to users in the App Store + Superwall paywall):

   ```text
   퍼스널컬러 프리미엄
   ```

   Matches `SUBSCRIPTION_DISPLAY_NAME_KO` exported from
   `apps/mobile/src/superwall/products.ts`.

3. Description:

   ```text
   월간 퍼스널컬러 진단·콘텐츠 패키지 구독
   ```

   Matches `SUBSCRIPTION_DESCRIPTION_KO` exported from
   `apps/mobile/src/superwall/products.ts`.

4. Save.

---

## 6 — Upload the Review Screenshot

Apple requires a screenshot showing the in-app surface where the user
sees the subscription offer (the Superwall paywall, in our case).

**Steps:**

1. Run `pnpm --filter mobile ios` against an iOS Simulator with the
   `PersonalColorKR.storekit` configuration bound to the scheme (see
   §8 below).
2. Trigger the paywall from the in-app payment-model screen so the
   Superwall sheet renders.
3. Capture the simulator screenshot (`Cmd+S`).
4. In ASC → Subscription record → **App Store Review Screenshot** →
   upload the PNG.
5. Save.

> The screenshot is required only by Apple's review pipeline — it does
> NOT block sandbox testing. If you are stopping at sandbox validation
> for Phase 2.5, this step may be deferred to Phase 7 launch.

---

## 7 — Create a Sandbox Tester Account

Sandbox purchases route through an Apple-issued **Sandbox Tester
Account** (a synthetic Apple ID that bypasses real billing). This is
the canonical mechanism for exercising the StoreKit purchase path
end-to-end without spending real money or charging a real card.

> Seed ontology — `sandboxAccount` (required concept): "Apple Sandbox
> tester account used for ASC subscription sandbox testing — created
> once in this phase."

**Steps:**

1. Open <https://appstoreconnect.apple.com> → **Users and Access** →
   **Sandbox** → **Testers**.
2. Click **+** to create a tester. Suggested fields:

   | Field       | Value                                              |
   | ----------- | -------------------------------------------------- |
   | First name  | `PCKR`                                             |
   | Last name   | `Sandbox`                                          |
   | Email       | `pckr-sandbox+<unique>@<your-domain>` *(not real)* |
   | Password    | strong, unique (saved to 1Password / equivalent)   |
   | Country     | Korea, Republic of                                 |
   | Date of birth | any adult value                                  |
   | App Store country | Korea, Republic of                           |

   The email does NOT need to receive mail — Apple only uses it as
   the tester's login identifier.

3. Save the account.
4. On the iOS Simulator: **Settings → App Store → Sandbox Account** →
   sign in with the tester credentials.

   *Caveat:* a sandbox account can be used on at most one device at a
   time. If a previous tester is signed in, sign out first.

5. Launch the personal-color-kr dev client and trigger the paywall —
   the purchase sheet should now show the Sandbox watermark and
   ₩9,900 / KRW price.

> **Do NOT sign into the simulator's main Apple ID with the sandbox
> tester credentials.** Sandbox testers must remain isolated to the
> dedicated `Settings → App Store → Sandbox Account` slot, otherwise
> the App Store treats them as real accounts and Apple may auto-disable
> them.

---

## 8 — Bind the Local StoreKit Configuration File

For pre-ASC local iteration (faster than waiting for sandbox tester
provisioning), Xcode supports a **StoreKit Configuration File**
(`*.storekit`) that mirrors the ASC product offline.

The file lives at `apps/mobile/storekit/PersonalColorKR.storekit` and
is kept in lock-step with the ASC product by the vitest cross-check
test (`apps/mobile/tests/superwall-products.test.ts`).

**Steps:**

1. After `pnpm --filter mobile prebuild:ios`, open
   `apps/mobile/ios/PersonalColorKR.xcworkspace` in Xcode.
2. In the scheme dropdown → **Edit Scheme…** → **Run** → **Options**.
3. Set **StoreKit Configuration** to
   `PersonalColorKR.storekit` (Xcode picks it up from the
   `apps/mobile/storekit/` folder when added to the project).
4. Add the file to the Xcode project: **File → Add Files to
   "PersonalColorKR"…** → select
   `apps/mobile/storekit/PersonalColorKR.storekit` → ensure the iOS
   target is checked.
5. Run on iOS Simulator — purchases now flow through the local
   StoreKit emulator and do NOT require a sandbox tester sign-in.

This makes pre-ASC iteration possible: the local file is the
source of truth for simulator runs; the ASC product is the source of
truth for TestFlight / physical-device runs.

---

## 9 — Registration Verification Checklist

After completing §2–§7, the human operator MUST tick every item below
before marking AC 15 complete. (§6, §8 are optional for sandbox-only
verification.)

- [ ] **Subscription group created** with reference name `personal_color_premium`.
- [ ] **Subscription product created** with product ID
      `com.personalcolorkr.monthly.premium`.
- [ ] **Billing period** set to 1 Month.
- [ ] **Base territory price** set to ₩9,900 / KRW for Korea, Republic of.
- [ ] **Korean localisation** added with display name `퍼스널컬러 프리미엄`
      and description `월간 퍼스널컬러 진단·콘텐츠 패키지 구독`.
- [ ] **Sandbox tester account** created (Korea storefront) and saved
      to the team's password manager.
- [ ] iOS Simulator signed into the sandbox tester (or
      `PersonalColorKR.storekit` bound to the scheme).
- [ ] Test purchase succeeds: `Superwall.register('payment_model_unlock')`
      from the payment-model screen renders the paywall, shows
      ₩9,900 KRW, and completes a sandbox purchase (purchase outcome →
      `isPremium = true` → result-reveal premium branch renders).
- [ ] `vitest --run tests/superwall-products.test.ts` passes — the
      code-side cross-check (constants ↔ .storekit ↔ runbook).

When every box is ticked, the AC 15 registration is complete. Forward
the sandbox tester credentials to the on-call engineer responsible
for Phase 4 (backend receipt verification) so they can replay
purchases without recreating the account.

---

## 10 — Drift Recovery

If a future contributor changes one of the code-side constants
without updating the others, the vitest cross-check will fail with one
of these signatures:

| Vitest failure                                                  | Likely cause                                                                 | Recovery                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `SUBSCRIPTION_PRODUCT_ID !== 'com.personalcolorkr.monthly.premium'` | A constant was renamed.                                                       | Revert the constant **or** update the .storekit file + this runbook + re-register in ASC.                  |
| `storekit/PersonalColorKR.storekit` JSON parse error              | Manual edit broke the JSON shape.                                             | `git diff` the file and restore valid JSON. Apple's schema is documented in `Xcode → File → New → File → StoreKit Configuration`. |
| `RUNBOOK mention check fails`                                     | A constant changed but this runbook was not re-saved.                          | Update the relevant `Steps` section above to restate the new literal.                                       |
| `SUBSCRIPTION_BUNDLE_IDENTIFIER !== IOS_BUNDLE_IDENTIFIER`        | `apps/mobile/app.config.ts` bundle ID changed without ASC re-registration.    | Either revert the bundle ID change **or** re-register the ASC product against the new bundle (see §3).      |

ASC itself has no automated drift detection — the cross-check test is
the canonical guard. Treat a failing
`tests/superwall-products.test.ts` as a stop-the-line signal until the
four surfaces (constants, .storekit, runbook, ASC) are realigned.

---

## 11 — References

- Apple — [Creating Auto-Renewable Subscriptions](https://help.apple.com/app-store-connect/#/devbb56ee94c)
- Apple — [Set Up Sandbox Testers](https://developer.apple.com/help/app-store-connect/test-in-app-purchases/create-sandbox-apple-id)
- Apple — [Test in-app purchases with Xcode StoreKit configuration files](https://developer.apple.com/documentation/xcode/setting-up-storekit-testing-in-xcode)
- Superwall — [iOS — Setting Up Products](https://docs.superwall.com/docs/setting-up-products-ios)
- This repo — `apps/mobile/src/superwall/products.ts` (canonical constants)
- This repo — `apps/mobile/storekit/PersonalColorKR.storekit` (local test config)
- This repo — `apps/mobile/tests/superwall-products.test.ts` (cross-check)
