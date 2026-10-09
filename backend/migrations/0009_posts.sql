-- Fljótið and the walls (decision 0034): posts, their replies and reactions,
-- public to every signed-in account and not end-to-end encrypted. A post is
-- kept until its author deletes it or the account is deleted. Times are Unix
-- milliseconds.

CREATE TABLE posts (
  post_id TEXT PRIMARY KEY,
  author_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
) STRICT;

-- The feed and a wall are read newest first, a page at a time.
CREATE INDEX posts_by_time ON posts (created_at, post_id);
CREATE INDEX posts_by_author ON posts (author_account_id, created_at, post_id);

CREATE TABLE post_replies (
  reply_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts (post_id) ON DELETE CASCADE,
  author_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX post_replies_by_post ON post_replies (post_id, created_at, reply_id);
CREATE INDEX post_replies_by_author ON post_replies (author_account_id);

-- One reaction per account per post, from a fixed set the apps draw.
CREATE TABLE post_reactions (
  post_id TEXT NOT NULL REFERENCES posts (post_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('heart', 'thumbs_up', 'laugh', 'wow', 'sad')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, account_id)
) STRICT;

CREATE INDEX post_reactions_by_account ON post_reactions (account_id);
