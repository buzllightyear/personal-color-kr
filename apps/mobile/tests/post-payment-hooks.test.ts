/**
 * Unit tests — 4 per-screen data hooks (Phase 3.3 Sub-AC 11).
 *
 *   useDiagnosisContent(season) → DataHook<DiagnosisView>
 *   useEditContent(season)      → DataHook<EditView>
 *   useGuideContent(season)     → DataHook<GuideView>
 *   useCurationContent(season)  → DataHook<CurationView>
 *
 * What's verified:
 *   1. Each hook returns DataHook<T> with state==='ready' for a known
 *      Season (the fixture-backed happy path).
 *   2. Each hook resolves to the season-keyed slice from its fixture.
 *   3. Hooks are independent — calling one with a Season does not affect
 *      another hook's result (independence is the AC, the deeper
 *      compile-time enforcement is in `post-payment-hook-independence.test.ts`).
 *
 * Why we exercise the hook with `renderHook` from @testing-library/react:
 *   Each hook uses `useMemo` via `useDummy`, which only works inside a
 *   React render cycle. `renderHook` provides a minimal render harness.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react-native';

import { useCurationContent } from '../src/hooks/use-curation-content';
import { useDiagnosisContent } from '../src/hooks/use-diagnosis-content';
import { useEditContent } from '../src/hooks/use-edit-content';
import { useGuideContent } from '../src/hooks/use-guide-content';
import { CURATION_VIEWS } from '../src/fixtures/post-payment-curation-views';
import { DIAGNOSIS_VIEWS } from '../src/fixtures/post-payment-diagnosis-views';
import { EDIT_VIEWS } from '../src/fixtures/post-payment-edit-views';
import { GUIDE_VIEWS } from '../src/fixtures/post-payment-guide-views';
import type { Season } from '../src/contracts/post-payment-views';

const ALL_SEASONS: readonly Season[] = [
  'spring-warm',
  'summer-cool',
  'autumn-warm',
  'winter-cool',
];

describe('useDiagnosisContent', () => {
  it.each(ALL_SEASONS)('returns ready DataHook<DiagnosisView> for %s', (s) => {
    const { result } = renderHook(() => useDiagnosisContent(s));
    expect(result.current.state).toBe('ready');
    expect(result.current.data).toBe(DIAGNOSIS_VIEWS[s]);
  });
});

describe('useEditContent', () => {
  it.each(ALL_SEASONS)('returns ready DataHook<EditView> for %s', (s) => {
    const { result } = renderHook(() => useEditContent(s));
    expect(result.current.state).toBe('ready');
    expect(result.current.data).toBe(EDIT_VIEWS[s]);
  });
});

describe('useGuideContent', () => {
  it.each(ALL_SEASONS)('returns ready DataHook<GuideView> for %s', (s) => {
    const { result } = renderHook(() => useGuideContent(s));
    expect(result.current.state).toBe('ready');
    expect(result.current.data).toBe(GUIDE_VIEWS[s]);
    expect(result.current.data?.tiles.length).toBeGreaterThan(0);
  });
});

describe('useCurationContent', () => {
  it.each(ALL_SEASONS)('returns ready DataHook<CurationView> for %s', (s) => {
    const { result } = renderHook(() => useCurationContent(s));
    expect(result.current.state).toBe('ready');
    expect(result.current.data).toBe(CURATION_VIEWS[s]);
    expect(result.current.data?.items).toHaveLength(4);
  });
});

describe('hook independence (Sub-AC 11 — cross-coupling assertion)', () => {
  it('changing the Season passed to one hook does not affect another hook called separately', () => {
    const diag = renderHook(() => useDiagnosisContent('spring-warm')).result
      .current;
    const edit = renderHook(() => useEditContent('winter-cool')).result.current;

    expect(diag.data?.season).toBe('spring-warm');
    expect(edit.data?.season).toBe('winter-cool');
  });
});
