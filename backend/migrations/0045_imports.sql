-- contract: only two new tables and a new column that is null on every existing row, so the previous version reads and writes every row unchanged
-- Bringing a person's own posts in from another platform (decisions 0119, 0120).
-- One row per upload or connection.
CREATE TABLE import_sources (
  import_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'profile', 'page')),
  source TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('friends', 'everyone')),
  created_at INTEGER NOT NULL,
  -- Set when the person asked for it to be removed: nothing more comes in.
  removing_at INTEGER
) STRICT;

CREATE INDEX import_sources_by_account ON import_sources (account_id);

-- A post that came in, whichever route brought it. The row outlives its post when
-- the person deletes that post or a moderator removes it, so that it stays out.
-- `fingerprint` finds a post a second route names by another id; it is null on a
-- post with no text, which only its id can find.
CREATE TABLE imported_posts (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_post_id TEXT NOT NULL,
  fingerprint TEXT,
  import_id TEXT REFERENCES import_sources (import_id) ON DELETE SET NULL,
  post_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  done_at INTEGER,
  PRIMARY KEY (account_id, source, source_post_id)
) STRICT;

CREATE UNIQUE INDEX imported_posts_by_fingerprint
  ON imported_posts (account_id, source, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX imported_posts_by_import ON imported_posts (import_id);

-- Null on a post written here. A backlog stays out of the home feed (decision
-- 0119); a sync is what the person is posting now, and enters it.
ALTER TABLE post_index ADD COLUMN imported TEXT CHECK (imported IN ('backlog', 'sync'));
