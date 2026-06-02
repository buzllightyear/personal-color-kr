/**
 * Phase 2.5 Sub-AC 2.1 — `@superwall/react-native-superwall` dependency
 * presence contract for `apps/mobile/package.json`.
 *
 * Goal:
 *   This test pins the *declaration* contract — that the native Superwall
 *   SDK is listed as a direct runtime dependency of the mobile app
 *   workspace. It is the smallest, fastest signal that a future
 *   `pnpm install` (or EAS dev-client build) will fetch the package and
 *   the wrapper module (`src/superwall/client.ts`) will be resolvable
 *   at bundle time.
 *
 * What this test asserts:
 *   1. `apps/mobile/package.json` is a valid JSON document and parses
 *      into an object whose `.dependencies` field is itself an object.
 *      A non-object `dependencies` field (missing, null, array, string)
 *      would silently break `pnpm install` and ship the app without the
 *      SDK — surfacing that as a fast CI failure beats a sandbox crash.
 *   2. The dependency key `@superwall/react-native-superwall` is present
 *      on `.dependencies` (NOT `.devDependencies`, NOT `.peerDependencies`).
 *      The wrapper imports it at runtime, so a `devDependencies` listing
 *      would cause an `Unable to resolve module` error at app launch
 *      after the production bundle is produced.
 *   3. The version specifier is a non-empty string that parses as a valid
 *      npm semver range. We accept the common shapes (`^x.y.z`, `~x.y.z`,
 *      `x.y.z`, comparator ranges, `x.x` shorthands) and explicitly reject
 *      the disallowed shapes for *production* dependencies in this phase:
 *      `*` (any version — too loose for a payment-critical SDK),
 *      `latest` / `next` (npm dist-tags — non-deterministic across
 *      installs), `file:` / `link:` (local paths — not portable), and
 *      git/url references (no semver guarantees).
 *   4. The major version is >= 2 — the wrapper at
 *      `src/superwall/client.ts` is written against the v2 API surface
 *      (`Superwall.configure({ apiKey })` shape, `Superwall.shared.register`
 *      callback signature). A v1.x install would type-check the wrapper
 *      against an incompatible shape and the dev-client build would
 *      surface a runtime crash. The lower-bound pin is the most direct
 *      defence against an accidental downgrade.
 *
 * What this test does NOT do:
 *   - It does not require a specific minor/patch version. The wrapper
 *     contract is stable across the v2.x line and we let `pnpm` resolve
 *     the latest compatible patch. (A specific patch is pinned in
 *     `pnpm-lock.yaml`, which is the *resolution* contract — orthogonal
 *     to the *declaration* contract under test here.)
 *   - It does not exercise the native SDK. Native isolation is the
 *     Phase 2.5 architectural invariant — the SDK is loaded only inside
 *     the wrapper module on the device, never inside vitest.
 *
 * Why a vitest test (and not a typecheck or lint rule):
 *   - `tsc --noEmit` cannot inspect a sibling JSON manifest — TS only
 *     sees imported types. A dependency-presence assertion must run at
 *     test time and read the file directly.
 *   - A bespoke lint rule would work but adds tooling overhead for a
 *     single declaration. A 30-line vitest test is the cheaper guard.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Resolve the mobile workspace `package.json` from the repo root regardless
 * of which directory vitest was launched from. The test file lives at
 * `apps/mobile/tests/`, so the manifest is one directory up.
 */
const MOBILE_PACKAGE_JSON_PATH: string = path.resolve(__dirname, '..', 'package.json');

const SUPERWALL_DEPENDENCY_KEY: string = '@superwall/react-native-superwall';
const MINIMUM_SUPPORTED_MAJOR: number = 2;

/**
 * Narrow shape for the manifest fields we care about. Defined here (rather
 * than imported) so this test is self-contained — a drift in the broader
 * package.json schema must not silently affect this assertion.
 */
interface MobilePackageManifest {
  readonly name?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly peerDependencies?: unknown;
}

function readManifest(): MobilePackageManifest {
  const raw: string = readFileSync(MOBILE_PACKAGE_JSON_PATH, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  // Defence-in-depth: a JSON document is parseable into any value
  // (number, string, array, null). We need a plain object.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `expected ${MOBILE_PACKAGE_JSON_PATH} to parse into an object, got ${
        Array.isArray(parsed) ? 'array' : typeof parsed
      }`,
    );
  }
  return parsed as MobilePackageManifest;
}

/**
 * Conservative npm-semver validator. We do not pull in the `semver` npm
 * package because (a) it isn't a workspace dependency and (b) the
 * narrow allowed-shape subset we accept here is small enough to encode
 * directly. The regex accepts:
 *   - exact:        `1.2.3`, `1.2.3-beta.0`, `1.2.3+build`
 *   - caret/tilde:  `^1.2.3`, `~1.2.3`
 *   - comparator:   `>=1.2.3`, `<2.0.0`, `>1.2.3 <2.0.0` (space-joined)
 *   - hyphen range: `1.2.3 - 1.5.0`
 *   - shorthand:    `1.x`, `1.2.x`, `1`, `1.2`
 * It rejects: `*`, `latest`, `next`, `file:...`, `link:...`,
 * `github:...`, `git+...`, URL schemes.
 */
function isAcceptableSemverRange(spec: string): boolean {
  if (spec.length === 0) return false;

  // Explicit disallow-list for production-critical dependencies in this phase.
  const disallowedExact = new Set<string>(['*', 'x', 'latest', 'next']);
  if (disallowedExact.has(spec.trim().toLowerCase())) return false;

  // Reject any non-registry resolver protocol.
  const disallowedPrefixes = [
    'file:',
    'link:',
    'github:',
    'git+',
    'git:',
    'http:',
    'https:',
    'workspace:',
  ];
  for (const prefix of disallowedPrefixes) {
    if (spec.startsWith(prefix)) return false;
  }

  // Acceptable shapes: a comparator/range chain or a single version.
  // Each token must look like a (partial) version, optionally prefixed
  // by `^`, `~`, `>=`, `<=`, `>`, `<`, or `=`. Hyphen ranges and
  // space-joined comparator pairs are flattened into tokens here.
  const tokens: ReadonlyArray<string> = spec
    .replace(/\s+-\s+/g, ' ') // hyphen range -> two tokens
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return false;

  // Each token must match this conservative version-ish pattern.
  const versionishPattern: RegExp =
    /^(?:\^|~|>=|<=|>|<|=)?\d+(?:\.\d+(?:\.\d+(?:-[0-9A-Za-z.\-]+)?(?:\+[0-9A-Za-z.\-]+)?)?)?(?:\.x|\.X)?$/;

  return tokens.every((tok) => versionishPattern.test(tok));
}

/**
 * Extract the first concrete major-version integer from a semver range.
 * Returns `null` if no leading numeric major can be determined (which
 * is itself a test failure — we require a numeric lower bound).
 */
function extractLowerBoundMajor(spec: string): number | null {
  // Strip a leading operator (^, ~, >=, <=, >, <, =) and any whitespace.
  const stripped: string = spec.trim().replace(/^(?:\^|~|>=|<=|>|<|=)/, '');
  const match: RegExpMatchArray | null = stripped.match(/^(\d+)/);
  if (match === null) return null;
  const parsed: number = Number.parseInt(match[1]!, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

describe('apps/mobile/package.json — @superwall/react-native-superwall declaration (Sub-AC 2.1)', () => {
  it('parses as a JSON object whose .dependencies is itself an object', () => {
    const manifest = readManifest();
    expect(manifest).toBeTypeOf('object');
    expect(manifest.dependencies).toBeTypeOf('object');
    expect(manifest.dependencies).not.toBeNull();
    expect(Array.isArray(manifest.dependencies)).toBe(false);
  });

  it('declares @superwall/react-native-superwall on .dependencies (runtime, not dev/peer)', () => {
    const manifest = readManifest();
    const deps = manifest.dependencies as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(deps, SUPERWALL_DEPENDENCY_KEY)).toBe(
      true,
    );

    // Regression guard: must NOT be in devDependencies — the wrapper
    // module imports it at runtime, so a dev-only listing would crash
    // the bundle at app launch.
    const devDeps = (manifest.devDependencies ?? {}) as Record<string, unknown>;
    expect(
      Object.prototype.hasOwnProperty.call(devDeps, SUPERWALL_DEPENDENCY_KEY),
    ).toBe(false);

    // And not in peerDependencies — this app is the consumer, not a
    // library that expects a host to provide the SDK.
    const peerDeps = (manifest.peerDependencies ?? {}) as Record<string, unknown>;
    expect(
      Object.prototype.hasOwnProperty.call(peerDeps, SUPERWALL_DEPENDENCY_KEY),
    ).toBe(false);
  });

  it('declares a non-empty string semver range (no protocol/dist-tag aliases)', () => {
    const manifest = readManifest();
    const deps = manifest.dependencies as Record<string, unknown>;
    const spec: unknown = deps[SUPERWALL_DEPENDENCY_KEY];

    expect(typeof spec).toBe('string');
    expect((spec as string).length).toBeGreaterThan(0);

    expect(
      isAcceptableSemverRange(spec as string),
      `expected a valid npm semver range, got: ${String(spec)}`,
    ).toBe(true);
  });

  it('pins the major version at or above the v2 wrapper-API baseline', () => {
    const manifest = readManifest();
    const deps = manifest.dependencies as Record<string, unknown>;
    const spec = deps[SUPERWALL_DEPENDENCY_KEY] as string;

    const major: number | null = extractLowerBoundMajor(spec);
    expect(major, `could not extract a major version from "${spec}"`).not.toBeNull();
    expect(major as number).toBeGreaterThanOrEqual(MINIMUM_SUPPORTED_MAJOR);
  });
});
