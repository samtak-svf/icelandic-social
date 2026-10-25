-- A group's photo (decision 0094): which object in spjall-profiles, under
-- groups/<conversation_id>/<media_id>, is the conversation's photo. One row
-- per conversation; the server learns that a photo exists and its size, never
-- the picture, which is end-to-end encrypted.
CREATE TABLE group_photos (
  conversation_id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
