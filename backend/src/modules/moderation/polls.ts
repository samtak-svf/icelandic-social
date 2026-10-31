import { db, space } from "../../env/index.ts";
import { moderates } from "../communities/index.ts";
import { postAccess, viewPost } from "../social/index.ts";
import { entry } from "./log.ts";

// Closing a poll (decision 0090): its author closes it, and so do the
// community's owner and moderators, whose close is an entry in the moderation
// log (decision 0066), written first because the space is not D1, as for a
// pin. The author's own close is no moderation and is not logged. The entry
// names the post and its author, never a vote: there is nothing of the sort
// to name.

/** `accountId` closes the poll `postId`; the post as it now reads, or what refused it. */
export async function closePoll(env: Env, accountId: string, postId: string) {
  const found = await postAccess(env, accountId, postId);
  if (!found) return "not_found" as const;
  const { communityId, authorId } = found.post;
  const there = space(env, communityId);
  const status = await there.pollStatus(postId);
  if (status === "none") return "not_found" as const;
  const asModerator =
    authorId !== accountId && found.access.wall === null && moderates(found.access.standing);
  if (authorId !== accountId && !asModerator) return "not_permitted" as const;
  // Closing a closed poll changes and logs nothing.
  if (status === "open") {
    if (asModerator) {
      await db(env).batch([
        entry(env, {
          communityId,
          actorId: accountId,
          asPlatform: false,
          action: "close_poll",
          targetKind: "post",
          targetId: postId,
          targetAccount: authorId,
          reason: "",
        }),
      ]);
    }
    await there.closePoll(postId);
  }
  return (await viewPost(env, accountId, postId)) ?? ("not_found" as const);
}
