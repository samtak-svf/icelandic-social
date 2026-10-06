-- Invites and who let each account in (decisions 0009, 0019). Like a device
-- token, an invite token is never stored: only its hex SHA-256, so a copy of
-- this database lets nobody in.

CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  -- Null for an invite the operator wrote by hand (`pnpm invite:operator`).
  inviter_account_id TEXT REFERENCES accounts (account_id) ON DELETE CASCADE,
  -- The operator's invites let one person in; a personal one any number.
  single_use INTEGER NOT NULL DEFAULT 0 CHECK (single_use IN (0, 1)),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

-- One live personal invite per account: rotating revokes the old one first.
CREATE UNIQUE INDEX one_personal_invite ON invites (inviter_account_id)
  WHERE revoked_at IS NULL AND inviter_account_id IS NOT NULL;

-- Null for the first account, which the operator let in.
ALTER TABLE accounts ADD COLUMN invited_by TEXT
  REFERENCES accounts (account_id) ON DELETE SET NULL;
