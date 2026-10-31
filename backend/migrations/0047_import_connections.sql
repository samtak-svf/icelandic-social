-- contract: only two new tables, so the previous version of the Worker runs on this schema unchanged.
-- A connection to a public profile (decision 0120): one row per import of the kind
-- profile. `author_id` is null until the person has shown the code on that profile,
-- and nothing comes in before it is set; afterwards only that author's posts do.
-- `next_run_at` is when the next run starts: null while one is out, and on an
-- unproven connection until the person asks for a check.
CREATE TABLE import_connections (
  import_id TEXT PRIMARY KEY REFERENCES import_sources (import_id) ON DELETE CASCADE,
  profile_url TEXT NOT NULL,
  code TEXT NOT NULL,
  author_id TEXT,
  phase TEXT NOT NULL CHECK (phase IN ('unproven', 'backlog', 'sync')),
  checks INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER,
  run_id TEXT,
  run_started_at INTEGER,
  run_month TEXT,
  run_ceiling INTEGER,
  outcome TEXT CHECK (outcome IN ('not_found', 'capped', 'failed', 'ok')),
  last_ok_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX import_connections_due ON import_connections (next_run_at)
  WHERE next_run_at IS NOT NULL;

-- What the provider's runs cost in a calendar month, in millionths of a dollar. A run
-- adds its ceiling when it starts, and the provider's own figure replaces that once
-- the figure has come through; it reads zero for a while after a run ends.
CREATE TABLE import_scrape_spend (
  month TEXT PRIMARY KEY,
  micros INTEGER NOT NULL
) STRICT;
