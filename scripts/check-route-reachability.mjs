#!/usr/bin/env node
/**
 * Route-reachability guard — the first mechanical "ratchet" click for the
 * orphaned-feature failure class (see docs/decisions/0002-feature-reachability.md).
 *
 * The content-generation catalog shipped as a fully-built `(generate)` route
 * group that NOTHING in the app navigated into — it passed every AC and CI was
 * green, yet the surface was unreachable on device. This guard makes that exact
 * class impossible to merge again: every top-level Expo Router group under
 * `apps/mobile/app/` must have at least one inbound navigation, or be the entry
 * group, or be explicitly allowlisted with a reason.
 *
 * It is a HEURISTIC, not a proof. It relies on this repo's convention that
 * navigation targets are written with explicit group tokens, e.g.
 * `router.push('/(generate)/(tabs)/catalog')` and `<Redirect href="/(post-payment)/…">`.
 * That convention holds today; a target written without its `(group)` token
 * (or computed at runtime) would be a blind spot — accept the false-negative
 * rather than over-engineer a full router graph. False POSITIVES are handled by
 * ALLOWLIST below. This is a backstop against the specific "built but never
 * wired" mistake, layered under the completeness-critic review dimension that
 * catches the open-ended tail this script cannot.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(repoRoot, 'apps/mobile/app');
const scanRoots = [appDir, join(repoRoot, 'apps/mobile/src')];

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/**
 * Top-level groups that are intentionally reachable by a path this heuristic
 * cannot see (external deep links, native intents, etc.). Each entry MUST carry
 * a reason — an unexplained allowlist entry is how the next orphan hides.
 */
const ALLOWLIST = Object.freeze({
  // (none today — every group is wired via in-app navigation)
});

// --- collect top-level route groups: app/(group)/ ---------------------------
function topLevelGroups() {
  return readdirSync(appDir)
    .filter((name) => /^\(.+\)$/.test(name))
    .filter((name) => statSync(join(appDir, name)).isDirectory());
}

// --- walk .ts/.tsx files under the scan roots -------------------------------
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

// --- extract navigation-target group tokens ---------------------------------
// Match the FIRST `(group)` token inside any navigation target string:
//   router.push('/(generate)/(tabs)/catalog')   <Redirect href="/(funnel)/x" />
//   router.replace(`/(post-payment)/y`)          <Link href='/(funnel)/z'>
const NAV_TARGET = /(?:href\s*[=:]\s*|\.(?:push|replace|navigate|dismissTo)\(\s*)["'`]([^"'`]+)["'`]/g;

function referencedGroups() {
  const refs = new Set();
  for (const root of scanRoots) {
    for (const file of walk(root)) {
      const src = readFileSync(file, 'utf8');
      let m;
      while ((m = NAV_TARGET.exec(src)) !== null) {
        const groupMatch = m[1].match(/\((\w[\w-]*)\)/);
        if (groupMatch) refs.add(`(${groupMatch[1]})`);
      }
    }
  }
  return refs;
}

// --- entry group: whatever app/index.tsx redirects into ---------------------
function entryGroup() {
  try {
    const src = readFileSync(join(appDir, 'index.tsx'), 'utf8');
    const m = src.match(/href=["'`]\/(\(\w[\w-]*\))/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// --- run --------------------------------------------------------------------
const groups = topLevelGroups();
const refs = referencedGroups();
const entry = entryGroup();

const orphans = groups.filter(
  (g) => g !== entry && !refs.has(g) && !(g in ALLOWLIST),
);

console.log(dim(`route-reachability: ${groups.length} groups, entry=${entry ?? '?'}`));
for (const g of groups) {
  const why =
    g === entry
      ? 'entry (index redirect)'
      : refs.has(g)
        ? 'in-app navigation'
        : g in ALLOWLIST
          ? `allowlisted: ${ALLOWLIST[g]}`
          : 'ORPHAN';
  console.log(`  ${orphans.includes(g) ? red('✗') : green('✓')} ${g} ${dim(`— ${why}`)}`);
}

if (orphans.length > 0) {
  console.error(
    '\n' +
      red(`✖ ${orphans.length} orphaned route group(s): ${orphans.join(', ')}`),
  );
  console.error(
    '  A group with no inbound navigation is unreachable on device even when');
  console.error(
    '  every screen inside it is built and its tests pass. Wire an entry');
  console.error(
    "  (router.push / <Link> / <Redirect>), or add it to ALLOWLIST with a reason.\n");
  process.exit(1);
}

console.log(green('\n✓ every route group is reachable'));
