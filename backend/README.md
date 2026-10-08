# spjall-api in production

The Worker runs on Samtak's Cloudflare account (`account_id` in `wrangler.jsonc`) at
`https://spjall.samtak.is`, a custom domain on the `samtak.is` zone. Every stateful resource is
in the EU jurisdiction (decision 0001); the order below exists because wrangler would otherwise
create a missing one without it, and a jurisdiction can never be added afterwards.

## Once, before the first deploy

1. Storage, both with `--jurisdiction eu`, then the D1 id into `wrangler.jsonc`:

   ```bash
   wrangler d1 create spjall-db --jurisdiction eu
   wrangler r2 bucket create spjall-media --jurisdiction eu
   wrangler r2 bucket lifecycle add spjall-media expire-media --expire-days 31 --jurisdiction eu
   ```

   The lifecycle rule is the backstop behind the Worker's daily media expiry (decision 0023).

2. Two API tokens, each stored in the vault (`samtak-secrets`, prefix `samtak-spjall-`):

   | Token                           | Scopes                                                                                  | Where in GitHub                      |
   | ------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------ |
   | `CLOUDFLARE_JURISDICTION_TOKEN` | Account: D1 Read, Workers R2 Storage Read                                               | repo secret (CI's live check)        |
   | `CLOUDFLARE_API_TOKEN`          | Account: Workers Scripts Edit, D1 Edit. Zone `samtak.is`: Workers Routes Edit, DNS Edit | `production` environment secret only |

3. `KENNITALA_HMAC_KEY`: 32 random bytes as hex, made straight into the vault as
   `samtak-spjall-kennitala-hmac-key` and never printed. **It is never rotated**: accounts are
   found by HMAC(kennitala), so a new key orphans every one of them.

## Every deploy

The `deploy` workflow (Actions → deploy → Run workflow, on `main`). The `production`
environment holds it until the maintainer approves. It runs
`tooling/jurisdiction-check.mjs --deploy --live`, the backend's checks and tests, the remote D1
migrations (`pnpm --filter spjall-backend run migrate:remote`), `wrangler deploy`, and then
asks `/health` on the API host.

Both package scripts run `jurisdiction-check.mjs --deploy` first, so a deploy from a laptop is
refused on the same terms.

## Secrets

```bash
node tooling/worker-secrets.mjs --dry-run      # what it would send, and why it skips the rest
node tooling/worker-secrets.mjs --gcloud-account=<address with access to samtak-secrets>
```

It reads each value from the vault and sends the set to `wrangler secret bulk` on stdin, then
checks `wrangler secret list`. Its table has one row per secret in `src/env/index.ts`; a test
keeps the two in step. Run it after the first deploy and whenever a vault value changes.

## Not yet

- Sign-in needs Kenni's production client `@innskraning.is/samtak-spjall` (decision 0019).
  Until it exists, `/v1/sign-in` answers `discovery_failed`.
- iOS push needs the APNs key (decision 0025, `docs/store-accounts/README.md`).
