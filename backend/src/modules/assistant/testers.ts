import { brandStrings } from "../../brand.gen.ts";
import { assistantCommunity, db } from "../../env/index.ts";
import { addMember } from "../communities/index.ts";
import { assistantAccount, makeAssistant } from "../../identity/index.ts";
import { commentThread, writeComment } from "../social/index.ts";

// The testers' queue (decision 0076): the addresses the assistant found,
// taken by the maintainer's machine, which adds each to its store's test and
// says how it went. A request keeps its address only until then.

export type TesterRequest = {
  requestId: string;
  platform: "ios" | "android";
  address: string;
  createdAt: number;
};

/** The requests waiting, oldest first, of one platform or of both. */
export async function pendingTesters(
  env: Env,
  platform?: "ios" | "android",
): Promise<TesterRequest[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT request_id AS requestId, platform, address, created_at AS createdAt
         FROM tester_requests
        WHERE state = 'pending' AND (?1 IS NULL OR platform = ?1)
        ORDER BY created_at LIMIT 100`,
    )
    .bind(platform ?? null)
    .all<TesterRequest>();
  return results;
}

/**
 * Marks a waiting request done or failed and clears its address; the
 * assistant then tells the tester, on the post they asked under, for an
 * iPhone. False when no request waits under `requestId`.
 */
export async function markTester(
  env: Env,
  requestId: string,
  outcome: "done" | "failed",
  error?: string,
): Promise<boolean> {
  const row = await db(env)
    .prepare(
      `UPDATE tester_requests SET state = ?, error = ?, address = NULL, finished_at = ?
        WHERE request_id = ? AND state = 'pending'
        RETURNING platform, comment_id AS commentId`,
    )
    .bind(outcome, error?.slice(0, 200) ?? null, Date.now(), requestId)
    .first<{ platform: string; commentId: string }>();
  if (!row) return false;
  if (row.platform === "ios") {
    const text =
      outcome === "done" ? brandStrings.assistant_added_ios : brandStrings.assistant_failed_ios;
    await replyUnder(env, row.commentId, text);
  }
  return true;
}

/** Posts `text` as the assistant on the post `commentId` is under; whether it was posted. */
async function replyUnder(env: Env, commentId: string, text: string): Promise<boolean> {
  const communityId = assistantCommunity(env);
  const assistant = await assistantAccount(env);
  if (!communityId || !assistant) return false;
  const thread = await commentThread(env, communityId, commentId, assistant);
  return !!thread && (await replyAsAssistant(env, thread.post.postId, text));
}

/** Posts `text` as the assistant on `postId`; false where it may not comment. */
export async function replyAsAssistant(env: Env, postId: string, text: string): Promise<boolean> {
  const assistant = await assistantAccount(env);
  if (!assistant) return false;
  const written = await writeComment(env, assistant, postId, text);
  return !!written && "comment" in written;
}

/**
 * Makes the assistant's account, or renames it, and a member of its
 * community; null while no community is set.
 */
export async function setUpAssistant(env: Env): Promise<string | null> {
  const communityId = assistantCommunity(env);
  if (!communityId) return null;
  const accountId = await makeAssistant(env, brandStrings.assistant_name);
  await addMember(env, communityId, accountId);
  return accountId;
}
