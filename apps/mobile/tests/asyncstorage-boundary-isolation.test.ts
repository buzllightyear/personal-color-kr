/**
 * Boundary-isolation test — Phase 3.3 Sub-AC 14 (extended Phase 4.5).
 *
 * Greps the entire `apps/mobile/src` and `apps/mobile/app` source trees
 * and asserts that ONLY files inside `apps/mobile/src/storage/` import
 * `@react-native-async-storage/async-storage`. Any source OUTSIDE the
 * `storage/` wrapper directory importing the library directly bypasses the
 * typed wrapper API, which Phase 3.3 forbids ("No source file outside this
 * wrapper may import @react-native-async-storage/async-storage").
 *
 * Phase 4.5 note:
 *   The boundary was originally a single file
 *   (`storage/post-payment-storage.ts`). Phase 4.5 adds a second cohesive
 *   wrapper (`storage/referral-storage.ts`) for the stashed referral code.
 *   The boundary is therefore the `src/storage/` directory — still a strict,
 *   single, auditable location for every AsyncStorage import — rather than a
 *   single filename. A source file outside `src/storage/` importing the
 *   library still fails this test.
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WRAPPER_DIR_PREFIX = 'apps/mobile/src/storage/';

describe('AsyncStorage boundary isolation (Phase 3.3 Sub-AC 14 / Phase 4.5)', () => {
  it('only files in src/storage/ import the AsyncStorage library', () => {
    // git grep keeps the search constrained to tracked files and respects
    // the repo's .gitignore (no node_modules / coverage / .next noise).
    let raw: string;
    try {
      raw = execSync(
        "git grep -l '@react-native-async-storage/async-storage' -- 'apps/mobile/src' 'apps/mobile/app'",
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
    } catch (e: unknown) {
      // git grep exits non-zero when no matches found, which would mean
      // the wrapper itself does not import the library either — that's
      // a real failure, surface it.
      raw = '';
    }
    const matches = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const offenders = matches.filter(
      (line) => !line.startsWith(WRAPPER_DIR_PREFIX),
    );

    // Guard against a vacuous pass: at least one storage-wrapper file must
    // import the library, otherwise the grep matched nothing (the catch
    // branch) and `offenders` would be trivially empty.
    expect(
      matches.some((line) => line.startsWith(WRAPPER_DIR_PREFIX)),
      `Expected at least one file under ${WRAPPER_DIR_PREFIX} to import the AsyncStorage library.`,
    ).toBe(true);

    expect(
      offenders,
      `Only files under ${WRAPPER_DIR_PREFIX} may import '@react-native-async-storage/async-storage'. Found extras: ${offenders.join(
        ', ',
      )}`,
    ).toEqual([]);
  });
});
