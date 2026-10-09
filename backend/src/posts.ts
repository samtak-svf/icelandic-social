import { randomToken } from "./accounts.ts";
import { REACTIONS } from "./api/posts.ts";
import { base64url } from "./bytes.ts";
import { db } from "./env/index.ts";

// Fljótið and the walls (decision 0034): posts, replies and reactions in D1,
// public to every signed-in account. The server filters blocks (0024): a
// reader never sees what an account they blocked wrote, and an account
// cannot reply or react to a post by an account that blocked it.

export type Reaction = (typeof REACTIONS)[number];

type Author = { accountId: string; name: string | null; verified: boolean };

export type Post = {
  postId: string;
  author: Author;
  body: string;
  createdAt: number;
  replyCount: number;
  reactions: Record<Reaction, number>;
  myReaction: Reaction | null;
};

export type Reply = {
  replyId: string;
  postId: string;
  author: Author;
  body: string;
  createdAt: number;
};

export type Page<T> = { items: T[]; next: string | null };

/** A position in a list: the last item's time and id, which break ties. */
type Cursor = { at: number; id: string };

const CURSOR = /^(\d{1,16})\.([A-Za-z0-9_-]{1,128})$/;

/** The opaque form of a cursor: base64url, so a client cannot read meaning into it. */
function encodeCursor(cursor: Cursor): string {
  return base64url(new TextEncoder().encode(`${cursor.at}.${cursor.id}`));
}

/** A cursor this server made, or null for anything else. */
export function decodeCursor(text: string): Cursor | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(text)) return null;
  let decoded: string;
  try {
    decoded = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    return null;
  }
  const match = CURSOR.exec(decoded);
  return match ? { at: Number(match[1]), id: match[2]! } : null;
}

/** A reader's view: hides the authors the reader blocked. */
const NOT_BLOCKED = (author: string) =>
  `NOT EXISTS (SELECT 1 FROM blocks
     WHERE blocker_account_id = ?1 AND blocked_account_id = ${author})`;

type PostRow = {
  postId: string;
  accountId: string;
  name: string | null;
  verified: number;
  body: string;
  createdAt: number;
  replyCount: number;
  reactions: string;
  myReaction: Reaction | null;
};

/** The columns of a post as `?1` reads it. */
const POST_COLUMNS = `
  p.post_id AS postId, p.author_account_id AS accountId, a.display_name AS name,
  a.verified, p.body, p.created_at AS createdAt,
  (SELECT count(*) FROM post_replies r
    WHERE r.post_id = p.post_id AND ${NOT_BLOCKED("r.author_account_id")}) AS replyCount,
  (SELECT json_group_object(reaction, n) FROM
    (SELECT reaction, count(*) AS n FROM post_reactions
      WHERE post_id = p.post_id GROUP BY reaction)) AS reactions,
  (SELECT reaction FROM post_reactions
    WHERE post_id = p.post_id AND account_id = ?1) AS myReaction`;

function toPost(row: PostRow): Post {
  const counted = JSON.parse(row.reactions) as Partial<Record<Reaction, number>>;
  return {
    postId: row.postId,
    author: { accountId: row.accountId, name: row.name, verified: row.verified === 1 },
    body: row.body,
    createdAt: row.createdAt,
    replyCount: row.replyCount,
    reactions: Object.fromEntries(REACTIONS.map((r) => [r, counted[r] ?? 0])) as Record<
      Reaction,
      number
    >,
    myReaction: row.myReaction,
  };
}

/**
 * A page of posts, newest first, as `reader` sees them: every account's
 * (Fljótið), or one author's (a wall). The cursor is the last post of the
 * page before, so posts made while a reader pages do not shift the pages.
 */
export async function posts(
  env: Env,
  reader: string,
  options: { author?: string; before?: Cursor; limit: number },
): Promise<Page<Post>> {
  const { author, before, limit } = options;
  const { results } = await db(env)
    .prepare(
      `SELECT ${POST_COLUMNS}
         FROM posts p JOIN accounts a ON a.account_id = p.author_account_id
        WHERE ${NOT_BLOCKED("p.author_account_id")}
          AND (?2 IS NULL OR p.author_account_id = ?2)
          AND (?3 IS NULL OR (p.created_at, p.post_id) < (?3, ?4))
        ORDER BY p.created_at DESC, p.post_id DESC LIMIT ?5`,
    )
    .bind(reader, author ?? null, before?.at ?? null, before?.id ?? null, limit + 1)
    .all<PostRow>();
  return page(results.map(toPost), limit, (p) => ({ at: p.createdAt, id: p.postId }));
}

/** One post as `reader` sees it, or null when there is none or its author is blocked. */
export async function post(env: Env, reader: string, postId: string): Promise<Post | null> {
  const row = await db(env)
    .prepare(
      `SELECT ${POST_COLUMNS}
         FROM posts p JOIN accounts a ON a.account_id = p.author_account_id
        WHERE p.post_id = ?2 AND ${NOT_BLOCKED("p.author_account_id")}`,
    )
    .bind(reader, postId)
    .first<PostRow>();
  return row ? toPost(row) : null;
}

function page<T>(rows: T[], limit: number, cursorOf: (item: T) => Cursor): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, next: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
}

/** Writes a post; the caller has checked the body. */
export async function createPost(env: Env, author: string, body: string): Promise<Post> {
  const postId = randomToken("post_");
  await db(env)
    .prepare(
      // Times only rise, so two posts in one millisecond keep the order they came in.
      `INSERT INTO posts (post_id, author_account_id, body, created_at)
       VALUES (?1, ?2, ?3, max(?4, coalesce((SELECT max(created_at) + 1 FROM posts), 0)))`,
    )
    .bind(postId, author, body, Date.now())
    .run();
  return (await post(env, author, postId))!;
}

/** Deletes `author`'s own post, with its replies and reactions. */
export async function deletePost(
  env: Env,
  author: string,
  postId: string,
): Promise<"ok" | "not_found" | "not_author"> {
  return deleteOwn(env, "posts", "post_id", author, postId);
}

async function deleteOwn(
  env: Env,
  table: "posts" | "post_replies",
  key: "post_id" | "reply_id",
  author: string,
  id: string,
): Promise<"ok" | "not_found" | "not_author"> {
  const row = await db(env)
    .prepare(`SELECT author_account_id AS author FROM ${table} WHERE ${key} = ?`)
    .bind(id)
    .first<{ author: string }>();
  if (!row) return "not_found";
  if (row.author !== author) return "not_author";
  await db(env).prepare(`DELETE FROM ${table} WHERE ${key} = ?`).bind(id).run();
  return "ok";
}

/**
 * Whether `account` may answer a post: it exists, the account can see it,
 * and its author has not blocked the account.
 */
async function answerable(
  env: Env,
  account: string,
  postId: string,
): Promise<"ok" | "not_found" | "blocked"> {
  const row = await db(env)
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM blocks
                WHERE blocker_account_id = p.author_account_id AND blocked_account_id = ?1)
              AS blocked
         FROM posts p WHERE p.post_id = ?2 AND ${NOT_BLOCKED("p.author_account_id")}`,
    )
    .bind(account, postId)
    .first<{ blocked: number }>();
  if (!row) return "not_found";
  return row.blocked ? "blocked" : "ok";
}

/** Sets `account`'s one reaction to a post, replacing any it had. */
export async function react(
  env: Env,
  account: string,
  postId: string,
  reaction: Reaction,
): Promise<"ok" | "not_found" | "blocked"> {
  const allowed = await answerable(env, account, postId);
  if (allowed !== "ok") return allowed;
  await db(env)
    .prepare(
      `INSERT INTO post_reactions (post_id, account_id, reaction, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (post_id, account_id) DO UPDATE SET reaction = excluded.reaction`,
    )
    .bind(postId, account, reaction, Date.now())
    .run();
  return "ok";
}

/** Takes back `account`'s reaction; taking back none is no error. */
export async function unreact(env: Env, account: string, postId: string): Promise<void> {
  await db(env)
    .prepare("DELETE FROM post_reactions WHERE post_id = ? AND account_id = ?")
    .bind(postId, account)
    .run();
}

type ReplyRow = {
  replyId: string;
  postId: string;
  accountId: string;
  name: string | null;
  verified: number;
  body: string;
  createdAt: number;
};

const toReply = (row: ReplyRow): Reply => ({
  replyId: row.replyId,
  postId: row.postId,
  author: { accountId: row.accountId, name: row.name, verified: row.verified === 1 },
  body: row.body,
  createdAt: row.createdAt,
});

const REPLY_COLUMNS = `
  r.reply_id AS replyId, r.post_id AS postId, r.author_account_id AS accountId,
  a.display_name AS name, a.verified, r.body, r.created_at AS createdAt`;

/** A page of a post's replies, oldest first, or null when `reader` cannot see the post. */
export async function replies(
  env: Env,
  reader: string,
  postId: string,
  options: { after?: Cursor; limit: number },
): Promise<Page<Reply> | null> {
  if (!(await post(env, reader, postId))) return null;
  const { after, limit } = options;
  const { results } = await db(env)
    .prepare(
      `SELECT ${REPLY_COLUMNS}
         FROM post_replies r JOIN accounts a ON a.account_id = r.author_account_id
        WHERE r.post_id = ?2 AND ${NOT_BLOCKED("r.author_account_id")}
          AND (?3 IS NULL OR (r.created_at, r.reply_id) > (?3, ?4))
        ORDER BY r.created_at, r.reply_id LIMIT ?5`,
    )
    .bind(reader, postId, after?.at ?? null, after?.id ?? null, limit + 1)
    .all<ReplyRow>();
  return page(results.map(toReply), limit, (r) => ({ at: r.createdAt, id: r.replyId }));
}

/** Writes a reply; the caller has checked the body. */
export async function createReply(
  env: Env,
  author: string,
  postId: string,
  body: string,
): Promise<Reply | "not_found" | "blocked"> {
  const allowed = await answerable(env, author, postId);
  if (allowed !== "ok") return allowed;
  const replyId = randomToken("reply_");
  await db(env)
    .prepare(
      `INSERT INTO post_replies (reply_id, post_id, author_account_id, body, created_at)
       VALUES (?1, ?2, ?3, ?4,
               max(?5, coalesce((SELECT max(created_at) + 1 FROM post_replies
                                  WHERE post_id = ?2), 0)))`,
    )
    .bind(replyId, postId, author, body, Date.now())
    .run();
  const row = await db(env)
    .prepare(
      `SELECT ${REPLY_COLUMNS}
         FROM post_replies r JOIN accounts a ON a.account_id = r.author_account_id
        WHERE r.reply_id = ?`,
    )
    .bind(replyId)
    .first<ReplyRow>();
  return toReply(row!);
}

/** Deletes `author`'s own reply. */
export async function deleteReply(
  env: Env,
  author: string,
  replyId: string,
): Promise<"ok" | "not_found" | "not_author"> {
  return deleteOwn(env, "post_replies", "reply_id", author, replyId);
}
