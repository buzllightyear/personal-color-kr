/**
 * Per-season EditView fixtures (Phase 3.3 Sub-AC 9). Phase 4 swap
 * replaces the fixture lookup with a real Fal.ai pipeline output read
 * through `usePython<EditView>`.
 *
 * Phase 3.4 — extended with the wording slice `categoryLine` +
 * `ctaMicrocopy` drawn from
 * `apps/mobile/src/wording/result-wording-catalog.ts`. `ctaMicrocopy` is
 * derived per-season from the catalog (via `ctaMicrocopyFor`) — it does
 * NOT borrow from the curation `recommendationLines`, preserving
 * cross-tab independence.
 *
 * `previewImageUrl` uses placeholder image URLs; the Phase 3.3 shell
 * surface verifies the rendering shape only. Phase 4 wires real
 * vendor-edited previews.
 */
import type { EditView, Season } from '../contracts/post-payment-views';
import {
  ctaMicrocopyFor,
  RESULT_WORDING_CATALOG,
} from '../wording/result-wording-catalog';

export const EDIT_VIEWS: Readonly<Record<Season, EditView>> = {
  'spring-warm': {
    season: 'spring-warm',
    previewImageUrl: 'https://placeholder.invalid/preview/spring-warm.jpg',
    caption: '봄웜 톤에 어울리는 따스한 컬러 베이스의 편집 미리보기.',
    vendorName: 'Fal.ai',
    categoryLine: RESULT_WORDING_CATALOG['spring-warm'].categoryLine,
    ctaMicrocopy: ctaMicrocopyFor('spring-warm'),
  },
  'summer-cool': {
    season: 'summer-cool',
    previewImageUrl: 'https://placeholder.invalid/preview/summer-cool.jpg',
    caption: '여름쿨 톤에 어울리는 시원한 컬러 베이스의 편집 미리보기.',
    vendorName: 'Fal.ai',
    categoryLine: RESULT_WORDING_CATALOG['summer-cool'].categoryLine,
    ctaMicrocopy: ctaMicrocopyFor('summer-cool'),
  },
  'autumn-warm': {
    season: 'autumn-warm',
    previewImageUrl: 'https://placeholder.invalid/preview/autumn-warm.jpg',
    caption: '가을웜 톤에 어울리는 깊이 있는 컬러 베이스의 편집 미리보기.',
    vendorName: 'Fal.ai',
    categoryLine: RESULT_WORDING_CATALOG['autumn-warm'].categoryLine,
    ctaMicrocopy: ctaMicrocopyFor('autumn-warm'),
  },
  'winter-cool': {
    season: 'winter-cool',
    previewImageUrl: 'https://placeholder.invalid/preview/winter-cool.jpg',
    caption: '겨울쿨 톤에 어울리는 선명한 컬러 베이스의 편집 미리보기.',
    vendorName: 'Fal.ai',
    categoryLine: RESULT_WORDING_CATALOG['winter-cool'].categoryLine,
    ctaMicrocopy: ctaMicrocopyFor('winter-cool'),
  },
};
