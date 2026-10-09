# 0031. Samtak svf. owns the Cloudflare account and the zone

- Status: accepted
- Date: 2026-10-09
- Decided by: the maintainer, answering L6 of architecture review #100

## Decision

The repo never said which Cloudflare account runs the service. For a project meant to outlive
its first operator, that is recorded here.

- **The account is Samtak svf.'s own**: `af4d4a9c4527ce1e46d0c2dc1165e801`
  (`SAMTAK_ACCOUNT` in `tooling/jurisdiction-check.mjs`, which refuses any other `account_id`).
  The `samtak.is` zone and every `spjall-*` resource (the Worker, D1, R2, the Durable Objects)
  live on it.
- **The account's recovery codes are kept in the cooperative's vault**, the `samtak-secrets`
  project (decision 0026), and nowhere in the repo. No agent holds a login to the account.
- **The service reaches the account only through scoped API tokens**, listed with their
  scopes in `backend/README.md` and stored in the same vault as
  `samtak-spjall-cloudflare-deploy-token` and `samtak-spjall-cloudflare-jurisdiction-token`.
  Rotating one means a new token in the vault and in the GitHub secret it feeds.
- This mirrors decision 0010 for the store accounts: whoever operates the service, the
  cooperative owns what it runs on.

## Rules out

- Any `spjall-*` resource on another organisation's account or on a personal account.
- Moving to another account without a new record. A jurisdiction is set only at creation, so a
  move means a new D1 and R2 in the EU and a data copy, not a transfer.
