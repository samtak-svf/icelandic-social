-- Moderation (decisions 0063, 0066): the platform's moderators, reports and
-- the append-only moderation log, all in D1 so a moderator's action and its
-- log entry are one batch, and the platform's queue spans every community.

-- Samtak's list (decision 0063). Seeded by the maintainer, never by a route.
CREATE TABLE platform_moderators (
  account_id TEXT PRIMARY KEY REFERENCES accounts (account_id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL
) STRICT;

-- A member a moderator muted may read but not post, comment or react until then.
ALTER TABLE community_members ADD COLUMN muted_until INTEGER;

-- When a moderator last hid or removed the post; a removed post's text is
-- deleted 90 days after it (decision 0063).
ALTER TABLE post_index ADD COLUMN moderated_at INTEGER;
CREATE INDEX posts_removed ON post_index (moderated_at) WHERE state = 'removed';

-- A report keeps its target after the reporter is deleted, without the
-- reporter, and goes with its community. An account reports a thing once
-- while its report is open.
CREATE TABLE reports (
  report_id TEXT PRIMARY KEY,
  community_id TEXT REFERENCES communities (community_id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('post', 'comment', 'community', 'account')),
  target_id TEXT NOT NULL,
  target_account TEXT REFERENCES accounts (account_id) ON DELETE SET NULL,
  reporter_id TEXT REFERENCES accounts (account_id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unlawful', 'harassment', 'spam', 'other')),
  note TEXT NOT NULL DEFAULT '',
  to_platform INTEGER NOT NULL CHECK (to_platform IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  closed_by TEXT REFERENCES accounts (account_id) ON DELETE SET NULL
) STRICT;

CREATE INDEX reports_by_community ON reports (community_id, state, created_at);
CREATE INDEX reports_to_platform ON reports (to_platform, state, created_at);
CREATE INDEX reports_by_reporter ON reports (reporter_id);
CREATE INDEX reports_by_target_account ON reports (target_account);
CREATE UNIQUE INDEX reports_once ON reports (reporter_id, target_kind, target_id) WHERE state = 'open';

-- Every moderator action: who, what, on which target, why and when. No route
-- edits or deletes an entry, and the triggers below refuse anything else that
-- tries: a deleted account's id becomes null ("a deleted account"), and
-- entries go only with their community.
CREATE TABLE moderation_log (
  entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_id TEXT REFERENCES communities (community_id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES accounts (account_id) ON DELETE SET NULL,
  as_platform INTEGER NOT NULL CHECK (as_platform IN (0, 1)),
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_account TEXT REFERENCES accounts (account_id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX moderation_log_by_community ON moderation_log (community_id, entry_id);
CREATE INDEX moderation_log_by_actor ON moderation_log (actor_id);
CREATE INDEX moderation_log_by_target_account ON moderation_log (target_account);

CREATE TRIGGER moderation_log_append_only BEFORE UPDATE ON moderation_log
WHEN NEW.entry_id IS NOT OLD.entry_id
  OR NEW.community_id IS NOT OLD.community_id
  OR NEW.as_platform IS NOT OLD.as_platform
  OR NEW.action IS NOT OLD.action
  OR NEW.target_kind IS NOT OLD.target_kind
  OR NEW.target_id IS NOT OLD.target_id
  OR NEW.reason IS NOT OLD.reason
  OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.actor_id IS NOT OLD.actor_id AND NEW.actor_id IS NOT NULL)
  OR (NEW.target_account IS NOT OLD.target_account AND NEW.target_account IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'moderation_log is append-only');
END;

CREATE TRIGGER moderation_log_kept BEFORE DELETE ON moderation_log
WHEN EXISTS (SELECT 1 FROM communities WHERE community_id = OLD.community_id)
BEGIN
  SELECT RAISE(ABORT, 'moderation_log is append-only');
END;
