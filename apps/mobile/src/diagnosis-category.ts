/**
 * `diagnosis-category.ts` — localized (Korean) presentation of a diagnosed
 * personal-color category.
 *
 * The backend returns the diagnosis as machine enums (`season`, `tone`); the
 * `result_reveal` screen needs the human-facing Korean label ("가을 웜톤") and
 * the full headline ("당신의 카테고리는 ✦ 가을 웜톤 ✦"). This module owns that
 * machine-enum → Korean-copy mapping so the screen stays a pure presentation
 * layer and the copy lives in one auditable place.
 *
 * Why the app layer (not core-ts FUNNEL_SCREENS):
 *   The legacy `FUNNEL_SCREENS.result_reveal.headline` is a *static* hardcoded
 *   "가을 웜톤" teaser, frozen by core-ts contract tests. Rather than mutate
 *   that frozen contract, the app overrides the headline at render time from
 *   the live diagnosis result and falls back to the static copy when no
 *   result is present (no token / no selfie / call still pending). This module
 *   is the app-layer source of truth for that override.
 *
 * Korean copy is hardcoded per the project convention ("Korean text hardcoded
 * — no i18n").
 */
import type { Season, Tone } from './request-diagnosis';

/** Season enum → Korean noun. */
export const SEASON_KOREAN: Readonly<Record<Season, string>> = Object.freeze({
  spring: '봄',
  summer: '여름',
  autumn: '가을',
  winter: '겨울',
});

/** Tone enum → Korean "웜톤"/"쿨톤" label. */
export const TONE_KOREAN: Readonly<Record<Tone, string>> = Object.freeze({
  warm: '웜톤',
  cool: '쿨톤',
});

/**
 * Format the diagnosed category as the Korean label, e.g.
 * `('autumn', 'warm') → "가을 웜톤"`. This is the same string shape the legacy
 * static teaser used, so it slots into the existing headline verbatim.
 */
export function formatCategoryKorean(season: Season, tone: Tone): string {
  return `${SEASON_KOREAN[season]} ${TONE_KOREAN[tone]}`;
}

/**
 * The decorative wrapper applied to the category label in the result headline.
 * Matches the legacy static headline "당신의 카테고리는 ✦ 가을 웜톤 ✦" so the
 * dynamic and fallback branches render identically apart from the category.
 */
export const RESULT_HEADLINE_PREFIX = '당신의 카테고리는 ✦ ' as const;
export const RESULT_HEADLINE_SUFFIX = ' ✦' as const;

/**
 * Build the full `result_reveal` headline from a diagnosed season + tone, e.g.
 * `('autumn', 'warm') → "당신의 카테고리는 ✦ 가을 웜톤 ✦"`.
 */
export function buildResultHeadline(season: Season, tone: Tone): string {
  return `${RESULT_HEADLINE_PREFIX}${formatCategoryKorean(season, tone)}${RESULT_HEADLINE_SUFFIX}`;
}
