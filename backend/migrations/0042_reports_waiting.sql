-- contract: two tables rebuilt with every column kept and meaning the same, with only a wider kind check and an event's actor now optional, so the previous version reads and writes them unchanged
-- A notice to a platform moderator that reports wait (decision 0115). It has a
-- kind of its own, is about no community and is by nobody: a report's author is
-- not an actor. Its events still go in notification_actors, which is what makes a
-- job run twice one effect, so an event's actor may be NULL.

-- The kind check can only be widened by a rebuild. The actor rows reference the
-- notifications, so they are set aside and put back, as in 0041.
CREATE TABLE notification_actors_kept AS SELECT * FROM notification_actors;
DROP TABLE notification_actors;

ALTER TABLE notifications RENAME TO notifications_old;
DROP INDEX notifications_by_account;
DROP INDEX notifications_by_actor;
DROP INDEX notifications_by_age;

CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'reply', 'reaction', 'join_approved', 'moderated', 'friend_request', 'friend_accepted', 'reports_waiting')),
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
