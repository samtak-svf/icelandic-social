import { db } from "../../env/index.ts";
import { authors } from "../social/index.ts";

// The caller's notifications, newest first, and marking them read.

/** A notification is kept this long. */
const KEPT_MS = 90 * 24 * 60 * 60 * 1000;

/** A deleted community's notifications are not shown, and go when it is purged (0070). */
const LIVE = "EXISTS (SELECT 1 FROM live_communities c WHERE c.community_id = n.community_id)";

/** How many actors a row names. */
const SHOWN = 3;

type Row = {
  notification_id: string;
  kind: "comment" | "reply" | "reaction" | "join_approved" | "moderated";
  actor_id: string | null;
  community_id: string;
  post_id: string | null;
  comment_id: string | null;
  action: string | null;
  emoji: string | null;
  created_at: number;
  read_at: number | null;
};

type Actors = { notification_id: string; actor_id: string; n: number };

/** The newest `SHOWN` distinct actors of each of `ids`, and how many distinct actors each has. */
const ACTORS = `
  WITH latest AS (
    SELECT notification_id, actor_id, MAX(created_at) AS at
      FROM notification_actors WHERE notification_id IN (SELECT value FROM json_each(?1))
     GROUP BY notification_id, actor_id
  ), ranked AS (
    SELECT notification_id, actor_id,
           ROW_NUMBER() OVER (PARTITION BY notification_id ORDER BY at DESC, actor_id) AS rank,
           COUNT(*) OVER (PARTITION BY notification_id) AS n
      FROM latest
  )
  SELECT notification_id, actor_id, n FROM ranked WHERE rank <= ${SHOWN} ORDER BY notification_id, rank`;

/** The caller's counts: unread, unseen (unread and newer than `seenAt`), and `seenAt` itself. */
async function counters(env: Env, accountId: string) {
  const row = await db(env)
    .prepare(
      `WITH seen AS (SELECT seen_at FROM notification_seen WHERE account_id = ?1),
            unread AS (SELECT created_at FROM notifications n
                        WHERE account_id = ?1 AND read_at IS NULL AND ${LIVE})
       SELECT (SELECT COUNT(*) FROM unread) AS unread,
              (SELECT COUNT(*) FROM unread
                WHERE created_at > COALESCE((SELECT seen_at FROM seen), 0)) AS unseen,
              (SELECT seen_at FROM seen) AS seen_at`,
    )
    .bind(accountId)
    .first<{ unread: number; unseen: number; seen_at: number | null }>();
  return { unread: row?.unread ?? 0, unseen: row?.unseen ?? 0, seenAt: row?.seen_at ?? null };
}

/** The newest actors of each of `ids`, and how many distinct actors each has. */
async function actorsOf(env: Env, ids: string[]) {
  const { results } = await db(env).prepare(ACTORS).bind(JSON.stringify(ids)).all<Actors>();
  const named = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const a of results) {
    named.set(a.notification_id, [...(named.get(a.notification_id) ?? []), a.actor_id]);
    counts.set(a.notification_id, a.n);
  }
  return { named, counts, ids: results.map((a) => a.actor_id) };
}

/** A page of `accountId`'s notifications created before `before`, with its counts. */
export async function notificationPage(
  env: Env,
  accountId: string,
  before: number | null,
  limit: number,
) {
  const [{ results }, count] = await Promise.all([
    db(env)
      .prepare(
        `SELECT notification_id, kind, actor_id, community_id, post_id, comment_id, action,
                emoji, created_at, read_at
           FROM notifications n WHERE account_id = ?1 AND (?2 IS NULL OR created_at < ?2)
            AND ${LIVE}
          ORDER BY created_at DESC LIMIT ?3`,
      )
      .bind(accountId, before, limit + 1)
      .all<Row>(),
    counters(env, accountId),
  ]);
  const shown = results.slice(0, limit);
  const actors = await actorsOf(
    env,
    shown.map((r) => r.notification_id),
  );
  const names = await authors(env, [
    ...shown.flatMap((r) => (r.actor_id ? [r.actor_id] : [])),
    ...actors.ids,
  ]);
  const last = shown.at(-1);
  return {
    notifications: shown.map((r) => ({
      notificationId: r.notification_id,
      kind: r.kind,
      actor: (r.actor_id && names.get(r.actor_id)) || null,
      actors: (actors.named.get(r.notification_id) ?? []).flatMap((id) => names.get(id) ?? []),
      actorCount: actors.counts.get(r.notification_id) ?? 0,
      communityId: r.community_id,
      postId: r.post_id,
      commentId: r.comment_id,
      action: r.action,
      emoji: r.emoji,
      createdAt: r.created_at,
      read: r.read_at !== null,
    })),
    ...count,
    next: results.length > limit && last ? String(last.created_at) : null,
  };
}

/** Marks `accountId`'s notifications created at or before `upTo` read. */
export async function markRead(env: Env, accountId: string, upTo: number): Promise<void> {
  await db(env)
    .prepare(
      `UPDATE notifications SET read_at = ?3
        WHERE account_id = ?1 AND created_at <= ?2 AND read_at IS NULL`,
    )
    .bind(accountId, upTo, Date.now())
    .run();
}

/** Marks one notification of `accountId` read, or unread again; whether it is there. */
export async function setRead(
  env: Env,
  accountId: string,
  notificationId: string,
  read: boolean,
): Promise<boolean> {
  const { meta } = await db(env)
    .prepare(
      `UPDATE notifications SET read_at = CASE WHEN ?3 THEN COALESCE(read_at, ?4) END
        WHERE account_id = ?1 AND notification_id = ?2`,
    )
    .bind(accountId, notificationId, read ? 1 : 0, Date.now())
    .run();
  return meta.changes > 0;
}

/** Deletes one notification of `accountId`, with its actors; whether it was there. */
export async function removeNotification(
  env: Env,
  accountId: string,
  notificationId: string,
): Promise<boolean> {
  const { meta } = await db(env)
    .prepare("DELETE FROM notifications WHERE account_id = ? AND notification_id = ?")
    .bind(accountId, notificationId)
    .run();
  return meta.changes > 0;
}

/** Records that `accountId` has seen its notifications up to `upTo`; never moves back. */
export async function markSeen(env: Env, accountId: string, upTo: number): Promise<void> {
  await db(env)
    .prepare(
      `INSERT INTO notification_seen (account_id, seen_at) VALUES (?1, ?2)
       ON CONFLICT (account_id) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)`,
    )
    .bind(accountId, upTo)
    .run();
}

/** Deletes the notifications older than 90 days at `now`; their count. */
export async function expireNotifications(env: Env, now = Date.now()): Promise<number> {
  const { meta } = await db(env)
    .prepare("DELETE FROM notifications WHERE created_at < ?")
    .bind(now - KEPT_MS)
    .run();
  return meta.changes;
}

/** Deletes a purged community's notifications (decision 0070). */
export async function forgetCommunity(env: Env, communityId: string): Promise<void> {
  await db(env).prepare("DELETE FROM notifications WHERE community_id = ?").bind(communityId).run();
}
