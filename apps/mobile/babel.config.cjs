/**
 * Babel config for the personal-color-kr mobile app (Expo SDK 51 + Expo Router).
 *
 * Using `.cjs` so this file stays CommonJS even though the repo-root
 * `package.json` declares `"type": "module"`. Babel/Metro require a sync
 * CommonJS export here.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
