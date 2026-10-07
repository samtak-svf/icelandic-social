# 0026. The app's secrets live in the co-operative's own vault

- Status: accepted
- Date: 2026-10-07
- Decided by: the maintainer, moving the co-operative's secrets to its own vault
- Amends: [0004](0004-frozen-identifiers-vs-brand.md) (`services.gcpSecretProject`)

## Decision

- **`services.gcpSecretProject` is `samtak-secrets`**, the GCP Secret Manager project that
  Samtak svf. owns, in place of `fedora-setup-secrets`, a personal vault that held the
  co-operative's secrets until then.
- **The prefix stays `samtak-spjall-`.** Secrets are routed to a vault by their name, and
  every `samtak-` name now goes to `samtak-secrets`, so the prefix already puts the app's
  secrets there.

## Why now

No `samtak-spjall-*` secret existed in either project when this was decided, so the change
orphans nothing. The first ones, the APNs key and the store signing material, are created
with the store accounts (`docs/store-accounts/README.md`). That is after this decision, so
they are created in the right place from the start.
