import { DurableObject } from "cloudflare:workers";
import type { ReactionKind } from "../../../api/social.ts";
import {
  type CommentContent,
  type CommentRecord,
  type CommentRow,
  type ContentState,
  type Viewer,
  comment,
  latestComments,
  listComments,
} from "./comment-reads.ts";
import { ensureAnonymousColumn, publish } from "./anonymous.ts";
import { ensureEmojiReactions, reactionViews, setReaction } from "./reactions.ts";
import * as polls from "./polls.ts";
import { featured, pinPost } from "./pins.ts";
import { type PostRow, REMOVED_KEPT_MS, SCHEMA } from "./space-schema.ts";
import { sweepRemoved } from "./removed.ts";
import { type OwnPage, type OwnStage, ownPage } from "./export.ts";

export type { CommentContent, CommentRecord, ContentState, Viewer } from "./comment-reads.ts";
/** An image a post holds, re-encoded (decision 0065). */
export type MediaRef = { mediaId: string; width: number; height: number };

/** A post as one viewer sees it, before the Worker adds its author's name. */
export type PostContent = {
  postId: string;
  author: string;
  body: string;
  media: MediaRef[];
  createdAt: number;
  /** The old kinds, derived from the emoji (0100). */
  reactions: { kind: ReactionKind; count: number }[];
  myReaction: ReactionKind | null;
  emojis: { emoji: string; count: number }[];
  myEmoji: string | null;
  commentCount: number;
  /** The newest comment the viewer may read, or null (decision 0080). */
  latestComment: CommentContent | null;
  /** Present on a poll (decision 0090). */
  poll?: polls.PollView;
  /** Posted without the author's name (decision 0091); the author stays here for the Worker. */
  anonymous: boolean;
};

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
    ensureAnonymousColumn(this.sql);
    ensureEmojiReactions(this.sql);
    // The space made before decision 0071 lacks the replay column: it is
    // added in place, as a repair on open, whatever its history (0050).
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(comments)").toArray();
    if (!columns.some((c) => c.name === "parent_comment_id")) {
      this.sql.exec("ALTER TABLE comments ADD COLUMN parent_comment_id TEXT");
    }
    this.sql.exec("CREATE INDEX IF NOT EXISTS comments_by_parent ON comments (parent_comment_id)");
    // The single pin of decision 0080 becomes the first featured post (0088):
    // copied across and dropped in one step, so a repeat finds nothing to do.
    const old = this.sql
      .exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pinned_post'")
      .toArray();
    if (old.length > 0) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "INSERT OR IGNORE INTO pinned_posts (post_id, pinned_at) SELECT post_id, pinned_at FROM pinned_post",
        );
        this.sql.exec("DROP TABLE pinned_post");
      });
    }
  }

  createPost(input: {
    postId: string;
    author: string;
    body: string;
    media: MediaRef[];
    createdAt: number;
    /** The texts of a poll's options, in order (decision 0090). */
    poll?: string[];
    /** Without the author's name for readers (decision 0091). */
    anonymous?: boolean;
  }): void {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT OR IGNORE INTO posts (post_id, author, body, media, created_at, anonymous) VALUES (?, ?, ?, ?, ?, ?)",
        input.postId,
        input.author,
        input.body,
        JSON.stringify(input.media),
        input.createdAt,
        input.anonymous ? 1 : 0,
      );
      polls.addOptions(this.sql, input.postId, input.poll ?? []);
    });
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
      .exec<{ post_id: string; emoji: string; count: number }>(
        `SELECT post_id, emoji, COUNT(*) AS count FROM reactions
          WHERE post_id IN (SELECT value FROM json_each(?1))
            AND account NOT IN (SELECT value FROM json_each(?2))
          GROUP BY post_id, emoji ORDER BY count DESC, emoji`,
        wanted,
        hidden,
      )
      .toArray();
    const mine = new Map(
      this.sql
        .exec<{ post_id: string; emoji: string }>(
          `SELECT post_id, emoji FROM reactions
            WHERE account = ? AND post_id IN (SELECT value FROM json_each(?))`,
          viewer.account,
          wanted,
        )
        .toArray()
        .map((r) => [r.post_id, r.emoji]),
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
    const latest = latestComments(this.sql, ids, viewer);
    const pollOf = polls.readPolls(
      this.sql,
      ids,
      viewer,
      new Map(rows.map((r) => [r.post_id, r.author])),
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
          ...reactionViews(
            counts.filter((c) => c.post_id === id),
            mine.get(id) ?? null,
          ),
          commentCount: comments.get(id) ?? 0,
          latestComment: latest.get(id) ?? null,
          anonymous: row.anonymous === 1,
          ...(pollOf.has(id) ? { poll: pollOf.get(id) } : {}),
        },
      ];
    });
  }

  /** Sets, changes or (with null) withdraws `account`'s vote (decision 0090). */
  vote(postId: string, account: string, option: string | null) {
    return polls.castVote(this.sql, postId, account, option);
  }

  /** Whether `postId` is no poll, an open one or a closed one (decision 0090). */
  pollStatus(postId: string) {
    return polls.pollStatus(this.sql, postId);
  }

  /** Closes a poll; closing a closed one changes nothing. */
  closePoll(postId: string): void {
    polls.closePoll(this.sql, postId);
  }

  /**
   * The ids of the posts here whose text contains `query`, without case, the
   * visible ones among them for the search to intersect with the index
   * (decision 0079). It folds in JavaScript, since SQLite's `lower` folds
   * only plain ASCII and the text is Icelandic; it reads this space's own
   * posts, which every search of it is bound to.
   */
  searchPosts(query: string): string[] {
    const wanted = query.toLowerCase();
    if (wanted.length === 0) return [];
    return this.sql
      .exec<{ post_id: string; body: string }>("SELECT post_id, body FROM posts")
      .toArray()
      .filter((p) => p.body.toLowerCase().includes(wanted))
      .map((p) => p.post_id);
  }

  /** Dates an approved anonymous post at the approval (decision 0091). */
  publishPost(postId: string, at: number): void {
    publish(this.sql, postId, at);
  }

  /** Deletes a post with its comments and reactions. */
  deletePost(postId: string): void {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `DELETE FROM comment_reactions
          WHERE comment_id IN (SELECT comment_id FROM comments WHERE post_id = ?)`,
        postId,
      );
      this.sql.exec("DELETE FROM posts WHERE post_id = ?", postId);
      this.sql.exec("DELETE FROM comments WHERE post_id = ?", postId);
      this.sql.exec("DELETE FROM reactions WHERE post_id = ?", postId);
      polls.purgePoll(this.sql, postId);
      // A deleted post is no longer pinned (decision 0080).
      this.sql.exec("DELETE FROM pinned_posts WHERE post_id = ?", postId);
    });
  }

  /**
   * Features `postId` in the community's strip (decisions 0080, 0088): "absent"
   * when the post is not here, "full" when three others are featured already,
   * "pinned" when it is now featured, "already" when it was.
   */
  pinPost(postId: string): "absent" | "full" | "pinned" | "already" {
    return pinPost(this.sql, postId);
  }

  /** Releases `postId` when it is featured; whether it was. */
  unpinPost(postId: string): boolean {
    return this.sql.exec("DELETE FROM pinned_posts WHERE post_id = ?", postId).rowsWritten > 0;
  }

  /** The ids of the featured posts, newest pin first. */
  featured(): string[] {
    return featured(this.sql);
  }

  /**
   * A post's comments as `viewer` sees them, oldest first, after the cursor
   * `after` (decisions 0071, 0080).
   */
  comments(
    postId: string,
    viewer: Viewer,
    after: { createdAt: number; id: string } | null,
    limit: number,
  ): CommentContent[] {
    return listComments(this.sql, postId, viewer, after, limit);
  }

  /**
   * Stores a comment as a reply of `parentCommentId` (decision 0071). Null
   * when the post is not here, or "invalid_parent_comment" when the parent
   * is not a top-level visible comment on that post, so a thread never
   * nests deeper than one level.
   */
  addComment(
    input: Omit<CommentRecord, "state">,
  ): CommentContent | "invalid_parent_comment" | null {
    const exists = this.sql
      .exec("SELECT 1 FROM posts WHERE post_id = ?", input.postId)
      .toArray().length;
    if (!exists) return null;
    if (input.parentCommentId !== null) {
      const parent = this.sql
        .exec<CommentRow>(
          "SELECT post_id, parent_comment_id, state FROM comments WHERE comment_id = ?",
          input.parentCommentId,
        )
        .toArray()[0];
      if (!parent || parent.post_id !== input.postId || parent.state !== "visible") {
        return "invalid_parent_comment";
      }
      // A reply to a reply is refused: the parent must be the top-level one.
      if (parent.parent_comment_id !== null) return "invalid_parent_comment";
    }
    this.sql.exec(
      `INSERT OR IGNORE INTO comments (comment_id, post_id, parent_comment_id, author, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.commentId,
      input.postId,
      input.parentCommentId,
      input.author,
      input.body,
      input.createdAt,
    );
    return { ...input, state: "visible", likes: 0, liked: false };
  }

  /** One comment as stored, without its likes; `likes` counts them for a viewer. */
  comment(commentId: string): CommentRecord | null {
    const row = this.sql
      .exec<CommentRow>("SELECT * FROM comments WHERE comment_id = ?", commentId)
      .toArray()[0];
    return row ? comment(row) : null;
  }

  /**
   * Deletes `commentId`, its author's own delete. A top-level comment with a
   * visible reply stays as a tombstone, so the replies underneath keep their
   * place (decision 0071); a deleted reply whose parent's tombstone is then
   * left without one takes that tombstone with it. Run repeatedly on one id,
   * it has one effect.
   */
  deleteComment(commentId: string): void {
    // Its likes go with it, a tombstone's too (decision 0080).
    this.sql.exec("DELETE FROM comment_reactions WHERE comment_id = ?", commentId);
    const tombstoned =
      this.sql
        .exec(
          "SELECT 1 FROM comments WHERE parent_comment_id = ? AND state = 'visible' LIMIT 1",
          commentId,
        )
        .toArray().length === 1;
    if (tombstoned) {
      this.sql.exec(
        "UPDATE comments SET author = '', body = '', state = 'removed', moderated_at = ? WHERE comment_id = ?",
        Date.now(),
        commentId,
      );
      return;
    }
    const parent = this.sql
      .exec<{ parent_comment_id: string | null }>(
        "SELECT parent_comment_id FROM comments WHERE comment_id = ?",
        commentId,
      )
      .toArray()[0];
    this.sql.exec("DELETE FROM comments WHERE comment_id = ?", commentId);
    if (parent?.parent_comment_id) {
      // A reply's gone, its parent a blanked top-level with no reply left.
      this.sql.exec(
        `DELETE FROM comments WHERE comment_id = ? AND parent_comment_id IS NULL AND author = ''
           AND NOT EXISTS (SELECT 1 FROM comments r
                            WHERE r.parent_comment_id = comments.comment_id AND r.state = 'visible')`,
        parent.parent_comment_id,
      );
    }
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
    // A removed comment loses its likes (decision 0080); hiding keeps them.
    if (changed > 0 && state === "removed") {
      this.sql.exec("DELETE FROM comment_reactions WHERE comment_id = ?", commentId);
    }
    if (changed > 0 && state === "removed" && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(at + REMOVED_KEPT_MS);
    }
    return changed > 0;
  }

  /**
   * Deletes the comments removed REMOVED_KEPT_MS ago, and waits for the next.
   * A top-level comment kept as a tombstone (0071) holds no text and no
   * author, so it is not a removal the alarm erases: it stays until its last
   * visible reply goes with it, and the alarm never waits on it.
   */
  async alarm(): Promise<void> {
    const next = sweepRemoved(this.sql, Date.now());
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  /** Sets, replaces or (with null) removes `account`'s reaction; false when the post is not here. */
  react(postId: string, account: string, emoji: string | null): boolean {
    return setReaction(this.sql, postId, account, emoji);
  }

  /**
   * Sets or (with `on` false) removes `account`'s 👍 on a comment, the one
   * reaction a comment takes (decision 0080). False when the comment is not
   * here, or is not visible to like. Liking twice is one like.
   */
  likeComment(commentId: string, account: string, on: boolean): boolean {
    const row = this.sql
      .exec<{ state: ContentState }>("SELECT state FROM comments WHERE comment_id = ?", commentId)
      .toArray()[0];
    if (!row) return false;
    if (!on) {
      this.sql.exec(
        "DELETE FROM comment_reactions WHERE comment_id = ? AND account = ?",
        commentId,
        account,
      );
      return true;
    }
    if (row.state !== "visible") return false;
    this.sql.exec(
      "INSERT OR IGNORE INTO comment_reactions (comment_id, account, created_at) VALUES (?, ?, ?)",
      commentId,
      account,
      Date.now(),
    );
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
        polls.purgePoll(this.sql, post_id);
      }
      this.sql.exec("DELETE FROM posts WHERE author = ?", account);
      this.sql.exec("DELETE FROM pinned_posts WHERE post_id NOT IN (SELECT post_id FROM posts)");
      // A top-level comment of the account that still carries someone else's
      // visible reply stays as a tombstone, so the reply keeps its place
      // (decision 0071); the account's other comments go.
      this.sql.exec(
        `UPDATE comments SET author = '', body = '', state = 'removed', moderated_at = ?
           WHERE author = ? AND parent_comment_id IS NULL
             AND EXISTS (SELECT 1 FROM comments r
                          WHERE r.parent_comment_id = comments.comment_id AND r.state = 'visible'
                            AND r.author != ?)`,
        Date.now(),
        account,
        account,
      );
      this.sql.exec("DELETE FROM comments WHERE author = ?", account);
      this.sql.exec("DELETE FROM reactions WHERE account = ?", account);
      this.sql.exec("DELETE FROM poll_votes WHERE account = ?", account);
      // Its likes on comments, and every like on a comment that is gone or
      // was blanked to a tombstone (decision 0080).
      this.sql.exec("DELETE FROM comment_reactions WHERE account = ?", account);
      this.sql.exec(
        `DELETE FROM comment_reactions WHERE comment_id NOT IN (SELECT comment_id FROM comments)
            OR comment_id IN (SELECT comment_id FROM comments WHERE author = '')`,
      );
    });
    return posts.map((p) => p.post_id);
  }

  /** One page of what `account` wrote or chose here, for its own export (decision 0126). */
  ownPage(account: string, stage: OwnStage, after: string, limit: number): OwnPage {
    return ownPage(this.sql, account, stage, after, limit);
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
      // A tombstone keeps no author (0071): an empty one is not an account.
      accounts: column(
        `SELECT author AS id FROM posts WHERE author != ''
          UNION SELECT author FROM comments WHERE author != ''
          UNION SELECT account FROM reactions
          UNION SELECT account FROM poll_votes
          UNION SELECT account FROM comment_reactions`,
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
