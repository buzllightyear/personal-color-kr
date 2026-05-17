/**
 * Public exports — `superwall` module.
 *
 * Phase 1.2 scope: regex validation for the SUPERWALL_API_KEY env var
 * only.  The superwall-react-native SDK is intentionally NOT imported
 * here — that install is deferred to Phase 2.5 when a custom Expo dev
 * client lands.
 *
 * Keep this file as a pure re-export barrel — coverage config excludes
 * `src/{star}{star}/index.ts` so behavioural code lives in sibling
 * modules.
 */
export {
  SUPERWALL_API_KEY_PATTERN,
  SuperwallApiKeyError,
  assertValidSuperwallApiKey,
  isValidSuperwallApiKey,
  type SuperwallApiKey,
  type SuperwallApiKeyErrorReason,
} from './key.js';
