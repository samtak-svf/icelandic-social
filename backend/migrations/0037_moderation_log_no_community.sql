-- A log entry with no community (decision 0115): a platform moderator's action
-- on an account, or the closing of a report on one. moderation_log_kept (0016)
-- needs an existing community, so it never covered these. They are refused
-- deletion for the year /privacy promises; after it the daily job deletes them
-- (expireLog, backend/src/modules/moderation/log.ts, with the same year).
CREATE TRIGGER moderation_log_kept_no_community BEFORE DELETE ON moderation_log
WHEN OLD.community_id IS NULL AND OLD.created_at > unixepoch() * 1000 - 31536000000
BEGIN
  SELECT RAISE(ABORT, 'moderation_log is append-only');
END;
