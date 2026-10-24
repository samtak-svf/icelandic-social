-- contract: the view is dropped and recreated with the same columns plus two, so the previous version reads it unchanged
-- The framing of an image (decision 0086): the focus and any per-frame
-- rectangle as JSON, kept beside the version token so the editor reopens where
-- the person left it. Null for an image stored before the master was kept.
ALTER TABLE accounts ADD COLUMN photo_frames TEXT;
ALTER TABLE communities ADD COLUMN photo_frames TEXT;
ALTER TABLE communities ADD COLUMN cover_frames TEXT;

-- The view of the live rows (0018, 0022, 0023) lists its columns, so it takes the new ones.
DROP VIEW live_communities;
CREATE VIEW live_communities AS
  SELECT community_id, name, name_key, description, audience, created_at, read_only_since,
         deleted_at, deleted_by, purged_at, photo_version, cover_version, post_seq, last_post_at,
         photo_frames, cover_frames
    FROM communities WHERE deleted_at IS NULL;
