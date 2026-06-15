---
# DESIGN.md — machine-readable design tokens for the personal-color-kr mobile app.
#
# Source of truth: apps/mobile/src/theme/ (editorial.ts = INK + FONT; colors.ts =
# season accents; spacing.ts = SPACING). This file MIRRORS those tokens for human
# + agent consumption — when they disagree, the code wins; update this file to match.
#
# Format inspired by github.com/google-labs-code/design.md.
name: personal-color-kr
direction: Editorial / VSCO — monochrome, type-led, built on negative space.

colors:
  # Monochrome ink ramp (apps/mobile/src/theme/editorial.ts → INK). Chrome is built
  # almost entirely from these.
  ink:
    primary: "#1A1A1A"   # headlines, flat CTA fill, primary text
    muted:   "#8A8A8A"   # subheads, secondary text, captions
    faint:   "#B8B8B8"   # tertiary text, placeholders, disabled fills
    line:    "#E8E8E8"   # hairline dividers, outlines
    wash:    "#F4F4F4"   # subtle neutral fill (inputs, cards)
    paper:   "#FFFFFF"   # surface / background, label on dark CTA
  # Season accents (apps/mobile/src/theme/colors.ts → COLORS.season). RESERVED for
  # genuinely color-bearing moments — the diagnosed season swatch — NOT for chrome.
  season:
    spring: "#F7A6B3"
    summer: "#A6CDE3"
    autumn: "#C9925E"
    winter: "#5C5470"
  # Legacy soft-pink identity (COLORS.base: pink/coral/blush) is DEPRECATED for the
  # editorial direction — do not use in new UI.

typography:
  # Pretendard (SIL OFL), registered via src/hooks/use-app-fonts + expo-font plugin.
  families:
    light:    "Pretendard-Light"
    regular:  "Pretendard-Regular"
    medium:   "Pretendard-Medium"
    semibold: "Pretendard-SemiBold"
  styles:
    headline:    { family: "{typography.families.light}",   size: 28, lineHeight: 38, letterSpacing: -0.3, color: "{colors.ink.primary}" }
    subhead:     { family: "{typography.families.regular}", size: 14, lineHeight: 22, letterSpacing: 0.2,  color: "{colors.ink.muted}" }
    buttonLabel: { family: "{typography.families.medium}",  size: 13, letterSpacing: 1.5, color: "{colors.ink.paper}" }
    body:        { family: "{typography.families.regular}", size: 15, lineHeight: 24, color: "{colors.ink.primary}" }
    caption:     { family: "{typography.families.regular}", size: 12, lineHeight: 18, letterSpacing: 0.2, color: "{colors.ink.muted}" }

spacing:
  # apps/mobile/src/theme/spacing.ts → SPACING (t-shirt scale, px).
  xxs: 4
  xs:  8
  sm:  12
  md:  16
  lg:  24
  xl:  32
  xxl: 48

shapes:
  buttonRadius: 2     # near-square flat bars — NOT pills
  cardRadius:   2
  hairline:     1     # divider/outline width, color {colors.ink.line}

layout:
  screenPaddingH: 24  # FunnelScreenLayout horizontal inset (SPACING.lg)
  screenPaddingV: 32  # FunnelScreenLayout vertical inset (SPACING.xl)
  background: "{colors.ink.paper}"
---

# personal-color-kr — Design System (Editorial / VSCO)

A monochrome, type-led identity. Color comes from the user's photos and the one
diagnosed season swatch — **never from the chrome**. Restraint and negative space
do the work a decorative palette used to.

> **Source of truth is code.** The tokens above mirror
> `apps/mobile/src/theme/editorial.ts` (INK, FONT), `colors.ts` (season accents),
> and `spacing.ts` (SPACING). Edit the code first, then sync this file.

## Overview

- **Mood:** quiet, premium, editorial — closer to a film/photography app than a
  Korean-beauty-market app. Lots of white, thin type, flat surfaces.
- **Hierarchy through type and space, not color.** A light headline + muted
  subhead + generous negative space carry the page.

## Colors

- **Chrome = ink ramp only.** Headlines/CTA fill `ink.primary`, secondary text
  `ink.muted`, placeholders/disabled `ink.faint`, dividers `ink.line`, neutral
  fills `ink.wash`, surfaces `ink.paper`.
- **Season accents are precious.** Use `colors.season.*` only where the product
  is literally showing a personal-color result (a swatch/chip), at most as a
  small accent. Never tint a card, button, or background with them.
- **Deprecated:** the soft-pink `base.pink/coral/blush` identity. Do not add new
  usages; existing ones are being removed in the VSCO rollout.

## Typography

Pretendard, system-loaded. Korean has no uppercase, so the "VSCO label" feel comes
from **light weight + letter-spacing (자간)**, not caps.

- **Headline** — `Pretendard-Light`, 28/38, tracking −0.3, `ink.primary`.
- **Subhead** — `Pretendard-Regular`, 14/22, tracking +0.2, `ink.muted`.
- **Button label** — `Pretendard-Medium`, 13, tracking +1.5, `ink.paper`.
- Prefer Light/Regular. Reserve Medium for CTA labels and Semibold for rare
  emphasis. **Avoid heavy bold for body text.**

## Layout & Spacing

- Screens use `FunnelScreenLayout`: `ink.paper` background, 24/32 edge insets.
- Compose with the `spacing` scale; lean toward more negative space than feels
  necessary (the editorial move).
- Primary CTAs stretch **full-bleed** to the content width.

## Shapes & Elevation

- **Flat. No elevation.** No drop shadows, no glows, no gradients.
- Corners are near-square (`radius 2`), not pills.
- Separate sections with **1px `ink.line` hairlines**, not cards-with-shadows.

## Components

- **FunnelHeadline** — headline + subhead type group (the styles above). Used on
  every funnel step.
- **FunnelPrimaryButton** — flat full-width `ink.primary` bar, `radius 2`,
  `paddingVertical 18`, Pretendard-Medium tracked `ink.paper` label. Pressed →
  `opacity 0.8`; disabled → `ink.faint` fill.
- Secondary/skip actions are **text-only** in `ink.muted` (no outlined buttons,
  no second fill color).

## Do's & Don'ts

**Do**
- Build chrome from the ink ramp; let photos + the season swatch be the only color.
- Use Pretendard families via `theme/editorial.ts → FONT`.
- Use flat full-width bars, near-square corners, hairline dividers.
- Spend negative space generously.

**Don't**
- ❌ Use `coral` / `pink` / `blush` (or season colors) in chrome — cards,
  buttons, backgrounds, icons.
- ❌ Use pill buttons (`borderRadius: 999`), drop shadows, or glows.
- ❌ Use emoji as iconography — prefer thin line (SVG) icons or none.
- ❌ Use heavy bold weights for body copy.
- ❌ Hard-code token values — import from `theme/editorial.ts` / `theme`.
