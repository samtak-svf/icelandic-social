-- Notification settings (decision 0106). How loudly an account wants to be told:
-- `off` writes nothing, `in_app` writes the notification and sends no push,
-- `push` also pushes. One level for each kind and one for each community, the
-- lower of the two applies, and a missing row means `push`.
CREATE TABLE notification_settings (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'reply', 'reaction', 'join_approved', 'moderated')),
  level TEXT NOT NULL CHECK (level IN ('off', 'in_app', 'push')),
  PRIMARY KEY (account_id, kind)
) STRICT;

CREATE TABLE community_notification_settings (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('off', 'in_app', 'push')),
  PRIMARY KEY (account_id, community_id)
) STRICT;

CREATE INDEX community_notification_settings_by_community
  ON community_notification_settings (community_id);
