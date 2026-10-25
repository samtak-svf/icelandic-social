import { blockedEither } from "../../identity/index.ts";
import { db, space } from "../../env/index.ts";
import { canRead, moderates, standing, type Standing } from "../communities/index.ts";
import type { CommentRecord, Viewer } from "./do/space.ts";

// The one answer to "may this account see this?" for a community's content
// (decision 0063, #287). Every path that reads a post, a comment or an image
// asks here first, so a private community, a ban, a block and a removal are
// decided in one place. Whatever the reason, the answer is the same null.
// One function per kind: spaceAccess (a community's content), postAccess (a
// post, its comments and its images) and commentAccess (one comment).

/** A post's index row: what the access checks and the feed read in D1. */
export type IndexedPost = {
  postId: string;
  communityId: string;
  authorId: string;
  createdAt: number;
  state: "visible" | "pending" | "hidden" | "removed";
  /** 1 for an anonymous post (decision 0091): its author is named to no reader but the author. */
  anonymous: number;
};

/**
 * The viewer in a community it may read: its standing, who a block hides from
 * it, and every account a block stands between it and (`between`), which a
 * moderator still sees but does not reply to.
 */
export type SpaceAccess = {
  standing: Standing;
  viewer: Viewer;
  moderator: boolean;
  between: string[];
};

/**
 * How `viewer` reads `communityId`, or null when it may not. Samtak's
 * platform moderators read every community, as its moderators do (0063).
 */
export async function spaceAccess(
  env: Env,
  viewer: string,
  communityId: string,
): Promise<SpaceAccess | null> {
  const found = await standing(env, viewer, communityId);
  if (!found || !(canRead(found) || found.platformModerator)) return null;
  const moderator = moderates(found) || found.platformModerator;
  const between = await blockedEither(env, viewer);
  // A block does not hide content from the community's moderators (0063).
  const hidden = moderator ? [] : between;
  return { standing: found, viewer: { account: viewer, hidden, moderator }, moderator, between };
}

type Refusal = "not_a_member" | "read_only" | "muted";

/** Why `access` may not add to its space (post, comment, react), or null when it may. */
export function refusal(access: SpaceAccess, now = Date.now()): Refusal | null {
  const { role, readOnly, mutedUntil } = access.standing;
  if (role === null) return "not_a_member";
  if (readOnly) return "read_only";
  return mutedUntil !== null && mutedUntil > now ? "muted" : null;
}

/**
 * Why `access` may not reply to `post` (comment, react), or null when it may:
 * only a visible post takes replies, and nobody replies across a block (0063).
 * An anonymous post is the exception: a refusal would tell a moderator, who
 * reads across blocks, that a block stands between them and its author. The
 * block still holds, because the author sees neither the reply nor a notice of
 * it (0091).
 */
export function replyRefusal(
  access: SpaceAccess,
  post: IndexedPost,
): Refusal | "not_permitted" | "blocked" | null {
  const refused = refusal(access);
  if (refused) return refused;
  if (post.state !== "visible") return "not_permitted";
  if (post.anonymous === 1) return null;
  return access.between.includes(post.authorId) ? "blocked" : null;
}

/**
 * Whether the post is one this access sees: visible, or any to a moderator,
 * and no block. Its author also sees their own post waiting for approval (0091).
 */
function sees(access: SpaceAccess, post: IndexedPost): boolean {
  const own = post.state === "pending" && post.authorId === access.viewer.account;
  if (post.state !== "visible" && !access.moderator && !own) return false;
  return !access.viewer.hidden.includes(post.authorId);
}

/** The post and how `viewer` reads it, or null when there is no such post it may see. */
export async function postAccess(
  env: Env,
  viewer: string,
  postId: string,
): Promise<{ post: IndexedPost; access: SpaceAccess } | null> {
  const post = await db(env)
    .prepare(
      `SELECT post_id AS postId, community_id AS communityId, author_id AS authorId,
              created_at AS createdAt, state, anonymous
         FROM post_index WHERE post_id = ?`,
    )
    .bind(postId)
    .first<IndexedPost>();
  if (!post) return null;
  const access = await spaceAccess(env, viewer, post.communityId);
  return access && sees(access, post) ? { post, access } : null;
}

/** The comment, its post and how `viewer` reads them, or null when it may not see it. */
export async function commentAccess(
  env: Env,
  viewer: string,
  commentId: string,
): Promise<{ post: IndexedPost; access: SpaceAccess; comment: CommentRecord } | null> {
  // A comment id is its post's id, a dash and its own part (posts.ts).
  const postId = commentId.slice(0, Math.max(0, commentId.lastIndexOf("-")));
  const found = postId ? await postAccess(env, viewer, postId) : null;
  if (!found) return null;
  const comment = await space(env, found.post.communityId).comment(commentId);
  if (!comment || found.access.viewer.hidden.includes(comment.author)) return null;
  if (comment.state !== "visible" && !found.access.moderator) return null;
  return { ...found, comment };
}
