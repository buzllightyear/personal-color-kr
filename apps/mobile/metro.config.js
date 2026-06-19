// Metro config for the pnpm monorepo.
//
// Without this, Metro (a) only watches apps/mobile, so it refuses to bundle the
// `core-ts` workspace package whose source lives in packages/core-ts/src, and
// (b) ignores package.json `exports`, so `core-ts/funnel` (mapped by core-ts's
// exports to ./src/funnel/index.ts) fails to resolve with
// "Unable to resolve module core-ts/funnel".
//
// The three settings below are the canonical Expo + pnpm monorepo setup:
//   - watchFolders: include the workspace root so files under packages/* are
//     inside Metro's watched graph and can be bundled.
//   - resolver.nodeModulesPaths: resolve from both the app's and the root's
//     node_modules (pnpm hoists shared deps to the root store).
//   - resolver.unstable_enablePackageExports: honor the `exports` map so
//     core-ts's subpath exports (./funnel, ./scan_option, ...) resolve to their
//     TypeScript sources (Metro transpiles .ts via Expo's default transformer).

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Extend (do NOT replace) Expo's default watchFolders so the monorepo root is
// watched in addition to whatever `getDefaultConfig` already registers. SDK 54's
// default config seeds watchFolders itself; clobbering it with a bare
// `[workspaceRoot]` drops those entries (flagged by `expo-doctor`).
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.unstable_enablePackageExports = true;

// core-ts is authored in TS-ESM style: relative imports carry explicit `.js`
// extensions (e.g. `from './types.js'`) that tsc/vitest map to the on-disk
// `.ts` source. Metro does NOT remap `.js`->`.ts`, so it fails with
// "Unable to resolve ./types.js from .../core-ts/src/funnel/index.ts". For a
// relative `.js` specifier, retry resolution without the extension first (so
// Metro's sourceExts finds the `.ts`), then fall back to the literal name so
// genuine `.js` files still resolve.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    (moduleName.startsWith('./') || moduleName.startsWith('../')) &&
    moduleName.endsWith('.js')
  ) {
    try {
      return context.resolveRequest(
        context,
        moduleName.slice(0, -'.js'.length),
        platform,
      );
    } catch {
      // fall through to the literal `.js` resolution below
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
