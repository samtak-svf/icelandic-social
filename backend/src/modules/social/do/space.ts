import { DurableObject } from "cloudflare:workers";
import type { REACTIONS } from "../../../api/social.ts";
import { REMOVED_KEPT_MS, SCHEMA } from "./space-schema.ts";

export type Reaction = (typeof REACTIONS)[number];

/** An image a post holds, re-encoded (decision 0065). */
export type MediaRef = { mediaId: string; width: number; height: number };

/** A post as one viewer sees it, before the Worker adds its author's name. */
export type PostContent = {
  postId: string;
  author: string;
  body: string;
  media: MediaRef[];
  createdAt: number;
  reactions: { kind: Reaction; count: number }[];
  myReaction: Reaction | null;
  commentCount: number;
};

export type ContentState = "visible" | "hidden" | "removed";

export type CommentContent = {
  commentId: string;
  postId: string;
  author: string;
  body: string;
  createdAt: number;
  state: ContentState;
};

/**
 * Who is looking: the viewer, and the accounts a block stands between it and
 * (decision 0063), whose comments and reactions it does not see. The Worker
 * has already decided the viewer may read the space; a moderator's `hidden`
 * is empty, since a block does not hide content from moderation, and only a
 * moderator sees a hidden or removed comment.
 */
export type Viewer = { account: string; hidden: string[]; moderator: boolean };

type PostRow = { post_id: string; author: string; body: string; media: string; created_at: number };
type CommentRow = {
  comment_id: string;
  post_id: string;
  author: string;
  body: string;
  created_at: number;
  state: ContentState;
};

const comment = (r: CommentRow): CommentContent => ({
  commentId: r.comment_id,
  postId: r.post_id,
  author: r.author,
  body: r.body,
  createdAt: r.created_at,
  state: r.state,
});

/**
 * One space's content (decisions 0060, 0063): its posts, the comments on
 * them and one reaction per account on each. It is hosted, not encrypted:
 * the Worker checks who may read and write before it calls, and the object
 * keeps what it is given. Nothing here is logged (0008).
 */
export class Space extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }

  createPost(input: {
    postId: string;
    author: string;
    body: string;
    media: MediaRef[];
    createdAt: number;
  }): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO posts (post_id, author, body, media, created_at) VALUES (?, ?, ?, ?, ?)",
      input.postId,
      input.author,
      input.body,
      JSON.stringify(input.media),
      input.createdAt,
    );
  }

  /** The posts of `ids` there are, as `viewer` sees them, in the order asked. */
  posts(ids: string[], viewer: Viewer): PostContent[] {
    if (ids.length === 0) return [];
    const wanted = JSON.stringify(ids);
    const hidden = JSON.stringify(viewer.hidden);
    const rows = this.sql
      .exec<PostRow>(
        "SELECT * FROM posts WHERE post_id IN (SELECT value FROM json_each(?))",
        wanted,
      )
      .toArray();
    const counts = this.sql
      .exec<{ post_id: string; kind: Reaction; count: number }>(
        `SELECT post_id, kind, COUNT(*) AS count FROM reactions
          WHERE post_id IN (SELECT value FROM json_each(?1))
            AND account NOT IN (SELECT value FROM json_each(?2))
          GROUP BY post_id, kind ORDER BY count DESC, kind`,
        wanted,
        hidden,
      )
      .toArray();
    const mine = new Map(
      this.sql
        .exec<{ post_id: string; kind: Reaction }>(
          `SELECT post_id, kind FROM reactions
            WHERE account = ? AND post_id IN (SELECT value FROM json_each(?))`,
          viewer.account,
          wanted,
        )
        .toArray()
        .map((r) => [r.post_id, r.kind]),
    );
    const comments = new Map(
      this.sql
        .exec<{ post_id: string; count: number }>(
          `SELECT post_id, COUNT(*) AS count FROM comments
            WHERE post_id IN (SELECT value FROM json_each(?1))
              AND author NOT IN (SELECT value FROM json_each(?2))
              AND (?3 = 1 OR state = 'visible')
            GROUP BY post_id`,
          wanted,
          hidden,
          viewer.moderator ? 1 : 0,
        )
        .toArray()
        .map((r) => [r.post_id, r.count]),
    );
    const byId = new Map(rows.map((r) => [r.post_id, r]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      return [
        {
          postId: row.post_id,
          author: row.author,
          body: row.body,
          media: JSON.parse(row.media) as MediaRef[],
          createdAt: row.created_at,
          reactions: counts
            .filter((c) => c.post_id === id)
            .map(({ kind, count }) => ({ kind, count })),
          myReaction: mine.get(id) ?? null,
          commentCount: comments.get(id) ?? 0,
        },
      ];
    });
  }

  /** Deletes a post with its comments and reactions. */
  deletePost(postId: string): void {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM posts WHERE post_id = ?", postId);
      this.sql.exec("DELETE FROM comments WHERE post_id = ?", postId);
      this.sql.exec("DELETE FROM reactions WHERE post_id = ?", postId);
    });
  }

  /** A post's comments, oldest first, after the cursor `after`. */
  comments(
    postId: string,
    viewer: Viewer,
    after: { createdAt: number; id: string } | null,
    limit: number,
  ): CommentContent[] {
    return this.sql
      .exec<CommentRow>(
        `SELECT * FROM comments
          WHERE post_id = ?1 AND author NOT IN (SELECT value FROM json_each(?2))
            AND (?6 = 1 OR state = 'visible')
            AND (?3 IS NULL OR created_at > ?3 OR (created_at = ?3 AND comment_id > ?4))
          ORDER BY created_at, comment_id LIMIT ?5`,
        postId,
        JSON.stringify(viewer.hidden),
        after?.createdAt ?? null,
        after?.id ?? null,
        limit,
        viewer.moderator ? 1 : 0,
      )
      .toArray()
      .map(comment);
  }

  /** Stores a comment; null when the post is not here. */
  addComment(input: Omit<CommentContent, "state">): CommentContent | null {
    const exists = this.sql
      .exec("SELECT 1 FROM posts WHERE post_id = ?", input.postId)
      .toArray().length;
    if (!exists) return null;
    this.sql.exec(
      `INSERT OR IGNORE INTO comments (comment_id, post_id, author, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      input.commentId,
      input.postId,
      input.author,
      input.body,
      input.createdAt,
    );
    return { ...input, state: "visible" };
  }

  comment(commentId: string): CommentContent | null {
    const row = this.sql
      .exec<CommentRow>("SELECT * FROM comments WHERE comment_id = ?", commentId)
      .toArray()[0];
    return row ? comment(row) : null;
  }

  deleteComment(commentId: string): void {
    this.sql.exec("DELETE FROM comments WHERE comment_id = ?", commentId);
  }

  /**
   * A moderator's hide, removal or restoring of a comment (decision 0063).
   * A removed comment's text is deleted REMOVED_KEPT_MS later, by the alarm.
   */
  async moderateComment(commentId: string, state: ContentState, at: number): Promise<boolean> {
    const changed = this.sql.exec(
      "UPDATE comments SET state = ?, moderated_at = ? WHERE comment_id = ?",
      state,
      at,
      commentId,
    ).rowsWritten;
    if (changed > 0 && state === "removed" && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(at + REMOVED_KEPT_MS);
    }
    return changed > 0;
  }

  /** Deletes the comments removed REMOVED_KEPT_MS ago, and waits for the next. */
  async alarm(): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      "DELETE FROM comments WHERE state = 'removed' AND moderated_at <= ?",
      now - REMOVED_KEPT_MS,
    );
    const next = this.sql
      .exec<{ at: number | null }>(
        "SELECT MIN(moderated_at) AS at FROM comments WHERE state = 'removed'",
      )
      .one().at;
    if (next !== null) await this.ctx.storage.setAlarm(next + REMOVED_KEPT_MS);
  }

  /** Sets, replaces or (with null) removes `account`'s reaction; false when the post is not here. */
  react(postId: string, account: string, kind: Reaction | null): boolean {
    const exists = this.sql.exec("SELECT 1 FROM posts WHERE post_id = ?", postId).toArray().length;
    if (!exists) return false;
    if (kind === null) {
      this.sql.exec("DELETE FROM reactions WHERE post_id = ? AND account = ?", postId, account);
    } else {
      this.sql.exec(
        `INSERT INTO reactions (post_id, account, kind, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (post_id, account) DO UPDATE SET kind = excluded.kind`,
        postId,
        account,
        kind,
        Date.now(),
      );
    }
    return true;
  }

  /**
   * Deletes everything `account` wrote here, for the deletion of its account
   * (decision 0063): its posts with every comment and reaction on them, and
   * its comments and reactions elsewhere. The ids of its posts, for the Worker
   * to drop from the index.
   */
  forget(account: string): string[] {
    const posts = this.sql
      .exec<{ post_id: string }>("SELECT post_id FROM posts WHERE author = ?", account)
      .toArray();
    this.ctx.storage.transactionSync(() => {
      for (const { post_id } of posts) {
        this.sql.exec("DELETE FROM comments WHERE post_id = ?", post_id);
        this.sql.exec("DELETE FROM reactions WHERE post_id = ?", post_id);
      }
      this.sql.exec("DELETE FROM posts WHERE author = ?", account);
      this.sql.exec("DELETE FROM comments WHERE author = ?", account);
      this.sql.exec("DELETE FROM reactions WHERE account = ?", account);
    });
    return posts.map((p) => p.post_id);
  }

  /**
   * What the space holds, for reconciling it with D1 after a restore
   * (decision 0068): its posts' ids, the comments' ids, and every account
   * that wrote or reacted here.
   */
  inventory(): { posts: string[]; comments: string[]; accounts: string[] } {
    const column = (query: string) =>
      this.sql
        .exec<{ id: string }>(query)
        .toArray()
        .map((r) => r.id);
    return {
      posts: column("SELECT post_id AS id FROM posts"),
      comments: column("SELECT comment_id AS id FROM comments"),
      accounts: column(
        `SELECT author AS id FROM posts UNION SELECT author FROM comments
          UNION SELECT account FROM reactions`,
      ),
    };
  }

  /**
   * Sets the space to restore, when it next starts, to `target`: a time, or a
   * bookmark an earlier restore returned (decision 0068). The bookmark of now,
   * which undoes the restore. The object starts again only after `restart`.
   */
  async restoreTo(target: { at: number } | { bookmark: string }): Promise<string> {
    const bookmark =
      "at" in target ? await this.ctx.storage.getBookmarkForTime(target.at) : target.bookmark;
    return this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
  }

  /** Ends this run of the object, so the next call starts it on the restored storage. */
  restart(): void {
    this.ctx.abort("restored");
  }

  /** Deletes the whole space, with its community (decision 0063). */
  async drop(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
