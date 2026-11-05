# AGENTS.md: samtak-spjall

A community social platform and end-to-end encrypted messenger for Iceland on Android, iOS and the web, built by Samtak svf.
(`samtak-svf/icelandic-social`, AGPL-3.0). The product ships under a **brand** ("Hjal" today) that is
designed to be renamed cheaply; nothing outside `brand/` may depend on it.

Decisions are in [`docs/decisions/`](docs/decisions/), and they win over any plan or
issue where the two differ.

## The one structural rule: frozen ids vs brand

Display names are cheap to change and resource identifiers are not (the samtakamatt → samtak
rename, samtak-vefur decision 0036). So the repo keeps two things apart:

|                                                                                                                                           | Lives in                                   | Changes how                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Frozen identifiers**: bundle/application ids, App Group, Kenni client id, Worker/D1/R2/DO names, hosts, Firebase project, secret prefix | `identifiers/ids.json` (+ `ids.lock.json`) | Never, in practice. A change is a lock edit **and** a new `docs/decisions/*.md` in the same PR (`tooling/ids-freeze.mjs`) |
| **Brand**: display name, every user-visible sentence, colours, fonts, icons, external listing names                                       | `brand/<name>/`                            | Freely. Add a brand directory, pass `pnpm check`, switch `BRAND`                                                          |

Consequences, all enforced by `tooling/brand-leak-guard.mjs`:

- **Code never names the brand.** Not in a class, a resource, a log line or a test. Refer to a
  strings key (`app_name`) or a token (`color.primary`). Comments too: the guard reads them.
- **A frozen id never contains a brand term** (`samtak.spjall`, never a brand word). The
  Kotlin/Swift namespace is `samtak.spjall` because `is` is a hard keyword in Kotlin
  (decision 0004).
- The brand's own words are matched per word, inflections included, from
  `brand/<name>/brand.json` `leakTerms`. A word that only shares the stem (a person's name,
  another noun) is added to `allowPrefixes` **with its reason**. `allowPaths` lists the files
  allowed to talk about the brand (this file, `docs/**`).
- **A UI noun is a term, not a word in a string** (decision 0117). `brand/<name>/terms.is.json` holds its BÍN forms
  and agreement words, a string writes a token (`Stofna [[group.acc]]`), `brand:gen` expands it to plain text, and
  `check:brand` fails on a raw form, an unknown token or a retired word. Renaming one edits the table and regenerates.
  Comments and tests name the string key or say "the community", never the label.
- **Strings are whole sentences per brand**, never `{name}` interpolation: the name inflects.
  Key set, placeholders and plural categories (`one`, `other`) must match
  `brand/strings.contract.json` exactly (`tooling/brand-check.mjs`).
- **Factual claims are keyed to `claims` flags.** The residency sentence must contain exactly
  _"geymd varanlega innan ESB; unnin á netkerfi Cloudflare"_ (decision 0001). Never write
  that data is stored or processed in Iceland.
- **Contrast is computed, not eyeballed.** Every pair in `brand/contrast-pairs.json` must
  reach its WCAG level for every brand; a brand that fails does not pass `check:brand`.
- **Apps read generated files, never `brand/`.** `pnpm brand:gen` (`tooling/brand-gen.mjs`)
  writes Android resources and `BrandTokens.kt` in `android/core/brand/src/generated/`, `ios/Generated/`,
  `backend/src/brand.gen.ts` and `web/src/generated/brand/` (strings, Tailwind theme, fonts), icons
  included; all are committed and `check:brand-gen`
  fails when they differ by a byte. Never edit them by hand. The brand is `BRAND=<name>`, by
  default the only brand not starting with `_`. Generated files may name the active brand and
  no other one.
- **Apps read the Rust core from local paths, never from cargo or the network.**
  No Gradle or Xcode file calls cargo (`check:core`). Detail, the lock and the publishing steps: [`docs/commands.md`](docs/commands.md) § The Rust core in the apps.

## Commands

```bash
pnpm install           # also installs the lefthook hooks
pnpm check             # lint, types, format, every guard CI runs (tooling/guards.json), knip
pnpm brand:gen         # regenerate the platform files from brand/$BRAND
pnpm test              # guard tests (vitest); what deserves a test: docs/testing.md
node tooling/ids-freeze.mjs --base origin/main   # what CI runs on a PR
```

Every other command (Worker, web, Rust core, apps, `mac-remote`), the debug-build setup, the OpenSSL and
worktree build notes and the tooling baseline (Node >= 24.2, one pnpm workspace) are in
[`docs/commands.md`](docs/commands.md). Two rules bind here: **Gradle, Xcode and the emulator run on
samtak-mac only** (`node tooling/mac-remote.mjs`), never on the Linux workstation; and **the apps read the
Rust core from local paths** filled by `cargo xtask`, so no Gradle or Xcode file calls cargo.

**The contract (decisions 0005, 0097).** zod in `backend/src/api/` is the source. `api/openapi.json`
and the web client `web/src/generated/api.ts` are generated and committed; `contract.yml` fails when either is
stale, and `oasdiff breaking` fails unless the PR has the label `api: breaking`. Contract changes in different
domains may run side by side; the branch that lands second runs `node tooling/contract-rebase.mjs`
(`docs/commands.md` § The contract). **Limits (decision 0123)** live in `api/limits.json`, generated to every platform.

## Git

- **Feature branch + PR, never `main`.** Lefthook refuses a commit or push on `main`.
- **Conventional commits** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`).
- **Never `--no-verify`**, `LEFTHOOK=0` or `core.hooksPath` tricks. A hook that fails for an
  environmental reason is fixed, not stepped around.
- **No AI authorship markers**, anywhere: no co-author trailer naming an AI, no
  "Generated with" footer, no AI byline. Commits and PRs credit only the human accountable.
  Enforced by the `commit-msg` hook and `.github/workflows/ai-authorship.yml`.
- **Stage explicit paths.** Never `git add -A` / `git add .`.

## PII

**Kennitölur and phone numbers never enter git**, including tests, fixtures, logs and notes.
`tooling/pii-guard.mjs` (pre-commit on staged files, CI on the whole tree) finds a person's
kennitala by its check digit and an Icelandic number by `+354`. Build sample values at
runtime in tests so the file itself holds none. Real data goes in the gitignored `private/`.

**No PII in logs** (decision 0008): Workers Logs are processed outside the EU boundary, so a
log line carries ids and counts, never a kennitala, a phone number, a name, a message or a
push token.

## Public repository

**No other messenger app is named here** (decision 0073): not in files, commit messages, PR
titles and bodies, or issues. Write "an established messenger" or describe the behaviour. A
named comparison lives only in the gitignored `private/comparison/`. `tooling/peer-name-guard.mjs`
checks staged files, commit messages, the whole tree and every PR; a new name goes into
`tooling/peer-names.json` as the hash `node tooling/peer-name-guard.mjs --hash <name>` prints.

## Icelandic text

User-facing strings are Icelandic and live only in `brand/<name>/strings.is.json`, with the nouns
they share in `terms.is.json` beside it. No
þankastrik (em dash, or spaced en dash) in them: `tooling/thankastrik.mjs`. An unspaced en
dash in a range (`9–17`) is a millistrik and is fine. Everything else written here (code,
comments, docs, commits, PRs, issues) is English.

## Infrastructure

Full rules: [`docs/infrastructure.md`](docs/infrastructure.md). Binding here: Samtak's own Cloudflare
account only; every stateful resource in the **EU jurisdiction** (a bare `idFromName` or `getByName`
is a residency bug, decision 0001); **never deploy before D1 and R2 exist**
(`cf deploy --no-provision`); no Queues; secrets only in the maintainer's vault, never in the repo.
Creating Cloudflare, Firebase, Apple, Play or Kenni resources, and DNS, is Guðröður's step:
agents prepare the commands, they do not run them (the standing exceptions are in the doc).

## Decision records

`docs/decisions/NNNN-slug.md`, numbered, never renumbered. A record states the decision, why,
and what it rules out. A superseded record is kept and marked, not deleted.

The record format (header list and statuses) is in [`docs/decision-format.md`](docs/decision-format.md); `tooling/tests/decisions.test.mjs` enforces it.

**v1 scope is [0009](docs/decisions/0009-v1-scope.md).** A feature outside its table needs a
new record before any code.

**Store accounts are Samtak svf.'s own ([0010](docs/decisions/0010-samtak-own-store-accounts.md)).**
Nothing is registered on another organisation's Apple team or Play account. The enrollment
steps are in `docs/store-accounts/`, and every one of them is Guðröður's.
