# 0075. The repo is recreated as samtak-svf/icelandic-social

- Status: accepted; implemented
- Date: 2026-10-21
- Decided by: Guðröður Atli Jónsson
- Amends: [0012](0012-public-repo-icelandic-messenger.md) (the repo and its name),
  [0013](0013-core-artifacts-as-github-releases.md) (where the core releases live)

## Decision

- **The code lives in the public repo `samtak-svf/icelandic-social`**, under AGPL-3.0.
  `services.githubSlug` in `identifiers/ids.json` names it, and `core/artifact.lock.json`
  fetches the core from its releases.
- **It was created new, with the history rewritten once** (decision 0073), not by a
  force-push to `samtak-svf/icelandic-messenger`. Main's tree on the day was byte-identical
  to the old main's. The 33 `core-v*` tags and their releases were recreated with the same
  notes and the same asset bytes, so the checksums in `core/artifact.lock.json` still hold.
- **The issues were transferred** with their comments, and got new numbers. The pull requests
  were not carried over: each one is its squashed commit on main. An old `#N` in a commit
  subject or a decision record refers to the old repo, which no longer exists. Links in
  documents point at the new issue numbers, or at the commit when they named a pull request.
- **The old repo is deleted**, not archived.
- **The name names what the product is, not its brand.** It is a community social platform
  with an encrypted messenger in it, and a brand word in a frozen id is what the repo exists
  to avoid.

## Why

The old history named other messenger apps (decision 0073). A force-push leaves the old
commits reachable on GitHub through pull request refs and cached views until GitHub support
removes them, and it keeps every fork. A new repo with only the rewritten history leaves
nothing behind once the old one is deleted. Renaming at the same time costs nothing extra,
since every link had to move anyway.

## What it rules out

- Referring to `samtak-svf/icelandic-messenger` anywhere but in the history of 0012 and 0013.
- Pushing the old history, or a branch made from it, to the new repo
  (`git merge-base` with the old main finds nothing).
