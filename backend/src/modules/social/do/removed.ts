// The comments removed REMOVED_KEPT_MS ago, erased by the Space's alarm.
import { REMOVED_KEPT_MS } from "./space-schema.ts";

/**
 * Deletes the comments removed REMOVED_KEPT_MS before `now`; returns when the
 * next one is due, or null. A top-level comment kept as a tombstone (0071)
 * holds no text and no author, so it is not a removal the alarm erases: it
 * stays until its last visible reply goes with it, and the alarm never waits
 * on it.
 */
export function sweepRemoved(sql: SqlStorage, now: number): number | null {
  const kept = "state = 'removed' AND moderated_at <= ? AND author != ''";
  sql.exec(`DELETE FROM comments WHERE ${kept}`, now - REMOVED_KEPT_MS);
  sql.exec(
    "DELETE FROM comment_reactions WHERE comment_id NOT IN (SELECT comment_id FROM comments)",
  );
  const next = sql
    .exec<{ at: number | null }>(
      `SELECT MIN(moderated_at) AS at FROM comments WHERE ${kept}`,
      now - REMOVED_KEPT_MS,
    )
    .one().at;
  return next === null ? null : next + REMOVED_KEPT_MS;
}
