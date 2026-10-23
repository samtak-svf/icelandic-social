import { db, space } from "../../env/index.ts";
import { canRead, moderates, standing } from "../communities/index.ts";
import { postContent } from "../social/index.ts";
import { entry } from "./log.ts";

// The post pinned to the top of a community (decision 0080): one at a time,
// set by the owner and the moderators. The pin lives in the community's space;
// each change is an entry in the moderation log (decision 0066), written first
// because the space is not D1: a failure between the two leaves an entry for
// a change to repeat, never a change without its entry.

export type PinRefusal = "not_found" | "not_permitted";

/**
 * `accountId` pins (or with `on` false unpins) `postId` in `communityId`; what
 * refused it, or null when done. Pinning the pinned post, or unpinning one
 * that is not pinned, changes and logs nothing.
 */
export async function setPostPin(
  env: Env,
  accountId: string,
  communityId: string,
  postId: string,
  on: boolean,
): Promise<PinRefusal | null> {
  const me = await standing(env, accountId, communityId);
  if (!me || !canRead(me)) return "not_found";
  if (!moderates(me)) return "not_permitted";
  const post = await postContent(env, postId);
  if (post?.communityId !== communityId || post.state !== "visible") return "not_found";
  const there = space(env, communityId);
  const pinned = (await there.pinnedPost()) === postId;
  if (pinned === on) return null;
  await db(env).batch([
    entry(env, {
      communityId,
      actorId: accountId,
      asPlatform: false,
      action: on ? "pin_post" : "unpin_post",
      targetKind: "post",
      targetId: postId,
      targetAccount: post.authorId,
      reason: "",
    }),
  ]);
  if (on) await there.pinPost(postId);
  else await there.unpinPost(postId);
  return null;
}
