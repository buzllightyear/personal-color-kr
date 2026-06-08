/**
 * Phase 4 hook-internal-only swap test — Phase 3.3 Sub-AC 19.
 *
 * Asserts the architectural invariant that the screens, layouts, and
 * AsyncStorage wrapper are decoupled from the shell-time data hook
 * (`useDummy`). Phase 4 swaps the 4 hooks' internals from `useDummy`
 * to `usePython` — that swap MUST require zero changes to any of the
 * surfaces listed below.
 *
 * Strategy: grep the screen + layout files for `useDummy` imports.
 * The screens must depend on the per-screen hook contract, not on
 * `useDummy` directly. If a screen ever imports `useDummy` directly
 * it leaks the implementation detail and breaks the
 * `phase4_portability` evaluation principle.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Surfaces that MUST stay decoupled from `useDummy`. Listed as repo-
// relative paths so a future surface gain (e.g. a new screen) only
// requires adding an entry, not rewiring the test.
const PROTECTED_SURFACES = [
  // Screens
  'apps/mobile/app/(post-payment)/diagnosis-reveal.tsx',
  'apps/mobile/app/(post-payment)/(tabs)/edit.tsx',
  'apps/mobile/app/(post-payment)/(tabs)/diagnosis.tsx',
  'apps/mobile/app/(post-payment)/(tabs)/guide.tsx',
  'apps/mobile/app/(post-payment)/(tabs)/curation.tsx',
  // Layouts
  'apps/mobile/app/(post-payment)/_layout.tsx',
  'apps/mobile/app/(post-payment)/(tabs)/_layout.tsx',
  // Storage wrapper
  'apps/mobile/src/storage/post-payment-storage.ts',
];

function fileContainsUseDummy(relativePath: string): boolean {
  const fullPath = path.resolve(REPO_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    return false;
  }
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) {
    return false;
  }
  const text = fs.readFileSync(fullPath, 'utf8');
  return text.includes('use-dummy');
}

describe('Phase 4 hook-internal-only swap invariant (Sub-AC 19)', () => {
  it.each(PROTECTED_SURFACES)(
    '%s does not import useDummy directly',
    (relativePath) => {
      expect(
        fileContainsUseDummy(relativePath),
        `${relativePath} must not import useDummy directly (Phase 4 hook-internal-only swap invariant).`,
      ).toBe(false);
    },
  );

  it('the 4 per-screen post-payment hooks ARE the only useDummy consumers in the post-payment surface', () => {
    // Scope: just the 4 post-payment per-screen hook files. Each MUST
    // import useDummy; nothing else in the post-payment surface should.
    const expectedConsumers = [
      'apps/mobile/src/hooks/use-curation-content.ts',
      'apps/mobile/src/hooks/use-diagnosis-content.ts',
      'apps/mobile/src/hooks/use-edit-content.ts',
      'apps/mobile/src/hooks/use-guide-content.ts',
    ];
    for (const consumer of expectedConsumers) {
      expect(
        fileContainsUseDummy(consumer),
        `${consumer} should be a useDummy consumer (hook-internal).`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3.4 — wording-catalog boundary invariant.
//
// Asserts that only files inside `apps/mobile/src/wording/` and
// `apps/mobile/src/fixtures/post-payment-*.ts` import from the wording
// catalog at `apps/mobile/src/wording/result-wording-catalog.ts`. Phase 4
// will swap the catalog file for an API-backed module; any consumer
// outside this boundary would break the swap.
// ---------------------------------------------------------------------------

const WORDING_CATALOG_IMPORT_NEEDLE = "from '../wording/result-wording-catalog'";

function isAllowedWordingConsumer(relativePath: string): boolean {
  const normalised = relativePath.split(path.sep).join('/');
  if (normalised.startsWith('apps/mobile/src/wording/')) {
    return true;
  }
  if (
    normalised.startsWith('apps/mobile/src/fixtures/') &&
    /\/post-payment-[A-Za-z0-9-]+\.ts$/.test(normalised)
  ) {
    return true;
  }
  return false;
}

function walkRepoForCatalogImporters(dir: string, accumulator: string[]): void {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === '.expo'
    ) {
      continue;
    }
    const childPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRepoForCatalogImporters(childPath, accumulator);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      continue;
    }
    const relNormalised = path.relative(REPO_ROOT, childPath).split(path.sep).join('/');
    // Tests are NOT part of the production import boundary — tests render
    // catalog text and assert against it (and this file itself encodes
    // the import-string needle). Scope the boundary to source files only.
    if (relNormalised.startsWith('apps/mobile/tests/')) {
      continue;
    }
    const text = fs.readFileSync(childPath, 'utf8');
    if (
      text.includes(WORDING_CATALOG_IMPORT_NEEDLE) ||
      text.includes("from '../../wording/result-wording-catalog'") ||
      text.includes("from '../../../wording/result-wording-catalog'") ||
      text.includes("from '../../../src/wording/result-wording-catalog'")
    ) {
      accumulator.push(relNormalised);
    }
  }
}

describe('Phase 3.4 — wording catalog single-import-boundary (interview Q3 single-file boundary)', () => {
  it('only apps/mobile/src/wording/ and apps/mobile/src/fixtures/post-payment-*.ts may import the wording catalog', () => {
    const importers: string[] = [];
    walkRepoForCatalogImporters(path.resolve(REPO_ROOT, 'apps'), importers);
    walkRepoForCatalogImporters(path.resolve(REPO_ROOT, 'packages'), importers);

    const violations = importers.filter(
      (relativePath) => !isAllowedWordingConsumer(relativePath),
    );
    expect(
      violations,
      `Wording catalog boundary violated by: ${violations.join(', ')}`,
    ).toEqual([]);
  });

  it('the wording catalog file itself exists at apps/mobile/src/wording/result-wording-catalog.ts', () => {
    const fullPath = path.resolve(
      REPO_ROOT,
      'apps/mobile/src/wording/result-wording-catalog.ts',
    );
    expect(fs.existsSync(fullPath)).toBe(true);
  });
});
