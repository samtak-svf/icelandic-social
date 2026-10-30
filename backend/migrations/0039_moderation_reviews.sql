-- contract: a new table and an index that only this version reads, so the previous version is untouched by them
-- The single review of a moderator's action (decisions 0063, 0115). The entry is
-- the key, so a second request fails here and not only in a route's check. A row
-- goes with its entry. account_id is who may read the answer: it is cleared when
-- the review of an anonymous post is decided, so that no row keeps the author's
-- name beside a log entry that withholds it (decision 0091).
CREATE TABLE moderation_reviews (
  entry_id INTEGER PRIMARY KEY REFERENCES moderation_log (entry_id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts (account_id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'upheld', 'overturned')),
  asked_at INTEGER NOT NULL,
  decided_by TEXT REFERENCES accounts (account_id) ON DELETE SET NULL,
  decided_at INTEGER,
  reason TEXT,
  restored INTEGER NOT NULL DEFAULT 0 CHECK (restored IN (0, 1))
) STRICT;

CREATE INDEX moderation_reviews_by_account ON moderation_reviews (account_id);
CREATE INDEX moderation_reviews_by_decider ON moderation_reviews (decided_by);
CREATE INDEX moderation_reviews_open ON moderation_reviews (entry_id) WHERE state = 'open';

-- A review is decided once. `OF state`: a decider's deleted account clears
-- decided_by and is no second decision. Raised, so the whole batch of the second
-- decision goes: its log entry, its notice and any restoring.
CREATE TRIGGER moderation_reviews_decided_once BEFORE UPDATE OF state ON moderation_reviews
WHEN OLD.state <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'moderation_reviews already decided');
END;

-- An anonymous post's entries name no author, so its author finds them by the post.
CREATE INDEX moderation_log_by_target ON moderation_log (target_id);
