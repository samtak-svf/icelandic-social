# icelandic-messenger

A native Android and iOS messenger for Iceland, built by Samtak svf.

**Status: in development, not yet released.** The backend, the shared Rust core and both apps
implement sign-in with Kenni, personal invites, devices, and end-to-end encrypted 1:1 and
group conversations with MLS ([decision 0002](docs/decisions/0002-mls-end-to-end-encryption.md)):
text, photos and files, replies, edits, deletes, reactions, disappearing messages, block,
account deletion, and push notifications that carry no message ids
([decision 0025](docs/decisions/0025-push-without-ids.md)). The first release is a closed test
group ([decision 0009](docs/decisions/0009-v1-scope.md)). Nothing is deployed yet, and sign-in
has so far been tested only against a stand-in for Kenni. The code has not been reviewed by
anyone outside the project. Do not rely on it to protect anything.

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
