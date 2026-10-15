# 0058. The beta starts again from no accounts

- Status: accepted; implemented in the backend (#250), run once in production on 2026-10-15, then removed
- Date: 2026-10-15
- Decided by: the maintainer, choosing a clean slate for the beta testers
- Builds on: [0014](0014-accounts-devices-and-auth.md) (deleting an account),
  [0008](0008-no-pii-in-logs.md) (what a log line may carry)

## Decision

- **Every account is deleted once, in production**, with everything it owns: devices,
  KeyPackages, identities, invites, blocks, roster places, inboxes, conversations, messages,
  media and profile photos. The testers sign in again from a new operator invite.
- **Each account goes through `deleteAccount`**, the path of `DELETE /v1/me`, so the wipe
  deletes nothing in a way the app's own deletion does not.
- **Then whatever no account owns**: operator invites (they have no inviter, so nothing
  cascades to them), roster copies no member is left in, with their Conversation objects,
  rows a cascade missed, and R2 objects in `spjall-media` and `spjall-profiles` that no row
  names. After it every table of the D1 database but the migrations' own is empty, and so
  are both buckets.
- **It is an operator route, `POST /operator/wipe`**, outside `/v1` and outside the contract
  (0005): no client calls it. It answers 404 unless the Worker secret `OPERATOR_WIPE_TOKEN`
  is set, and 404 again for any other bearer token, compared as SHA-256 digests in constant
  time. Each call deletes at most ten accounts and answers counts only; `pnpm --filter
  spjall-backend wipe:operator` calls it until nothing is left. Its log line carries a count
  and the request id (0008).
- **It is run once, then removed.** The secret is deleted from the Worker after the run, and
  a follow-up PR removes the route, the script, the secret's row and `Conversation.purge`.
  This record stays.

## Why

The testers' accounts carry state from every protocol change since the first build: roster
copies, KeyPackages and conversations made by apps that have since changed how they make
them. Starting again costs the testers their test conversations, which are theirs to lose
and hold nothing worth keeping, and it lets every later problem be read against data made by
the current builds.

Deleting through `deleteAccount` rather than emptying the tables keeps one way of deleting
an account, the one the tests already hold, and reaches the Durable Objects and R2 objects a
SQL `DELETE` cannot.

## Rules out

- Emptying the tables or recreating the database, which would leave the Inbox and
  Conversation objects and the R2 objects behind.
- Keeping the route after the run. A route that deletes everything is a standing risk, even
  behind a secret.
- Doing it again without a new record.
