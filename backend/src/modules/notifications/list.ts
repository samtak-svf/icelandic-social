import { db } from "../../env/index.ts";
import type { NoticeReach } from "../../shared/client-version.ts";
import { authors } from "../social/index.ts";
import { announcer } from "./settings.ts";
import { snippetOf } from "./snippet.ts";

// The caller's notifications, newest first, and marking them read.

/** A notification is kept this long. */
const KEPT_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * A deleted community's notifications are not shown, and go when it is purged
 * (0070). A row with no community has none to be deleted (0114).
 */
const LIVE = `(n.community_id IS NULL OR EXISTS
  (SELECT 1 FROM live_communities c WHERE c.community_id = n.community_id))`;

/** The kinds an app below `NOTICE_CLIENT_VERSION` knows. Frozen: a new kind stays out of it. */
const OLD_KINDS = ["comment", "reply", "reaction", "join_approved", "moderated"];

/** The actions on a notice such an app words correctly. Frozen, as the kinds are. */
const OLD_ACTIONS = [
  "hide_post",
  "remove_post",
  "hide_comment",
  "remove_comment",
  "decline_anonymous_post",
];

/**
 * What a client is shown (0114). An app below `NOTICE_CLIENT_VERSION` fails its
 * whole page on a null community and does not know a new kind, so neither
 * reaches its list or its counts. It reads a new action as "unknown" and words
 * it as a removal, so that stays out as well (0115). An app that decodes every
 * row may still word a suspension that way, until its core knows the action.
 */
export function shownTo(reach: NoticeReach): string {
  if (reach === "all") return LIVE;
  if (reach === "decoding") {
    return `${LIVE} AND (n.action IS NULL OR n.action NOT IN ('suspend_account', 'unsuspend_account'))`;
  }
  const kinds = OLD_KINDS.map((k) => `'${k}'`).join(", ");
  const actions = OLD_ACTIONS.map((a) => `'${a}'`).join(", ");
  return `${LIVE} AND ((n.community_id IS NOT NULL AND n.kind IN (${kinds})
    AND (n.action IS NULL OR n.action IN (${actions}))) OR n.action = 'suspend_account')`;
}

/** How many actors a row names. */
const SHOWN = 3;

type Row = {
  notification_id: string;
  kind: "comment" | "reply" | "reaction" | "join_approved" | "moderated";
  actor_id: string | null;
  community_id: string | null;
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
async function counters(env: Env, accountId: string, reach: NoticeReach) {
  const row = await db(env)
    .prepare(
      `WITH seen AS (SELECT seen_at FROM notification_seen WHERE account_id = ?1),
            unread AS (SELECT created_at FROM notifications n
                        WHERE account_id = ?1 AND read_at IS NULL AND ${shownTo(reach)})
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
  reach: NoticeReach,
) {
  const [{ results }, count, announces] = await Promise.all([
    db(env)
      .prepare(
        `SELECT notification_id, kind, actor_id, community_id, post_id, comment_id, action,
                emoji, created_at, read_at
           FROM notifications n WHERE account_id = ?1 AND (?2 IS NULL OR created_at < ?2)
            AND ${shownTo(reach)}
          ORDER BY created_at DESC LIMIT ?3`,
      )
      .bind(accountId, before, limit + 1)
      .all<Row>(),
    counters(env, accountId, reach),
    announcer(env, accountId),
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
  const snippets = await Promise.all(
    shown.map((r) =>
      snippetOf(env, accountId, { kind: r.kind, postId: r.post_id, commentId: r.comment_id }),
    ),
  );
  const last = shown.at(-1);
  return {
    notifications: shown.map((r, i) => ({
      notificationId: r.notification_id,
      kind: r.kind,
      ...(r.kind === "moderated"
        ? // A moderator acts in the community's or the platform's name, never their own (0115).
          { actor: null, actors: [], actorCount: 0 }
        : {
            actor: (r.actor_id && names.get(r.actor_id)) || null,
            actors: (actors.named.get(r.notification_id) ?? []).flatMap(
              (id) => names.get(id) ?? [],
            ),
            actorCount: actors.counts.get(r.notification_id) ?? 0,
          }),
      communityId: r.community_id,
      postId: r.post_id,
      commentId: r.comment_id,
      action: r.action,
      emoji: r.emoji,
      createdAt: r.created_at,
      read: r.read_at !== null,
      announce: r.read_at === null && announces(r),
      snippet: snippets[i] ?? null,
    })),
    ...count,
    next: results.length > limit && last ? String(last.created_at) : null,
  };
}

/** Marks the notifications `accountId` is shown, created at or before `upTo`, read. */
export async function markRead(
  env: Env,
  accountId: string,
  upTo: number,
  reach: NoticeReach,
): Promise<void> {
  await db(env)
    .prepare(
      `UPDATE notifications AS n SET read_at = ?3
        WHERE account_id = ?1 AND created_at <= ?2 AND read_at IS NULL AND ${shownTo(reach)}`,
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
