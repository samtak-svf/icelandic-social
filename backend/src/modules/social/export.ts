import { db, space } from "../../env/index.ts";
import type { OwnPage, OwnStage } from "./do/export.ts";

// What a person's own export reads from the social module (decision 0126): the
// spaces where they wrote or reacted, and their posts, comments and reactions in
// one of them, a page at a time. The text of a hidden or removed item is theirs
// and stays; its images do not (the file is not a way around a moderator).

/** An image an item holds; `withheld` when a moderator took it down or it is gone. */
export type ExportImage = { mediaId: string; withheld: boolean };

export type ExportPost = {
  postId: string;
  body: string;
  createdAt: number;
  anonymous: boolean;
  audience: string | null;
  state: string;
  imported: boolean;
  images: ExportImage[];
  poll: { options: { optionId: string; text: string }[]; myOption: string | null } | null;
};
export type ExportComment = {
  commentId: string;
  postId: string;
  parentCommentId: string | null;
  body: string;
  createdAt: number;
  state: string;
  images: ExportImage[];
};
export type ExportPage = {
  posts: ExportPost[];
  comments: ExportComment[];
  reactions: NonNullable<OwnPage["reactions"]>;
  next: string | null;
};

/** The spaces where `accountId` wrote or reacted (every write notes its author here). */
export async function exportSpaceIds(env: Env, accountId: string): Promise<string[]> {
  const { results } = await db(env)
    .prepare(
      "SELECT community_id AS id FROM space_authors WHERE account_id = ? ORDER BY community_id",
    )
    .bind(accountId)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

type MediaRow = {
  post_id: string;
  comment_id: string | null;
  media_id: string;
  removed_at: number | null;
  hidden_at: number | null;
};

async function imagesOf(
  env: Env,
  postIds: string[],
): Promise<{ post: Map<string, MediaRow[]>; comment: Map<string, MediaRow[]> }> {
  const post = new Map<string, MediaRow[]>();
  const comment = new Map<string, MediaRow[]>();
  if (postIds.length === 0) return { post, comment };
  const { results } = await db(env)
    .prepare(
      `SELECT post_id, comment_id, media_id, removed_at, hidden_at FROM social_media
        WHERE post_id IN (${marks(postIds.length)}) ORDER BY created_at, media_id`,
    )
    .bind(...postIds)
    .all<MediaRow>();
  for (const row of results) {
    const into = row.comment_id === null ? post : comment;
    const key = row.comment_id ?? row.post_id;
    into.set(key, [...(into.get(key) ?? []), row]);
  }
  return { post, comment };
}

const image = (row: MediaRow, withheldAll: boolean): ExportImage => ({
  mediaId: row.media_id,
  withheld: withheldAll || row.removed_at !== null || row.hidden_at !== null,
});

type PostState = { state: string; audience: string | null; imported: string | null };

/** The moderation state, audience and import mark the index holds for `postIds`. */
async function postStates(env: Env, postIds: string[]): Promise<Map<string, PostState>> {
  const states = new Map<string, PostState>();
  if (postIds.length === 0) return states;
  const { results } = await db(env)
    .prepare(
      `SELECT post_id, state, audience, imported FROM post_index
        WHERE post_id IN (${marks(postIds.length)})`,
    )
    .bind(...postIds)
    .all<PostState & { post_id: string }>();
  for (const r of results) states.set(r.post_id, r);
  return states;
}

/** One page of what `accountId` has in `communityId` for `stage`, after the keyset `after`. */
export async function exportPage(
  env: Env,
  communityId: string,
  accountId: string,
  stage: OwnStage,
  after: string,
  limit: number,
): Promise<ExportPage> {
  const page = await space(env, communityId).ownPage(accountId, stage, after, limit);
  const out: ExportPage = {
    posts: [],
    comments: [],
    reactions: page.reactions ?? [],
    next: page.next,
  };
  const posts = page.posts ?? [];
  const comments = page.comments ?? [];
  const postIds = [...new Set([...posts.map((p) => p.postId), ...comments.map((c) => c.postId)])];
  const media = await imagesOf(env, postIds);
  const states = await postStates(env, postIds);
  const closed = (state: string) => state === "hidden" || state === "removed";
  for (const p of posts) {
    const index = states.get(p.postId);
    const state = index?.state ?? "visible";
    const held = new Map((media.post.get(p.postId) ?? []).map((m) => [m.media_id, m]));
    out.posts.push({
      postId: p.postId,
      body: p.body,
      createdAt: p.createdAt,
      anonymous: p.anonymous,
      audience: index?.audience ?? null,
      state,
      imported: (index?.imported ?? null) !== null,
      // A listed image with no row is gone from storage: withheld, never a dead path.
      images: p.media.map((m) => {
        const row = held.get(m.mediaId);
        return row ? image(row, closed(state)) : { mediaId: m.mediaId, withheld: true };
      }),
      poll: p.poll,
    });
  }
  for (const c of comments) {
    out.comments.push({
      commentId: c.commentId,
      postId: c.postId,
      parentCommentId: c.parentCommentId,
      body: c.body,
      createdAt: c.createdAt,
      state: c.state,
      images: (media.comment.get(c.commentId) ?? []).map((m) => image(m, c.state !== "visible")),
    });
  }
  return out;
}
