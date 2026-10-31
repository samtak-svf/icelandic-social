import { db } from "../../env/index.ts";
import { SUMMARY, summaryOf, type SummaryRow } from "./summary.ts";

// Snoozing a person (decision 0114): 30 days, tells nobody, liftable early. It
// filters the home feed only (decision 0116), never a notification or the
// person's screen; that feed reads this table through `UNSNOOZED`.

const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * SQL: `viewer` has no snooze on `author` in force at `now`, each a column or a
 * parameter. A snooze past its time is not in force before the sweep removes it.
 */
export const UNSNOOZED = (viewer: string, author: string, now: string) =>
  `NOT EXISTS (SELECT 1 FROM person_snoozes z
     WHERE z.account_id = ${viewer} AND z.target_id = ${author} AND z.until > ${now})`;

/** Snoozes `target` for `me`, from now; undefined when there is no such account. */
export async function snooze(
  env: Env,
  me: string,
  target: string,
  now = Date.now(),
): Promise<number | undefined> {
  const until = now + SNOOZE_MS;
  const written = await db(env)
    .prepare(
      `INSERT INTO person_snoozes (account_id, target_id, until)
       SELECT ?, account_id, ? FROM accounts WHERE account_id = ?
       ON CONFLICT (account_id, target_id) DO UPDATE SET until = excluded.until`,
    )
    .bind(me, until, target)
    .run();
  return written.meta.changes > 0 ? until : undefined;
}

export async function unsnooze(env: Env, me: string, target: string): Promise<void> {
  await db(env)
    .prepare("DELETE FROM person_snoozes WHERE account_id = ? AND target_id = ?")
    .bind(me, target)
    .run();
}

/** Who `me` has snoozed, the soonest back first. */
export async function snoozeList(env: Env, me: string, now = Date.now()) {
  const { results } = await db(env)
    .prepare(
      `SELECT ${SUMMARY}, s.until
         FROM person_snoozes s JOIN accounts a ON a.account_id = s.target_id
        WHERE s.account_id = ? AND s.until > ? ORDER BY s.until, a.account_id`,
    )
    .bind(me, now)
    .all<SummaryRow & { until: number }>();
  return results.map((r) => ({ person: summaryOf(r), until: r.until }));
}

/** The daily sweep's part: a snooze past its time. */
export async function expireSnoozes(env: Env, now = Date.now()): Promise<number> {
  const done = await db(env).prepare("DELETE FROM person_snoozes WHERE until <= ?").bind(now).run();
  return done.meta.changes;
}
