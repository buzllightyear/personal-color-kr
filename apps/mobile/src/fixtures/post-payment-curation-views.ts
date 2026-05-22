/**
 * Per-season CurationView fixtures (Phase 3.3 Sub-AC 9). Exactly 4
 * items per season per the Python `FirstCuration` invariant.
 *
 * Phase 3.4 — extended with the wording slice `recommendationLines`
 * drawn from `apps/mobile/src/wording/result-wording-catalog.ts`. The
 * lines carry the visible WordingTone prefix
 * ("(다정한)/(에디토리얼)/(유쾌한)/(시적인) ...") that mirrors Python
 * `_format_recommendation_item` so the "톤 혼합" (4-voice mix)
 * invariant is visible on the curation tab.
 */
import type { CurationView, Season } from '../contracts/post-payment-views';
import { RESULT_WORDING_CATALOG } from '../wording/result-wording-catalog';

function items(season: Season): CurationView['items'] {
  return [
    {
      id: `${season}-look`,
      name: '메이크업 룩',
      blurb: `${season} 톤을 살리는 시그니처 메이크업 룩.`,
      toneTag: '에디토리얼',
    },
    {
      id: `${season}-outfit`,
      name: '오피스 아우터',
      blurb: `${season} 톤에 어울리는 단정한 오피스 아우터.`,
      toneTag: '미니멀',
    },
    {
      id: `${season}-scene`,
      name: '포토 씬',
      blurb: `${season} 톤이 가장 잘 드러나는 자연광 셀카 씬.`,
      toneTag: '자연광',
    },
    {
      id: `${season}-preset`,
      name: '편집 프리셋',
      blurb: `${season} 톤을 보존하는 사진 편집 프리셋.`,
      toneTag: '컬러그레이딩',
    },
  ];
}

export const CURATION_VIEWS: Readonly<Record<Season, CurationView>> = {
  'spring-warm': {
    season: 'spring-warm',
    items: items('spring-warm'),
    recommendationLines: RESULT_WORDING_CATALOG['spring-warm'].recommendationLines,
  },
  'summer-cool': {
    season: 'summer-cool',
    items: items('summer-cool'),
    recommendationLines: RESULT_WORDING_CATALOG['summer-cool'].recommendationLines,
  },
  'autumn-warm': {
    season: 'autumn-warm',
    items: items('autumn-warm'),
    recommendationLines: RESULT_WORDING_CATALOG['autumn-warm'].recommendationLines,
  },
  'winter-cool': {
    season: 'winter-cool',
    items: items('winter-cool'),
    recommendationLines: RESULT_WORDING_CATALOG['winter-cool'].recommendationLines,
  },
};
