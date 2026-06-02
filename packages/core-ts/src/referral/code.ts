/**
 * Sub-AC 1.1 — Referral Code Generator.
 *
 * Step 10 of the Korean funnel variant is `referral_gate` (1명 친구 추천 게이트).
 * To gate that step we need short, share-friendly codes that:
 *
 *   • are easy to type / read aloud in Korean (no visually ambiguous chars),
 *   • carry a stable "PCKR" prefix so codes are self-identifying in logs,
 *   • are long enough that collisions are vanishingly unlikely yet bounded,
 *   • can be deterministically tested via dependency-injected RNG.
 *
 * This module is intentionally tiny: it does not persist or distribute
 * codes — it just *mints* and *validates* them.  Higher layers compose
 * minting with persistence.
 *
 * All public outputs are immutable (frozen) where applicable.
 */

// ---------------------------------------------------------------------------
// Charset & format
// ---------------------------------------------------------------------------

/**
 * Public alphabet for the random suffix.  Excludes visually ambiguous
 * characters (0/O, 1/I/L) to reduce manual-entry errors.  Crockford
 * base32 inspired, uppercase only.
 */
export const REFERRAL_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' as const;

/** Stable prefix identifying personal-color-kr referral codes. */
export const REFERRAL_CODE_PREFIX = 'PCKR' as const;

/** Separator between the prefix and the random suffix. */
export const REFERRAL_CODE_SEPARATOR = '-' as const;

/** Length of the random suffix portion. */
export const REFERRAL_CODE_SUFFIX_LENGTH = 6 as const;

/**
 * Full canonical form: `PCKR-XXXXXX` (4 + 1 + 6 = 11 chars).
 */
export const REFERRAL_CODE_TOTAL_LENGTH =
  REFERRAL_CODE_PREFIX.length +
  REFERRAL_CODE_SEPARATOR.length +
  REFERRAL_CODE_SUFFIX_LENGTH;

/**
 * Regex used by {@link isValidReferralCode} — exposed for advanced
 * callers (e.g. server-side schema validators) that need the same
 * source of truth without invoking the helper.
 */
export const REFERRAL_CODE_PATTERN: RegExp = new RegExp(
  `^${REFERRAL_CODE_PREFIX}${REFERRAL_CODE_SEPARATOR}[${REFERRAL_CODE_CHARSET}]{${REFERRAL_CODE_SUFFIX_LENGTH}}$`,
);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ReferralCodeErrorReason =
  | 'collision_budget_exhausted'
  | 'invalid_rng_output';

/**
 * Thrown when {@link generateUniqueReferralCode} cannot find a free code
 * within the supplied attempt budget, or when an injected RNG returns
 * an out-of-range integer.
 */
export class ReferralCodeError extends Error {
  public readonly reason: ReferralCodeErrorReason;

  public constructor(reason: ReferralCodeErrorReason, message: string) {
    super(message);
    this.name = 'ReferralCodeError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// RNG abstraction
// ---------------------------------------------------------------------------

/**
 * Pluggable RNG: takes the exclusive upper bound and returns an integer
 * in `[0, upperBoundExclusive)`.  Defaults to `Math.random`-derived
 * uniform sampling.  Tests inject deterministic counters.
 */
export type ReferralRandomInt = (upperBoundExclusive: number) => number;

const defaultRandomInt: ReferralRandomInt = (upperBoundExclusive) =>
  Math.floor(Math.random() * upperBoundExclusive);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateReferralCodeOptions {
  /** Injected RNG.  Defaults to a `Math.random`-based uniform sampler. */
  readonly randomInt?: ReferralRandomInt;
}

export interface GenerateUniqueReferralCodeOptions extends GenerateReferralCodeOptions {
  /**
   * Maximum number of mint attempts before giving up.  Defaults to 32.
   * Collision probability with the default 6-char suffix is
   * ~1 / 31^6 ≈ 1.1e-9 per draw, so the budget rarely matters in
   * production — it exists so tests can verify the failure path.
   */
  readonly maxAttempts?: number;
}

/** Default attempt budget for {@link generateUniqueReferralCode}. */
export const DEFAULT_GENERATE_MAX_ATTEMPTS = 32 as const;

/**
 * Mint a single referral code without collision checking.  Pure given
 * a deterministic RNG.
 */
export function generateReferralCode(
  options: GenerateReferralCodeOptions = {},
): string {
  const randomInt = options.randomInt ?? defaultRandomInt;
  const charsetSize = REFERRAL_CODE_CHARSET.length;
  const chars: string[] = [];
  for (let i = 0; i < REFERRAL_CODE_SUFFIX_LENGTH; i += 1) {
    const index = randomInt(charsetSize);
    if (!Number.isInteger(index) || index < 0 || index >= charsetSize) {
      throw new ReferralCodeError(
        'invalid_rng_output',
        `RNG returned out-of-range value ${String(index)} for charset size ${charsetSize}.`,
      );
    }
    chars.push(REFERRAL_CODE_CHARSET[index] as string);
  }
  return `${REFERRAL_CODE_PREFIX}${REFERRAL_CODE_SEPARATOR}${chars.join('')}`;
}

/**
 * Mint a referral code guaranteed not to collide with `existingCodes`.
 * Throws {@link ReferralCodeError} with reason `collision_budget_exhausted`
 * when no free code is found within `maxAttempts` draws.
 *
 * `existingCodes` may be any iterable (Set/Array/etc.).  Comparison is
 * case-sensitive and uses canonical form — callers should canonicalize
 * stored codes via {@link normalizeReferralCode} first.
 */
export function generateUniqueReferralCode(
  existingCodes: Iterable<string>,
  options: GenerateUniqueReferralCodeOptions = {},
): string {
  const taken =
    existingCodes instanceof Set ? existingCodes : new Set<string>(existingCodes);
  const maxAttempts = options.maxAttempts ?? DEFAULT_GENERATE_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new ReferralCodeError(
      'collision_budget_exhausted',
      `maxAttempts must be a positive integer, received ${String(maxAttempts)}.`,
    );
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateReferralCode(options);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new ReferralCodeError(
    'collision_budget_exhausted',
    `Failed to mint a unique referral code within ${maxAttempts} attempts.`,
  );
}

/**
 * Cheap structural validator — returns `true` iff the supplied string
 * is the canonical `PCKR-XXXXXX` form using the public charset.
 */
export function isValidReferralCode(code: unknown): code is string {
  if (typeof code !== 'string') {
    return false;
  }
  if (code.length !== REFERRAL_CODE_TOTAL_LENGTH) {
    return false;
  }
  return REFERRAL_CODE_PATTERN.test(code);
}

/**
 * Normalize free-form user input to canonical form by trimming
 * whitespace and uppercasing.  Does NOT validate — chain with
 * {@link isValidReferralCode} when the result must be trustworthy.
 */
export function normalizeReferralCode(input: string): string {
  return input.trim().toUpperCase();
}
