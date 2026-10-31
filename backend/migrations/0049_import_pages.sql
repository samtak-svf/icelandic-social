-- contract: only new tables, so the previous version of the Worker runs on this schema unchanged.
-- A connection to a page the person manages on another platform, through its official
-- API (decision 0120): one row per import of the kind page. Managing the page is the
-- proof, so there is no code to publish. `token` is sealed under a Worker secret and is
-- never returned or logged. `next_run_at` is when the next run starts: null while a
-- preview waits for the person and after the platform has refused the token. A run moves
-- it an hour ahead while it works, so one whose Worker died is started again.
CREATE TABLE import_page_connections (
  import_id TEXT PRIMARY KEY REFERENCES import_sources (import_id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  token TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('backlog', 'sync')),
  next_run_at INTEGER,
  run_started_at INTEGER,
  outcome TEXT CHECK (outcome IN ('expired', 'failed', 'ok')),
  last_ok_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX import_page_connections_due ON import_page_connections (next_run_at)
  WHERE next_run_at IS NOT NULL;

-- The pages a person may choose from, for the hour after signing in at the platform.
-- Sealed like the above; a choice or the daily sweep deletes the row.
CREATE TABLE import_page_offers (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, page_id)
) STRICT;
