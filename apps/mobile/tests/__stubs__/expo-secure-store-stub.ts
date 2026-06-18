/**
 * Vitest stub for `expo-secure-store` (a native Keychain-backed module
 * vite/rollup cannot parse in the node test env).
 *
 * `src/storage/auth-token-storage.ts` imports `getItemAsync` / `setItemAsync` /
 * `deleteItemAsync` to persist the backend access token. The storage seam is
 * unit-tested through injected deps, so this stub only needs to make the import
 * resolve with inert, side-effect-free implementations.
 */
export async function getItemAsync(): Promise<string | null> {
  return null;
}

export async function setItemAsync(): Promise<void> {
  return undefined;
}

export async function deleteItemAsync(): Promise<void> {
  return undefined;
}
