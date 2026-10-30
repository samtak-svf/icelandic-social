-- contract: three new tables nothing old reads, and two tables rebuilt with every column kept and meaning the same and only a wider kind check, so the previous version reads and writes them unchanged
-- Friends (decision 0114): a symmetric friendship, the last request of each
-- direction, and a snooze. Each of the first two has a kind of notification.
CREATE TABLE friend_requests (
  from_account TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  to_account TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'ended')),
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  PRIMARY KEY (from_account, to_account)
) STRICT;

-- The recipient's incoming list, a block or deletion's other direction, the rolling count and the sweep.
CREATE INDEX friend_requests_by_recipient ON friend_requests (to_account, state, created_at);
CREATE INDEX friend_requests_by_sender_age ON friend_requests (from_account, created_at);
CREATE INDEX friend_requests_by_age ON friend_requests (state, created_at);

-- Two directed rows written in one batch, so a list and a mutual join read one direction.
CREATE TABLE friendships (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  since INTEGER NOT NULL,
  PRIMARY KEY (account_id, friend_id)
) STRICT;

CREATE INDEX friendships_by_friend ON friendships (friend_id);

CREATE TABLE person_snoozes (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  until INTEGER NOT NULL,
  PRIMARY KEY (account_id, target_id)
) STRICT;

CREATE INDEX person_snoozes_by_target ON person_snoozes (target_id);
CREATE INDEX person_snoozes_by_until ON person_snoozes (until);

-- The kind checks can only be widened by a rebuild. The actor rows reference
-- the notifications, so they are set aside and put back, as in 0038.
CREATE TABLE notification_actors_kept AS SELECT * FROM notification_actors;
DROP TABLE notification_actors;

ALTER TABLE notifications RENAME TO notifications_old;
DROP INDEX notifications_by_account;
DROP INDEX notifications_by_actor;
DROP INDEX notifications_by_age;

CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'reply', 'reaction', 'join_approved', 'moderated', 'friend_request', 'friend_accepted')),
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

INSERT INTO notification_actors (event_id, notification_id, actor_id, emoji, comment_id, created_at, pushed_at)
  SELECT event_id, notification_id, actor_id, emoji, comment_id, created_at, pushed_at
    FROM notification_actors_kept;
DROP TABLE notification_actors_kept;

CREATE INDEX notification_actors_by_group ON notification_actors (notification_id, created_at);
CREATE INDEX notification_actors_by_actor ON notification_actors (actor_id);

ALTER TABLE notification_settings RENAME TO notification_settings_old;

CREATE TABLE notification_settings (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'reply', 'reaction', 'join_approved', 'moderated', 'friend_request', 'friend_accepted')),
  level TEXT NOT NULL CHECK (level IN ('off', 'in_app', 'push')),
  PRIMARY KEY (account_id, kind)
) STRICT;

INSERT INTO notification_settings (account_id, kind, level)
  SELECT account_id, kind, level FROM notification_settings_old;
DROP TABLE notification_settings_old;
