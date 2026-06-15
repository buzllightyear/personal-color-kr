/**
 * `useAppFonts` — loads the Pretendard typeface family at app mount.
 *
 * Pretendard (SIL OFL) is the editorial/VSCO-direction display + body face.
 * It ships four static weights bundled under `assets/fonts/`; this hook
 * registers them with `expo-font` so screens can reference them by their
 * PostScript family names (`Pretendard-Light` / `-Regular` / `-Medium` /
 * `-SemiBold`) in `fontFamily`.
 *
 * Runtime vs embed:
 *   `useFonts` loads the OTF assets at JS runtime via the native `expo-font`
 *   module (already present in the dev client, since `expo-font` is a default
 *   Expo SDK module). That means the family is available WITHOUT a fresh
 *   native build — handy for in-development preview. A later native build also
 *   embeds the same files via the `expo-font` config plugin (see
 *   `app.config.ts`), which is harmless alongside this runtime registration.
 *
 * @returns `true` once every weight has loaded (gate the app render on it to
 *   avoid a flash of the system fallback face).
 */
import { useFonts } from 'expo-font';

export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    'Pretendard-Light': require('../../assets/fonts/Pretendard-Light.otf'),
    'Pretendard-Regular': require('../../assets/fonts/Pretendard-Regular.otf'),
    'Pretendard-Medium': require('../../assets/fonts/Pretendard-Medium.otf'),
    'Pretendard-SemiBold': require('../../assets/fonts/Pretendard-SemiBold.otf'),
  });
  return loaded;
}
