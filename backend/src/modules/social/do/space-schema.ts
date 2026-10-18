/** The Space DO's tables (decisions 0060, 0063): one community's content. */
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
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS comments_by_post ON comments (post_id, created_at, comment_id);
  CREATE INDEX IF NOT EXISTS comments_by_author ON comments (author);
  CREATE TABLE IF NOT EXISTS reactions (
    post_id TEXT NOT NULL,
    account TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, account)
  );
  CREATE INDEX IF NOT EXISTS reactions_by_account ON reactions (account);
`;
