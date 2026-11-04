-- contract: two tables rebuilt with every column kept and meaning the same and only a wider kind check, and a new nullable column nothing old reads, so the previous version reads and writes them unchanged
-- A community invitation is noticed (decision 0130). It keeps its inviter (nullable: the
-- rows from before have none) and has a kind of notification of its own, with a level.
ALTER TABLE community_invitations ADD COLUMN invited_by TEXT REFERENCES accounts (account_id) ON DELETE SET NULL;

-- The kind checks can only be widened by a rebuild. The actor rows reference the
-- notifications, so they are set aside and put back, as in 0042.
CREATE TABLE notification_actors_kept AS SELECT * FROM notification_actors;
DROP TABLE notification_actors;

ALTER TABLE notifications RENAME TO notifications_old;
DROP INDEX notifications_by_account;
DROP INDEX notifications_by_actor;
DROP INDEX notifications_by_age;

CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'reply', 'reaction', 'join_approved', 'moderated', 'friend_request', 'friend_accepted', 'reports_waiting', 'community_invite')),
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
  actor_id TEXT REFERENCES accounts (account_id) ON DELETE CASCADE,
  emoji TEXT,
  comment_id TEXT,
  created_at INTEGER NOT NULL,
  pushed_at INTEGER
) STRICT;

INSERT INTO notification_actors (event_id, notification_id, actor_id, emoji, comment_id, created_at, pushed_at)
  SELECT event_id, notification_id, actor_id, emoji, comment_id, created_at, pushed_at
    FROM notification_actors_kept;
DROP TABLE notification_actors_kept;



CREATE INDEX notification_actors_by_group ON notification_actors (notification_id, created_at);
CREATE INDEX notification_actors_by_actor ON notification_actors (actor_id);

ALTER TABLE notification_settings RENAME TO notification_settings_old;

CREATE TABLE notification_settings (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'reply', 'reaction', 'join_approved', 'moderated', 'friend_request', 'friend_accepted', 'community_invite')),
  level TEXT NOT NULL CHECK (level IN ('off', 'in_app', 'push')),
  PRIMARY KEY (account_id, kind)
) STRICT;

INSERT INTO notification_settings (account_id, kind, level)
  SELECT account_id, kind, level FROM notification_settings_old;
DROP TABLE notification_settings_old;
