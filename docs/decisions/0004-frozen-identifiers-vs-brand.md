# 0004. Frozen identifiers are neutral; the brand lives only in `brand/`

- Status: accepted
- Date: 2026-10-05
- Decided by: Guðröður (plan), recorded at phase 0
- Amended by: [0010](0010-samtak-own-store-accounts.md) (Apple team is `null` until Samtak svf.'s own team exists; § Open is closed)
- Amended by: [0016](0016-one-encrypted-store-owned-by-the-core.md) (one database file, `spjall.db`)

## Decision

Every identifier that cannot change after first use is listed in `identifiers/ids.json`,
contains no brand term, and is copied byte-for-byte into `identifiers/ids.lock.json`:

| Group      | Values                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store / OS | `is.samtak.spjall` (Android application id, iOS bundle id, URL scheme), `is.samtak.spjall.notifications`, `group.is.samtak.spjall`, notification channels `messages` and `alerts`, database file `spjall.db`  |
| Identity   | Kenni client id `@innskraning.is/samtak-spjall`                                                                                                                                                               |
| Cloudflare | Worker `spjall-api`, D1 `spjall-db`, R2 `spjall-media` and `spjall-artifacts`, DO classes `Conversation` and `Inbox`, jurisdiction `eu`                                                                       |
| Hosts      | `spjall.samtak.is` for the API, and `spjall.samtak.is/l/` as the link host in App Links, Universal Links and links inside sent messages, so it must resolve forever. A brand host is only ever an extra alias |
| Services   | Firebase project `samtak-spjall`, Apple team (`null` until 0010 is carried out), secret prefix `samtak-spjall-` in `samtak-secrets` (0026), GitHub `samtak-svf/samtak-spjall` (moved by 0012)                 |

The brand (display name, all copy, tokens, icons, the Kenni application _Name_, store listing
names) lives in `brand/<name>/` and nowhere else.

**Code namespace is `samtak.spjall`**, not `is.samtak.spjall`: `is` is a hard keyword in
Kotlin, and the generator spike (0005) showed `package is.samtak…` does not compile. The
application id stays `is.samtak.spjall`; Android allows the namespace and the application
id to differ.

## Why

The samtakamatt → samtak rename (samtak-vefur decision 0036, rosaparks `docs/nafnabreyting.md`)
showed that a display name changes in an afternoon and an identifier costs a new Worker, a
data migration, a re-registered OIDC client or a new store listing. The brand name "Hjal" is
also an ordinary Icelandic noun, which makes a rename likely enough to design for now.

## Enforcement

- `tooling/ids-freeze.mjs`: `ids.json` must equal the lock byte-for-byte and match
  `ids.schema.json` (which also pins `jurisdiction` to `eu`); a lock change since the base
  branch must add a `docs/decisions/*.md` in the same range.
- `tooling/brand-leak-guard.mjs`: no brand term in any frozen id (substring) or any file
  outside `brand/<name>/` and the brand's `allowPaths` (per word, inflected, camelCase split).
- The rename drill (`tooling/rename-drill.mjs`, `rename-drill.yml`) switches the tree to a
  generated `_fixture` brand, builds the APK and the Worker bundle from it, and asserts no
  real brand's leak term in either, and the fixture's name in the APK.

## Open

`appleTeamId` is the team every existing app ships on, which belongs to another
organisation. Samtak svf. is a separate organisation, and a bundle id is bound to the team
that registers it. Guðröður confirms the
team before any App ID is created; changing it after is a new decision record.
