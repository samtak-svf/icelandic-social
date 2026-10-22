-- contract: the view is dropped and recreated with the same columns plus two, so the previous version reads it unchanged
-- A community's picture and cover (decision 0080). The images themselves are in
-- the R2 bucket spjall-profiles under community/<communityId>/photo and
-- community/<communityId>/cover; these are opaque tokens that change with each
-- upload, null when there is none, so a client fetches an image again only when
-- it changes.

ALTER TABLE communities ADD COLUMN photo_version TEXT;
ALTER TABLE communities ADD COLUMN cover_version TEXT;

-- The view of the live rows (0018) lists its columns, so it takes the new ones.
DROP VIEW live_communities;
CREATE VIEW live_communities AS
  SELECT community_id, name, name_key, description, audience, created_at, read_only_since,
         deleted_at, deleted_by, purged_at, photo_version, cover_version
    FROM communities WHERE deleted_at IS NULL;
