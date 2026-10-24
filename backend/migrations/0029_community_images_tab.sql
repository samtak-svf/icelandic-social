-- The images tab of a community (decision 0089) reads its attached images
-- newest first, a page at a time, and leaves out those of a comment a
-- moderator hid or removed. hidden_at is when the comment was hidden (null
-- while it stands), as removed_at is when it was removed (decision 0082).
-- Additive only (decision 0068).
ALTER TABLE social_media ADD COLUMN hidden_at INTEGER;

CREATE INDEX social_media_by_community ON social_media (community_id, created_at)
  WHERE post_id IS NOT NULL;
