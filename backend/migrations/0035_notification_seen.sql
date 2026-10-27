-- Seen (decision 0104). Seen is what the badge counts from: the time up to which
-- an account has had its notifications in front of it, apart from read, which
-- belongs to each notification. No row means nothing was seen yet.
CREATE TABLE notification_seen (
  account_id TEXT PRIMARY KEY REFERENCES accounts (account_id) ON DELETE CASCADE,
  seen_at INTEGER NOT NULL
) STRICT;
