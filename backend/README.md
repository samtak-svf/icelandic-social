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

   | Token                           | Scopes                                                                                                                      | Where in GitHub                                      |
   | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
   | `CLOUDFLARE_JURISDICTION_TOKEN` | Account: D1 Read, Workers R2 Storage Read                                                                                   | repo secret (CI) and `production` environment secret |
   | `CLOUDFLARE_API_TOKEN`          | Account: Workers Scripts Edit, D1 Edit, Workers R2 Storage Read. Zone `samtak.is`: Workers Routes Edit, DNS Edit, Zone Read | `production` environment secret only                 |

   The deploy token reads R2 because `wrangler deploy` checks that each bound bucket exists, and
   reads the zone to attach the custom domain. In the vault they are
   `samtak-spjall-cloudflare-jurisdiction-token` and `samtak-spjall-cloudflare-deploy-token`.

3. `KENNITALA_HMAC_KEY`: 32 random bytes as hex, made straight into the vault as
   `samtak-spjall-kennitala-hmac-key` and never printed. Accounts are found by HMAC(kennitala),
   so a new key on its own orphans every one of them. To rotate it (an exposed key, a
   departing operator), put the old value as `KENNITALA_HMAC_KEY_PREVIOUS` and a new one as
   `KENNITALA_HMAC_KEY`. A person's row moves to the new key when they next sign in, the only
   time the Worker sees a kennitala. A row that has not moved still matches the old key, so
   the previous key stays set for as long as such an account may come back.

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

- iOS push needs the APNs key (decision 0025, `docs/store-accounts/README.md`).
