-- Sessions (decision 0061): one sign-in on one client. A browser's session is
-- proved by a secret in its cookie, kept here only as a hex SHA-256 as device
-- tokens are (0014), and it expires. A phone's session is proved by its
-- device's token and lasts as long as the device, so it has neither. A row
-- never holds an IP address or a user-agent string: `browser` and `os` are a
-- product name each, from a fixed list (src/identity/sessions.ts).

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('web', 'android', 'ios')),
  secret_hash TEXT UNIQUE,
  browser TEXT,
  os TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER,
  CHECK ((kind = 'web') = (secret_hash IS NOT NULL AND expires_at IS NOT NULL))
) STRICT;

CREATE INDEX sessions_by_account ON sessions (account_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at) WHERE expires_at IS NOT NULL;

-- The session a device was enrolled from. Ending it revokes the device, and
-- revoking a phone's device ends its session; a revoked device's goes null.
ALTER TABLE devices ADD COLUMN session_id TEXT
  REFERENCES sessions (session_id) ON DELETE SET NULL;

CREATE INDEX devices_by_session ON devices (session_id) WHERE session_id IS NOT NULL;

-- Every active device gets its session, so the device tokens of 0014 keep
-- working unchanged. Each id is random, like every other; the device names
-- it before the row exists, so the foreign key is checked at commit.
PRAGMA defer_foreign_keys = on;

UPDATE devices SET session_id = 's_' || lower(hex(randomblob(32))) WHERE revoked_at IS NULL;

INSERT INTO sessions (session_id, account_id, kind, created_at, last_seen_at)
SELECT session_id, account_id, platform, created_at, created_at
  FROM devices WHERE session_id IS NOT NULL;
