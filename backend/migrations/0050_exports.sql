-- contract: only a new table, so the previous version of the Worker runs on this schema unchanged.
-- A person's own export (decision 0126): one row per ZIP asked for. The bytes are in the
-- EU media bucket under `exports/<export_id>.zip`, with `exports/<export_id>.checkpoint`
-- while the build runs. `failure` is a code, never text. `size` is set with `ready`.
-- `expires_at` is when the bytes go: the daily sweep deletes them with the row.
CREATE TABLE exports (
  export_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('building', 'ready', 'failed')),
  failure TEXT,
  size INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX exports_by_account ON exports (account_id, created_at);
CREATE INDEX exports_by_expiry ON exports (expires_at);
