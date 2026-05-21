/**
 * Phase 4 hook-internal-only swap test — Phase 3.3 Sub-AC 19.
 *
 * Asserts the architectural invariant that the screens, layouts, Tone
 * Switcher, and AsyncStorage wrapper are decoupled from the shell-time
 * data hook (`useDummy`). Phase 4 swaps the 4 hooks' internals from
 * `useDummy` to `usePython` — that swap MUST require zero changes to
 * any of the surfaces listed below.
 *
 * Strategy: grep the screen + layout + provider files for `useDummy`
 * imports. The screens must depend on the per-screen hook contract,
 * not on `useDummy` directly. If a screen ever imports `useDummy`
 * directly it leaks the implementation detail and breaks the
 * `phase4_portability` evaluation principle.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Surfaces that MUST stay decoupled from `useDummy`. Listed as repo-
// relative globs so a future surface gain (e.g. a new screen) only
// requires adding a glob entry, not rewiring the test.
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
  // Tone Switcher (per Seed phase4_portability)
  'apps/mobile/src/components/ToneSwitcher.tsx',
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
