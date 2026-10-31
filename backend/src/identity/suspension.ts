import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { db } from "../env/index.ts";
import type { AppEnv } from "../http.ts";
import { fail } from "../shared/errors.ts";

// A suspended account (decision 0115). This file alone says what a suspension
// is and who is refused by it: a route that takes a new post, comment, reaction,
// vote, community, membership, invitation or friend request wraps its contract in
// `notSuspended` and has no predicate of its own. A conversation is never touched.

/** A suspension that stands now; `until` null means until a moderator lifts it. */
export type Suspension = { until: number | null };

/** The one predicate. An end date in the past is simply not read as a suspension, so no job runs. */
const STANDS = "suspended_at IS NOT NULL AND (suspended_until IS NULL OR suspended_until > ?)";

/** The statement that reads the suspension of `accountId`, for a batch. */
export function suspensionRead(env: Env, accountId: string): D1PreparedStatement {
  return db(env)
    .prepare(`SELECT suspended_until AS until FROM accounts WHERE account_id = ? AND ${STANDS}`)
    .bind(accountId, Date.now());
}

/** The suspension of `accountId` that stands now, or null. */
export function suspension(env: Env, accountId: string): Promise<Suspension | null> {
  return suspensionRead(env, accountId).first<Suspension>();
}

/** Which of `ids` are suspended now. */
export async function suspendedAmong(env: Env, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await db(env)
    .prepare(
      `SELECT account_id AS id FROM accounts
        WHERE account_id IN (SELECT value FROM json_each(?)) AND ${STANDS}`,
    )
    .bind(JSON.stringify(ids), Date.now())
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

/**
 * Sets or lifts the suspension of `accountId`, with `entries` in the same write.
 * A new one replaces the old one's end date: the latest decides.
 */
export async function setSuspension(
  env: Env,
  accountId: string,
  value: Suspension | null,
  entries: D1PreparedStatement[] = [],
): Promise<void> {
  await db(env).batch([
    db(env)
      .prepare("UPDATE accounts SET suspended_at = ?, suspended_until = ? WHERE account_id = ?")
      .bind(value && Date.now(), value?.until ?? null, accountId),
    ...entries,
  ]);
}

/** The answer that refuses the caller while a suspension stands, or null; for a route only part of which is refused. */
export async function suspendedRefusal(c: Context<AppEnv>) {
  const stands = await suspension(c.env, c.var.session.accountId);
  return stands && fail(c, 403, "suspended", stands.until === null ? {} : { until: stands.until });
}

const refuseWhileSuspended = createMiddleware<AppEnv>(async (c, next) => {
  const refused = await suspendedRefusal(c);
  if (!refused) return next();
  // A refusal cancels the body, so a client that is uploading stops sending it.
  await c.req.raw.body?.cancel();
  return refused;
});

/** `route`, refused to a suspended account before anything else about the request is read. */
export const notSuspended = <R extends object>(route: R) => ({
  ...route,
  middleware: refuseWhileSuspended,
});
