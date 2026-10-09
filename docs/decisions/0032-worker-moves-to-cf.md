# 0032. The Worker moves to the cf CLI now, in two steps

- Status: accepted; designed, not yet implemented
- Date: 2026-10-09
- Decided by: the maintainer, deciding #37

## Decision

#37 proposed moving the Worker from Wrangler to Cloudflare's `cf` CLI. A spike of
`cf@1.0.0-beta.13 migrate` on `backend/` carried over the vars, D1 by id, R2 with
`jurisdiction: "eu"`, the rate limits, the cron, the custom domain and observability, and left
four required items. Wrangler stays maintained until about 2028-03, but the move is made now,
not at the end of that window: a switch made while both tools work can be checked against the
old one, and one made under a deadline cannot.

It is made in two steps, so the one step that cannot be undone is taken alone.

1. **Durable Object classes move from `migrations` to `exports`, still under Wrangler.** cf
   has no `migrations`; it declares classes in `exports`. Cloudflare documents that a Worker
   moves from `migrations` to `exports` with no data migration: the namespaces stay, only the
   configuration changes, provided every live class is declared with the storage it was
   created with (`Conversation` and `Inbox`, `sqlite`, from tag `v1`). Once deployed, a Worker
   cannot return to `migrations`. Before the deploy, the namespace ids and the count of objects
   with stored data are recorded through the API, and afterwards they are compared, and the app
   reads an existing conversation. `tooling/jurisdiction-check.mjs` refuses `migrations` coming
   back, a live class missing from `exports`, and any storage but `sqlite`.
2. **The Worker builds, tests and deploys with `cf` from `cloudflare.config.ts`.**
   `wrangler.jsonc` is removed in the same PR: one config for one Worker. The guards read the
   new config through `tooling/lib/worker-config.mjs`, the only reader (#118). D1 migrations
   move to `cf d1 migrations apply --dir` (with `--local --persist-to` for development). The
   tests run from the new config, or from a config generated from it and checked for drift in
   `pnpm check`; never from a second hand-written one. `cf` and `@cloudflare/config` are pinned
   to exact versions, since both are beta and may change without notice.

## Rules out

- Two hand-written config files for the same Worker, even for a transition.
- Translating the old `migrations` history into `exports` tombstones: only the live classes
  are declared.
- Taking step 2 before step 1 is deployed and verified.
- A floating version range for `cf` or `@cloudflare/config`.
