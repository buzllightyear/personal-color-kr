/**
 * Per-season GuideView fixtures (Phase 3.3 Sub-AC 9). Non-empty tile
 * array per the Python `guides: tuple[Guide, ...]` invariant.
 *
 * Phase 3.4 — extended with the wording slice `guideLines` (exactly 4
 * Korean lines per season in makeup → outfit → hair → accessory order)
 * drawn from `apps/mobile/src/wording/result-wording-catalog.ts`.
 */
import type { GuideView, Season } from '../contracts/post-payment-views';
import { RESULT_WORDING_CATALOG } from '../wording/result-wording-catalog';

function tiles(season: Season): GuideView['tiles'] {
  return [
    {
      id: `${season}-makeup`,
      title: '메이크업 가이드',
      body: `${season} 톤에 맞는 메이크업 색조와 발색 전략.`,
    },
    {
      id: `${season}-outfit`,
      title: '데일리 코디',
      body: `${season} 톤이 살아나는 데일리 아우터와 액세서리 매치.`,
    },
    {
      id: `${season}-hair`,
      title: '헤어 컬러',
      body: `${season} 톤을 보강하는 염색 톤과 펌 스타일 추천.`,
    },
    {
      id: `${season}-accessory`,
      title: '액세서리',
      body: `${season} 톤을 받쳐 주는 메탈/스톤/소재 가이드.`,
    },
  ];
}

export const GUIDE_VIEWS: Readonly<Record<Season, GuideView>> = {
  'spring-warm': {
    season: 'spring-warm',
    tiles: tiles('spring-warm'),
    guideLines: RESULT_WORDING_CATALOG['spring-warm'].guideLines,
  },
  'summer-cool': {
    season: 'summer-cool',
    tiles: tiles('summer-cool'),
    guideLines: RESULT_WORDING_CATALOG['summer-cool'].guideLines,
  },
  'autumn-warm': {
    season: 'autumn-warm',
    tiles: tiles('autumn-warm'),
    guideLines: RESULT_WORDING_CATALOG['autumn-warm'].guideLines,
  },
  'winter-cool': {
    season: 'winter-cool',
    tiles: tiles('winter-cool'),
    guideLines: RESULT_WORDING_CATALOG['winter-cool'].guideLines,
  },
};
