# docs/design-system — Claude Design source cards

HTML **preview cards** for the editorial / VSCO design system, synced to the
team's **claude.ai/design** project ("Design System") via `/design-sync` so
Claude Design produces on-brand work using our real tokens + components.

Each `*.html` is a self-contained preview whose **first line** is a
`<!-- @dsCard group="…" -->` marker — the Design System pane indexes cards by
that group. Tokens mirror `docs/DESIGN.md` and `apps/mobile/src/theme/editorial.ts`
(INK + FONT) / `colors.ts` (season accents); **when they disagree, the code
wins** — update these cards to match.

## Cards

| Group | File | Shows |
|---|---|---|
| Colors | `colors/ink-ramp.html` | Monochrome ink ramp (6) — all chrome |
| Colors | `colors/season-accents.html` | 4 season accents — reserved for the result swatch |
| Type | `type/scale.html` | Pretendard scale (headline/subhead/body/label/caption) |
| Components | `components/primary-button.html` | Flat dark CTA bar (default/pressed/disabled) + text skip |
| Components | `components/headline.html` | Funnel headline + subhead group |
| Components | `components/season-result-swatch.html` | The one color moment — diagnosed category card |
| Foundations | `foundations/shape-spacing.html` | radius 2, hairline, spacing scale |

## Sync

These are pushed with the `DesignSync` tool (`/design-sync`) to the claude.ai/design
project `Design System` (`6b28f2de-ad99-4ee1-88a2-2fd2709ed314`). Edit a card,
re-run the sync (incremental — one component at a time, never wholesale replace).

Preview locally like any static file: `python3 -m http.server` from this dir.
