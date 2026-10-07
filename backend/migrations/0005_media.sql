-- Photos and files (decision 0023). R2 holds each object's ciphertext under
-- its id; this row is what lets the Worker check whom an object belongs to,
-- expire it after 30 days, and delete one account's uploads with the account,
-- without listing the bucket. The key is never here: it travels inside MLS.

CREATE TABLE media (
  media_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  uploader_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX media_by_age ON media (created_at);
CREATE INDEX media_by_uploader ON media (uploader_account_id);
