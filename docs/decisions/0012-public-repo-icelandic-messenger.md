# 0012. The code is public in a new repo, samtak-svf/icelandic-messenger

- Status: accepted
- Date: 2026-10-05
- Decided by: Guðröður

## Decision

- **The code lives in the public repo `samtak-svf/icelandic-messenger`**, under AGPL-3.0.
  `services.githubSlug` in `identifiers/ids.json` names it.
- **It starts from main only.** Phase 0 was landed on the earlier private repo
  `samtak-svf/samtak-spjall` as one squashed commit per PR, and only that main was pushed
  here: no other branch, no tag and no pull request.
- **The earlier repo stays private and archived.** It keeps the review threads of the phase-0
  PRs.
- **In CI the repository must be the one the lock names** (`tooling/ids-freeze.mjs`,
  `checkRepository`), so a later move is a lock edit with a record, like any frozen id. A
  fork under another owner is left alone.

## Why

Free hosted minutes for a public repo, macOS included, pay for the iOS checks that the
private repo had to ration.

The earlier repo could not simply be made public. One of its PR branches carried, in commits
since replaced, detail about how a store account is secured. GitHub keeps every PR's commits
under `refs/pull/N/head` even after the branch changes, and only GitHub Support can remove
them. A new repo built from a reviewed main has none of them, and that can be checked with
`git` alone, without waiting on anyone.

## Rules out

- Making `samtak-svf/samtak-spjall` public.
- Pushing any branch other than main, or any PR ref, from the earlier repo to this one.
