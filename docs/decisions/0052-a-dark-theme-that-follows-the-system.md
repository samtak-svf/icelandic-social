# 0052. A dark theme that follows the system

- Status: accepted; designed, not yet implemented
- Date: 2026-10-15
- Decided by: the maintainer, choosing from the UX round on 0.7.3
- Builds on: [0043](0043-first-launch-and-the-ui-pass.md) (which left a dark theme to its own
  record), [0022](0022-the-conversation-surfaces.md) (the surfaces it colours)

## Decision

- **The apps follow the system's light or dark setting**, on both platforms, with no setting of
  their own. A phone in dark mode no longer gets a bright app.
- **A brand defines its dark colours next to its light ones.** `brand/<name>/tokens.json` gets a
  `dark` group with every key of `color`; a token may point at another (`{color.fg}`) in the
  same mode. `tooling/brand-check.mjs` fails when a key is missing in either mode.
- **Contrast is computed for both modes.** Every pair in `brand/contrast-pairs.json` must reach
  its level in light and in dark, and a brand that fails either does not generate. The pairs
  stay shared: they are a property of the UI, not of the mode.
- **The generated files carry both.** `pnpm brand:gen` writes Android's `values-night`
  resources and a dark scheme in `BrandTokens.kt`, and iOS colour sets with a dark
  appearance. The apps keep reading only generated files.
- **Photos, avatars and the app icon are not recoloured.** The status and navigation bars
  follow the mode.
- **Until then the iOS app is held light** (`UIUserInterfaceStyle: Light` in
  `ios/project.yml`), as Android's theme already is. Without it, 0.7.3 in dark mode drew the
  composer's text white on its light field. The work that lands this record removes the key.

## Why

The S23 used for the UX round runs in dark mode, and the app was the one bright screen on it;
Both established messengers we compared follow the system. 0043 deferred a dark theme only because it needs
its own tokens and contrast pairs, which is what this record sets.

## What it rules out

- A dark theme drawn by inverting or dimming the light colours in code: every colour is a
  brand token, checked for contrast.
- An in-app light/dark switch in v1.
