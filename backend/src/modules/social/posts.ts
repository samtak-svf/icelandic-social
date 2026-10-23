import { db, space } from "../../env/index.ts";
import { blockedEither, UNBLOCKED } from "../../identity/index.ts";
import { notePost } from "../communities/index.ts";
import { notice } from "../jobs/index.ts";
import type { CommentContent, CommentRecord, MediaRef, PostContent, Viewer } from "./do/space.ts";
import { type Author, bylineKey, bylines } from "./bylines.ts";
import { type IndexedPost, postAccess, replyRefusal } from "./access.ts";

// Posts across D1 and the space (decision 0060): D1's post_index is what the
// feed and the access checks read, the Space object holds what was written.
// A post is indexed first and written to its space second, so a read that
// finds an index row with no content (a write cut short) skips it.

/** The feed reads this far back at a time (docs/d1-social-workload.md, #275). */
const FEED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type Post = Omit<PostContent, "author" | "latestComment"> & {
  communityId: string;
  author: Author;
  latestComment: (Omit<CommentContent, "author"> & { author: Author }) | null;
  state: IndexedPost["state"];
  /** The community's moderators pinned it to the top of its feed (decision 0080). */
  pinned: boolean;
};

const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

const newPostId = () => `p_${hex(16)}`;
const newCommentId = (postId: string) => `${postId}-${hex(8)}`;

/** The post a post id or a comment id names. */
export const postOf = (id: string) => id.split("-")[0]!;

/**
 * The content of indexed posts as `viewer` sees them, in the order given:
 * each community's space is asked once, in parallel, for its posts.
 */
export async function render(
  env: Env,
  rows: IndexedPost[],
  viewer: Viewer,
  pinnedId: string | null = null,
): Promise<Post[]> {
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
  // One query for every (account, community) pair of the posts and their
  // newest comments, so a feed across communities costs the same as one.
  const pairs = [...contents.values()].flatMap((c) => [
    { accountId: c.author, communityId: c.communityId },
    ...(c.latestComment && c.latestComment.author !== ""
      ? [{ accountId: c.latestComment.author, communityId: c.communityId }]
      : []),
  ]);
  const names = await bylines(env, pairs);
  return rows.flatMap((row) => {
    const content = contents.get(row.postId);
    const author = content && names.get(bylineKey(content.author, content.communityId));
    if (!content || !author) return [];
    const latest = content.latestComment;
    const latestAuthor = latest && names.get(bylineKey(latest.author, content.communityId));
    return [
      {
        ...content,
        author,
        // A comment whose author is gone is left out, as the comment list leaves it.
        latestComment: latest && latestAuthor ? { ...latest, author: latestAuthor } : null,
        state: row.state,
        pinned: row.postId === pinnedId,
      },
    ];
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

/**
 * A community's visible posts, newest first, but those a block hides from the
 * viewer. With `query` (decision 0079) the community's own space names the
 * posts whose text matches it, so the index reads only those, and every page
 * and its `next` follow the same rule without the search: keyset pagination,
 * visibility and block filtering stay exact. A search page pins nothing: the
 * caller passes no `pinnedId` with a `query`.
 */
export async function communityPosts(
  env: Env,
  communityId: string,
  viewer: Viewer,
  before: string | undefined,
  limit: number,
  query?: string,
  pinnedId: string | null = null,
): Promise<{ rows: IndexedPost[]; next: string | null }> {
  const cursor = parseCursor(before);
  const text = query?.trim() ?? "";
  const matched = text ? await space(env, communityId).searchPosts(text) : null;
  if (matched !== null && matched.length === 0) return { rows: [], next: null };
  const { results } = await db(env)
    .prepare(
      `SELECT ${INDEXED} FROM post_index p
        WHERE p.community_id = ?1 AND p.state = 'visible'
          AND p.author_id NOT IN (SELECT value FROM json_each(?2))
          AND (?3 IS NULL OR p.created_at < ?3
               OR (p.created_at = ?3 AND (?4 IS NULL OR p.post_id < ?4)))
          AND (?5 = 1 OR p.post_id IN (SELECT value FROM json_each(?6)))
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
    )
    .all<IndexedPost>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  const next = results.length > limit && last ? `${last.createdAt}-${last.postId}` : null;
  return { rows: await leadWithPinned(env, communityId, viewer, before, pinnedId, page), next };
}

/**
 * `page` with the pinned post (decision 0080) leading the first page and
 * appearing nowhere else, so a client never shows it twice. It is read from
 * the index, so a pin on a post that is no longer visible, or whose author the
 * viewer blocked, shows nothing.
 */
async function leadWithPinned(
  env: Env,
  communityId: string,
  viewer: Viewer,
  before: string | undefined,
  pinnedId: string | null,
  page: IndexedPost[],
): Promise<IndexedPost[]> {
  if (!pinnedId) return page;
  const rest = page.filter((r) => r.postId !== pinnedId);
  if (before !== undefined) return rest;
  const pinned =
    page.find((r) => r.postId === pinnedId) ??
    (await db(env)
      .prepare(
        `SELECT ${INDEXED} FROM post_index p
          WHERE p.post_id = ?1 AND p.community_id = ?2 AND p.state = 'visible'
            AND p.author_id NOT IN (SELECT value FROM json_each(?3))`,
      )
      .bind(pinnedId, communityId, JSON.stringify(viewer.hidden))
      .first<IndexedPost>());
  return pinned ? [pinned, ...rest] : rest;
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
      `SELECT ${INDEXED} FROM community_members m
         JOIN live_communities c ON c.community_id = m.community_id
         JOIN post_index p ON p.community_id = m.community_id
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
           JOIN live_communities c ON c.community_id = m.community_id WHERE m.account_id = ?`,
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
  also: (postId: string) => D1PreparedStatement[] = () => [],
): Promise<(Omit<PostContent, "latestComment"> & { latestComment: null }) | "invalid_media"> {
  const media = await unattached(env, communityId, author, input.media);
  if (!media) return "invalid_media";
  const postId = newPostId();
  const createdAt = Date.now();
  await db(env).batch([
    ...notePost(env, communityId, author, createdAt),
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
    ...also(postId),
  ]);
  const content = { postId, author, body: input.body, media, createdAt };
  await space(env, communityId).createPost(content);
  return { ...content, reactions: [], myReaction: null, commentCount: 0, latestComment: null };
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

/**
 * Comments `body` on `postId` as `author`, when it may reply there: the one
 * way a comment is written, from the route and from the assistant (decision
 * 0076). With `parentCommentId` it is a reply to a top-level comment on the
 * post, whose author is told too (0071), deduplicated when it is the post's
 * author, and never across a block. The post's author is told, and `also`
 * adds the jobs of the comment's id to that batch. The notice is written
 * first; its job finds no comment to tell of if the space then fails to
 * take it.
 */
export async function writeComment(
  env: Env,
  author: string,
  postId: string,
  body: string,
  also: (post: IndexedPost, commentId: string) => D1PreparedStatement[] = () => [],
  parentCommentId: string | null = null,
): Promise<
  | { comment: CommentContent; post: IndexedPost }
  | { refused: NonNullable<ReturnType<typeof replyRefusal>> }
  | { invalidParent: true }
  | null
> {
  const found = await postAccess(env, author, postId);
  if (!found) return null;
  const refused = replyRefusal(found.access, found.post);
  if (refused) return { refused };
  const { post } = found;
  // The parent is checked before anything is written, and the space checks
  // it again as the comment is written, so a refused parent tells nobody.
  let parent: CommentRecord | null = null;
  if (parentCommentId !== null) {
    parent = await space(env, post.communityId).comment(parentCommentId);
    if (!parent || parent.postId !== postId || parent.parentCommentId !== null) {
      return { invalidParent: true };
    }
    if (parent.state !== "visible") return { invalidParent: true };
    if ((await blockedEither(env, author)).includes(parent.author)) return { refused: "blocked" };
  }
  const commentId = newCommentId(postId);
  await noteAuthor(env, post.communityId, author, [
    notice(env, commentId, {
      kind: "comment",
      accountId: post.authorId,
      actorId: author,
      communityId: post.communityId,
      postId,
      commentId,
    }),
    // A reply tells the parent comment's author besides the post's (0071);
    // one and the same account is told once, by the notice above.
    ...(parent && parent.author !== post.authorId
      ? [
          notice(env, `${commentId}:parent`, {
            kind: "comment",
            accountId: parent.author,
            actorId: author,
            communityId: post.communityId,
            postId,
            commentId,
          }),
        ]
      : []),
    ...also(post, commentId),
  ]);
  const comment = await space(env, post.communityId).addComment({
    commentId,
    postId,
    parentCommentId,
    author,
    body,
    createdAt: Date.now(),
  });
  if (comment === null) return null;
  if (comment === "invalid_parent_comment") return { invalidParent: true };
  return { comment, post };
}

/** What someone said in a space: a post, or a comment on one. */
export type Said = { id: string; author: string; body: string; visible: boolean };

/**
 * A post or a comment, with the post and its first comments, as `reader` sees
 * them: what the testers' assistant answers (decision 0076). Null when it or
 * its post is gone.
 */
export async function thread(
  env: Env,
  communityId: string,
  saidId: string,
  reader: string,
): Promise<{ said: Said; post: PostContent; comments: CommentContent[] } | null> {
  const stub = space(env, communityId);
  const postId = postOf(saidId);
  const viewer: Viewer = { account: reader, hidden: [], moderator: false };
  const [post] = await stub.posts([postId], viewer);
  if (!post) return null;
  const comment = saidId === postId ? null : await stub.comment(saidId);
  const said: Said | null =
    saidId === postId
      ? { id: postId, author: post.author, body: post.body, visible: true }
      : comment && {
          id: comment.commentId,
          author: comment.author,
          body: comment.body,
          visible: comment.state === "visible",
        };
  if (!said) return null;
  const comments = await stub.comments(postId, viewer, null, THREAD_LIMIT);
  return { said, post, comments };
}

/** The most comments of a post the assistant reads before answering. */
const THREAD_LIMIT = 50;

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
