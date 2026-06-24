/**
 * `getApiBaseUrl()` — the single accessor for the FastAPI backend origin the
 * mobile client targets (Phase 4.5, referrals/me wiring).
 *
 * Why this module exists:
 *   The mobile app must issue real HTTP requests against the backend (e.g.
 *   `GET /v1/referrals/me` for the referral share URL). React Native's
 *   `fetch` cannot resolve relative URLs, so every request needs an absolute
 *   origin. Centralising the origin lookup here means there is exactly one
 *   import-site for "where is the API" — a future environment split
 *   (dev / staging / prod) changes one file rather than every call-site.
 *
 * Why `EXPO_PUBLIC_API_BASE_URL`:
 *   Expo inlines every `process.env.EXPO_PUBLIC_*` variable into the JS
 *   bundle at build time, so this is the idiomatic Expo way to surface a
 *   non-secret build-time constant to runtime code without touching
 *   `app.config.ts` / `expo.extra`. The base URL is NOT a secret (it is just
 *   the public API origin), so the `EXPO_PUBLIC_` channel is the correct one
 *   — unlike the Fal.ai key, which is deliberately kept server-side only.
 *
 * Defensive contract:
 *   When the variable is unset (a developer's local `.env` not yet populated,
 *   or vitest's node env without an Expo build), we return an empty string
 *   rather than throwing. A caller that builds a transport from an empty
 *   origin will simply fail its network call, which the referral share flow
 *   already treats as a silent, non-blocking degradation (the share gate is
 *   a soft gate — it must never crash the funnel). Live validation of the
 *   actual value is an integration / deployment concern, not this accessor's.
 *
 *   The returned value is trimmed of a single trailing slash so callers can
 *   uniformly append `'/v1/...'` paths without producing a double slash.
 */

/**
 * The Expo public env var carrying the backend origin (e.g.
 * `https://api.example.com`). `EXPO_PUBLIC_`-prefixed so Expo inlines it into
 * the runtime bundle.
 */
export const API_BASE_URL_ENV_KEY = 'EXPO_PUBLIC_API_BASE_URL' as const;

/**
 * Resolve the backend API origin from the environment.
 *
 * @returns the configured origin with any single trailing slash removed, or
 *   an empty string when the env var is unset / blank.
 */
export function getApiBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (raw === undefined || raw.length === 0) {
    return '';
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}
