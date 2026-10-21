# 0073. The public repository names no other messenger

- Status: accepted; implemented (`tooling/peer-name-guard.mjs`)
- Date: 2026-10-21
- Decided by: Guðröður Atli Jónsson

## Decision

- **Files, commit messages, pull requests and issues in this repository never name another
  messenger app.** They write "an established messenger" or describe the behaviour.
- **A named comparison lives only in the gitignored `private/comparison/`**, with its
  screenshots and sources.
- **`tooling/peer-name-guard.mjs` enforces it:** pre-commit on staged files, commit-msg on the
  message, `pnpm check` on the whole tree, and a pull-request workflow on the title, the body
  and every commit message. The names it looks for are SHA-256 hashes in
  `tooling/peer-names.json`, so the guard does not spell them out. A word that is also plain
  English or one of our identifiers is matched only capitalised, in prose, outside backticks.
- **History is rewritten once** to remove the names that were already committed, and from then
  on the guard keeps them out.

## Why

The repository is public, and the project is compared with established messengers all the
time. Named, such a comparison reads as a claim about another company's product, made by an
organisation with no standing to make it. The comparison itself stays useful, so it is kept,
privately.

## What it rules out

- Naming another messenger in a decision record, a doc, a code comment, a test or a PR body.
- Quoting another messenger's documentation or blog by link.
- A plain-text list of the names in the repository, including in the guard.
