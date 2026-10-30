-- contract: the table is rebuilt with every column kept and meaning the same, so the previous version reads and writes it unchanged; its filter on live communities drops a row with no community, and it writes none
-- A notification with no community (decision 0114): something about the account
-- itself, which a community cannot be asked about. community_id becomes
-- nullable; a row with no community is filtered by the Worker from any client
-- that cannot decode it (decision 0114, list.ts). The kind check stays as it
-- is, since nothing written yet needs another kind.
--
-- notification_actors is set aside first: renaming notifications would rewrite
-- its foreign key to the old name, and dropping the old table would then delete
-- every actor by cascade. The rows go back unchanged after the rebuild.
CREATE TABLE notification_actors_kept AS SELECT * FROM notification_actors;
DROP TABLE notification_actors;

ALTER TABLE notifications RENAME TO notifications_old;
DROP INDEX notifications_by_account;
DROP INDEX notifications_by_actor;
DROP INDEX notifications_by_age;

CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'reply', 'reaction', 'join_approved', 'moderated')),
  actor_id TEXT REFERENCES accounts (account_id) ON DELETE SET NULL,
  community_id TEXT REFERENCES communities (community_id) ON DELETE CASCADE,
  post_id TEXT,
  comment_id TEXT,
  action TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  pushed_at INTEGER,
  emoji TEXT
) STRICT;

INSERT INTO notifications (notification_id, account_id, kind, actor_id, community_id, post_id,
                           comment_id, action, created_at, read_at, pushed_at, emoji)
SELECT notification_id, account_id, kind, actor_id, community_id, post_id,
       comment_id, action, created_at, read_at, pushed_at, emoji
  FROM notifications_old;

DROP TABLE notifications_old;

CREATE INDEX notifications_by_account ON notifications (account_id, created_at);
CREATE INDEX notifications_by_actor ON notifications (actor_id);
CREATE INDEX notifications_by_age ON notifications (created_at);

CREATE TABLE notification_actors (
  event_id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications (notification_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  emoji TEXT,
  comment_id TEXT,
  created_at INTEGER NOT NULL,
  pushed_at INTEGER
) STRICT;

INSERT INTO notification_actors (event_id, notification_id, actor_id, emoji, comment_id, created_at,
                                 pushed_at)
SELECT event_id, notification_id, actor_id, emoji, comment_id, created_at, pushed_at
  FROM notification_actors_kept;

DROP TABLE notification_actors_kept;

CREATE INDEX notification_actors_by_group ON notification_actors (notification_id, created_at);
CREATE INDEX notification_actors_by_actor ON notification_actors (actor_id);
