-- A community's content (decisions 0060, 0063). The posts, comments and
-- reactions themselves live in the community's Space Durable Object; D1 keeps
-- what the feed and the access checks read across communities, and what
-- deleting an account or a community must find.

-- One row per post, read in time windows per community (docs/d1-social-workload.md).
CREATE TABLE post_index (
  post_id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  -- visible, hidden by a moderator, or removed by one (decision 0063).
  state TEXT NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'hidden', 'removed'))
) STRICT;

CREATE INDEX posts_by_community ON post_index (community_id, created_at);
CREATE INDEX posts_by_author ON post_index (author_id);

-- The images of posts, re-encoded, in spjall-profiles under social/ (decision
-- 0065). post_id is null until a post takes the image; one no post takes within
-- a day is deleted by the daily cron.
CREATE TABLE social_media (
  media_id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  post_id TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX social_media_by_post ON social_media (post_id);
CREATE INDEX social_media_unattached ON social_media (created_at) WHERE post_id IS NULL;
CREATE INDEX social_media_by_uploader ON social_media (uploader_id);

-- Every space an account wrote something in, so deleting the account reaches
-- each Space object that holds its posts, comments or reactions (decision 0063).
CREATE TABLE space_authors (
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, community_id)
) STRICT, WITHOUT ROWID;
