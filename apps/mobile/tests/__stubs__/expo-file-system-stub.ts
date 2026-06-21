/**
 * Vitest stub for `expo-file-system` (a native module vite/rollup cannot parse
 * in the node test env).
 *
 * `src/save-to-camera-roll.ts` imports the SDK 54 `File` / `Directory` / `Paths`
 * API for its default download path. The save seam is unit-tested through an
 * injected `downloadToCache` dep, so these inert classes only need to make the
 * import resolve — they are never exercised by a test.
 */
export class Directory {
  readonly uri: string;
  constructor(...segments: unknown[]) {
    this.uri = `file:///stub-cache/${segments.join('/')}`;
  }
}

export class File {
  readonly uri: string = 'file:///stub-cache/stub.png';

  static async downloadFileAsync(): Promise<File> {
    return new File();
  }
}

export const Paths = {
  get cache(): Directory {
    return new Directory();
  },
};
