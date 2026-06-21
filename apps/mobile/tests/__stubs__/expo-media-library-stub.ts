/**
 * Vitest stub for `expo-media-library` (a native module vite/rollup cannot
 * parse in the node test env).
 *
 * `src/save-to-camera-roll.ts` imports `requestPermissionsAsync` /
 * `saveToLibraryAsync` to persist a generated image to the camera roll. The
 * save seam is unit-tested through injected deps, so this stub only needs to
 * make the import resolve with inert, side-effect-free implementations.
 */
export async function requestPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted: false };
}

export async function saveToLibraryAsync(): Promise<void> {
  return undefined;
}
