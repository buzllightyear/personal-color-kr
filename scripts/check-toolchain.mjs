#!/usr/bin/env node
/**
 * Toolchain enforcement guard (runs as the root `preinstall` script).
 *
 * Embodies the project's governing principle: *pin one → the machine enforces →
 * bump deliberately via PR*. It refuses the wrong package manager / pnpm major
 * at the boundary instead of relying on a doc that someone has to remember.
 *
 * Calibrated on purpose (don't over-govern — block only what bites silently):
 *   - package manager  → FATAL if not pnpm (npm/yarn would write a foreign
 *     lockfile and bypass `pnpm.patchedDependencies` / `onlyBuiltDependencies`).
 *   - pnpm MAJOR       → FATAL if it doesn't match the pinned `packageManager`
 *     major. This is the exact drift that broke CI (pnpm 9 vs 10 write the
 *     patched-dependency hash differently). corepack + `packageManager` already
 *     pins it for CI/EAS/local; this is the belt-and-suspenders that fails loud.
 *   - node MAJOR       → WARN only, and only when BELOW the tested floor
 *     (`.nvmrc`). Node is intentionally NOT fatal: EAS Build pins no node
 *     version and local dev may run a newer major — a hard check would break
 *     real installs for no benefit (node drift hasn't bitten us).
 *
 * Single source of truth: expected pnpm major is read from `package.json`
 * `packageManager`, the node floor from `.nvmrc` — never duplicated here.
 *
 * Defensive: anything this script can't confidently parse degrades to a warning,
 * never a false-positive block. Only a CONFIRMED mismatch is fatal.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function fail(lines) {
  console.error('\n' + red('✖ toolchain check failed'));
  for (const l of lines) console.error('  ' + l);
  console.error('');
  process.exit(1);
}
function warn(line) {
  console.warn(yellow('⚠ toolchain: ') + line);
}

// --- expected versions (single source of truth) ----------------------------
let expectedPnpmMajor = null;
try {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const m = String(pkg.packageManager ?? '').match(/^pnpm@(\d+)\./);
  if (m) expectedPnpmMajor = Number(m[1]);
} catch {
  /* can't read pin → can't enforce; stay silent rather than block */
}

let nodeFloorMajor = null;
try {
  const m = readFileSync(join(repoRoot, '.nvmrc'), 'utf8').trim().match(/(\d+)/);
  if (m) nodeFloorMajor = Number(m[1]);
} catch {
  /* no .nvmrc → skip the node advisory */
}

// --- package manager + pnpm major (from the install user-agent) -------------
// npm_config_user_agent looks like: "pnpm/10.29.2 npm/? node/v25.6.0 darwin arm64"
const ua = process.env.npm_config_user_agent ?? '';
const pmMatch = ua.match(/^(\w+)\/(\d+)\.\d+\.\d+/);

if (pmMatch) {
  const pm = pmMatch[1];
  const pmMajor = Number(pmMatch[2]);
  if (pm !== 'pnpm') {
    fail([
      `This repo uses pnpm, but the install is running under "${pm}".`,
      'A foreign lockfile bypasses pnpm.patchedDependencies + onlyBuiltDependencies.',
      'Run with pnpm:  corepack enable && pnpm install',
    ]);
  }
  if (expectedPnpmMajor != null && pmMajor !== expectedPnpmMajor) {
    fail([
      `pnpm major mismatch: running pnpm ${pmMajor}.x, repo pins pnpm ${expectedPnpmMajor}.x ` +
        `(package.json "packageManager").`,
      'pnpm 9 and 10 write the patched-dependency hash differently, so CI ' +
        '(--frozen-lockfile) will reject a lockfile written by the wrong major.',
      'Fix:  corepack enable    (then re-run pnpm install — corepack honors the pin)',
    ]);
  }
}

// --- node floor (advisory only) ---------------------------------------------
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeFloorMajor != null && nodeMajor < nodeFloorMajor) {
  warn(
    `node ${nodeMajor}.x is below the tested floor (.nvmrc = ${nodeFloorMajor}). ` +
      `CI runs node ${nodeFloorMajor}; consider \`nvm use\`.`,
  );
}
