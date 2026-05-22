/**
 * Type-level + runtime contract test for
 * `apps/mobile/src/contracts/post-payment-views.ts` (AC 12).
 *
 * Verifies that the four per-screen TS slice types (`DiagnosisView`,
 * `EditView`, `GuideView`, `CurationView`) plus the closed `Season`
 * union:
 *
 *   1. Match the exact shapes called out in the AC 12 ontology
 *      (camelCase translation of the Pythonic snake_case notation
 *      retained — see the docblock in `post-payment-views.ts`).
 *   2. Are `readonly` end-to-end (including the nested `tiles` and
 *      `items` collections).
 *   3. Are NOT a 1:1 mirror of the Python `ContentPackage` shape.
 *      Specifically:
 *        - There is no top-level "bundle" type that nests all four
 *          slices under a single parent `season`. The four slice
 *          payloads are independent and each carries its own `season`
 *          (per Seed constraint: "4 hooks ... fully independent —
 *          one hook's change must not affect the others").
 *        - `EditView` does NOT expose the Python `PipelineResult`
 *          fields (raw image bytes, latency, pipeline status).
 *        - `GuideTile` does NOT expose the Python `Guide.category` enum
 *          / `palette` tuple — the screen never branches on them.
 *        - `CurationItem` does NOT expose the Python `kind` /
 *          `tone` enums / editor signature metadata — collapsed into
 *          free strings at the client boundary.
 *   4. Reject `string` widening on the `Season` slug union.
 *
 * Strategy is the established pattern from
 * `apps/mobile/tests/funnel-state-contract.test.ts`:
 *   - Type-level `Equal<A, B>` / `Expect<...>` assertions force a
 *     compile error if any field, modifier, or shape drifts.
 *   - Vitest runs the file so the assertion tuple is exercised at
 *     runtime, preventing tree-shaking elision and making `pnpm test`
 *     a single gate for both `tsc` and runtime failures.
 */
import { describe, expect, it } from 'vitest';

import type {
  CurationItem,
  CurationView,
  DiagnosisView,
  EditView,
  GuideTile,
  GuideView,
  Season,
} from '../src/contracts/post-payment-views';

// ---------------------------------------------------------------------------
// Tiny type-level assertion helpers — vendored to avoid a new dep, matching
// the precedent set in `funnel-state-contract.test.ts`.
//
// `Equal<A, B>` resolves to `true` iff `A` and `B` are structurally
// identical from TypeScript's perspective (including readonly modifiers
// and exact optional shapes). Wrapping it in `Expect<T extends true ?
// true : never>` turns a mismatch into a compile error at the call site
// so test failures surface during `tsc --noEmit` (typecheck) rather than
// only at runtime.
// ---------------------------------------------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// 1. Season — exact closed union of the four slugs
// ---------------------------------------------------------------------------

type _Season_IsExactUnion = Expect<
  Equal<Season, 'spring-warm' | 'summer-cool' | 'autumn-warm' | 'winter-cool'>
>;

// The union must not collapse to `string`. If a future edit accidentally
// widens the type to `string` this assertion fails to compile.
type _Season_RejectsArbitraryString = Expect<
  Equal<string extends Season ? true : false, false>
>;

// Negative compile guard: a stray slug must NOT be assignable to Season.
// We assert via `Extract<...>` that no extra members slipped in.
type _Season_NoExtraMembers = Expect<
  Equal<
    Extract<Season, 'neutral' | 'unknown' | 'spring' | 'summer'>,
    never
  >
>;

// ---------------------------------------------------------------------------
// 2. DiagnosisView — exact shape per AC 12 ontology, all readonly
// ---------------------------------------------------------------------------

type _DiagnosisView_IsExactShape = Expect<
  Equal<
    DiagnosisView,
    {
      readonly season: Season;
      readonly koreanLabel: string;
      readonly confidence: number;
      readonly toneLabel: string;
      readonly contrastLabel: string;
      // Phase 3.4 wording slice
      readonly categoryLine: string;
    }
  >
>;

// readonly modifier guard (same trick as the funnel-state-contract test)
type MutableDiagnosisView = {
  season: Season;
  koreanLabel: string;
  confidence: number;
  toneLabel: string;
  contrastLabel: string;
  categoryLine: string;
};
type _DiagnosisView_IsReadonly = Expect<
  Equal<Equal<MutableDiagnosisView, DiagnosisView>, false>
>;

// ---------------------------------------------------------------------------
// 3. EditView — exact shape per AC 12 ontology, all readonly
//    Deliberately excludes Python `PipelineResult` fields:
//      - editedImageBytes / imageBytes / bytes  ← server-internal
//      - latencyMs / latency                    ← server-internal
//      - pipelineStatus / status                ← server-internal
// ---------------------------------------------------------------------------

type _EditView_IsExactShape = Expect<
  Equal<
    EditView,
    {
      readonly season: Season;
      readonly previewImageUrl: string;
      readonly caption: string;
      readonly vendorName: string;
      // Phase 3.4 wording slice
      readonly categoryLine: string;
      readonly ctaMicrocopy: string;
    }
  >
>;

type MutableEditView = {
  season: Season;
  previewImageUrl: string;
  caption: string;
  vendorName: string;
  categoryLine: string;
  ctaMicrocopy: string;
};
type _EditView_IsReadonly = Expect<
  Equal<Equal<MutableEditView, EditView>, false>
>;

// Negative compile guards — these Python-only field names must NOT exist
// on the TS EditView (deliberate divergence from `PipelineResult`).
type _EditView_NoBytesField = Expect<
  Equal<'bytes' extends keyof EditView ? true : false, false>
>;
type _EditView_NoLatencyField = Expect<
  Equal<'latencyMs' extends keyof EditView ? true : false, false>
>;
type _EditView_NoStatusField = Expect<
  Equal<'pipelineStatus' extends keyof EditView ? true : false, false>
>;

// ---------------------------------------------------------------------------
// 4. GuideView / GuideTile — exact shapes per AC 12 ontology
//    Deliberately excludes Python `Guide` fields:
//      - category (GuideCategory enum)  ← server-side spanning invariant
//      - palette  (tuple[str, ...])     ← Phase 4 concern
//      - summary                        ← collapsed into `body`
// ---------------------------------------------------------------------------

type _GuideTile_IsExactShape = Expect<
  Equal<
    GuideTile,
    {
      readonly id: string;
      readonly title: string;
      readonly body: string;
    }
  >
>;

type _GuideView_IsExactShape = Expect<
  Equal<
    GuideView,
    {
      readonly season: Season;
      readonly tiles: ReadonlyArray<GuideTile>;
      // Phase 3.4 wording slice
      readonly guideLines: ReadonlyArray<string>;
    }
  >
>;

type MutableGuideView = {
  season: Season;
  tiles: GuideTile[];
  guideLines: string[];
};
type _GuideView_IsReadonly = Expect<
  Equal<Equal<MutableGuideView, GuideView>, false>
>;

type _GuideTile_NoCategoryField = Expect<
  Equal<'category' extends keyof GuideTile ? true : false, false>
>;
type _GuideTile_NoPaletteField = Expect<
  Equal<'palette' extends keyof GuideTile ? true : false, false>
>;
type _GuideTile_NoSummaryField = Expect<
  Equal<'summary' extends keyof GuideTile ? true : false, false>
>;

// ---------------------------------------------------------------------------
// 5. CurationView / CurationItem — exact shapes per AC 12 ontology
//    Deliberately excludes Python `CurationItem` / `FirstCuration` fields:
//      - kind (CurationItemKind enum)   ← server-side spanning invariant
//      - tone (WordingTone enum)        ← collapsed into free `toneTag`
//      - editor_signature               ← Phase 4 concern
//      - mood_keywords                  ← Phase 4 concern
// ---------------------------------------------------------------------------

type _CurationItem_IsExactShape = Expect<
  Equal<
    CurationItem,
    {
      readonly id: string;
      readonly name: string;
      readonly blurb: string;
      readonly toneTag: string;
    }
  >
>;

type _CurationView_IsExactShape = Expect<
  Equal<
    CurationView,
    {
      readonly season: Season;
      readonly items: ReadonlyArray<CurationItem>;
      // Phase 3.4 wording slice
      readonly recommendationLines: ReadonlyArray<string>;
    }
  >
>;

type MutableCurationView = {
  season: Season;
  items: CurationItem[];
  recommendationLines: string[];
};
type _CurationView_IsReadonly = Expect<
  Equal<Equal<MutableCurationView, CurationView>, false>
>;

type _CurationItem_NoKindField = Expect<
  Equal<'kind' extends keyof CurationItem ? true : false, false>
>;
type _CurationItem_NoToneEnumField = Expect<
  Equal<'tone' extends keyof CurationItem ? true : false, false>
>;
type _CurationItem_NoEditorSignatureField = Expect<
  Equal<'editorSignature' extends keyof CurationItem ? true : false, false>
>;
type _CurationItem_NoMoodKeywordsField = Expect<
  Equal<'moodKeywords' extends keyof CurationItem ? true : false, false>
>;

// ---------------------------------------------------------------------------
// 6. AC 12 core invariant: the four slice types are NOT a 1:1 mirror of
//    the Python `ContentPackage`.
//
//    The Python shape is a single nested object:
//
//        ContentPackage {
//          diagnosis:    DiagnosisResult,
//          edited_image: PipelineResult,
//          guides:       tuple[Guide, ...],
//          curations:    FirstCuration,
//        }
//
//    The TS contract intentionally has NO equivalent top-level bundle
//    type. The four slice types are siblings, each carrying its own
//    `season` field. We assert structurally that constructing the
//    Python-style bundle would not be structurally equal to any of the
//    four TS slices (drift detection: if anyone ever introduces a
//    PythonContentPackage-shaped TS type that bundles the four slices,
//    this assertion goes green and the AC 12 invariant is silently
//    broken).
// ---------------------------------------------------------------------------

type PythonContentPackageMirror = {
  readonly diagnosis: DiagnosisView;
  readonly editedImage: EditView;
  readonly guides: ReadonlyArray<GuideTile>;
  readonly curations: CurationView;
};

// Each individual slice must NOT equal the bundle shape. (If they did,
// the slice would have been collapsed into a 1:1 mirror — which AC 12
// forbids.)
type _DiagnosisView_IsNotBundleMirror = Expect<
  Equal<Equal<DiagnosisView, PythonContentPackageMirror>, false>
>;
type _EditView_IsNotBundleMirror = Expect<
  Equal<Equal<EditView, PythonContentPackageMirror>, false>
>;
type _GuideView_IsNotBundleMirror = Expect<
  Equal<Equal<GuideView, PythonContentPackageMirror>, false>
>;
type _CurationView_IsNotBundleMirror = Expect<
  Equal<Equal<CurationView, PythonContentPackageMirror>, false>
>;

// Each TS slice carries its own `season` field — a cardinal AC 12
// invariant ("each hook returns its own season; the Tone Switcher keeps
// them aligned via ToneState.current, not via a shared parent field").
type _DiagnosisView_HasOwnSeason = Expect<
  Equal<DiagnosisView['season'], Season>
>;
type _EditView_HasOwnSeason = Expect<Equal<EditView['season'], Season>>;
type _GuideView_HasOwnSeason = Expect<Equal<GuideView['season'], Season>>;
type _CurationView_HasOwnSeason = Expect<Equal<CurationView['season'], Season>>;

// ---------------------------------------------------------------------------
// 7. Reference every type-level assertion so it participates in `tsc`.
//    Each `Expect<...>` resolves to `true` at the type level; assigning
//    a `true` literal to the tuple keeps the symbols live.
// ---------------------------------------------------------------------------

const _typeAssertions: readonly [
  _Season_IsExactUnion,
  _Season_RejectsArbitraryString,
  _Season_NoExtraMembers,
  _DiagnosisView_IsExactShape,
  _DiagnosisView_IsReadonly,
  _EditView_IsExactShape,
  _EditView_IsReadonly,
  _EditView_NoBytesField,
  _EditView_NoLatencyField,
  _EditView_NoStatusField,
  _GuideTile_IsExactShape,
  _GuideView_IsExactShape,
  _GuideView_IsReadonly,
  _GuideTile_NoCategoryField,
  _GuideTile_NoPaletteField,
  _GuideTile_NoSummaryField,
  _CurationItem_IsExactShape,
  _CurationView_IsExactShape,
  _CurationView_IsReadonly,
  _CurationItem_NoKindField,
  _CurationItem_NoToneEnumField,
  _CurationItem_NoEditorSignatureField,
  _CurationItem_NoMoodKeywordsField,
  _DiagnosisView_IsNotBundleMirror,
  _EditView_IsNotBundleMirror,
  _GuideView_IsNotBundleMirror,
  _CurationView_IsNotBundleMirror,
  _DiagnosisView_HasOwnSeason,
  _EditView_HasOwnSeason,
  _GuideView_HasOwnSeason,
  _CurationView_HasOwnSeason,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

// ---------------------------------------------------------------------------
// 8. Runtime sanity — construct one instance of each slice and verify the
//    fields are exactly what the AC 12 ontology calls out. This guards
//    against accidental field renames that `tsc` might miss if a sibling
//    type drifts in lockstep with the slice.
// ---------------------------------------------------------------------------

describe('PostPaymentViews contract (AC 12)', () => {
  it('keeps the type-level assertions alive (compile-time gate)', () => {
    expect(_typeAssertions).toHaveLength(31);
    for (const flag of _typeAssertions) {
      expect(flag).toBe(true);
    }
  });

  it('Season enumerates exactly the four Korean personal-color slugs', () => {
    // We can't enumerate a TS literal union at runtime, but we can
    // exercise each member through a typed array — if anyone ever
    // removes one of the slugs from the union, this stops compiling
    // because the literal no longer narrows to `Season`.
    const allSeasons: readonly Season[] = [
      'spring-warm',
      'summer-cool',
      'autumn-warm',
      'winter-cool',
    ];
    expect(allSeasons).toHaveLength(4);
    expect(new Set(allSeasons).size).toBe(4);
  });

  it('constructs a DiagnosisView with exactly the declared fields (Phase 3.3 + Phase 3.4 categoryLine)', () => {
    const value: DiagnosisView = {
      season: 'summer-cool',
      koreanLabel: '여름쿨',
      confidence: 0.85,
      toneLabel: 'Cool',
      contrastLabel: 'Low',
      categoryLine: '당신은 여름 쿨톤입니다.',
    };
    expect(Object.keys(value).sort()).toEqual([
      'categoryLine',
      'confidence',
      'contrastLabel',
      'koreanLabel',
      'season',
      'toneLabel',
    ]);
    expect(value.season).toBe('summer-cool');
    expect(value.confidence).toBeGreaterThanOrEqual(0);
    expect(value.confidence).toBeLessThanOrEqual(1);
  });

  it('constructs an EditView with exactly the declared fields (Phase 3.3 + Phase 3.4 categoryLine + ctaMicrocopy)', () => {
    const value: EditView = {
      season: 'summer-cool',
      previewImageUrl: 'https://example.invalid/preview.jpg',
      caption: '여름쿨 톤으로 보정된 미리보기',
      vendorName: 'Fal.ai',
      categoryLine: '당신은 여름 쿨톤입니다.',
      ctaMicrocopy: '여름 쿨톤은 이렇게 편집하세요',
    };
    expect(Object.keys(value).sort()).toEqual([
      'caption',
      'categoryLine',
      'ctaMicrocopy',
      'previewImageUrl',
      'season',
      'vendorName',
    ]);
    // The deliberate Python-divergence fields are absent.
    expect(value).not.toHaveProperty('bytes');
    expect(value).not.toHaveProperty('latencyMs');
    expect(value).not.toHaveProperty('pipelineStatus');
  });

  it('constructs a GuideView with a non-empty readonly tile array and the Phase 3.4 guideLines slice', () => {
    const value: GuideView = {
      season: 'summer-cool',
      tiles: [
        { id: 'guide-1', title: '메이크업', body: '쿨톤 메이크업 팁…' },
        { id: 'guide-2', title: '코디', body: '쿨톤 코디 팁…' },
      ],
      guideLines: ['지1', '지2', '지3', '지4'],
    };
    expect(value.tiles.length).toBeGreaterThan(0);
    expect(value.guideLines.length).toBe(4);
    for (const tile of value.tiles) {
      expect(Object.keys(tile).sort()).toEqual(['body', 'id', 'title']);
      // The deliberate Python-divergence fields are absent.
      expect(tile).not.toHaveProperty('category');
      expect(tile).not.toHaveProperty('palette');
      expect(tile).not.toHaveProperty('summary');
    }
  });

  it('constructs a CurationView with exactly four items per the FirstCuration invariant + Phase 3.4 recommendationLines slice', () => {
    const value: CurationView = {
      season: 'summer-cool',
      items: [
        {
          id: 'cur-1',
          name: '쿨톤 룩 1',
          blurb: '다정한 톤의 추천',
          toneTag: '다정한',
        },
        {
          id: 'cur-2',
          name: '쿨톤 룩 2',
          blurb: '에디토리얼 톤의 추천',
          toneTag: '에디토리얼',
        },
        {
          id: 'cur-3',
          name: '쿨톤 룩 3',
          blurb: '유쾌한 톤의 추천',
          toneTag: '유쾌한',
        },
        {
          id: 'cur-4',
          name: '시적인 톤의 추천',
          blurb: '시적인 톤의 추천',
          toneTag: '시적인',
        },
      ],
      recommendationLines: [
        '헤드라인',
        '에디터 한 줄',
        '(다정한) 메이크업 룩 · 1 — 블러브',
        '(에디토리얼) 코디 픽 · 2 — 블러브',
        '(유쾌한) 촬영 씬 · 3 — 블러브',
        '(시적인) 편집 프리셋 · 4 — 블러브',
      ],
    };
    expect(value.items).toHaveLength(4);
    expect(value.recommendationLines.length).toBeGreaterThanOrEqual(6);
    for (const item of value.items) {
      expect(Object.keys(item).sort()).toEqual([
        'blurb',
        'id',
        'name',
        'toneTag',
      ]);
      // The deliberate Python-divergence fields are absent.
      expect(item).not.toHaveProperty('kind');
      expect(item).not.toHaveProperty('tone');
      expect(item).not.toHaveProperty('editorSignature');
      expect(item).not.toHaveProperty('moodKeywords');
    }
  });

  it('confirms each slice carries its own season field (no shared parent)', () => {
    // The AC 12 invariant — four slice payloads can carry DIFFERENT
    // seasons simultaneously while a tone-switch is in flight (a hook
    // refetches faster than another). Demonstrating this through a
    // runtime construction is the cheapest way to keep the invariant
    // observable in CI.
    const diagnosis: DiagnosisView = {
      season: 'summer-cool',
      koreanLabel: '여름쿨',
      confidence: 0.85,
      toneLabel: 'Cool',
      contrastLabel: 'Low',
      categoryLine: '당신은 여름 쿨톤입니다.',
    };
    const edit: EditView = {
      season: 'winter-cool',
      previewImageUrl: 'https://example.invalid/winter.jpg',
      caption: '겨울쿨 미리보기',
      vendorName: 'Fal.ai',
      categoryLine: '당신은 겨울 쿨톤입니다.',
      ctaMicrocopy: '겨울 쿨톤은 이렇게 편집하세요',
    };
    expect(diagnosis.season).not.toBe(edit.season);
    // Both are valid `Season` values — neither is a sub-field of a
    // parent bundle.
    expect(diagnosis.season).toBe('summer-cool');
    expect(edit.season).toBe('winter-cool');
  });
});
