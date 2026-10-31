-- contract: only new columns with defaults or null, a new table and a new view, and a view re-created to read as before, so the previous version reads and writes every row unchanged
-- The wall (decision 0115): a person's posts in a space of its own. The row is a
-- `communities` row of kind 'wall' with no member, so a slip denies by default,
-- and it holds the wall's random id where a community holds its name.
ALTER TABLE communities ADD COLUMN kind TEXT NOT NULL DEFAULT 'community'
  CHECK (kind IN ('community', 'wall'));

CREATE TABLE walls (
  account_id TEXT PRIMARY KEY REFERENCES accounts (account_id) ON DELETE CASCADE,
  community_id TEXT NOT NULL UNIQUE REFERENCES communities (community_id) ON DELETE CASCADE
) STRICT;

-- Who reads a wall post, the author's to change; null on a community's post.
ALTER TABLE post_index ADD COLUMN audience TEXT CHECK (audience IN ('friends', 'everyone'));

ALTER TABLE accounts ADD COLUMN bio TEXT;

DROP VIEW live_communities;
CREATE VIEW live_communities AS
  SELECT community_id, name, name_key, description, audience, created_at, read_only_since,
         deleted_at, deleted_by, purged_at, photo_version, cover_version, post_seq, last_post_at,
         photo_frames, cover_frames, anonymous_posts
    FROM communities WHERE deleted_at IS NULL AND kind = 'community';

-- What must see both: notifications, and the wall's own queries.
CREATE VIEW live_spaces AS
  SELECT community_id, name, name_key, description, audience, created_at, read_only_since,
         deleted_at, deleted_by, purged_at, photo_version, cover_version, post_seq, last_post_at,
         photo_frames, cover_frames, anonymous_posts, kind
    FROM communities WHERE deleted_at IS NULL;
