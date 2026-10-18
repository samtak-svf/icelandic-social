-- Jobs and notifications (decision 0067, #290). A job is written in the same
-- D1 batch as the change that causes it and run by the minute cron until it
-- is done or has failed for good; its key makes writing it twice one job.

CREATE TABLE jobs (
  job_id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;

CREATE INDEX jobs_due ON jobs (run_after) WHERE state = 'pending';
CREATE INDEX jobs_finished ON jobs (finished_at) WHERE state != 'pending';

-- Something addressed to one account (decision 0063): a comment or a reaction
-- on its post, an approved join request, a moderator's action on its content.
-- Its id is the key of the job that made it, so a job run twice makes one.
CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'reaction', 'join_approved', 'moderated')),
  actor_id TEXT REFERENCES accounts (account_id) ON DELETE SET NULL,
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  post_id TEXT,
  comment_id TEXT,
  action TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  pushed_at INTEGER
) STRICT;

CREATE INDEX notifications_by_account ON notifications (account_id, created_at);
CREATE INDEX notifications_by_actor ON notifications (actor_id);
CREATE INDEX notifications_by_age ON notifications (created_at);
