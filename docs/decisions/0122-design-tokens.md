# 0122. Design tokens: type, radius and spacing beside colour

- Status: accepted; implemented in the generators, the web radii and Android type and radii (#471), spacing not yet read by a screen
- Date: 2026-10-31
- Decided by: Guðröður Atli Jónsson

## Decision

**`brand/<name>/tokens.json` is the only source of the design's scales, and three groups join colour
and font family in it:**

- **`type`**: named styles (`screen-title`, `account-name`, `section-label`, `bubble`, `meta`). Each
  has a font family alias, a weight, a size, and optionally a line height and a letter spacing.
  Size and line height are px, letter spacing is em. Line height is px rather than the DTCG
  multiplier because the apps need exact values, and 32 over 30 is not exact as a ratio.
- **`radius`**: by role, never by size (`well`, `thumbnail`, `pane`, `card`, `post-bubble`,
  `bubble`, `field`, `pill`, `pill-lg`, plus the web's `md`). Each role says where it is used.
- **`spacing`**: the gaps the apps repeat, `space-2` to `space-24`, all multiples of 2.

**The tokens record what the apps use today.** Consolidating near-equal values (a 14 and a 16, a 20
and a 22) is the designer's decision and arrives as an edit of this file, not as a refactor.

**Generation.** `pnpm brand:gen` writes `Type`, `Radius` and `Spacing` into the Android and iOS
`BrandTokens` (iOS names its type group `Typography`, because `BrandTokens.Type` is Swift's
metatype). The web theme gets `--radius-<role>` and `--text-<style>` with its line height, letter
spacing and weight. Spacing is not emitted for the web: Tailwind's scale covers it. Swift tracking
is in points (em times size), Kotlin keeps em.

**What reads them.** Radii: the web and Android now, through role classes such as `rounded-card`. The theme
clears Tailwind's radius scale, so `rounded-lg` and its siblings generated no CSS and rendered
square; `tooling/tests/rounded-classes.test.mjs` fails on any `rounded-*` class in `web/src` that
names no token. Android also reads type; `tooling/tests/android-radii.test.mjs` fails on a numeric radius in its
source. Spacing is generated but not yet read by a screen; the apps and the web adopt it in later changes.

**`brand-check` refuses** a brand missing any of the three groups, a type style naming an unknown
family, a family and weight with no bundled face, and a token in the wrong unit.

**An external design system page is a read-only view of this file.** A change comes by pull request
to `tokens.json`, never by editing the page.

## Why

Radius and type values were repeated as constants per screen on each platform and drifted (the
account card is 18 on Android and iOS, a community card 14; the iOS frame is 14 and the Android one
12). One file generated for three platforms makes a difference visible and a change one edit.

## What it rules out

A radius named by its size (`lg`), a hand-typed type size in a screen once a style exists for it,
and a second place where the scales are defined.
