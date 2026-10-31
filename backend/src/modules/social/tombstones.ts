import { readsWall, spaceAccess, type IndexedPost } from "./access.ts";
import { db } from "../../env/index.ts";
import type { Viewer } from "./do/space.ts";
import { render, wallFields, type Post } from "./posts.ts";

// A post a moderator removed keeps its place (decisions 0063, 0071, 0115): every
// reader of the space sees that it was removed, the author and moderators too in
// a list. It is made from the index row alone and never asks the space, so its
// text, images, comments and reactions have no way into it. The author reads
// the text in their statement of reasons, a moderator on the post itself.

/** What a reader sees in place of the removed post `row`. */
function tombstone(row: IndexedPost, viewer: string): Post {
  return {
    postId: row.postId,
    communityId: row.communityId,
    author: null,
    anonymous: false,
    mine: row.authorId === viewer,
    body: "",
    media: [],
    createdAt: row.createdAt,
    reactions: [],
    myReaction: null,
    emojis: [],
    myEmoji: null,
    commentCount: 0,
    latestComment: null,
    state: "removed",
    pinned: false,
    ...wallFields(row),
  };
}

/** A list's posts, in the order given, with a tombstone for each removed one. */
export async function renderListed(
  env: Env,
  rows: IndexedPost[],
  viewer: Viewer,
  featured?: ReadonlySet<string>,
): Promise<Post[]> {
  const shown = await render(
    env,
    rows.filter((r) => r.state !== "removed"),
    viewer,
    featured,
  );
  const byId = new Map(shown.map((p) => [p.postId, p]));
  return rows.flatMap((r) =>
    r.state === "removed" ? tombstone(r, viewer.account) : (byId.get(r.postId) ?? []),
  );
}

/** The tombstone of `postId` for a reader of its space, or null when there is none for them. */
export async function removedPost(env: Env, viewer: string, postId: string): Promise<Post | null> {
  const row = await db(env)
    .prepare(
      `SELECT post_id AS postId, community_id AS communityId, author_id AS authorId,
              created_at AS createdAt, state, anonymous, audience
         FROM post_index WHERE post_id = ? AND state = 'removed'`,
    )
    .bind(postId)
    .first<IndexedPost>();
  if (!row) return null;
  const access = await spaceAccess(env, viewer, row.communityId);
  if (!access || access.viewer.hidden.includes(row.authorId)) return null;
  // Who may not read a wall post learns nothing of it, its removal included (0115).
  if (access.wall && !readsWall(access.wall, row.audience, viewer)) return null;
  return tombstone(row, viewer);
}
