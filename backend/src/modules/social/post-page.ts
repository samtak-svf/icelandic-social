import { db, space } from "../../env/index.ts";
import type { IndexedPost } from "./access.ts";
import type { Viewer } from "./do/space.ts";

// A page of a community's or a wall's posts as the index holds them, and the
// keyset cursor every list of posts shares (decisions 0088, 0115).

/** The ids a search of the community finds, or null when nothing is searched for. */
async function searched(env: Env, communityId: string, query: string | undefined) {
  const text = query?.trim() ?? "";
  return text ? space(env, communityId).searchPosts(text) : null;
}

/** The posts a list holds: a client that knows a tombstone gets the removed too (0115). */
export const listed = (tombstones: boolean) =>
  tombstones ? "p.state IN ('visible', 'removed')" : "p.state = 'visible'";

export const INDEXED = `p.post_id AS postId, p.community_id AS communityId, p.author_id AS authorId,
       p.created_at AS createdAt, p.state, p.anonymous, p.audience`;

/** A cursor: the last post's time and id, or only a time to read before. */
export function parseCursor(cursor: string | undefined): { t: number; id: string | null } | null {
  if (cursor === undefined) return null;
  const at = cursor.indexOf("-");
  return at < 0
    ? { t: Number(cursor), id: null }
    : { t: Number(cursor.slice(0, at)), id: cursor.slice(at + 1) };
}

/**
 * A community's visible posts, newest first, with `tombstones` the removed in
 * their places, but those a block hides from the viewer. With `query` (decision
 * 0079) the community's own space names the posts whose text matches it, so the
 * index reads only those, and every page and its `next` follow the same rule
 * without the search: keyset pagination, visibility and block filtering stay
 * exact. Featured posts keep their place in time (decision 0088). A search finds
 * only what can be read. With `everyoneOnly` it holds only the wall posts anyone
 * may read (decision 0115).
 */
export async function communityPosts(
  env: Env,
  communityId: string,
  viewer: Viewer,
  before: string | undefined,
  limit: number,
  tombstones: boolean,
  query?: string,
  everyoneOnly = false,
): Promise<{ rows: IndexedPost[]; next: string | null }> {
  const cursor = parseCursor(before);
  const matched = await searched(env, communityId, query);
  if (matched !== null && matched.length === 0) return { rows: [], next: null };
  const { results } = await db(env)
    .prepare(
      `SELECT ${INDEXED} FROM post_index p
        WHERE p.community_id = ?1 AND ${listed(tombstones && matched === null)}
          AND p.author_id NOT IN (SELECT value FROM json_each(?2))
          AND (?3 IS NULL OR p.created_at < ?3
               OR (p.created_at = ?3 AND (?4 IS NULL OR p.post_id < ?4)))
          AND (?5 = 1 OR p.post_id IN (SELECT value FROM json_each(?6)))
          AND (?8 = 0 OR p.audience = 'everyone')
        ORDER BY p.created_at DESC, p.post_id DESC LIMIT ?7`,
    )
    .bind(
      communityId,
      JSON.stringify(viewer.hidden),
      cursor?.t ?? null,
      cursor?.id ?? null,
      matched === null ? 1 : 0,
      JSON.stringify(matched ?? []),
      limit + 1,
      Number(everyoneOnly),
    )
    .all<IndexedPost>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  const next = results.length > limit && last ? `${last.createdAt}-${last.postId}` : null;
  return { rows: page, next };
}
