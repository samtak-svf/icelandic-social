import { db } from "../../env/index.ts";
import { authors } from "../social/index.ts";

// The caller's notifications, newest first, and marking them read.

/** A notification is kept this long. */
const KEPT_MS = 90 * 24 * 60 * 60 * 1000;

/** A deleted community's notifications are not shown, and go when it is purged (0070). */
const LIVE = "EXISTS (SELECT 1 FROM live_communities c WHERE c.community_id = n.community_id)";

type Row = {
  notification_id: string;
  kind: "comment" | "reaction" | "join_approved" | "moderated";
  actor_id: string | null;
  community_id: string;
  post_id: string | null;
  comment_id: string | null;
  action: string | null;
  emoji: string | null;
  created_at: number;
  read_at: number | null;
};

/** A page of `accountId`'s notifications created before `before`, with its unread count. */
export async function notificationPage(
  env: Env,
  accountId: string,
  before: number | null,
  limit: number,
) {
  const [page, unread] = await db(env).batch<Row | { n: number }>([
    db(env)
      .prepare(
        `SELECT notification_id, kind, actor_id, community_id, post_id, comment_id, action,
                emoji, created_at, read_at
           FROM notifications n WHERE account_id = ?1 AND (?2 IS NULL OR created_at < ?2)
            AND ${LIVE}
          ORDER BY created_at DESC LIMIT ?3`,
      )
      .bind(accountId, before, limit + 1),
    db(env)
      .prepare(
        `SELECT COUNT(*) AS n FROM notifications n
          WHERE account_id = ? AND read_at IS NULL AND ${LIVE}`,
      )
      .bind(accountId),
  ]);
  const rows = (page?.results ?? []) as Row[];
  const shown = rows.slice(0, limit);
  const names = await authors(
    env,
    shown.flatMap((r) => (r.actor_id ? [r.actor_id] : [])),
  );
  const last = shown.at(-1);
  return {
    notifications: shown.map((r) => ({
      notificationId: r.notification_id,
      kind: r.kind,
      actor: (r.actor_id && names.get(r.actor_id)) || null,
      communityId: r.community_id,
      postId: r.post_id,
      commentId: r.comment_id,
      action: r.action,
      emoji: r.emoji,
      createdAt: r.created_at,
      read: r.read_at !== null,
    })),
    unread: ((unread?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0,
    next: rows.length > limit && last ? String(last.created_at) : null,
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
