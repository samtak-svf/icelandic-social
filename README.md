# samtak-spjall

A native Android and iOS messenger for Iceland, built by Samtak svf.

**Status: phase 0, not usable.** The apps build and start, and they show that the shared
core loads and that the backend answers. They cannot send messages yet. End-to-end
encryption with MLS is the design ([decision 0002](docs/decisions/0002-mls-end-to-end-encryption.md)),
but only a self-test exists. Do not rely on this code to protect anything.

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
