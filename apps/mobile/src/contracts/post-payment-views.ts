/**
 * Per-screen TS slice types for the post-payment shell (AC 12).
 *
 * This module defines the four read-only data shapes that the four
 * post-payment tab screens consume — `DiagnosisView`, `EditView`,
 * `GuideView`, and `CurationView` — plus the closed `Season` enum that
 * keys them.
 *
 * The four types are the contract surface returned by the four independent
 * per-screen data hooks (`useDiagnosisContent`, `useEditContent`,
 * `useGuideContent`, `useCurationContent`) through the shared
 * `DataHook<T>` async boundary defined in `./data-hook.ts`. Each slice
 * type is `T` in `DataHook<T>` for exactly one hook; the hooks remain
 * independent (no shared `T`) so a change to one screen's shape never
 * cascades into another (Seed constraint: "4 hooks ... fully independent
 * — one hook's change must not affect the others; no shared state or
 * shared fixture object").
 *
 * --------------------------------------------------------------------------
 * Why these slice types are intentionally NOT a 1:1 mirror of the Python
 * `ContentPackage` shape (Seed constraint, AC 12 core invariant)
 * --------------------------------------------------------------------------
 *
 * The Python `content.post_payment_package.ContentPackage` value object
 * lives at `packages/core-python/src/content/post_payment_package.py` and
 * bundles four neighbouring value objects together with cross-field
 * coherence enforced in `__post_init__`:
 *
 *     ContentPackage = {
 *       diagnosis:    DiagnosisResult,      # Season + tone + contrast + confidence
 *       edited_image: PipelineResult,       # vendor bytes + latency + vendor name
 *       guides:       tuple[Guide, ...],    # 16-entry library slice keyed to season
 *       curations:    FirstCuration,        # 4-item package keyed to season
 *     }
 *
 * The Python object exists because the **server** is the single point at
 * which a freshly-completed payment is reconciled with a freshly-computed
 * diagnosis — that is the one moment where season coherence across the
 * four sub-objects can be enforced (the `__post_init__` block in
 * `post_payment_package.py` rejects any bundle whose `guides[i].season`
 * or `curations.season` differs from `diagnosis.season`).
 *
 * The **client**, by contrast, has a completely different responsibility:
 * it powers a persistent 4-tab surface with a global Tone Switcher that
 * lets the user freely re-select any of the four seasons after the initial
 * reveal (Seed goal: "global+persisted Tone Switcher across 4 seasonal
 * tones"). The moment the user taps "겨울쿨" while their diagnosis was
 * "여름쿨" the four tab payloads stop sharing a single season — they each
 * carry whatever season is currently in `ToneState.current`. Mirroring
 * the Python shape on the client would mean either:
 *
 *   (a) re-enforcing `__post_init__`-style cross-field coherence on every
 *       tone switch and rejecting the user's selection, which defeats the
 *       Tone Switcher's purpose, or
 *
 *   (b) carrying a redundant `season` field at the bundle level on top of
 *       the per-slice `season` field, which creates two sources of truth
 *       for "the currently displayed season" and invites drift bugs.
 *
 * Both are wrong. The correct boundary is:
 *
 *   - **Server (Python).** Coherence-enforced bundle. One `ContentPackage`
 *     per `(user, diagnosis)` pair. Built once at payment completion;
 *     never re-derived.
 *   - **Client (TypeScript).** Four independent per-tab slice payloads,
 *     each keyed by `season`. The currently displayed season comes from
 *     `ToneState.current` (the user's most recent Tone Switcher pick).
 *     Each per-screen hook returns only the fields its tab renders — no
 *     cross-tab data, no bundle-level wrapper, no `__post_init__`-style
 *     coherence checks (the server already guaranteed they exist for
 *     every season).
 *
 * This is why every slice type below carries its own `season` field
 * rather than referencing a shared parent season — each hook returns
 * the season *its own data is for*, and the Tone Switcher reads
 * `ToneState.current` to keep the four hooks pointed at the same
 * season when the user changes tones. The reverse coupling — a single
 * parent `season` cascading into four typed children — would be the
 * Python shape, and is exactly what AC 12 forbids.
 *
 * Three further consequences of the deliberate divergence (all
 * intentional, all called out in the Seed constraints):
 *
 *   1. **No `editedImage: { bytes, latencyMs, vendorName }` nested object.**
 *      The Python `PipelineResult` carries the actual edited image bytes
 *      plus latency telemetry — both of which are server-internal concerns
 *      that never reach the screen. The TS `EditView` carries only
 *      `previewImageUrl` (already-hosted URL fetched by the hook),
 *      `caption`, and `vendorName`. The latency / bytes / pipeline-status
 *      fields are stripped at the hook boundary.
 *
 *   2. **No `category` / `kind` enums on tiles or curation items.** Python
 *      `Guide.category` is `GuideCategory` (a 4-member enum:
 *      MAKEUP / OUTFIT / HAIR / ACCESSORY) and `CurationItem.kind` is
 *      `CurationItemKind` (a 4-member enum: MAKEUP_LOOK / OUTFIT_PICK /
 *      PHOTO_SCENE / EDITING_PRESET). These enums encode the *server-side*
 *      "the package must span all 4 surfaces" invariant. The screen never
 *      branches on them — it renders whatever tiles the hook returns in
 *      whatever order they arrive — so the enum is collapsed into a free
 *      `title` / `name` string at the client boundary. (`toneTag` on
 *      `CurationItem` is kept as a free string for the same reason the
 *      Python `WordingTone` is collapsed: the client only displays the
 *      label, never branches on the value.)
 *
 *   3. **No `confidence`-style cross-field invariants.** Python
 *      `DiagnosisResult` carries `confidence: float` *and* intermediate
 *      tone/contrast signals with cross-field guarantees (e.g. NEUTRAL
 *      tone is unreachable post-classification). The TS `DiagnosisView`
 *      carries `confidence: number` and pre-formatted `toneLabel` /
 *      `contrastLabel` strings — the intermediate classifier inputs
 *      never cross the network boundary, and the screen never re-derives
 *      the season from them. Confidence is in [0, 1] *by convention*
 *      (the hook is expected to honor that range), but the TS type does
 *      not enforce it at compile time — runtime fixture tests do.
 *
 * --------------------------------------------------------------------------
 * Why all fields are `readonly`
 * --------------------------------------------------------------------------
 *
 * The slice payloads are produced once by a data hook and then rendered
 * many times by React. A field reassignment from a memoized selector or
 * a logger would corrupt every subsequent render. The same pattern is
 * applied uniformly across the contracts/ folder:
 *
 *   - `DataHook<T>` returns `{ readonly state, readonly data }`.
 *   - `FunnelStateValue` and every nested slice are `readonly`
 *     end-to-end.
 *
 * Mirroring that here keeps the contracts/ folder structurally uniform
 * and lets the type-level `Equal<A, B>` assertions in the companion test
 * detect any accidental mutability regression.
 *
 * --------------------------------------------------------------------------
 * Why `ReadonlyArray<...>` (and not `tuple[Guide, ...]`)
 * --------------------------------------------------------------------------
 *
 * Python uses `tuple[Guide, ...]` to express "immutable, ordered,
 * variable-length collection". The TS-native shape for the same semantic
 * is `ReadonlyArray<T>`. The fixture-side count invariants
 * (`tiles.length >= 1`, `items.length === 4`) are enforced at the hook /
 * fixture boundary by runtime assertion, not at the type level — the
 * TS type system cannot express "tuple of exactly length 4" without
 * collapsing readability. The companion vitest fixture tests verify
 * the count invariants.
 *
 * --------------------------------------------------------------------------
 * Conventions
 * --------------------------------------------------------------------------
 *
 *   - **Field naming is camelCase**, matching every other type in
 *     `apps/mobile/src/contracts/` (e.g. `selfieEditStyle`,
 *     `selectedMethod`, `selfieUri`). The Seed ontology uses Pythonic
 *     `snake_case` field names purely as a notational shorthand for
 *     domain concepts; the TS contract translates them to camelCase to
 *     match the prevailing TS workspace style. There is no semantic
 *     change.
 *
 *   - **No re-export of Python types.** This file imports nothing from
 *     `packages/core-python`. The four slice types are TypeScript-native
 *     declarations that intentionally diverge from the Python shape;
 *     re-exporting would create the very 1:1 mirror that AC 12 forbids.
 *
 *   - **No runtime exports.** This module exposes types and the closed
 *     `Season` literal union only. Default / initial values for the
 *     four slice types live with the fixtures (Seed constraint: "First-
 *     install default diagnosis fixture — packages/core-ts (or
 *     apps/mobile/src/fixtures/post-payment-default-diagnosis.ts)
 *     exports a deterministic DiagnosisView fixture"), not here.
 */

// ---------------------------------------------------------------------------
// Season — closed enum of the four Korean personal-color seasons
//
// The bijection with the Python `Season` enum (봄 / 여름 / 가을 / 겨울) is
// expressed as a string-literal union of stable slugs. The slug shape
// (`<season>-<tone>`) lets the client both:
//
//   1. Key the four per-tab payloads (one Season per slice instance), and
//   2. Drive the Tone Switcher UI without a parallel mapping table — the
//      slug carries both the season and the warm/cool tone in a single
//      token so analytics events can ship a single normalised string.
//
// Adding a fifth value (e.g. a "neutral" branch) is a deliberate contract
// change that requires updating the Phase 3.1 _PRESET_TO_PROMPT bijection
// on the Python side as well — keeping the union closed at exactly four
// members makes that drift a compile error rather than a silent rendering
// bug.
// ---------------------------------------------------------------------------

/**
 * The four Korean personal-color seasons, as the closed slug union the
 * client uses end-to-end. Bijects with the Python `Season` enum in
 * `packages/core-python/src/personal_color/season_classifier.py`:
 *
 *   - `'spring-warm'` — 봄 (warm + high contrast)
 *   - `'summer-cool'` — 여름 (cool + low contrast)
 *   - `'autumn-warm'` — 가을 (warm + low contrast)
 *   - `'winter-cool'` — 겨울 (cool + high contrast)
 *
 * No `'neutral'` / `'unknown'` member by design. The Phase 3.2 diagnosis
 * runtime resolves edge cases server-side and always returns one of these
 * four values; an unresolved case raises before the package is ever built.
 */
export type Season =
  | 'spring-warm'
  | 'summer-cool'
  | 'autumn-warm'
  | 'winter-cool';

// ---------------------------------------------------------------------------
// DiagnosisView — per-season subset slice for the diagnosis tab
//
// The diagnosis tab shows the user "which season you are" with a confidence
// readout and the human-readable tone / contrast labels. It is *not* a
// re-render of the full Python `DiagnosisResult` — the classifier inputs
// (RGB samples, contrast deltas, threshold parameters) never cross the
// network boundary; only the labelled outcome does.
// ---------------------------------------------------------------------------

/**
 * Per-season payload for the diagnosis tab.
 *
 * Fields (per the AC 12 ontology):
 *   - `season`         — the season this payload describes.
 *   - `koreanLabel`    — pre-rendered Korean display label (e.g. "여름쿨").
 *                        Comes from the server so the client never has to
 *                        translate; an i18n change is a server-side concern.
 *   - `confidence`     — diagnosis confidence in [0, 1] (by convention; not
 *                        enforced at the TS type level — fixture tests
 *                        verify the range).
 *   - `toneLabel`      — pre-formatted warm / cool tone label, ready to
 *                        render.
 *   - `contrastLabel`  — pre-formatted high / low contrast label, ready to
 *                        render.
 *
 * Deliberately omitted relative to Python `DiagnosisResult`:
 *   - The intermediate `tone: Tone` / `contrast: Contrast` enums (the
 *     client renders the labels, never branches on the enum value).
 *   - The classifier inputs and threshold parameters (server-internal).
 *   - The `NEUTRAL`-tone fallback path (server always resolves a season).
 */
export type DiagnosisView = {
  readonly season: Season;
  readonly koreanLabel: string;
  readonly confidence: number;
  readonly toneLabel: string;
  readonly contrastLabel: string;
};

// ---------------------------------------------------------------------------
// EditView — per-season subset slice for the edit tab
//
// The edit tab shows the vendor-edited preview of the user's selfie tinted
// to match the currently selected season. It is *not* a re-render of the
// full Python `PipelineResult` — the actual image bytes, the wall-clock
// latency, and the pipeline-status flags never cross the network boundary;
// only the hosted preview URL and the surrounding presentation text do.
// ---------------------------------------------------------------------------

/**
 * Per-season payload for the edit tab.
 *
 * Fields (per the AC 12 ontology):
 *   - `season`           — the season this payload describes.
 *   - `previewImageUrl`  — already-hosted URL of the vendor-edited preview.
 *                          In Phase 3.3 this is a fixture URL; in Phase 4
 *                          the hook swaps to `usePython<EditView>` and the
 *                          URL is produced by the Fal.ai pipeline.
 *   - `caption`          — pre-rendered caption text describing the edit.
 *   - `vendorName`       — display name of the editing vendor (analytics +
 *                          attribution surface).
 *
 * Deliberately omitted relative to Python `PipelineResult`:
 *   - The raw edited image bytes (server-internal; the client always
 *     consumes a hosted URL, never inline base64).
 *   - The wall-clock latency telemetry (server-internal; logged on the
 *     server side, not rendered on the screen).
 *   - The pipeline-status enum (server-internal; the hook surfaces a
 *     `DataHook<EditView>` error state when the pipeline fails).
 */
export type EditView = {
  readonly season: Season;
  readonly previewImageUrl: string;
  readonly caption: string;
  readonly vendorName: string;
};

// ---------------------------------------------------------------------------
// GuideView — per-season subset slice for the guide tab
//
// The guide tab shows a grid of guide tiles for the currently selected
// season. The Seed ontology requires a non-empty tile array (parity with
// the Python `guides: tuple[Guide, ...]` non-empty invariant); the TS
// type system cannot express "non-empty array" without sacrificing
// readability, so the runtime invariant is enforced by the fixture-side
// tests and by the hook itself, not at the type level.
// ---------------------------------------------------------------------------

/**
 * A single guide tile rendered on the guide tab.
 *
 * Fields (per the AC 12 ontology):
 *   - `id`     — stable identifier for the tile (key in React, analytics
 *                ID in PostHog events).
 *   - `title`  — pre-rendered short headline.
 *   - `body`   — pre-rendered long-form body text (markdown-flavoured
 *                plain text; the screen does not parse it).
 *
 * Deliberately omitted relative to Python `Guide`:
 *   - The `category: GuideCategory` enum (MAKEUP / OUTFIT / HAIR /
 *     ACCESSORY) — encodes a *server-side* "package must span all 4
 *     surfaces" invariant; the screen renders whatever tiles arrive and
 *     never branches on category.
 *   - The `summary` field — collapsed into the start of `body` so the
 *     screen renders a single text block per tile.
 *   - The `palette: tuple[str, ...]` hex codes — palette rendering is a
 *     Phase 4 concern, not a Phase 3.3 shell concern.
 */
export type GuideTile = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
};

/**
 * Per-season payload for the guide tab.
 *
 * Fields (per the AC 12 ontology):
 *   - `season` — the season this payload describes.
 *   - `tiles`  — read-only array of `GuideTile` to render. Non-empty by
 *                runtime convention (fixture tests verify); the type
 *                does not enforce non-emptiness.
 */
export type GuideView = {
  readonly season: Season;
  readonly tiles: ReadonlyArray<GuideTile>;
};

// ---------------------------------------------------------------------------
// CurationView — per-season subset slice for the curation tab
//
// The curation tab shows the four hand-picked items for the currently
// selected season. The Python `FirstCuration` value object enforces a
// "exactly 4 items, one per WordingTone, one per CurationItemKind"
// invariant in `__post_init__`. The TS slice carries the four items as a
// `ReadonlyArray<CurationItem>` — the "exactly 4" count is verified by
// fixture-side tests, and the `kind` / `tone` enums are collapsed into a
// free `toneTag` string at the client boundary because the screen never
// branches on them (Seed ontology: "exactly 4 items per the Python
// FirstCuration invariant").
// ---------------------------------------------------------------------------

/**
 * A single curated item rendered on the curation tab.
 *
 * Fields (per the AC 12 ontology):
 *   - `id`       — stable identifier for the item (React key, analytics
 *                  ID).
 *   - `name`     — pre-rendered item name.
 *   - `blurb`    — pre-rendered short description (one to two sentences).
 *   - `toneTag`  — pre-rendered wording-tone label (e.g. "에디토리얼"). A
 *                  free string at the client boundary — the screen
 *                  displays it as-is and never branches on the value.
 *
 * Deliberately omitted relative to Python `CurationItem`:
 *   - The `kind: CurationItemKind` enum (MAKEUP_LOOK / OUTFIT_PICK /
 *     PHOTO_SCENE / EDITING_PRESET) — encodes a server-side "package
 *     must span all 4 surfaces" invariant; the screen never branches on
 *     it, so it is collapsed into the free `name` / `blurb` text.
 *   - The `tone: WordingTone` enum — collapsed into the free `toneTag`
 *     display string for the same reason.
 *   - The `editor_signature` and `mood_keywords` server-side metadata —
 *     a Phase 4 concern (creator-signature surface), not a Phase 3.3
 *     shell concern.
 */
export type CurationItem = {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly toneTag: string;
};

/**
 * Per-season payload for the curation tab.
 *
 * Fields (per the AC 12 ontology):
 *   - `season` — the season this payload describes.
 *   - `items`  — read-only array of `CurationItem` to render. Exactly
 *                four by runtime convention (fixture tests verify the
 *                length); the type does not enforce the count.
 */
export type CurationView = {
  readonly season: Season;
  readonly items: ReadonlyArray<CurationItem>;
};
