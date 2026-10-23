-- contract: the view is dropped and recreated with the same columns plus two, so the previous version reads it unchanged
-- The hub's unread counts and pins (decision 0080), answered from D1 alone so
-- listing a reader's communities never wakes a Durable Object.
--
-- post_seq counts the posts ever made in a community and last_post_at is when
-- the latest was made. A post that is later deleted or removed still counts as
-- having been posted: the count is a sequence, not a tally of what is left,
-- and the hub accepts that a reader may see "1 new post" for a post it can no
-- longer open.
ALTER TABLE communities ADD COLUMN post_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE communities ADD COLUMN last_post_at INTEGER;

-- Where an account has read up to: the post_seq it saw when it last opened the
-- community's feed. No row means nothing was read yet.
CREATE TABLE community_reads (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  read_seq INTEGER NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, community_id)
) STRICT;

CREATE INDEX community_reads_by_community ON community_reads (community_id);

-- The communities an account pinned to the top of its own list, per account so
-- the pin follows the reader to every device.
CREATE TABLE community_pins (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  pinned_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, community_id)
) STRICT;

CREATE INDEX community_pins_by_community ON community_pins (community_id);

-- The view of the live rows (0018) lists its columns, so it takes the new ones.
DROP VIEW live_communities;
CREATE VIEW live_communities AS
  SELECT community_id, name, name_key, description, audience, created_at, read_only_since,
         deleted_at, deleted_by, purged_at, photo_version, cover_version, post_seq, last_post_at
    FROM communities WHERE deleted_at IS NULL;
