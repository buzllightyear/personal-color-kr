/**
 * Defensive smoke test — pins the exact ROOT_ENV_PATH value.
 *
 * Co-located with `app-config.test.ts` so that a future refactor that
 * changes the relative path math (e.g. moving the file or restructuring
 * the workspace) breaks this test loudly rather than silently loading the
 * wrong `.env` from a sibling directory. The expected value is computed
 * from `process.cwd()` mirroring how a developer would resolve it from
 * the workspace root.
 */
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT_ENV_PATH } from '../app.config';

describe('app.config.ts — ROOT_ENV_PATH workspace-root pin', () => {
  it('points at <workspace-root>/.env regardless of CWD', () => {
    // The test file lives at apps/mobile/tests/, but vitest sets CWD to the
    // package root (apps/mobile/). The path math therefore matches:
    //   apps/mobile/  →  ../../.env  →  <workspace-root>/.env
    // Computed via process.cwd() here so this assertion does not depend on
    // an absolute machine-specific path.
    const expected = path.resolve(process.cwd(), '../../.env');
    expect(ROOT_ENV_PATH).toBe(expected);
  });
});
