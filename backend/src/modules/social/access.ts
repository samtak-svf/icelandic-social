import { blockedEither } from "../../identity/index.ts";
import { db } from "../../env/index.ts";
import { canRead, moderates, standing, type Standing } from "../communities/index.ts";
import type { Viewer } from "./do/space.ts";

// The one answer to "may this account see this?" for a community's content
// (decision 0063, #287). Every path that reads a post, a comment or an image
// asks here first, so a private community, a ban, a block and a removal are
// decided in one place. Whatever the reason, the answer is the same null.

/** A post's index row: what the access checks and the feed read in D1. */
export type IndexedPost = {
  postId: string;
  communityId: string;
  authorId: string;
  createdAt: number;
  state: "visible" | "hidden" | "removed";
};

/** The viewer in a community it may read: its standing, and who a block hides from it. */
export type SpaceAccess = { standing: Standing; viewer: Viewer; moderator: boolean };

/** How `viewer` reads `communityId`, or null when it may not. */
export async function spaceAccess(
  env: Env,
  viewer: string,
  communityId: string,
): Promise<SpaceAccess | null> {
  const found = await standing(env, viewer, communityId);
  if (!found || !canRead(found)) return null;
  const moderator = moderates(found);
  // A block does not hide content from the community's moderators (0063).
  const hidden = moderator ? [] : await blockedEither(env, viewer);
  return { standing: found, viewer: { account: viewer, hidden }, moderator };
}

/** Whether a member may add to a space: post, comment, react. */
export function canTakePart(access: SpaceAccess): boolean {
  return access.standing.role !== null && !access.standing.readOnly;
}

/** Whether the post is one this access sees: visible, or any to a moderator, and no block. */
function sees(access: SpaceAccess, post: IndexedPost): boolean {
  if (post.state !== "visible" && !access.moderator) return false;
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
              created_at AS createdAt, state
         FROM post_index WHERE post_id = ?`,
    )
    .bind(postId)
    .first<IndexedPost>();
  if (!post) return null;
  const access = await spaceAccess(env, viewer, post.communityId);
  return access && sees(access, post) ? { post, access } : null;
}
