# spjall-api in production

The Worker runs on Samtak's Cloudflare account (`accountId` in `cloudflare.config.ts`,
decision 0031) at
`https://spjall.samtak.is`, a custom domain on the `samtak.is` zone. Every stateful resource is
in the EU jurisdiction (decision 0001); the order below exists because `cf deploy` would otherwise
create a missing one without it, and a jurisdiction can never be added afterwards.

## Once, before the first deploy

1. Storage, both in the EU jurisdiction, then the D1 id into `cloudflare.config.ts`:

   ```bash
   cf d1 create --name spjall-db --jurisdiction eu
   cf r2 buckets create --name spjall-media --cf-r2-jurisdiction eu
   cf r2 buckets lifecycle update spjall-media --cf-r2-jurisdiction eu --rules \
     '[{"id":"expire-media","enabled":true,"conditions":{"prefix":""},"deleteObjectsTransition":{"condition":{"type":"Age","maxAge":2678400}}}]'
   ```

   The lifecycle rule (31 days) is the backstop behind the Worker's daily media expiry (decision 0023).

   The profile photos (decision 0039) have a bucket of their own, also in the EU, with **no**
   lifecycle rule: a photo stays until its owner replaces or removes it, or deletes the account.

   ```bash
   cf r2 buckets create --name spjall-profiles --cf-r2-jurisdiction eu
   ```

2. Two API tokens, each stored in the vault (`samtak-secrets`, prefix `samtak-spjall-`):

   | Token                           | Scopes                                                                                                                      | Where in GitHub                                      |
   | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
   | `CLOUDFLARE_JURISDICTION_TOKEN` | Account: D1 Read, Workers R2 Storage Read                                                                                   | repo secret (CI) and `production` environment secret |
   | `CLOUDFLARE_API_TOKEN`          | Account: Workers Scripts Edit, D1 Edit, Workers R2 Storage Read. Zone `samtak.is`: Workers Routes Edit, DNS Edit, Zone Read | `production` environment secret only                 |

   The deploy token reads R2 because the deploy checks that each bound bucket exists, and
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
migrations (`pnpm --filter spjall-backend run migrate:remote`), `cf deploy --no-provision`, and then
asks `/health` on the API host.

Both package scripts run `jurisdiction-check.mjs --deploy` first, so a deploy from a laptop is
refused on the same terms.

## Secrets

```bash
node tooling/worker-secrets.mjs --dry-run      # what it would send, and why it skips the rest
node tooling/worker-secrets.mjs --gcloud-account=<address with access to samtak-secrets>
```

It reads each value from the vault and sends the set to `cf workers secrets bulk` on stdin, then
checks `cf workers secrets list`. Its table has one row per secret in `src/env/index.ts`; a test
keeps the two in step. Run it after the first deploy and whenever a vault value changes.

## The operator wipe (one-off)

`POST /operator/wipe` deletes every account the way `DELETE /v1/me` does, then whatever no
account owns any more (decision 0058). It answers 404 unless `OPERATOR_WIPE_TOKEN` is set, and
a follow-up PR removes it. The token goes through the vault like every other secret:

```bash
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create samtak-spjall-operator-wipe-token \
  --project=samtak-secrets --replication-policy=automatic --data-file=-
node tooling/worker-secrets.mjs --only=OPERATOR_WIPE_TOKEN
SPJALL_API_BASE_URL=https://spjall.samtak.is \
OPERATOR_WIPE_TOKEN="$(gcloud secrets versions access latest --project=samtak-secrets \
  --secret=samtak-spjall-operator-wipe-token)" \
  pnpm --filter spjall-backend wipe:operator
pnpm --filter spjall-backend exec cf workers secrets delete OPERATOR_WIPE_TOKEN --worker spjall-api
```

The script calls the route until no account and no leftover is there, printing counts only.
Every invite goes with it, so the first tester after it needs a new `invite:operator`.

## Not yet

- iOS push needs the APNs key (decision 0025, `docs/store-accounts/README.md`).
