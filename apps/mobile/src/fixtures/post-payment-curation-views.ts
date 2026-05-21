/**
 * Per-season CurationView fixtures (Phase 3.3 Sub-AC 9). Exactly 4
 * items per season per the Python `FirstCuration` invariant.
 */
import type { CurationView, Season } from '../contracts/post-payment-views';

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
  'spring-warm': { season: 'spring-warm', items: items('spring-warm') },
  'summer-cool': { season: 'summer-cool', items: items('summer-cool') },
  'autumn-warm': { season: 'autumn-warm', items: items('autumn-warm') },
  'winter-cool': { season: 'winter-cool', items: items('winter-cool') },
};
