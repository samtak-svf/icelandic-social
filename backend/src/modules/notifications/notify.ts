import { db } from "../../env/index.ts";
import { activeDevices, blockedEither } from "../../identity/index.ts";
import type { Notice } from "../jobs/index.ts";
import type { PushSender } from "../messaging/index.ts";
import { standing } from "../communities/index.ts";
import { areFriends, requestOpen } from "../friends/index.ts";
import { commentContent, postAccess } from "../social/index.ts";
import { levelFor } from "./settings.ts";
import { reportsWaitFor } from "./withdraw.ts";

// The notice job's handler (decisions 0063, 0067, 0103): a notification row for
// the account told, and a push to its devices that names nothing, as for chat
// (decision 0025). Comments, replies and reactions are grouped: one row for each
// account and post (or parent comment), with one actor row for each event. The
// job's key is the event's id, and a push is sent until the event is marked
// sent, so a job run twice has one effect.

/** Whether the account told may still see what it is told of. */
async function stillSo(env: Env, n: Notice): Promise<boolean> {
  if (n.accountId === n.actorId) return false;
  // A moderator's notice goes across a block: nothing is hidden untold.
  if (n.kind === "moderated") return true;
  // Reports waiting have no actor to be blocked: a moderator's duty outranks it (0115).
  if (n.kind === "reports_waiting") return eventStands(env, n);
  if ((await blockedEither(env, n.accountId)).includes(n.actorId)) return false;
  return eventStands(env, n);
}

/** Whether the comment `n` tells of is still visible, on a post the account told can read. */
async function commentStands(env: Env, n: Notice): Promise<boolean> {
  const comment = n.commentId ? await commentContent(env, n.commentId) : null;
  if (comment?.state !== "visible") return false;
  return !!(n.postId && (await postAccess(env, n.accountId, n.postId)));
}

/** Whether what `n` tells of is still there for the account told. */
async function eventStands(env: Env, n: Notice): Promise<boolean> {
  switch (n.kind) {
    case "moderated":
      return true;
    case "comment":
    case "reply":
      return commentStands(env, n);
    case "reaction":
      return !!(n.postId && (await postAccess(env, n.accountId, n.postId)));
    case "join_approved":
      if (n.communityId === null) return false;
      return (await standing(env, n.accountId, n.communityId))?.role === "member";
    case "friend_request":
      return requestOpen(env, n.actorId, n.accountId);
    case "friend_accepted":
      return areFriends(env, n.accountId, n.actorId);
    case "reports_waiting":
      return reportsWaitFor(env, n.accountId);
  }
}

/** The id of the row that `n`, the event `key`, belongs to: a group, or the event itself. */
function groupId(key: string, n: Notice): string {
  // A row with no community never takes in one that has one (decision 0114).
  const scope = n.communityId === null ? "none:" : "";
  switch (n.kind) {
    case "comment":
    case "reaction":
      return n.postId ? `${n.kind}:${scope}${n.postId}:${n.accountId}` : key;
    case "reply":
      return n.parentCommentId ? `reply:${scope}${n.parentCommentId}:${n.accountId}` : key;
    case "reports_waiting":
      return `reports_waiting:${n.accountId}`;
    default:
      return key;
  }
}

/** The state of an event already written, or null when it was not. */
async function written(env: Env, key: string, group: string) {
  const grouped = group !== key;
  return db(env)
    .prepare(
      grouped
        ? "SELECT pushed_at FROM notification_actors WHERE event_id = ?"
        : "SELECT pushed_at FROM notifications WHERE notification_id = ?",
    )
    .bind(key)
    .first<{ pushed_at: number | null }>();
}

/** Writes the group row of `n` and, with it, the actor row of its event `key`. */
async function write(env: Env, key: string, group: string, n: Notice, now: number) {
  const grouped = group !== key;
  await db(env).batch([
    db(env)
      .prepare(
        `INSERT INTO notifications (notification_id, account_id, kind, actor_id, community_id,
                                    post_id, comment_id, action, emoji, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM accounts WHERE account_id = ?2)
            AND (?5 IS NULL OR EXISTS (SELECT 1 FROM live_communities WHERE community_id = ?5))
         ON CONFLICT (notification_id) DO ${
           grouped
             ? `UPDATE SET created_at = excluded.created_at, read_at = NULL,
                           actor_id = excluded.actor_id, comment_id = excluded.comment_id,
                           emoji = excluded.emoji`
             : "NOTHING"
         }`,
      )
      .bind(
        group,
        n.accountId,
        n.kind,
        n.actorId,
        n.communityId,
        n.postId ?? null,
        n.commentId ?? null,
        n.action ?? null,
        n.emoji ?? null,
        now,
      ),
    db(env)
      .prepare(
        `INSERT INTO notification_actors (event_id, notification_id, actor_id, emoji, comment_id,
                                          created_at)
         SELECT ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM notifications WHERE notification_id = ?2)
            AND (?3 IS NULL OR EXISTS (SELECT 1 FROM accounts WHERE account_id = ?3))
         ON CONFLICT (event_id) DO NOTHING`,
      )
      .bind(key, group, n.actorId, n.emoji ?? null, n.commentId ?? null, now),
  ]);
}

/** The handler of the notice job, sending its pushes with `sender`. */
export function noticeHandler(sender: PushSender) {
  return async (env: Env, key: string, payload: Record<string, unknown>): Promise<void> => {
    const n = payload as Notice;
    const group = groupId(key, n);
    const pending = await written(env, key, group);
    if (pending?.pushed_at) return;
    // What the account chose (decision 0106): off tells it nothing, in_app tells it unpushed.
    const level = await levelFor(env, n.accountId, n.kind, n.communityId);
    if (level === "off") return;
    if (!pending) {
      if (!(await stillSo(env, n))) return;
      await write(env, key, group, n, Date.now());
    }
    // An outage throws here, and the job is tried again without a second row.
    if (level === "push") {
      for (const deviceId of await activeDevices(env, n.accountId)) {
        await sender.send({ deviceId });
      }
    }
    const now = Date.now();
    await db(env).batch([
      db(env)
        .prepare("UPDATE notification_actors SET pushed_at = ? WHERE event_id = ?")
        .bind(now, key),
      db(env)
        .prepare("UPDATE notifications SET pushed_at = ? WHERE notification_id = ?")
        .bind(now, group),
    ]);
  };
}
