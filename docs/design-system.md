# Design system page

The brand is shown to designers as a read-only Design System artifact on claude.ai. The page is
generated from `brand/<name>/` and never edited by hand: `brand/<name>/tokens.json` stays the
source (decision 0052), and the page is a view of it that can be regenerated at any time.

The artifact's URL is in `private/design-system/url.txt` and nowhere in the repository. The
exporter publishes nothing; a person hands its output to claude.ai.

## What the export holds

`node tooling/design-system.mjs` writes, for the first brand (or `--brand <name>`):

| File                                        | What it is                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project/design-system.json`                | The page's index: editing is `code`, so the page cannot be edited in place.                                                                               |
| `project/tokens.json`, `project/tokens.css` | Colours in both themes (resolved, no aliases), type, spacing and radius, with the source commit and the SHA-256 of `tokens.json`.                         |
| `project/README.md`                         | Usage rules, the contrast table, the wired status, the component inventory and the ad hoc sizes. Contrast and wiring are measured, never written by hand. |
| `project/components/Cover/preview.html`     | The cover: colour blocks, a pattern and the name, chosen by measurement.                                                                                  |
| `project/fonts/`                            | The faces as WOFF2 and their licences.                                                                                                                    |
| `publish.json`                              | The `files` map for one publish, with the file count and bytes.                                                                                           |
| `icon/<file>`                               | The mark, to upload as the page's asset.                                                                                                                  |

The default output is `private/design-system/<brand>/` of the primary checkout, whichever
worktree runs it. `--out <dir>` redirects it, and `--icon-blob <id>` files the uploaded icon
under Logos. The export clears only its own `project/` folder before writing.

It exits non-zero, naming every problem, when a limit of the page is broken (names, duplicates,
colour syntax, usage length, stack characters, more than 255 files or 16 MiB), when a colour
block would vanish against the ground in either mode, or when the brand itself fails
`pnpm check:brand`.

## Syncing the page

1. Run the export from `main`: `node tooling/design-system.mjs`.
2. Read the live page's index right before publishing and keep its keys (the blob ids of assets
   already uploaded), so a sync does not orphan them.
3. Upload `icon/<file>` as an asset of the artifact, then run the export again with
   `--icon-blob <id>` so the Logos group names it.
4. Publish with one Artifact call that passes `publish.json`'s `files` map.
5. Read `project/tokens.json` back from the published page and compare it with the local file;
   the two must be identical, including `meta.source`.

## Proposing a change

A designer comments on the page, or opens a pull request that edits
`brand/<name>/tokens.json`. The pull request is guarded by `pnpm check`: contrast pairs, the
scales and the generated platform files must all still pass. After the merge, the next sync
carries the change to the page.
