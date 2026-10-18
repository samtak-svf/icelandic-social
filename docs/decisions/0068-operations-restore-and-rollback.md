# 0068. Rollback is code only; D1 and a community's space have a way back in time

- Status: accepted; implemented in the backend, deploy.yml and docs/operations.md (#296)
- Date: 2026-10-18
- Decided by: Guðröður Atli Jónsson (phase 5, #307)
- Builds on: [0001](0001-eu-storage-and-residency-wording.md) (EU jurisdiction), [0008](0008-no-pii-in-logs.md)
  (no PII in logs), [0065](0065-the-space-object-and-social-media.md) (the Space object),
  [0067](0067-jobs-and-notifications.md) (jobs in D1)

## Decision

- **A rollback is the code, never the data.** A D1 migration only adds: a table, a column,
  an index. A drop or a rename comes in a later migration, once no version still live reads
  what it removes, and that migration's first line says so: `-- contract: <reason>`.
  `tooling/migration-guard.mjs` (in `pnpm check`) refuses a `DROP TABLE`, `DROP COLUMN`,
  `DROP INDEX`, `DROP TRIGGER`, `DROP VIEW` or `RENAME` without that line. So the Worker can
  always go back to the version before it, with `cf workers deployments create`, while D1
  stays as it is.
- **Every deploy writes its way back first.** Before the migrations, `deploy.yml` writes to the
  run's summary a D1 Time Travel bookmark and the id of the Worker version that served until
  then (`node scripts/ops.ts way-back`). Ids only, nothing about a person.
- **D1 goes back by Time Travel**, to that bookmark or to a time within 30 days
  (`scripts/ops.ts restore-d1`). It overwrites every write since, of every person, so it is
  the last resort, after a code rollback has not been enough.
- **One community's space goes back by the Durable Object's point-in-time recovery.**
  `POST /ops/restore` takes `{kind: "space", communityId, at | bookmark}` and the `OPS_TOKEN`
  secret as a bearer token (vault: `samtak-spjall-ops-token`, read only in `env/`, compared in
  constant time). Without the secret, with another one or while it is unset, every `/ops` route
  answers as an unknown route does: 404. The answer carries a bookmark that undoes the restore.
- **D1 stays the truth after a space goes back.** The restore reconciles the space with it at
  once: a post deleted since is deleted again, a post written since leaves the index with its
  images, the content of an account deleted since is forgotten again, and each comment takes the
  state the moderation log last gave it. A deleted community's space is not brought back.
- **The log of `/ops` carries the kind and the outcome**, with the request id and counts, and
  never a community id, an account or a body.
- **R2 has no way back in time.** Media keys are written once and never overwritten; a key goes
  away by its lifecycle rule or a deletion, and does not come back. A backup bucket is a later
  decision.
- **Jobs are watched.** The daily cron logs `jobs.failed` (in the last day) and `jobs.stuck`
  (due for over an hour) as counts per kind. `GET /ops/jobs` shows counts per state and kind
  with the failed ones; `POST /ops/jobs/retry` makes failed jobs pending again, and
  `POST /ops/jobs/drain` runs them until none is due. A Cloudflare Notification policy on the
  Worker's errors is the maintainer's step (docs/operations.md).

## Why

Nothing went back before this. A migration ran forward only and nothing kept the version before
it working on the new schema, so a bad deploy could only be fixed forward. No bookmark was taken,
posts lived in an object no procedure reached, and nobody read a failed job. Keeping the schema
expand-only makes the cheap way back (the code) always safe, and leaves the expensive one (D1)
for what the code cannot undo.

Reconciling a restored space with D1 keeps a restore from bringing back what a person deleted,
or an account that is gone ([0061](0061-account-identity-session-and-device-are-separate.md)), and from undoing a moderator's action. It does bring back
comments and reactions their authors deleted after the time, since D1 has no record of those;
`docs/operations.md` says so before the command.

## What it rules out

- Down-migrations, and a migration that drops or renames without `-- contract:`.
- Restoring D1 to roll back code.
- **Restoring a conversation.** The core first showed conversations beside spaces. A
  Conversation object is the MLS delivery service: its seq numbers and epochs are what the
  devices have already passed, so storage that goes back would hand out a seq twice and refuse
  the commits of an epoch every device is already in. A conversation is fixed forward, never
  wound back.
- An `/ops` route that answers without the secret, or says it exists.
- A community id, an account or any personal data in the deploy summary or the `/ops` log.
