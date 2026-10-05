# 0013. The published core is a GitHub release, not an R2 object

- Status: accepted
- Date: 2026-10-05
- Decided by: the agent, under Guðröður's request to stop building the core in every app run

## Decision

- **A core version is a GitHub release of its `core-vX.Y.Z` tag** on
  `samtak-svf/icelandic-messenger`. `core.yml` attaches `spjall-core-android.zip`,
  `spjall-core-ios.zip` and their `.sha256` files, and refuses to touch a tag that already
  has a release.
- **`baseUrl` in `core/artifact.lock.json` is a template.** `{version}` stands for the pinned
  version, so the lock reads
  `https://github.com/samtak-svf/icelandic-messenger/releases/download/core-v{version}`.
  `cargo xtask fetch` and `tooling/core-guard.mjs` both refuse a published `baseUrl` without
  the placeholder.
- **The checksum pin is unchanged.** The lock still pins each zip's SHA-256, moves only by
  PR, and `fetch` writes nothing until the download matches.
- **R2 `spjall-artifacts` stays a frozen name** in `identifiers/ids.json`, unused for now.
  Nothing needs to create it before the apps can fetch a core.

## Why

Until a core was published, `android.yml` and `ios.yml` compiled the Rust core from source on
every run, which made each app check several times slower than its own build. Publishing to
R2 waited on a bucket, a public custom domain and an API token, all of which are Guðröður's to
create. The repo is public since 0012, so its releases are public, served without
credentials, and written with the workflow's own `GITHUB_TOKEN`. Integrity never rested on
the host anyway: it rests on the pinned checksum.

## Rules out

- Re-uploading assets to an existing core release. A fix is a new version.
- A lock that names the version only in `version` and serves every version from one path.
