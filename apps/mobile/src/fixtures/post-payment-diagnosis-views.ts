/**
 * Per-season DiagnosisView fixtures (Phase 3.3 Sub-AC 9 — Tone Switcher
 * re-selects across all 4 seasons so the diagnosis tab needs a payload
 * for every Season, not just the diagnosis default).
 */
import type { DiagnosisView, Season } from '../contracts/post-payment-views';

export const DIAGNOSIS_VIEWS: Readonly<Record<Season, DiagnosisView>> = {
  'spring-warm': {
    season: 'spring-warm',
    koreanLabel: '봄웜',
    confidence: 0.82,
    toneLabel: '웜톤',
    contrastLabel: '저대비',
  },
  'summer-cool': {
    season: 'summer-cool',
    koreanLabel: '여름쿨',
    confidence: 0.85,
    toneLabel: '쿨톤',
    contrastLabel: '저대비',
  },
  'autumn-warm': {
    season: 'autumn-warm',
    koreanLabel: '가을웜',
    confidence: 0.84,
    toneLabel: '웜톤',
    contrastLabel: '고대비',
  },
  'winter-cool': {
    season: 'winter-cool',
    koreanLabel: '겨울쿨',
    confidence: 0.88,
    toneLabel: '쿨톤',
    contrastLabel: '고대비',
  },
};
