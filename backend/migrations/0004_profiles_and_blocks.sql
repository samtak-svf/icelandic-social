-- Who shares a conversation, so a member may read another's name, and who
-- blocked whom (decisions 0022, 0024). The Conversation DO keeps the roster;
-- these rows are its copy, written after each commit and tagged with the seq
-- of that commit, so an older copy never overwrites a newer one.

CREATE TABLE conversation_rosters (
  conversation_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL
) STRICT;

CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, account_id)
) STRICT;

CREATE INDEX conversation_members_by_account ON conversation_members (account_id);

CREATE TABLE blocks (
  blocker_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  blocked_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_account_id, blocked_account_id)
) STRICT;

CREATE INDEX blocks_by_blocked ON blocks (blocked_account_id);
