import { INDEXED, listed, parseCursor } from "./post-page.ts";
import { db, space } from "../../env/index.ts";
import { blockedEither, UNBLOCKED } from "../../identity/index.ts";
import { notePost } from "../communities/index.ts";
import { notice } from "../jobs/index.ts";
import type { CommentContent, CommentRecord, MediaRef, PostContent, Viewer } from "./do/space.ts";
import { type Author, bylineKey, bylines } from "./bylines.ts";
import { commentMedia } from "./media.ts";
import { optionId } from "./do/space-schema.ts";
import { type IndexedPost, postAccess, replyRefusal, spaceAccess } from "./access.ts";

// Posts across D1 and the space (decision 0060): D1's post_index is what the
// feed and the access checks read, the Space object holds what was written.
// A post is indexed first and written to its space second, so a read that
// finds an index row with no content (a write cut short) skips it.

/** The feed reads this far back at a time (docs/d1-social-workload.md, #275). */
const FEED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type Post = Omit<PostContent, "author" | "latestComment"> & {
  communityId: string;
  /** Null on an anonymous post to every reader but its author (decision 0091). */
  author: Author | null;
  anonymous: boolean;
  /** The viewer wrote it. */
  mine: boolean;
  latestComment: (Omit<CommentContent, "author"> & { author: Author; media: MediaRef[] }) | null;
  /** Whose wall it is on and who reads it; neither on a community's post (decision 0115). */
  wall?: { accountId: string };
  audience?: "friends" | "everyone";
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

const NONE: ReadonlySet<string> = new Set();

/**
 * The content of indexed posts as `viewer` sees them, in the order given:
 * each community's space is asked once, in parallel, for its posts.
 */
export async function render(
  env: Env,
  rows: IndexedPost[],
  viewer: Viewer,
  featured: ReadonlySet<string> = NONE,
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
  const [names, media] = await Promise.all([
    bylines(env, pairs),
    commentMedia(
      env,
      [...contents.values()].flatMap((c) => (c.latestComment ? [c.latestComment.commentId] : [])),
    ),
  ]);
  return rows.flatMap((row) => {
    const content = contents.get(row.postId);
    if (!content) return [];
    const mine = row.authorId === viewer.account;
    // The one place an anonymous post loses its byline (decision 0091): to
    // every reader but its author, whoever else asks, a moderator included.
    const anonymous = row.anonymous === 1;
    const author =
      anonymous && !mine
        ? null
        : (names.get(bylineKey(content.author, content.communityId)) ?? null);
    if (!author && !(anonymous && !mine)) return [];
    const latest = content.latestComment;
    const latestAuthor = latest && names.get(bylineKey(latest.author, content.communityId));
    return [
      {
        ...content,
        author,
        anonymous,
        mine,
        // A comment whose author is gone is left out, as the comment list leaves it.
        latestComment:
          latest && latestAuthor
            ? { ...latest, author: latestAuthor, media: media.get(latest.commentId) ?? [] }
            : null,
        state: row.state,
        pinned: featured.has(row.postId),
        ...wallFields(row),
      },
    ];
  });
}

/** What a wall post carries beyond a community's (decision 0115); nothing on the latter. */
export const wallFields = (row: IndexedPost) =>
  row.audience === null ? {} : { wall: { accountId: row.authorId }, audience: row.audience };

/**
 * The posts a community features (decision 0088) as `viewer` reads them,
 * newest pin first, each flagged `pinned`. They are read from the index like
 * the feed, so a removed or deleted post, and one by an author the viewer
 * blocked, shows nothing. The caller has already asked the access check
 * whether `viewer` reads the community.
 */
async function featuredPosts(env: Env, communityId: string, viewer: Viewer): Promise<Post[]> {
  const ids = await space(env, communityId).featured();
  if (ids.length === 0) return [];
  const { results } = await db(env)
    .prepare(
      `SELECT ${INDEXED} FROM post_index p
        WHERE p.community_id = ?1 AND p.state = 'visible'
          AND p.post_id IN (SELECT value FROM json_each(?2))
          AND p.author_id NOT IN (SELECT value FROM json_each(?3))`,
    )
    .bind(communityId, JSON.stringify(ids), JSON.stringify(viewer.hidden))
    .all<IndexedPost>();
  const byId = new Map(results.map((r) => [r.postId, r]));
  const rows = ids.flatMap((id) => byId.get(id) ?? []);
  return render(env, rows, viewer, new Set(ids));
}

/** The posts `accountId` reads as featured in `communityId`: none when it may not read it. */
export async function featuredFor(
  env: Env,
  accountId: string,
  communityId: string,
): Promise<Post[]> {
  const access = await spaceAccess(env, accountId, communityId);
  return access ? featuredPosts(env, communityId, access.viewer) : [];
}

/**
 * One page of `viewer`'s feed: the visible posts of its communities, with
 * `tombstones` the removed too, newest first, read one time window at a time
 * (the plan #275 measured). A page that fills ends at its last post; one that
 * does not ends at its window, and the next page reads the window before it,
 * until no community of the viewer's is that old. `rowsRead` is D1's own count,
 * for the budget test.
 */
export async function feed(
  env: Env,
  viewer: string,
  before: string | undefined,
  limit: number,
  tombstones: boolean,
  now = Date.now(),
): Promise<{ rows: IndexedPost[]; next: string | null; rowsRead: number }> {
  const cursor = parseCursor(before) ?? { t: now, id: null };
  const { results, meta } = await db(env)
    .prepare(
      `SELECT ${INDEXED} FROM community_members m
         JOIN live_communities c ON c.community_id = m.community_id
         JOIN post_index p ON p.community_id = m.community_id
          AND p.created_at <= ?2 AND p.created_at > ?2 - ?3
        WHERE m.account_id = ?1 AND ${listed(tombstones)}
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
  input: {
    body: string;
    media: string[];
    poll?: string[] | undefined;
    anonymous?: boolean;
    /** Makes it a wall post (decision 0115), which moves no community's unread count. */
    audience?: "friends" | "everyone";
  },
): Promise<(Omit<PostContent, "latestComment"> & { latestComment: null }) | "invalid_media"> {
  const media = await unattached(env, communityId, author, input.media);
  if (!media) return "invalid_media";
  const postId = newPostId();
  const createdAt = Date.now();
  // An anonymous post waits for a moderator's approval (decision 0091) and
  // moves the community's unread count then, so a reader cannot tell it was written.
  const anonymous = input.anonymous === true;
  await db(env).batch([
    ...(anonymous || input.audience ? [] : notePost(env, communityId, author, createdAt)),
    db(env)
      .prepare(
        `INSERT INTO post_index (post_id, community_id, author_id, created_at, state, anonymous,
                                 audience)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        postId,
        communityId,
        author,
        createdAt,
        anonymous ? "pending" : "visible",
        anonymous ? 1 : 0,
        input.audience ?? null,
      ),
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
  await space(env, communityId).createPost({ ...content, poll: input.poll, anonymous });
  // Its author sees a new poll's counts at once, all of them none (decision 0090).
  const poll = input.poll && {
    options: input.poll.map((text, i) => ({ optionId: optionId(i), text, votes: 0 })),
    total: 0,
    mine: null,
    closed: false,
  };
  return {
    ...content,
    anonymous,
    reactions: [],
    myReaction: null,
    emojis: [],
    myEmoji: null,
    commentCount: 0,
    latestComment: null,
    ...(poll ? { poll } : {}),
  };
}

/**
 * One post as `accountId` reads it, or null when it may not see it: the answer
 * of a route that changes a post and returns it (decision 0090).
 */
export async function viewPost(env: Env, accountId: string, postId: string): Promise<Post | null> {
  const found = await postAccess(env, accountId, postId);
  if (!found) return null;
  const featured = new Set(await space(env, found.post.communityId).featured());
  return (await render(env, [found.post], found.access.viewer, featured))[0] ?? null;
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

/** The top-level visible comment of `post` a reply answers, or "invalid". */
async function replyParent(
  env: Env,
  post: IndexedPost,
  parentCommentId: string,
): Promise<CommentRecord | "invalid"> {
  const parent = await space(env, post.communityId).comment(parentCommentId);
  const valid =
    parent &&
    parent.postId === post.postId &&
    parent.parentCommentId === null &&
    parent.state === "visible";
  return valid ? parent : "invalid";
}

/**
 * Comments `body` on `postId` as `author`, when it may reply there: the one
 * way a comment is written. With `media`, at most one image (0082). With `parentCommentId` it
 * is a reply to a top-level comment on the post, whose author is told too (0071), deduplicated when it is the post's
 * author, and never across a block. The post's author is told. The notice is written
 * first; its job finds no comment to tell of if the space then fails to
 * take it.
 */
export async function writeComment(
  env: Env,
  author: string,
  postId: string,
  body: string,
  parentCommentId: string | null = null,
  media: string[] = [],
): Promise<
  | { comment: CommentContent; post: IndexedPost }
  | { refused: NonNullable<ReturnType<typeof replyRefusal>> }
  | { invalidParent: true }
  | { invalidMedia: true }
  | null
> {
  const found = await postAccess(env, author, postId);
  if (!found) return null;
  const refused = replyRefusal(found.access, found.post);
  if (refused) return { refused };
  const { post } = found;
  // The parent is checked before anything is written, and the space checks
  // it again as the comment is written, so a refused parent tells nobody.
  const parent = parentCommentId === null ? null : await replyParent(env, post, parentCommentId);
  if (parent === "invalid") return { invalidParent: true };
  if (parent && (await blockedEither(env, author)).includes(parent.author)) {
    return { refused: "blocked" };
  }
  // The image is the caller's own unattached upload to this community, as a post's is (0082).
  if (!(await unattached(env, post.communityId, author, media))) return { invalidMedia: true };
  const commentId = newCommentId(postId);
  await noteAuthor(env, post.communityId, author, [
    // The row records the comment's post, so every path that deletes a post's images reaches it.
    db(env)
      .prepare(
        `UPDATE social_media SET post_id = ?1, comment_id = ?2
          WHERE media_id IN (SELECT value FROM json_each(?3)) AND post_id IS NULL
            AND community_id = ?4 AND uploader_id = ?5`,
      )
      .bind(postId, commentId, JSON.stringify(media), post.communityId, author),
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
            kind: "reply",
            accountId: parent.author,
            actorId: author,
            communityId: post.communityId,
            postId,
            commentId,
            parentCommentId: parent.commentId,
          }),
        ]
      : []),
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
