/**
 * `pick-selfie.ts` — real device selfie capture via `expo-image-picker`,
 * replacing the Phase 2.3 `stub://selfie/<timestamp>` placeholder.
 *
 * What it produces:
 *   A {@link SelfieFile} (`{ uri, name, mimeType }`) ready to feed straight
 *   into the diagnosis upload (`createDiagnosisTransport`). The `uri` is a
 *   real `file://` path, so it passes `selfieFileFromUri`'s guard and the
 *   funnel fires the real `POST /v1/diagnose` round-trip.
 *
 * Flow:
 *   1. request photo-library permission (the OS prompt uses the Korean strings
 *      declared in `app.config.ts` / `app.json`);
 *   2. if denied → resolve `null` (caller keeps the idle capture surface);
 *   3. launch the library picker constrained to images, square-cropped;
 *   4. if the user cancels → resolve `null`;
 *   5. otherwise map the picked asset to a {@link SelfieFile}, inferring a
 *      jpeg/png MIME type the backend accepts (it rejects anything else with
 *      415). Assets without an explicit jpeg/png type are normalised to jpeg.
 *
 * Why dependency-injected:
 *   `expo-image-picker` is a native module — unavailable in the vitest node
 *   env (aliased to a stub in `vitest.config.ts`). Injecting the two picker
 *   functions lets the pure mapping (permission → launch → SelfieFile) be
 *   unit-tested deterministically without the native module or an OS prompt.
 */
import * as ImagePicker from 'expo-image-picker';

import type { SelfieFile } from './request-diagnosis';

/** The MIME types the backend accepts; anything else is normalised to jpeg. */
type AcceptedMime = SelfieFile['mimeType'];

/**
 * Minimal structural shape of a picked asset — the subset of
 * `ImagePicker.ImagePickerAsset` this module reads. Declared locally (rather
 * than referencing the native type) so the injectable seam stays decoupled
 * from the heavy native typings and the unit test can supply a tiny literal.
 */
export interface PickedAsset {
  readonly uri: string;
  readonly fileName?: string | null;
  readonly mimeType?: string;
}

/** Minimal structural shape of `launchImageLibraryAsync`'s result. */
export interface SelfiePickerLaunchResult {
  readonly canceled: boolean;
  readonly assets?: ReadonlyArray<PickedAsset> | null;
}

/** Minimal slice of `expo-image-picker` this module drives — injectable. */
export interface SelfiePickerDeps {
  readonly requestPermission?: () => Promise<{ readonly granted: boolean }>;
  readonly launchLibrary?: (
    options: ImagePicker.ImagePickerOptions,
  ) => Promise<SelfiePickerLaunchResult>;
}

/**
 * Normalise a picked asset's reported MIME type to one the backend accepts.
 * `image/png` is preserved; everything else (including `undefined`, HEIC, or a
 * bare extension) maps to `image/jpeg` — expo-image-picker transcodes the
 * delivered file to jpeg by default, so this is the safe assumption.
 */
function normaliseMime(assetMimeType: string | undefined, uri: string): AcceptedMime {
  if (assetMimeType === 'image/png' || uri.toLowerCase().endsWith('.png')) {
    return 'image/png';
  }
  return 'image/jpeg';
}

/** Derive a filename for the multipart part from the asset (or a default). */
function deriveName(
  fileName: string | null | undefined,
  mimeType: AcceptedMime,
): string {
  if (typeof fileName === 'string' && fileName.length > 0) {
    return fileName;
  }
  return mimeType === 'image/png' ? 'selfie.png' : 'selfie.jpg';
}

/**
 * Launch the device picker and resolve a {@link SelfieFile}, or `null` when the
 * user denies permission or cancels.
 *
 * @param deps - optional `expo-image-picker` overrides (default to the real
 *   `requestMediaLibraryPermissionsAsync` / `launchImageLibraryAsync`).
 */
export async function pickSelfie(
  deps: SelfiePickerDeps = {},
): Promise<SelfieFile | null> {
  const requestPermission =
    deps.requestPermission ?? ImagePicker.requestMediaLibraryPermissionsAsync;
  const launchLibrary = deps.launchLibrary ?? ImagePicker.launchImageLibraryAsync;

  const permission = await requestPermission();
  if (!permission.granted) {
    return null;
  }

  const result = await launchLibrary({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.9,
  });

  if (result.canceled) {
    return null;
  }
  const asset = result.assets?.[0];
  if (asset === undefined || asset === null) {
    return null;
  }

  const mimeType = normaliseMime(asset.mimeType, asset.uri);
  return {
    uri: asset.uri,
    name: deriveName(asset.fileName, mimeType),
    mimeType,
  };
}

/**
 * Convenience adapter for the capture surface: launch {@link pickSelfie} and
 * return just the `file://` URI string (or `null` on deny/cancel) so it slots
 * into the `SelfieUploadPressable` `acquireSelfieUri` prop without the caller
 * destructuring the {@link SelfieFile}. The richer metadata is re-derived
 * downstream by `selfieFileFromUri`.
 */
export async function pickSelfieUri(
  deps: SelfiePickerDeps = {},
): Promise<string | null> {
  const selfie = await pickSelfie(deps);
  return selfie === null ? null : selfie.uri;
}
