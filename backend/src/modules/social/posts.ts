import { db, space } from "../../env/index.ts";
import { UNBLOCKED } from "../../identity/index.ts";
import type { MediaRef, PostContent, Viewer } from "./do/space.ts";
import type { IndexedPost } from "./access.ts";

// Posts across D1 and the space (decision 0060): D1's post_index is what the
// feed and the access checks read, the Space object holds what was written.
// A post is indexed first and written to its space second, so a read that
// finds an index row with no content (a write cut short) skips it.

/** The feed reads this far back at a time (docs/d1-social-workload.md, #275). */
const FEED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type Author = { accountId: string; name: string | null; verified: boolean };
export type Post = Omit<PostContent, "author"> & {
  communityId: string;
  author: Author;
  state: IndexedPost["state"];
};

const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

const newPostId = () => `p_${hex(16)}`;
export const newCommentId = (postId: string) => `${postId}-${hex(8)}`;

/** The names and marks of `ids`; an account deleted since is left out. */
export async function authors(env: Env, ids: string[]): Promise<Map<string, Author>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { results } = await db(env)
    .prepare(
      `SELECT account_id AS accountId, display_name AS name, verified FROM accounts
        WHERE account_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(unique))
    .all<{ accountId: string; name: string | null; verified: number }>();
  return new Map(results.map((r) => [r.accountId, { ...r, verified: r.verified === 1 }]));
}

/**
 * The content of indexed posts as `viewer` sees them, in the order given:
 * each community's space is asked once, in parallel, for its posts.
 */
export async function render(env: Env, rows: IndexedPost[], viewer: Viewer): Promise<Post[]> {
  const byCommunity = Map.groupBy(rows, (r) => r.communityId);
  const contents = new Map<string, PostContent & { communityId: string }>();
  await Promise.all(
    [...byCommunity].map(async ([communityId, posts]) => {
      const found = await space(env, communityId).posts(
        posts.map((p) => p.postId),
        viewer,
      );
      for (const content of found) contents.set(content.postId, { ...content, communityId });
    }),
  );
  const names = await authors(
    env,
    [...contents.values()].map((c) => c.author),
  );
  return rows.flatMap((row) => {
    const content = contents.get(row.postId);
    const author = content && names.get(content.author);
    return content && author ? [{ ...content, author, state: row.state }] : [];
  });
}

const INDEXED = `p.post_id AS postId, p.community_id AS communityId, p.author_id AS authorId,
       p.created_at AS createdAt, p.state`;

/** A cursor: the last post's time and id, or only a time to read before. */
export function parseCursor(cursor: string | undefined): { t: number; id: string | null } | null {
  if (cursor === undefined) return null;
  const at = cursor.indexOf("-");
  return at < 0
    ? { t: Number(cursor), id: null }
    : { t: Number(cursor.slice(0, at)), id: cursor.slice(at + 1) };
}

/** A community's visible posts, newest first, but those a block hides from the viewer. */
export async function communityPosts(
  env: Env,
  communityId: string,
  viewer: Viewer,
  before: string | undefined,
  limit: number,
): Promise<{ rows: IndexedPost[]; next: string | null }> {
  const cursor = parseCursor(before);
  const { results } = await db(env)
    .prepare(
      `SELECT ${INDEXED} FROM post_index p
        WHERE p.community_id = ?1 AND p.state = 'visible'
          AND p.author_id NOT IN (SELECT value FROM json_each(?2))
          AND (?3 IS NULL OR p.created_at < ?3
               OR (p.created_at = ?3 AND (?4 IS NULL OR p.post_id < ?4)))
        ORDER BY p.created_at DESC, p.post_id DESC LIMIT ?5`,
    )
    .bind(
      communityId,
      JSON.stringify(viewer.hidden),
      cursor?.t ?? null,
      cursor?.id ?? null,
      limit + 1,
    )
    .all<IndexedPost>();
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  return { rows, next: results.length > limit && last ? `${last.createdAt}-${last.postId}` : null };
}

/**
 * One page of `viewer`'s feed: the visible posts of its communities, newest
 * first, read one time window at a time (the plan #275 measured). A page that
 * fills ends at its last post; one that does not ends at its window, and the
 * next page reads the window before it, until no community of the viewer's is
 * that old. `rowsRead` is D1's own count, for the budget test.
 */
export async function feed(
  env: Env,
  viewer: string,
  before: string | undefined,
  limit: number,
  now = Date.now(),
): Promise<{ rows: IndexedPost[]; next: string | null; rowsRead: number }> {
  const cursor = parseCursor(before) ?? { t: now, id: null };
  const { results, meta } = await db(env)
    .prepare(
      `SELECT ${INDEXED} FROM community_members m JOIN post_index p
           ON p.community_id = m.community_id
          AND p.created_at <= ?2 AND p.created_at > ?2 - ?3
        WHERE m.account_id = ?1 AND p.state = 'visible'
          AND (p.created_at < ?2 OR ?4 IS NULL OR p.post_id < ?4)
          AND ${UNBLOCKED("?1", "p.author_id")}
        ORDER BY p.created_at DESC, p.post_id DESC LIMIT ?5`,
    )
    .bind(viewer, cursor.t, FEED_WINDOW_MS, cursor.id, limit + 1)
    .all<IndexedPost>();
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  let next: string | null;
  if (results.length > limit && last) next = `${last.createdAt}-${last.postId}`;
  else {
    const start = cursor.t - FEED_WINDOW_MS;
    const oldest = await db(env)
      .prepare(
        `SELECT MIN(c.created_at) AS createdAt FROM community_members m
           JOIN communities c ON c.community_id = m.community_id WHERE m.account_id = ?`,
      )
      .bind(viewer)
      .first<{ createdAt: number | null }>();
    next = oldest?.createdAt != null && oldest.createdAt <= start ? `${start}` : null;
  }
  return { rows, next, rowsRead: meta.rows_read };
}

/**
 * The images `media` names that `uploader` uploaded to `communityId` and no
 * post holds yet, in the order named; null when any is not.
 */
async function unattached(
  env: Env,
  communityId: string,
  uploader: string,
  media: string[],
): Promise<MediaRef[] | null> {
  if (new Set(media).size !== media.length) return null;
  if (media.length === 0) return [];
  const { results } = await db(env)
    .prepare(
      `SELECT media_id AS mediaId, width, height FROM social_media
        WHERE media_id IN (SELECT value FROM json_each(?1))
          AND community_id = ?2 AND uploader_id = ?3 AND post_id IS NULL`,
    )
    .bind(JSON.stringify(media), communityId, uploader)
    .all<MediaRef>();
  const byId = new Map(results.map((r) => [r.mediaId, r]));
  const found = media.flatMap((id) => byId.get(id) ?? []);
  return found.length === media.length ? found : null;
}

/** Posts `body` and `media` as `author`: indexed in D1, then written to the space. */
export async function createPost(
  env: Env,
  communityId: string,
  author: string,
  input: { body: string; media: string[] },
): Promise<PostContent | "invalid_media"> {
  const media = await unattached(env, communityId, author, input.media);
  if (!media) return "invalid_media";
  const postId = newPostId();
  const createdAt = Date.now();
  await db(env).batch([
    db(env)
      .prepare(
        "INSERT INTO post_index (post_id, community_id, author_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(postId, communityId, author, createdAt),
    db(env)
      .prepare(
        `UPDATE social_media SET post_id = ?1
          WHERE media_id IN (SELECT value FROM json_each(?2)) AND post_id IS NULL`,
      )
      .bind(postId, JSON.stringify(input.media)),
    db(env)
      .prepare("INSERT OR IGNORE INTO space_authors (community_id, account_id) VALUES (?, ?)")
      .bind(communityId, author),
  ]);
  const content = { postId, author, body: input.body, media, createdAt };
  await space(env, communityId).createPost(content);
  return { ...content, reactions: [], myReaction: null, commentCount: 0 };
}

/** Records that `account` wrote in `communityId`, so deleting the account reaches the space. */
export async function noteAuthor(
  env: Env,
  communityId: string,
  account: string,
  jobs: D1PreparedStatement[] = [],
): Promise<void> {
  await db(env).batch([
    db(env)
      .prepare("INSERT OR IGNORE INTO space_authors (community_id, account_id) VALUES (?, ?)")
      .bind(communityId, account),
    ...jobs,
  ]);
}

/** Drops posts from the index, with their images' rows; the R2 keys to delete. */
export async function unindex(env: Env, communityId: string, postIds: string[]): Promise<string[]> {
  if (postIds.length === 0) return [];
  const ids = JSON.stringify(postIds);
  const [, media] = await db(env).batch<{ media_id: string }>([
    db(env)
      .prepare("DELETE FROM post_index WHERE post_id IN (SELECT value FROM json_each(?))")
      .bind(ids),
    db(env)
      .prepare(
        "DELETE FROM social_media WHERE post_id IN (SELECT value FROM json_each(?)) RETURNING media_id",
      )
      .bind(ids),
  ]);
  return (media?.results ?? []).map((r) => mediaKey(communityId, r.media_id));
}

/** Where an image lives in the bucket (decision 0065). */
export const mediaKey = (communityId: string, mediaId: string) =>
  `social/${communityId}/${mediaId}`;
