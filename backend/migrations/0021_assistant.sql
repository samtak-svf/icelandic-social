-- The testers' assistant (decision 0076, #89): an automated account that
-- answers comments in one community and queues the Apple IDs testers give
-- there, for the maintainer's machine to add to TestFlight.
--
-- An account is a person's unless it says otherwise. There is at most one
-- assistant, and it holds no identity, so no sign-in reaches it.
--
-- A tester request keeps the address only until it is added: marking it done
-- or failed clears the address, and the row stays as a count. Deleting the
-- account that asked deletes its requests.
--
-- An Android tester joins the Google Group themselves; a request is queued
-- for one only while no group is set, for the maintainer to add by hand.
--
-- Each comment the assistant answers is recorded, so a job run twice posts
-- one answer.
--
-- The assistant's spending is counted per calendar month (UTC), in millionths
-- of a dollar, and checked against its cap before every call to the model.

ALTER TABLE accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'person'
  CHECK (kind IN ('person', 'assistant'));

CREATE UNIQUE INDEX accounts_one_assistant ON accounts (kind) WHERE kind = 'assistant';

CREATE TABLE tester_requests (
  request_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  address TEXT UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')),
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;

CREATE INDEX tester_requests_pending ON tester_requests (created_at) WHERE state = 'pending';

CREATE TABLE assistant_usage (
  month TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  refused INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE assistant_answers (
  comment_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
) STRICT;
