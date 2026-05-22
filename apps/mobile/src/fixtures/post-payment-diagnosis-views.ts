/**
 * Per-season DiagnosisView fixtures (Phase 3.3 Sub-AC 9 — Tone Switcher
 * re-selects across all 4 seasons so the diagnosis tab needs a payload
 * for every Season, not just the diagnosis default).
 *
 * Phase 3.4 — extended with the wording slice `categoryLine` drawn from
 * `apps/mobile/src/wording/result-wording-catalog.ts`. The visible
 * WordingTone prefix surface is deliberately localized to the curation
 * screen; this slice carries only the 분류 verdict line.
 */
import type { DiagnosisView, Season } from '../contracts/post-payment-views';
import { RESULT_WORDING_CATALOG } from '../wording/result-wording-catalog';

export const DIAGNOSIS_VIEWS: Readonly<Record<Season, DiagnosisView>> = {
  'spring-warm': {
    season: 'spring-warm',
    koreanLabel: '봄웜',
    confidence: 0.82,
    toneLabel: '웜톤',
    contrastLabel: '저대비',
    categoryLine: RESULT_WORDING_CATALOG['spring-warm'].categoryLine,
  },
  'summer-cool': {
    season: 'summer-cool',
    koreanLabel: '여름쿨',
    confidence: 0.85,
    toneLabel: '쿨톤',
    contrastLabel: '저대비',
    categoryLine: RESULT_WORDING_CATALOG['summer-cool'].categoryLine,
  },
  'autumn-warm': {
    season: 'autumn-warm',
    koreanLabel: '가을웜',
    confidence: 0.84,
    toneLabel: '웜톤',
    contrastLabel: '고대비',
    categoryLine: RESULT_WORDING_CATALOG['autumn-warm'].categoryLine,
  },
  'winter-cool': {
    season: 'winter-cool',
    koreanLabel: '겨울쿨',
    confidence: 0.88,
    toneLabel: '쿨톤',
    contrastLabel: '고대비',
    categoryLine: RESULT_WORDING_CATALOG['winter-cool'].categoryLine,
  },
};
