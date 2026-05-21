/**
 * Per-season GuideView fixtures (Phase 3.3 Sub-AC 9). Non-empty tile
 * array per the Python `guides: tuple[Guide, ...]` invariant.
 */
import type { GuideView, Season } from '../contracts/post-payment-views';

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
  'spring-warm': { season: 'spring-warm', tiles: tiles('spring-warm') },
  'summer-cool': { season: 'summer-cool', tiles: tiles('summer-cool') },
  'autumn-warm': { season: 'autumn-warm', tiles: tiles('autumn-warm') },
  'winter-cool': { season: 'winter-cool', tiles: tiles('winter-cool') },
};
