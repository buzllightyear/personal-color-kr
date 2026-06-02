/**
 * Cross-check test — Superwall / ASC subscription product (AC 15).
 *
 * What this test asserts (4-way cross-check):
 *   1. The TypeScript constants exported from
 *      `src/superwall/products.ts` carry the Seed-approved literals:
 *      product ID `com.personalcolorkr.monthly.premium`, group name
 *      `personal_color_premium`, baseline price 9_900, currency KRW,
 *      billing period P1M.
 *   2. The local StoreKit configuration file
 *      `storekit/PersonalColorKR.storekit` parses as valid JSON and
 *      every field in its subscription record equals the matching
 *      constant from (1).
 *   3. The ASC registration runbook (`docs/PHASE-2.5-ASC-SUBSCRIPTION.md`)
 *      restates the same literals in human-readable form — verified by
 *      grepping the markdown for each constant's value.
 *   4. The bundle identifier the .storekit / runbook reference matches
 *      the runtime `IOS_BUNDLE_IDENTIFIER` exported from
 *      `app.config.ts`. A bundle-ID rename without re-registering the
 *      ASC product would silently break sandbox purchases; this assertion
 *      surfaces the drift as a CI failure.
 *
 * Why a vitest cross-check (and not just trust the manual ASC entry):
 *   App Store Connect is the ultimate live registration surface, but I
 *   cannot programmatically pin it from CI. The next-best safeguard is
 *   to make the three *code-side* surfaces (constants, .storekit,
 *   runbook) drift-proof against each other. Any human change to one
 *   surface that does not propagate to the others is caught here.
 *
 * What this test does NOT do:
 *   - It does not validate the ASC dashboard state. That is a human
 *     verification step documented in the runbook (the "registration
 *     verification" checklist).
 *   - It does not invoke StoreKit / Superwall. Native modules are
 *     out-of-scope under vitest's Node runner.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { IOS_BUNDLE_IDENTIFIER } from '../app.config';
import {
  SUBSCRIPTION_BASELINE_PRICE_CURRENCY,
  SUBSCRIPTION_BASELINE_PRICE_KRW,
  SUBSCRIPTION_BILLING_PERIOD,
  SUBSCRIPTION_BUNDLE_IDENTIFIER,
  SUBSCRIPTION_DESCRIPTION_KO,
  SUBSCRIPTION_DISPLAY_NAME_KO,
  SUBSCRIPTION_GROUP_NAME,
  SUBSCRIPTION_PRIMARY_LOCALE,
  SUBSCRIPTION_PRODUCT,
  SUBSCRIPTION_PRODUCT_ID,
} from '../src/superwall/products';

// ---------------------------------------------------------------------------
// Filesystem fixtures — resolved as absolute paths so the test does not
// depend on the working directory the vitest CLI was invoked from.
// ---------------------------------------------------------------------------

const STOREKIT_PATH = path.resolve(__dirname, '../storekit/PersonalColorKR.storekit');
const RUNBOOK_PATH = path.resolve(
  __dirname,
  '../../../docs/PHASE-2.5-ASC-SUBSCRIPTION.md',
);

interface StorekitSubscription {
  readonly productID: string;
  readonly displayPrice: string;
  readonly recurringSubscriptionPeriod: string;
  readonly type: string;
  readonly familyShareable: boolean;
  readonly localizations: ReadonlyArray<{
    readonly displayName: string;
    readonly description: string;
    readonly locale: string;
  }>;
}

interface StorekitGroup {
  readonly name: string;
  readonly subscriptions: ReadonlyArray<StorekitSubscription>;
  readonly localizations: ReadonlyArray<{
    readonly displayName: string;
    readonly description: string;
    readonly locale: string;
  }>;
}

interface StorekitConfig {
  readonly subscriptionGroups: ReadonlyArray<StorekitGroup>;
  readonly settings: {
    readonly _locale: string;
    readonly _storefront: string;
  };
}

function loadStorekit(): StorekitConfig {
  const raw = readFileSync(STOREKIT_PATH, 'utf8');
  return JSON.parse(raw) as StorekitConfig;
}

function loadRunbook(): string {
  return readFileSync(RUNBOOK_PATH, 'utf8');
}

// ---------------------------------------------------------------------------
// (1) Constants pin the Seed-approved literals.
// ---------------------------------------------------------------------------

describe('superwall/products — constants (AC 15)', () => {
  it('pins the ASC product ID to com.personalcolorkr.monthly.premium', () => {
    // The literal-type `as const` already pins this at compile time; the
    // runtime assertion is defence-in-depth against a future refactor that
    // widens the type.
    expect(SUBSCRIPTION_PRODUCT_ID).toBe('com.personalcolorkr.monthly.premium');
  });

  it('pins the ASC subscription group name to personal_color_premium', () => {
    expect(SUBSCRIPTION_GROUP_NAME).toBe('personal_color_premium');
  });

  it('pins the baseline price to 9_900 KRW (integer won, no minor units)', () => {
    expect(SUBSCRIPTION_BASELINE_PRICE_KRW).toBe(9_900);
    expect(Number.isInteger(SUBSCRIPTION_BASELINE_PRICE_KRW)).toBe(true);
    expect(SUBSCRIPTION_BASELINE_PRICE_CURRENCY).toBe('KRW');
  });

  it('pins the billing period to 1 month (P1M)', () => {
    expect(SUBSCRIPTION_BILLING_PERIOD.unit).toBe('month');
    expect(SUBSCRIPTION_BILLING_PERIOD.value).toBe(1);
    expect(Object.isFrozen(SUBSCRIPTION_BILLING_PERIOD)).toBe(true);
  });

  it('binds the bundle identifier to app.config.ts (single source of truth)', () => {
    // If app.config.ts renames the bundle ID, this assertion immediately
    // surfaces the drift — the operator must then re-register the ASC
    // product against the new bundle before sandbox purchases will route.
    expect(SUBSCRIPTION_BUNDLE_IDENTIFIER).toBe(IOS_BUNDLE_IDENTIFIER);
    expect(SUBSCRIPTION_BUNDLE_IDENTIFIER).toBe('com.personalcolorkr.app');
  });

  it('exposes the aggregate SUBSCRIPTION_PRODUCT as a frozen record', () => {
    expect(Object.isFrozen(SUBSCRIPTION_PRODUCT)).toBe(true);
    expect(SUBSCRIPTION_PRODUCT.productId).toBe(SUBSCRIPTION_PRODUCT_ID);
    expect(SUBSCRIPTION_PRODUCT.groupName).toBe(SUBSCRIPTION_GROUP_NAME);
    expect(SUBSCRIPTION_PRODUCT.priceKrw).toBe(SUBSCRIPTION_BASELINE_PRICE_KRW);
    expect(SUBSCRIPTION_PRODUCT.currency).toBe(SUBSCRIPTION_BASELINE_PRICE_CURRENCY);
    expect(SUBSCRIPTION_PRODUCT.bundleIdentifier).toBe(SUBSCRIPTION_BUNDLE_IDENTIFIER);
    expect(SUBSCRIPTION_PRODUCT.primaryLocale).toBe(SUBSCRIPTION_PRIMARY_LOCALE);
    expect(SUBSCRIPTION_PRODUCT.displayNameKo).toBe(SUBSCRIPTION_DISPLAY_NAME_KO);
    expect(SUBSCRIPTION_PRODUCT.descriptionKo).toBe(SUBSCRIPTION_DESCRIPTION_KO);
  });
});

// ---------------------------------------------------------------------------
// (2) .storekit config mirrors the constants.
// ---------------------------------------------------------------------------

describe('storekit/PersonalColorKR.storekit — mirrors constants (AC 15)', () => {
  it('parses as valid JSON', () => {
    expect(() => loadStorekit()).not.toThrow();
  });

  it('declares exactly one subscription group matching SUBSCRIPTION_GROUP_NAME', () => {
    const config = loadStorekit();
    expect(config.subscriptionGroups).toHaveLength(1);
    const group = config.subscriptionGroups[0];
    expect(group).toBeDefined();
    if (group === undefined) {
      throw new Error('unreachable: previous assertion already proved length');
    }
    expect(group.name).toBe(SUBSCRIPTION_GROUP_NAME);
  });

  it('declares exactly one subscription product matching SUBSCRIPTION_PRODUCT_ID', () => {
    const config = loadStorekit();
    const group = config.subscriptionGroups[0];
    if (group === undefined) {
      throw new Error('expected subscriptionGroups[0] to be defined');
    }
    expect(group.subscriptions).toHaveLength(1);
    const subscription = group.subscriptions[0];
    if (subscription === undefined) {
      throw new Error('expected subscriptions[0] to be defined');
    }
    expect(subscription.productID).toBe(SUBSCRIPTION_PRODUCT_ID);
    expect(subscription.type).toBe('RecurringSubscription');
    expect(subscription.familyShareable).toBe(false);
  });

  it('encodes the baseline price as the integer-won display string "9900"', () => {
    const config = loadStorekit();
    const group = config.subscriptionGroups[0];
    if (group === undefined) {
      throw new Error('expected subscriptionGroups[0] to be defined');
    }
    const subscription = group.subscriptions[0];
    if (subscription === undefined) {
      throw new Error('expected subscriptions[0] to be defined');
    }
    // StoreKit's `displayPrice` is the integer won amount as a string.
    expect(subscription.displayPrice).toBe(String(SUBSCRIPTION_BASELINE_PRICE_KRW));
  });

  it('encodes the billing period as the ISO-8601 string "P1M"', () => {
    const config = loadStorekit();
    const group = config.subscriptionGroups[0];
    if (group === undefined) {
      throw new Error('expected subscriptionGroups[0] to be defined');
    }
    const subscription = group.subscriptions[0];
    if (subscription === undefined) {
      throw new Error('expected subscriptions[0] to be defined');
    }
    // P1M = 1 month — matches SUBSCRIPTION_BILLING_PERIOD = { unit: 'month', value: 1 }.
    expect(subscription.recurringSubscriptionPeriod).toBe('P1M');
  });

  it('declares a ko locale with matching display name + description', () => {
    const config = loadStorekit();
    const group = config.subscriptionGroups[0];
    if (group === undefined) {
      throw new Error('expected subscriptionGroups[0] to be defined');
    }
    const subscription = group.subscriptions[0];
    if (subscription === undefined) {
      throw new Error('expected subscriptions[0] to be defined');
    }
    const koLocalization = subscription.localizations.find(
      (l) => l.locale === SUBSCRIPTION_PRIMARY_LOCALE,
    );
    expect(koLocalization).toBeDefined();
    expect(koLocalization?.displayName).toBe(SUBSCRIPTION_DISPLAY_NAME_KO);
    expect(koLocalization?.description).toBe(SUBSCRIPTION_DESCRIPTION_KO);
  });

  it('targets the KOR storefront with ko_KR locale (matches funnel UI)', () => {
    const config = loadStorekit();
    // The simulator runs the .storekit purchase flow against a synthetic
    // storefront. Pin KOR so the price renders in Korean won during local
    // testing — a US storefront would render the price in USD and mask
    // a KRW-specific bug.
    expect(config.settings._storefront).toBe('KOR');
    expect(config.settings._locale).toBe('ko_KR');
  });
});

// ---------------------------------------------------------------------------
// (3) Runbook restates the constants.
// ---------------------------------------------------------------------------

describe('docs/PHASE-2.5-ASC-SUBSCRIPTION.md — restates constants (AC 15)', () => {
  it('exists at the documented path', () => {
    expect(() => loadRunbook()).not.toThrow();
  });

  it('mentions the product ID verbatim', () => {
    const runbook = loadRunbook();
    expect(runbook).toContain(SUBSCRIPTION_PRODUCT_ID);
  });

  it('mentions the subscription group name verbatim', () => {
    const runbook = loadRunbook();
    expect(runbook).toContain(SUBSCRIPTION_GROUP_NAME);
  });

  it('mentions the baseline price (₩9,900 or 9900)', () => {
    const runbook = loadRunbook();
    // Either grouped ("9,900") or ungrouped ("9900") rendering is
    // acceptable — both are unambiguous and the grouped form is more
    // human-readable for runbook prose.
    const hasGrouped = runbook.includes('9,900');
    const hasUngrouped = runbook.includes('9900');
    expect(hasGrouped || hasUngrouped).toBe(true);
  });

  it('mentions the bundle identifier (com.personalcolorkr.app)', () => {
    const runbook = loadRunbook();
    expect(runbook).toContain(SUBSCRIPTION_BUNDLE_IDENTIFIER);
  });

  it('documents the sandbox tester setup step', () => {
    const runbook = loadRunbook();
    // The runbook MUST instruct the operator to create an Apple Sandbox
    // tester account (Seed ontology: `sandboxAccount` — required concept).
    // We grep for the canonical phrase rather than the exact wording so
    // the test is robust to minor copy edits.
    expect(/sandbox\s+tester/i.test(runbook)).toBe(true);
  });
});
