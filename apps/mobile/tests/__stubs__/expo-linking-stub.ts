/**
 * Vitest stub for `expo-linking`.
 *
 * Why this stub exists:
 *   `expo-linking`'s entry transitively imports `react-native`, whose
 *   `index.js` ships Flow's `import typeof` syntax that vite/rollup cannot
 *   parse in the node test environment (Metro normally strips it at build
 *   time — see `setup-rn-stub.ts` for the parallel rationale on the CJS
 *   `require('react-native')` path). Any test that renders a component which
 *   statically imports `expo-linking` (e.g. `app/_layout.tsx`, which mounts
 *   `useStashReferralCodeOnDeepLink`) would otherwise crash during module
 *   transform.
 *
 *   `vitest.config.ts` aliases `expo-linking` to this stub so the import
 *   resolves to a parseable, inert module. The funnel/stash logic that
 *   actually consumes a deep-link URL is unit-tested directly against
 *   `stashReferralCodeFromDeepLink` (no expo-linking needed), so the stub
 *   only has to satisfy the module-load + hook-call surface.
 *
 * Surface:
 *   - `useURL()` returns `null` — the "no inbound deep link" state, which is
 *     the correct default for the render tests (the stash hook no-ops on
 *     `null`). Tests that need a specific URL exercise the pure stash
 *     function directly instead of driving it through this hook.
 *   - `getInitialURL` / `addEventListener` / `createURL` / `parse` are inert
 *     stand-ins for the rest of the `expo-linking` surface so any future
 *     consumer loads without throwing.
 */

export function useURL(): string | null {
  return null;
}

export function getInitialURL(): Promise<string | null> {
  return Promise.resolve(null);
}

export function addEventListener(): { remove: () => void } {
  return { remove: (): void => undefined };
}

export function createURL(path: string): string {
  return path;
}

export function parse(url: string): { path: string | null; queryParams: Record<string, string> } {
  return { path: url, queryParams: {} };
}
