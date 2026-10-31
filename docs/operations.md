# Operations: deploy, the way back, jobs and monitoring

What the maintainer runs when something goes wrong in production, and what to look at
before it does. The rules behind it are [decision 0068](decisions/0068-operations-restore-and-rollback.md).
Every command runs from `backend/` with the Cloudflare login of Samtak's account
(`cf whoami`), unless it says otherwise. The commands that call `/ops` read the
maintainer's token from the environment:

```bash
export OPS_TOKEN="$(gcloud secrets versions access latest --secret=samtak-spjall-ops-token \
  --project=samtak-secrets)"
```

## Deploy

Actions → deploy → Run workflow, on `main`; the `production` environment holds it until it
is approved (`backend/README.md`). In order, it:

1. checks that D1 and R2 are in the EU, and runs the backend's checks and tests;
2. **writes the way back to the run's summary**: a D1 bookmark and the Worker version that
   served until then, with the two commands that use them (`node scripts/ops.ts way-back`);
3. applies the remote D1 migrations;
4. builds and deploys the Worker with the web app, and asks `/health`.

Open the run's summary before anything else when a deploy has gone wrong: the ids there are
the ones the rest of this page needs.

## Staging

Staging is a second Worker on Samtak's account, `spjall-api-staging`, for measuring what local
workerd cannot ([decision 0118](decisions/0118-a-staging-worker.md)). It is the real Worker on
its own D1, buckets and Durable Objects, all in the EU, with the fake Kenni and Google in place
of real sign-in. `.github/workflows/staging.yml` deploys it from `main` with no approval, and
stays skipped until the repository variable `STAGING_ON` is `true`. Its address is the secret
`STAGING_ORIGIN`, so the public logs mask it.

**How to reach it.** Every request without the gate gets an empty 404, static files included.
A tool sends the secret as the header `x-staging-gate`. A browser opens
`/__staging-gate?key=<secret>` once, which sets a cookie for 30 days. The secret is
`STAGING_GATE`, in the repository's secrets and the Worker's. If it leaks, change it in both and
deploy. A key in a URL can land in the Worker's logs, so prefer the header. The native apps
cannot send the header; staging is for tools and browsers.

Behind the gate, anyone signs in as anyone: `login_hint=<subject>` at the fake Google starts a
session with no invite. `POST /dev/jobs` runs the minute cron, `POST /dev/operator-invite`
writes an operator invite, `POST /dev/platform-moderator?account=<id>` makes a moderator, and
`POST /dev/phone?account=<id>` gives an account a device row, so it enters the directory and the suggestions.

**What it may not hold.** Nothing real: no real person, kennitala, address, photo or message,
and nothing copied from production, since anyone with the gate can read all of it. No secret but
`STAGING_GATE` and its own `KENNITALA_HMAC_KEY`; never production's. No push credential
(`APNS_*`, `FCM_SERVICE_ACCOUNT`) and no `OPS_TOKEN`. `node tooling/jurisdiction-check.mjs`
holds what the config declares.

Sessions that sit idle expire as in production, and both crons run, so seeded data that a job
expires does go away.

## Releasing a core

Once the PR that sets the version in `core/Cargo.toml` has merged, from a clean checkout:

```bash
node tooling/core-release.mjs <version> [--app <X.Y.Z>]
```

It refuses unless `main` says that version and any tag already there is a commit on `main`
with that version. It tags the commit and pushes the tag through the usual hooks, waits for
`core.yml` to publish the release, then on a new branch `feat/apps-core-<version>` writes the
release's digests into `core/artifact.lock.json` and sets `versionName` and `MARKETING_VERSION`
(`--app`, or the next patch after `main`'s), and commits. The branch stays local: add the
apps' changes and open the apps PR.

When it stops (a failed `core.yml`, a lost connection), fix the cause and run the same command:
each step reads what is already there, so there is no second tag. It never uploads to a store;
that stays the two `workflow_dispatch` workflows. A wrong digest in a lock fails the apps' build
in `cargo xtask fetch`, before anything is written (`core/xtask/src/lock.rs`,
`a_wrong_checksum_fails_and_writes_nothing`).

## Migrations expand, and contract later

A rollback runs the version before on the schema the new one migrated, because D1 does not go
back with the code. So a migration only adds: a table, a column, an index. To remove or rename
something:

1. deploy code that no longer reads the old form, with a migration that adds the new one;
2. in a later deploy, once no version that reads the old form can be rolled back to, drop it
   in a migration whose **first line** says why:

   ```sql
   -- contract: nothing since 0.9.0 reads posts.legacy_body
   ALTER TABLE posts DROP COLUMN legacy_body;
   ```

`pnpm check` (`tooling/migration-guard.mjs`) refuses a `DROP TABLE`, `DROP COLUMN`,
`DROP INDEX`, `DROP TRIGGER`, `DROP VIEW` or `RENAME` without that line. cf records a migration
by its file name only, so the line may be added to an applied migration.

For the same reason a migration on main is never renamed: under a new name it applies again. A
number settles when the branch lands. `node tooling/contract-rebase.mjs` moves the branch's own
migrations above main's, and `node tooling/migration-guard.mjs --base origin/main` (pre-push, and
CI on a PR) refuses one at or below main's top. It reads only what the branch adds: since required
checks need not be up to date with main, a green PR can still land a number another just took, which
does no harm by file name and which no later PR could correct. A test that finds its migration by
the number alone (`startsWith("0034_")`) follows by hand; one that names the whole file moves with it.

## The way back

Try them in this order. Each step undoes less of what people did since.

### 1. The code

```bash
node scripts/ops.ts rollback --version <the version from the run's summary>
cf workers deployments list --worker spjall-api --per-page 1   # that version, at 100%
curl --fail https://spjall.samtak.is/health
```

D1 is untouched, which the expand-only migrations make safe. Secrets are per Worker, not per
version, so the old version reads the current ones. To go forward again, run the next deploy,
or `rollback --version` with the newer id.

### 2. One community's space

A community's posts, comments and reactions live in its Space object, which keeps 30 days of
point-in-time recovery. Going back one space touches no other community:

```bash
node scripts/ops.ts restore-space <communityId> --at 2026-10-18T07:30:00Z
```

`OPS_TOKEN` must be set (above). The answer is the
bookmark that undoes it, and what reconciling with D1 changed:

```json
{
  "undo": "…",
  "postsDeleted": 0,
  "postsUnindexed": 1,
  "accountsForgotten": 0,
  "commentsModerated": 0
}
```

D1 stays the truth, so right after the restore:

- a post deleted since is deleted again;
- a post written since leaves the feed, and its images are deleted;
- the content of an account deleted since is forgotten again;
- each comment takes the state the moderation log last gave it.

**It does bring back** comments and reactions their authors deleted after that time, since D1
keeps no record of them. Weigh that before running it. To undo the restore:

```bash
node scripts/ops.ts restore-space <communityId> --bookmark <undo>
```

The undo brings back the space as it was, then reconciles again, so a post written after the
time does not come back to the feed: the first restore removed it from the index and deleted its
images. A time within about a minute of the space's first post answers 400 `restore_too_early`,
since the object's history starts a little after it was created.

A deleted community answers 404: its space went with it and is not brought back. A
conversation has no restore (decision 0068): it is fixed forward.

### 3. D1

The last resort. Time Travel puts the whole database back, and every write since is lost:
sign-ins, messages' metadata, posts, moderation, deletions.

```bash
node scripts/ops.ts bookmark --at 2026-10-18T07:30:00Z      # or the one in the run's summary
node scripts/ops.ts restore-d1 --bookmark <bookmark> --yes
```

The restore prints the bookmark of the state it replaced (`previous_bookmark`); keep it, it undoes the restore the
same way. After a D1 restore, a deletion (an account, a post, a community) that happened since
is undone in D1 but not in the objects or R2, so run step 1 first when the code alone can fix it.

### R2 has no way back

Media and profile photos are written once under a new key and never overwritten. A key goes
away by the media bucket's 31-day lifecycle rule, by its owner, or with a deleted post, account
or community, and nothing brings it back. A backup bucket would be a decision of its own.

A history transfer (`history/<linkId>` in the media bucket, decision 0074) lives at most 24
hours: the linked device deletes it once it has imported it, the minute cron deletes every
transfer past its 24 hours (`history.expired` in the logs, with a count), and the bucket's
1-day `history/` rule is the backstop. A transfer that is gone is sent again from the phone by
linking again.

## Jobs

```bash
node scripts/ops.ts jobs                 # counts per state and kind, the failed ones, the stuck ones
node scripts/ops.ts jobs retry --failed  # every failed job pending again, attempts reset
node scripts/ops.ts jobs retry 41 42     # only these
node scripts/ops.ts jobs drain           # run the due jobs now, until none is due
```

A job fails after its last attempt, and its `error` says why. Fix the cause and deploy first:
a retry runs the same handler again. A job is stuck when it has been due for more than an hour,
which means the cron has not run: look at the Worker's Cron Triggers in the dashboard.

## Platform moderators

A platform moderator reads the platform report queue, reads the moderation log and reports of a
deleted community for a year, can restore a deleted community within its first 30 days, and can
clear an account's photo with `POST /v1/moderation/actions`, which also closes a report on that
account ([decision 0063](decisions/0063-communities-audiences-and-moderation.md),
[decision 0066](decisions/0066-moderation-in-d1.md),
[decision 0070](decisions/0070-community-deletion-and-declined-requests.md),
[decision 0115](decisions/0115-the-wall.md)).

A person may ask once for a review of a hidden or removed post or comment or a cleared photo, and a
platform moderator answers at `/moderation`, never the one who acted or the one who asked. With one
platform moderator, a review of that moderator's own action waits until there is a second: that is
correct, not a stuck queue.

Every platform moderator is told on the web when a report reaches the queue, except the one who made
it, by one notice that goes when the queue empties. No app and no push says so, so nobody is told
who does not open the web ([decision 0115](decisions/0115-the-wall.md)).

The role is never granted by a route:

```bash
# Grant the role to an account:
cf d1 execute spjall-db --remote --command \
  "INSERT INTO platform_moderators (account_id, added_at) VALUES ('<accountId>', $(date +%s%3N))"

# Remove the role:
cf d1 execute spjall-db --remote --command \
  "DELETE FROM platform_moderators WHERE account_id = '<accountId>'"

# List current platform moderators:
cf d1 execute spjall-db --remote --command \
  "SELECT account_id, added_at FROM platform_moderators ORDER BY added_at"
```

### Lifting a suspension by hand

A platform moderator lifts a suspension from the moderation page, which logs it and tells the
person (decision 0115). Use the database only when no moderator can act, for instance when the
only one is the suspended account. This write leaves no log entry and sends no notice, so tell
the person yourself and note why:

```bash
cf d1 execute spjall-db --remote --command \
  "UPDATE accounts SET suspended_at = NULL, suspended_until = NULL WHERE account_id = '<accountId>'"
```

## Testers

Testers reach the maintainer directly and are added by hand
([decision 0084](decisions/0084-testers-reach-the-maintainer-directly.md)). Nothing in the
Worker queues them, and no job runs on the maintainer's machine for them. The link the
maintainer sends a would-be tester is the public guide at https://spjall.samtak.is/testers
([decision 0112](decisions/0112-tester-guide-in-the-web-app.md)): it walks the Play opt-in and
TestFlight screens, and the maintainer adds the tester's address afterwards.

## Renaming a word in the UI

A UI noun is one entry in `brand/<name>/terms.is.json` (decision 0117). No identifier, route, table, string key or API
field changes with it, so nothing here needs a migration or an `api: breaking` label.

1. `node tooling/terms-forms.mjs <headword>` prints the forms from BÍN. Exit 3 means BÍN did not answer, not that the word
   has no forms. `--prefix` builds a compound BÍN has no headword for.
2. Put the forms in the term, set its gender and agreement words for that gender, and move the old forms to `retired`.
3. `pnpm brand:gen`, then `pnpm check`. The gate names any string that still holds a raw form.
4. Read every string that carries the token: a new gender can read wrong where no table sees it. Run
   `node tooling/mac-remote.mjs android` and re-record the screenshots that show the word (`docs/testing.md`).

## Monitoring

The daily cron logs these with counts only (decision 0008):

| Event         | Fields                       | Means                                    |
| ------------- | ---------------------------- | ---------------------------------------- |
| `jobs.failed` | `code` (kind), `count`       | jobs of that kind failed in the last day |
| `jobs.stuck`  | `code` (kind), `count`       | jobs of that kind due for over an hour   |
| `ops.*`       | `code`, `count`, `requestId` | a maintainer's call to `/ops`            |

Find them in Workers Logs (dashboard → spjall-api → Logs) by `event`.

**An alert on the Worker's errors** is the maintainer's step, once. Workers Observability
reports a new issue (an exception, an error rate) as a real-time issue; this policy sends it by
email:

```bash
cf alerting policies create --body '{
  "name": "spjall-api: issues",
  "alert_type": "workers_observability_real_time_issue",
  "enabled": true,
  "filters": {},
  "mechanisms": { "email": [{ "id": "<the maintainer address>" }] }
}'
```

Or in the dashboard: Notifications → Add → Workers Observability → Real-Time Issue.
