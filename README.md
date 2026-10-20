# icelandic-messenger

A community social platform and end-to-end encrypted messenger for Iceland, on Android, iOS
and the web, built by Samtak svf.

**Status: closed beta.** The web app is live at `https://spjall.samtak.is`, and the phone apps
reach a small group of testers through TestFlight and Google Play internal testing
([decision 0009](docs/decisions/0009-v1-scope.md),
[decision 0060](docs/decisions/0060-a-social-platform-with-an-encrypted-messenger.md)). Today
the system implements:

- **Sign-in and verification** on Android, iOS and the web: sign-in with Google, with optional
  Kenni (Icelandic electronic ID) verification that vouches for the person's registry name,
  adds the verified mark and joins an older verified account
  ([decision 0035](docs/decisions/0035-google-only-sign-in-and-merge-on-kenni.md),
  [decision 0069](docs/decisions/0069-web-kenni-links-not-signs-in.md)), plus session
  management across devices and browsers
  ([decision 0061](docs/decisions/0061-account-identity-session-and-device-are-separate.md));
- **End-to-end encrypted 1:1 and group conversations** on Android and iOS with MLS
  ([decision 0002](docs/decisions/0002-mls-end-to-end-encryption.md)): text, photos, files and
  a location ([decision 0059](docs/decisions/0059-send-a-location.md)), with replies, edits,
  deletes, forwarding, copying, reactions, read receipts, typing indicators and disappearing
  messages (encrypted chat on linked browser devices is designed in
  [decision 0064](docs/decisions/0064-non-phone-devices-are-linked-devices.md) and not built
  yet);
- **Communities and discussions** on Android, iOS and the web
  ([decision 0060](docs/decisions/0060-a-social-platform-with-an-encrypted-messenger.md),
  [decision 0063](docs/decisions/0063-communities-audiences-and-moderation.md),
  [decision 0065](docs/decisions/0065-the-space-object-and-social-media.md)): open and private
  communities created by verified accounts, join requests with a 30-day wait after a decline
  ([decision 0070](docs/decisions/0070-community-deletion-and-declined-requests.md)), posts
  with up to four server-re-encoded WebP images, comments, five reactions, in-app
  notifications ([decision 0067](docs/decisions/0067-jobs-and-notifications.md)), reports,
  community and platform moderation with an append-only log
  ([decision 0066](docs/decisions/0066-moderation-in-d1.md)), and a 30-day restore window for
  deleted communities ([decision 0070](docs/decisions/0070-community-deletion-and-declined-requests.md)).
  Hosted community content is not end-to-end encrypted;
- **Directory, profiles and account controls**: finding people by name or a personal invite
  link, profile photos re-encoded without metadata
  ([decision 0039](docs/decisions/0039-profile-photo.md)), mute, block and account deletion;
- **Push notifications** that carry no message or sender ids
  ([decision 0025](docs/decisions/0025-push-without-ids.md); live on Android via FCM, while
  iOS APNs awaits Samtak svf.'s Apple Developer organization enrollment under
  [decision 0010](docs/decisions/0010-samtak-own-store-accounts.md) and
  [decision 0011](docs/decisions/0011-interim-testflight-on-existing-team.md)).

Data in D1, R2 and the Durable Objects (`Conversation`, `Inbox`, `Space`) is stored in
Cloudflare's EU jurisdiction and processed on Cloudflare's network
([decision 0001](docs/decisions/0001-eu-storage-and-residency-wording.md)); logs carry no
personal data ([decision 0008](docs/decisions/0008-no-pii-in-logs.md)). Both the web app and
the API run at `https://spjall.samtak.is`
([decision 0062](docs/decisions/0062-the-web-host-and-its-sign-in-callbacks.md),
[backend/README.md](backend/README.md), [docs/operations.md](docs/operations.md)). The code
has not been reviewed by anyone outside the project. Do not rely on it to protect anything.

## Layout

| Path              | What it is                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `android/`        | Kotlin and Jetpack Compose app                                                                                                                                                                                  |
| `ios/`            | SwiftUI app, generated with XcodeGen                                                                                                                                                                            |
| `web/`            | TanStack Start web app served by the Worker alongside the API ([decision 0062](docs/decisions/0062-the-web-host-and-its-sign-in-callbacks.md))                                                                  |
| `core/`           | Rust core shared by both phone apps (envelope, MLS via OpenMLS, SQLCipher local store, sync and social client), exposed with UniFFI                                                                             |
| `backend/`        | Cloudflare Worker (`spjall-api`): REST API, MLS delivery, community `Space` objects, background jobs and the web app, with EU D1/R2/DO storage                                                                  |
| `api/`            | The OpenAPI contract (`api/openapi.json`) and generated Kotlin WebSocket frames, emitted from the backend's zod schemas and committed                                                                           |
| `brand/`          | The product's display name, Icelandic strings, colours, WCAG contrast pairs, fonts and icon. Everything outside `brand/` is brand-neutral                                                                       |
| `identifiers/`    | Frozen resource ids (bundle ids, package name, Worker/D1/R2/DO names, hosts) that never change with the brand                                                                                                   |
| `tooling/`        | The guards and generators behind `pnpm check` and `pnpm brand:gen`, each with tests proving that it fails when it should                                                                                        |
| `docs/decisions/` | Numbered decision records ([0001](docs/decisions/0001-eu-storage-and-residency-wording.md)–[0071](docs/decisions/0071-comment-replies-and-reactions.md)). They win over anything else written about the project |
| `docs/`           | Operational runbook ([`docs/operations.md`](docs/operations.md)), testing rules ([`docs/testing.md`](docs/testing.md)) and store-account guides                                                                 |

## Building

Node 24.2 or later and pnpm.

```bash
pnpm install    # also installs the git hooks
pnpm check      # every guard
pnpm test       # the guards' tests
```

The backend, the web app, the core and the phone apps each have their own commands, listed in
[`AGENTS.md`](AGENTS.md#commands), which also holds the rules every contributor works by.

## Security

See [`SECURITY.md`](SECURITY.md). Please do not report a vulnerability in a public issue.

## Licence

[GNU Affero General Public License v3.0](LICENSE) only.
