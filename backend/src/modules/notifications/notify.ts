import { db } from "../../env/index.ts";
import { activeDevices, blockedEither } from "../../identity/index.ts";
import type { Notice } from "../jobs/index.ts";
import type { PushSender } from "../messaging/index.ts";
import { standing } from "../communities/index.ts";
import { commentContent, postAccess } from "../social/index.ts";

// The notice job's handler (decisions 0063, 0067): a notification row for the
// account told, and a push to its devices that names nothing, as for chat
// (decision 0025). The notification's id is the job's key, and a push is sent
// until it is marked sent, so a job run twice has one effect.

/** Whether the account told may still see what it is told of. */
async function stillSo(env: Env, n: Notice): Promise<boolean> {
  if (n.accountId === n.actorId) return false;
  // A moderator's notice goes across a block: nothing is hidden untold.
  if (n.kind === "moderated") return true;
  if ((await blockedEither(env, n.accountId)).includes(n.actorId)) return false;
  switch (n.kind) {
    case "comment": {
      const comment = n.commentId ? await commentContent(env, n.commentId) : null;
      if (comment?.state !== "visible") return false;
      return !!(n.postId && (await postAccess(env, n.accountId, n.postId)));
    }
    case "reaction":
      return !!(n.postId && (await postAccess(env, n.accountId, n.postId)));
    case "join_approved":
      return (await standing(env, n.accountId, n.communityId))?.role === "member";
  }
}

/** The handler of the notice job, sending its pushes with `sender`. */
export function noticeHandler(sender: PushSender) {
  return async (env: Env, key: string, payload: Record<string, unknown>): Promise<void> => {
    const n = payload as Notice;
    const pending = await db(env)
      .prepare("SELECT pushed_at FROM notifications WHERE notification_id = ?")
      .bind(key)
      .first<{ pushed_at: number | null }>();
    if (pending?.pushed_at) return;
    if (!pending) {
      if (!(await stillSo(env, n))) return;
      await db(env)
        .prepare(
          `INSERT INTO notifications (notification_id, account_id, kind, actor_id, community_id,
                                      post_id, comment_id, action, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM accounts WHERE account_id = ?2)
              AND EXISTS (SELECT 1 FROM live_communities WHERE community_id = ?5)
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          key,
          n.accountId,
          n.kind,
          n.actorId,
          n.communityId,
          n.postId ?? null,
          n.commentId ?? null,
          n.action ?? null,
          Date.now(),
        )
        .run();
    }
    // An outage throws here, and the job is tried again without a second row.
    for (const deviceId of await activeDevices(env, n.accountId)) {
      await sender.send({ deviceId });
    }
    await db(env)
      .prepare("UPDATE notifications SET pushed_at = ? WHERE notification_id = ?")
      .bind(Date.now(), key)
      .run();
  };
}
