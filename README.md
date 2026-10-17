# icelandic-messenger

A native Android and iOS messenger for Iceland, built by Samtak svf.

**Status: closed beta.** Builds reach a small group of testers through TestFlight and Google
Play internal testing ([decision 0009](docs/decisions/0009-v1-scope.md)). The backend, the
shared Rust core and both apps implement:

- sign-in with Google, with Kenni verifying who the person is
  ([decision 0035](docs/decisions/0035-google-only-sign-in-and-merge-on-kenni.md));
- end-to-end encrypted 1:1 and group conversations with MLS
  ([decision 0002](docs/decisions/0002-mls-end-to-end-encryption.md));
- text, photos, files and a location ([decision 0059](docs/decisions/0059-send-a-location.md)),
  with replies, edits, deletes, forwarding, copying, reactions and disappearing messages;
- finding people by name or a personal invite link, profile photos, mute, block and account
  deletion;
- push notifications that carry no message ids
  ([decision 0025](docs/decisions/0025-push-without-ids.md)).

Data is stored in the EU ([decision 0001](docs/decisions/0001-eu-storage-and-residency-wording.md)).
The backend runs at `https://spjall.samtak.is` ([backend/README.md](backend/README.md)). The
code has not been reviewed by anyone outside the project. Do not rely on it to protect anything.

## Layout

| Path              | What it is                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `android/`        | Kotlin and Compose app                                                                                            |
| `ios/`            | SwiftUI app, generated with XcodeGen                                                                              |
| `core/`           | Rust core shared by both apps (envelope, MLS via OpenMLS, local store), exposed with UniFFI                       |
| `backend/`        | Cloudflare Worker: the REST API and the MLS delivery service, with every stateful resource in the EU jurisdiction |
| `api/`            | The OpenAPI contract, generated from the backend and committed                                                    |
| `brand/`          | The product's name, strings, colours and icon. Everything else is brand-neutral, so the product can be renamed    |
| `identifiers/`    | Frozen resource ids (bundle ids, package name, storage names) that never change with the brand                    |
| `tooling/`        | The guards behind `pnpm check`, each with tests that prove it fails when it should                                |
| `docs/decisions/` | Decision records. They win over anything else written about the project                                           |

## Building

Node 24.2 or later and pnpm.

```bash
pnpm install    # also installs the git hooks
pnpm check      # every guard
pnpm test       # the guards' tests
```

The backend, the core and the apps each have their own commands, listed in
[`AGENTS.md`](AGENTS.md#commands), which also holds the rules every contributor works by.

## Security

See [`SECURITY.md`](SECURITY.md). Please do not report a vulnerability in a public issue.

## Licence

[GNU Affero General Public License v3.0](LICENSE) only.
