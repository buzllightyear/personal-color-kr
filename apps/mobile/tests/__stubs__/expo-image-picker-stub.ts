/**
 * Inert stub for `expo-image-picker` (a native module vite/rollup cannot parse
 * in the node test env). `src/pick-selfie.ts` statically imports the module for
 * its default permission/launch functions + the `MediaTypeOptions` enum; the
 * actual picker flow is unit-tested through `pickSelfie`'s injected deps, so
 * this stub only needs to make the import resolve and expose the enum surface.
 */

export const MediaTypeOptions = {
  Images: 'Images',
  Videos: 'Videos',
  All: 'All',
} as const;

export async function requestMediaLibraryPermissionsAsync(): Promise<{
  granted: boolean;
}> {
  return { granted: false };
}

export async function launchImageLibraryAsync(): Promise<{
  canceled: boolean;
  assets: ReadonlyArray<{ uri: string }>;
}> {
  return { canceled: true, assets: [] };
}
