-- contract: three nullable columns that only this version reads, so the previous version is untouched by them
-- A suspension of an account (decision 0115). It stands while suspended_at is set
-- and suspended_until is null (open-ended) or still ahead: expiry is read, so no
-- job sweeps it. Its reason is only in the moderation_log entry that set it.
ALTER TABLE accounts ADD COLUMN suspended_at INTEGER;
ALTER TABLE accounts ADD COLUMN suspended_until INTEGER;
-- The end a suspension was given when it was decided, kept with the decision: a
-- statement and a review read it long after the account's own columns have moved
-- on. Null on every other action, and on a suspension until a moderator lifts it.
ALTER TABLE moderation_log ADD COLUMN suspended_until INTEGER;
