/**
 * Vitest stub for `src/hooks/use-app-fonts`.
 *
 * The real hook imports `expo-font` (which transitively pulls in
 * `react-native`'s Flow `import typeof` syntax vite/rollup cannot parse) and
 * `require()`s the Pretendard `*.otf` binaries (which vite tries to parse as
 * modules — "Invalid or unexpected token"). Both concerns are native /
 * Metro-only and irrelevant to the node render tests for `RootLayout`.
 *
 * `vitest.config.ts` aliases any `…/use-app-fonts` import to this stub so the
 * real module (and its native imports) never loads. The stub reports fonts as
 * loaded, which is exactly the post-load state `RootLayout` renders in — so
 * the provider-wiring / Sentry / Superwall / step-capture assertions exercise
 * the real rendered tree.
 */
export function useAppFonts(): boolean {
  return true;
}
