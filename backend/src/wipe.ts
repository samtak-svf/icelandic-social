// The one-off operator wipe (decision 0058): every account is deleted the way
// `DELETE /v1/me` deletes one, then whatever no account owns any more, so the
// beta starts again from nothing. It runs once in production and a follow-up
// PR removes this file, its route and its secret.
//
// It is not in api/openapi.json: no client calls it, and like the operator
// invite (scripts/invite-operator.ts) it is the operator's, not the contract's
// (decision 0005). src/index.ts adds it to the app, not createApp, so the
// document never sees it. It sits outside /v1, so no device token or client build is
// asked for; a bearer token of its own guards it, and while that secret is
// unset the route answers 404 like any path that does not exist.

import type { OpenAPIHono } from "@hono/zod-openapi";
import { deleteAccount } from "./accounts.ts";
import type { AppEnv } from "./app.ts";
import { conversation, db, mediaBucket, operatorWipeToken, profilesBucket } from "./env/index.ts";
import { fail } from "./errors.ts";
import { log } from "./log.ts";

export const WIPE_PATH = "/operator/wipe";

/**
 * Accounts deleted per call. Each takes a handful of D1 queries, two Inbox
 * calls, one call per conversation and two R2 deletes; ten stay far inside a
 * request's subrequest and CPU limits, and the script calls until none is left.
 */
export const ACCOUNTS_PER_CALL = 10;

/** Leftover roster copies, and so Conversation objects, purged per call. */
const CONVERSATIONS_PER_CALL = 50;

/** One R2 list page, which is also the most keys one delete takes. */
const OBJECTS_PER_PAGE = 1000;

/**
 * Rows that no account owns any more. The foreign keys cascade, so after the
 * last account none should be left; these catch what a cascade did not reach.
 * An operator invite has no inviter and never cascades, so every one goes.
 */
const ORPHANS: { table: string; where: string }[] = [
  { table: "key_packages", where: "device_id NOT IN (SELECT device_id FROM devices)" },
  { table: "devices", where: "account_id NOT IN (SELECT account_id FROM accounts)" },
  { table: "identities", where: "account_id NOT IN (SELECT account_id FROM accounts)" },
  {
    table: "blocks",
    where: `blocker_account_id NOT IN (SELECT account_id FROM accounts)
         OR blocked_account_id NOT IN (SELECT account_id FROM accounts)`,
  },
  { table: "conversation_members", where: "account_id NOT IN (SELECT account_id FROM accounts)" },
  { table: "media", where: "uploader_account_id NOT IN (SELECT account_id FROM accounts)" },
  { table: "invites", where: "inviter_account_id IS NULL" },
];

/** A roster copy no member is left in. */
const ORPHAN_ROSTER = "conversation_id NOT IN (SELECT conversation_id FROM conversation_members)";

/** What one call did: counts only (decision 0008). */
export type WipeResult = {
  /** Accounts deleted by this call. */
  deleted: number;
  /** Accounts still there. */
  remaining: number;
  /** Rows, roster copies and objects no account owns, still there (counted once no account is). */
  leftovers: number;
};

/**
 * Deletes up to `ACCOUNTS_PER_CALL` accounts through `deleteAccount`, and once
 * none is left, the leftovers. Called again until both counts are zero.
 */
async function wipe(env: Env): Promise<WipeResult> {
  const { results } = await db(env)
    .prepare(`SELECT account_id AS id FROM accounts ORDER BY account_id LIMIT ?`)
    .bind(ACCOUNTS_PER_CALL)
    .all<{ id: string }>();
  for (const { id } of results) await deleteAccount(env, id);
  const remaining = await count(env, "accounts", "1");
  if (remaining > 0) return { deleted: results.length, remaining, leftovers: 0 };
  await clearLeftovers(env);
  return { deleted: results.length, remaining, leftovers: await countLeftovers(env) };
}

async function clearLeftovers(env: Env): Promise<void> {
  const { results: rosters } = await db(env)
    .prepare(
      `SELECT conversation_id AS id FROM conversation_rosters WHERE ${ORPHAN_ROSTER} LIMIT ?`,
    )
    .bind(CONVERSATIONS_PER_CALL)
    .all<{ id: string }>();
  for (const { id } of rosters) {
    await conversation(env, id).purge();
    await db(env)
      .prepare("DELETE FROM conversation_rosters WHERE conversation_id = ?")
      .bind(id)
      .run();
  }
  await db(env).batch(
    ORPHANS.map(({ table, where }) => db(env).prepare(`DELETE FROM ${table} WHERE ${where}`)),
  );
  // An object is kept only while a row still names it.
  await deleteUnowned(env, mediaBucket(env), "media", "media_id");
  await deleteUnowned(env, profilesBucket(env), "accounts", "account_id");
}

/** Deletes the objects of one list page whose key no row of `table` holds in `column`. */
async function deleteUnowned(
  env: Env,
  bucket: R2Bucket,
  table: string,
  column: string,
): Promise<void> {
  const keys = (await bucket.list({ limit: OBJECTS_PER_PAGE })).objects.map((o) => o.key);
  if (!keys.length) return;
  const { results } = await db(env)
    .prepare(
      `SELECT ${column} AS id FROM ${table} WHERE ${column} IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(keys))
    .all<{ id: string }>();
  const kept = new Set(results.map((r) => r.id));
  const unowned = keys.filter((key) => !kept.has(key));
  if (unowned.length) await bucket.delete(unowned);
}

async function countLeftovers(env: Env): Promise<number> {
  const counts = await Promise.all([
    ...ORPHANS.map(({ table, where }) => count(env, table, where)),
    count(env, "conversation_rosters", ORPHAN_ROSTER),
  ]);
  const objects = await Promise.all(
    [mediaBucket(env), profilesBucket(env)].map(
      async (bucket) => (await bucket.list({ limit: OBJECTS_PER_PAGE })).objects.length,
    ),
  );
  return [...counts, ...objects].reduce((sum, n) => sum + n, 0);
}

async function count(env: Env, table: string, where: string): Promise<number> {
  const row = await db(env)
    .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Whether `header` carries the wipe token: digests compared in constant time. */
async function authorized(expected: string, header: string | undefined): Promise<boolean> {
  const given = /^Bearer (\S+)$/.exec(header ?? "")?.[1];
  if (!given) return false;
  const digest = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const [a, b] = await Promise.all([digest(expected), digest(given)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export function wipeRoutes(app: OpenAPIHono<AppEnv>): void {
  app.post(WIPE_PATH, async (c) => {
    const expected = operatorWipeToken(c.env);
    // Off, or the wrong token: the same 404 as a path that does not exist.
    if (!expected || !(await authorized(expected, c.req.header("authorization")))) {
      return fail(c, 404, "not_found");
    }
    const result = await wipe(c.env);
    log("operator.wiped", { count: result.deleted, requestId: c.var.requestId });
    return c.json(result, 200);
  });
}
