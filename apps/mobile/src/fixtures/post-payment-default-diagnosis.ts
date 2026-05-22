/**
 * First-install default DiagnosisView fixture (Phase 3.3 Sub-AC 7).
 *
 * The post-payment shell needs a DiagnosisView the very first time the
 * user enters (post-payment), before any persistence has happened and
 * before the real Phase 4 funnel-derived diagnosis exists. This module
 * exports that deterministic seed.
 *
 * Why a fixture and not a runtime call:
 *   The Seed scopes Phase 3.3 to fixture/mock data — the real
 *   diagnose_personal_color() pipeline (Phase 3.2) is invoked only by
 *   the Phase 4 server. Phase 4 swap is hook-internal-only — the
 *   `useDiagnosisContent` hook switches from `useDummy` to `usePython`
 *   and the fixture import disappears with no screen-code change
 *   (`phase4_portability` evaluation principle).
 *
 * Why `summer-cool` as the canonical demo:
 *   No Korean personal-color survey shows a dominant season, so any
 *   pick is arbitrary. `summer-cool` (여름쿨) is a common Korean
 *   personal-color result and makes the demo + screenshots visually
 *   distinct from the funnel "scan-option" palette (which biases toward
 *   spring-warm in marketing assets). Pinning the demo here keeps QA
 *   screenshots and storybook captures reproducible.
 */
import type { DiagnosisView } from '../contracts/post-payment-views';
import { RESULT_WORDING_CATALOG } from '../wording/result-wording-catalog';

/**
 * Default diagnosis used on first-install. Used both:
 *   - as the diagnosis-reveal screen body until persistence lands; and
 *   - as the default tone source for the global ToneState atom (the
 *     `current` field is seeded from `defaultDiagnosis.season` on first
 *     install).
 *
 * Phase 3.4 — gains `categoryLine` from the wording catalog so the
 * first-install reveal carries the 분류 verdict line.
 */
export const DEFAULT_DIAGNOSIS: DiagnosisView = {
  season: 'summer-cool',
  koreanLabel: '여름쿨',
  confidence: 0.85,
  toneLabel: '쿨톤',
  contrastLabel: '저대비',
  categoryLine: RESULT_WORDING_CATALOG['summer-cool'].categoryLine,
};
