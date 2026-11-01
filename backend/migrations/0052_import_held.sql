-- contract: post_index is rebuilt with the same columns, only to widen its state check, so the previous version reads it unchanged
-- An import comes in held (decision 0127): on the person's account, seen by nobody else until they
-- open it. SQLite cannot widen a check, so the table is rebuilt (nothing references it). The kind of
-- post an imported row was is kept, because the person opens by kind.
CREATE TABLE post_index_new (
  post_id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  -- visible, waiting for a moderator's approval (0091), hidden or removed by a moderator (0063), or held by an import until its author opens it (0127).
  state TEXT NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'pending', 'hidden', 'removed', 'held')),
  moderated_at INTEGER,
  anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  audience TEXT CHECK (audience IN ('friends', 'everyone')),
  imported TEXT CHECK (imported IN ('backlog', 'sync'))
) STRICT;
INSERT INTO post_index_new (post_id, community_id, author_id, created_at, state, moderated_at, anonymous, audience, imported)
  SELECT post_id, community_id, author_id, created_at, state, moderated_at, anonymous, audience, imported FROM post_index;
DROP TABLE post_index;
ALTER TABLE post_index_new RENAME TO post_index;
CREATE INDEX posts_by_community ON post_index (community_id, created_at);
CREATE INDEX posts_by_author ON post_index (author_id);
CREATE INDEX posts_removed ON post_index (moderated_at) WHERE state = 'removed';
CREATE INDEX posts_pending ON post_index (community_id, created_at) WHERE state = 'pending';

ALTER TABLE imported_posts ADD COLUMN class TEXT;
