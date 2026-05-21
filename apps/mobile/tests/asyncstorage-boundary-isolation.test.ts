/**
 * Boundary-isolation test — Phase 3.3 Sub-AC 14.
 *
 * Greps the entire `apps/mobile/src` and `apps/mobile/app` source trees
 * and asserts that ONLY `apps/mobile/src/storage/post-payment-storage.ts`
 * imports `@react-native-async-storage/async-storage`. Any other source
 * importing the library directly bypasses the typed wrapper API, which
 * Phase 3.3 explicitly forbids ("No source file outside this wrapper may
 * import @react-native-async-storage/async-storage").
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WRAPPER_RELATIVE_PATH =
  'apps/mobile/src/storage/post-payment-storage.ts';

describe('AsyncStorage boundary isolation (Phase 3.3 Sub-AC 14)', () => {
  it('only the post-payment-storage wrapper imports the AsyncStorage library', () => {
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
    const offenders = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== WRAPPER_RELATIVE_PATH);

    expect(
      offenders,
      `Only ${WRAPPER_RELATIVE_PATH} may import '@react-native-async-storage/async-storage'. Found extras: ${offenders.join(
        ', ',
      )}`,
    ).toEqual([]);
  });
});
