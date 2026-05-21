/**
 * Per-season EditView fixtures (Phase 3.3 Sub-AC 9). Phase 4 swap
 * replaces the fixture lookup with a real Fal.ai pipeline output read
 * through `usePython<EditView>`.
 *
 * `previewImageUrl` uses placeholder image URLs; the Phase 3.3 shell
 * surface verifies the rendering shape only. Phase 4 wires real
 * vendor-edited previews.
 */
import type { EditView, Season } from '../contracts/post-payment-views';

export const EDIT_VIEWS: Readonly<Record<Season, EditView>> = {
  'spring-warm': {
    season: 'spring-warm',
    previewImageUrl: 'https://placeholder.invalid/preview/spring-warm.jpg',
    caption: '봄웜 톤에 어울리는 따스한 컬러 베이스의 편집 미리보기.',
    vendorName: 'Fal.ai',
  },
  'summer-cool': {
    season: 'summer-cool',
    previewImageUrl: 'https://placeholder.invalid/preview/summer-cool.jpg',
    caption: '여름쿨 톤에 어울리는 시원한 컬러 베이스의 편집 미리보기.',
    vendorName: 'Fal.ai',
  },
  'autumn-warm': {
    season: 'autumn-warm',
    previewImageUrl: 'https://placeholder.invalid/preview/autumn-warm.jpg',
    caption: '가을웜 톤에 어울리는 깊이 있는 컬러 베이스의 편집 미리보기.',
    vendorName: 'Fal.ai',
  },
  'winter-cool': {
    season: 'winter-cool',
    previewImageUrl: 'https://placeholder.invalid/preview/winter-cool.jpg',
    caption: '겨울쿨 톤에 어울리는 선명한 컬러 베이스의 편집 미리보기.',
    vendorName: 'Fal.ai',
  },
};
