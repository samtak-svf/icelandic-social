-- contract: the table is rebuilt with every old column kept and meaning the same, so the previous version reads and writes it unchanged; only the kind CHECK widens
-- Grouped notifications (decision 0103). One row for each account, kind and
-- thing (post or parent comment) instead of one for each event, with the
-- events that made it kept in notification_actors. The old columns keep their
-- meaning: a group row's actor_id, comment_id and emoji are the newest event's.
-- A Worker rolled back to the version before this one still reads and writes
-- the table, and sees a group as an ordinary row.
--
-- The old table is renamed and read while the new one is filled. Its indexes
-- are dropped first, since their names belong to the new table.
ALTER TABLE notifications RENAME TO notifications_old;
DROP INDEX notifications_by_account;
DROP INDEX notifications_by_actor;
DROP INDEX notifications_by_age;

CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'reply', 'reaction', 'join_approved', 'moderated')),
  actor_id TEXT REFERENCES accounts (account_id) ON DELETE SET NULL,
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  post_id TEXT,
  comment_id TEXT,
  action TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  pushed_at INTEGER,
  emoji TEXT
) STRICT;

CREATE INDEX notifications_by_account ON notifications (account_id, created_at);
CREATE INDEX notifications_by_actor ON notifications (actor_id);
CREATE INDEX notifications_by_age ON notifications (created_at);

-- The group each old row belongs to: a reaction and a comment on a post go to
-- the group of that post, a reply to its parent comment's author keeps its own
-- row (its parent comment lives in the Durable Object, not here), and the rest
-- are ungrouped. Window functions pick the newest member and fold the others.
INSERT INTO notifications (notification_id, account_id, kind, actor_id, community_id, post_id,
                           comment_id, action, created_at, read_at, pushed_at, emoji)
WITH keyed AS (
  SELECT o.*,
         CASE
           WHEN kind = 'reaction' AND post_id IS NOT NULL
             THEN 'reaction:' || post_id || ':' || account_id
           WHEN kind = 'comment' AND post_id IS NOT NULL AND notification_id NOT LIKE '%:parent'
             THEN 'comment:' || post_id || ':' || account_id
           ELSE notification_id
         END AS gid,
         CASE WHEN kind = 'comment' AND notification_id LIKE '%:parent' THEN 'reply' ELSE kind END
           AS new_kind
    FROM notifications_old o
), ranked AS (
  SELECT keyed.*,
         ROW_NUMBER() OVER (PARTITION BY gid ORDER BY created_at DESC, notification_id DESC) AS rn,
         SUM(read_at IS NULL) OVER (PARTITION BY gid) AS unread,
         MAX(read_at) OVER (PARTITION BY gid) AS last_read,
         MAX(pushed_at) OVER (PARTITION BY gid) AS last_pushed
    FROM keyed
)
SELECT gid, account_id, new_kind, actor_id, community_id, post_id, comment_id, action, created_at,
       CASE WHEN unread > 0 THEN NULL ELSE last_read END, last_pushed, emoji
  FROM ranked WHERE rn = 1;

-- The events of each group, one row per old notification that had an actor.
CREATE TABLE notification_actors (
  event_id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications (notification_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  emoji TEXT,
  comment_id TEXT,
  created_at INTEGER NOT NULL,
  pushed_at INTEGER
) STRICT;

CREATE INDEX notification_actors_by_group ON notification_actors (notification_id, created_at);
CREATE INDEX notification_actors_by_actor ON notification_actors (actor_id);

INSERT INTO notification_actors (event_id, notification_id, actor_id, emoji, comment_id, created_at,
                                 pushed_at)
SELECT notification_id,
       CASE
         WHEN kind = 'reaction' AND post_id IS NOT NULL
           THEN 'reaction:' || post_id || ':' || account_id
         WHEN kind = 'comment' AND post_id IS NOT NULL AND notification_id NOT LIKE '%:parent'
           THEN 'comment:' || post_id || ':' || account_id
         ELSE notification_id
       END,
       actor_id, emoji, comment_id, created_at, pushed_at
  FROM notifications_old WHERE actor_id IS NOT NULL;

DROP TABLE notifications_old;
