-- contract: post_index is rebuilt with the same columns plus one, only to widen its state check, so the previous version reads it unchanged
-- Anonymous posts (decision 0091). A community's switch, off by default; and
-- the flag on a post, beside its real author, which stays in the row. A post
-- awaiting a moderator's approval is in the new state `pending`: SQLite cannot
-- widen a check, so the table is rebuilt (nothing references it).
ALTER TABLE communities ADD COLUMN anonymous_posts INTEGER NOT NULL DEFAULT 0;

-- The view of the live rows lists its columns (0018, 0022, 0023, 0028), so it takes the new one.
DROP VIEW live_communities;
CREATE VIEW live_communities AS
  SELECT community_id, name, name_key, description, audience, created_at, read_only_since,
         deleted_at, deleted_by, purged_at, photo_version, cover_version, post_seq, last_post_at,
         photo_frames, cover_frames, anonymous_posts
    FROM communities WHERE deleted_at IS NULL;

CREATE TABLE post_index_new (
  post_id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  -- visible, waiting for a moderator's approval (an anonymous post), hidden by a moderator, or removed by one (decisions 0063, 0091).
  state TEXT NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'pending', 'hidden', 'removed')),
  moderated_at INTEGER,
  anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1))
) STRICT;
INSERT INTO post_index_new (post_id, community_id, author_id, created_at, state, moderated_at)
  SELECT post_id, community_id, author_id, created_at, state, moderated_at FROM post_index;
DROP TABLE post_index;
ALTER TABLE post_index_new RENAME TO post_index;
CREATE INDEX posts_by_community ON post_index (community_id, created_at);
CREATE INDEX posts_by_author ON post_index (author_id);
CREATE INDEX posts_removed ON post_index (moderated_at) WHERE state = 'removed';
-- The moderators' queue of anonymous posts that wait.
CREATE INDEX posts_pending ON post_index (community_id, created_at) WHERE state = 'pending';
