/** A removed post's or comment's text is deleted this long after its removal (decision 0063). */
export const REMOVED_KEPT_MS = 90 * 24 * 60 * 60 * 1000;

/** The id of a poll's option at `position` (decision 0090): stable, and says nothing else. */
export const optionId = (position: number) => `o${position}`;

/** How many posts a community features at once (decision 0088). */
export const MAX_FEATURED = 3;

/**
 * The Space DO's tables (decisions 0060, 0063, 0080): one community's content.
 * `reactions` holds a post's one emoji per account (decision 0100; before it,
 * a column `kind`, which `ensureEmojiReactions` migrates);
 * `comment_reactions` holds a comment's one 👍 per account (decision 0080);
 * `pinned_posts` holds the featured posts, at most three (decision 0088), each
 * with the time it was pinned. A poll (decision 0090) is a post with rows in
 * `poll_options` (its question is the post's body); `poll_votes` keeps one row
 * per account and post only so a vote stays one and can change, and is read
 * only as counts and as the reader's own row. A closed poll has a row in
 * `poll_closed`. All three go with the post, and the votes with the account.
 */
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS posts (
    post_id TEXT PRIMARY KEY,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    media TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS posts_by_author ON posts (author);
  CREATE TABLE IF NOT EXISTS comments (
    comment_id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    parent_comment_id TEXT,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'hidden', 'removed')),
    moderated_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS comments_removed ON comments (moderated_at) WHERE state = 'removed';
  CREATE INDEX IF NOT EXISTS comments_by_post ON comments (post_id, created_at, comment_id);
  CREATE INDEX IF NOT EXISTS comments_by_author ON comments (author);
  CREATE TABLE IF NOT EXISTS reactions (
    post_id TEXT NOT NULL,
    account TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, account)
  );
  CREATE INDEX IF NOT EXISTS reactions_by_account ON reactions (account);
  CREATE TABLE IF NOT EXISTS comment_reactions (
    comment_id TEXT NOT NULL,
    account TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (comment_id, account)
  );
  CREATE INDEX IF NOT EXISTS comment_reactions_by_account ON comment_reactions (account);
  CREATE TABLE IF NOT EXISTS pinned_posts (
    post_id TEXT PRIMARY KEY,
    pinned_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS poll_options (
    post_id TEXT NOT NULL,
    option_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (post_id, option_id)
  );
  CREATE TABLE IF NOT EXISTS poll_votes (
    post_id TEXT NOT NULL,
    account TEXT NOT NULL,
    option_id TEXT NOT NULL,
    PRIMARY KEY (post_id, account)
  );
  CREATE INDEX IF NOT EXISTS poll_votes_by_account ON poll_votes (account);
  CREATE TABLE IF NOT EXISTS poll_closed (
    post_id TEXT PRIMARY KEY,
    closed_at INTEGER NOT NULL
  );
`;

/** A post as stored in the space. */
export type PostRow = {
  post_id: string;
  author: string;
  body: string;
  media: string;
  created_at: number;
  anonymous: number;
};
