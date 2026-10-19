-- A community's deletion, and a declined join request (decision 0070).
--
-- Deleting a community marks it: it is gone for everyone at once, and a
-- platform moderator can restore it for 30 days. Then the daily job purges
-- its content and graph, and a year after that deletes its row, which takes
-- its moderation log and reports with it by their cascade. Until then the
-- row keeps the name the log is read under.

ALTER TABLE communities ADD COLUMN deleted_at INTEGER;
ALTER TABLE communities ADD COLUMN deleted_by TEXT REFERENCES accounts (account_id) ON DELETE SET NULL;
ALTER TABLE communities ADD COLUMN purged_at INTEGER;

CREATE INDEX communities_deleted ON communities (deleted_at) WHERE deleted_at IS NOT NULL;

-- Every module but the one that owns the table reads communities through
-- this view, so a deleted community cannot leak through a read that forgot
-- the filter (tooling/module-guard.mjs).
CREATE VIEW live_communities AS
  SELECT community_id, name, name_key, description, audience, created_at, read_only_since,
         deleted_at, deleted_by, purged_at
    FROM communities WHERE deleted_at IS NULL;

-- A declined request stays, as the account's answer, for 30 days; until then
-- it cannot ask again. A request that waits has none.
ALTER TABLE community_join_requests ADD COLUMN declined_at INTEGER;

CREATE INDEX community_join_requests_declined ON community_join_requests (declined_at)
  WHERE declined_at IS NOT NULL;

-- How a moderator closed a report: the action it took, `dismissed`, or
-- `community_deleted`; and the reason or resolution it gave.
ALTER TABLE reports ADD COLUMN decision TEXT;
ALTER TABLE reports ADD COLUMN resolution TEXT;
