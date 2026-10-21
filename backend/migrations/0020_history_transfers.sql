-- History from a sibling device (decision 0064, #300): at linking, the phone
-- that approved the link may upload its history, sealed by the core to the
-- link's one-time X25519 key, for the linked device to download once.
--
-- A linked device remembers the link it came from and the phone that approved
-- it, since completing the link deletes the request row and the transfer must
-- still know both: who may upload and who may download.
--
-- The ciphertext is in the EU media bucket under `history/<link_id>`, uploaded
-- in parts (R2 multipart). Nothing here can open it: the key is the link's,
-- and its private half never leaves the browser. A transfer is kept 24 hours
-- at most and deleted as soon as the linked device says it has it.

ALTER TABLE devices ADD COLUMN link_id TEXT;

ALTER TABLE devices ADD COLUMN linked_by_device_id TEXT;

CREATE UNIQUE INDEX devices_by_link ON devices (link_id) WHERE link_id IS NOT NULL;

CREATE TABLE history_transfers (
  link_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  uploader_device_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER
) STRICT;

CREATE INDEX history_transfers_by_expiry ON history_transfers (expires_at);

CREATE INDEX history_transfers_by_account ON history_transfers (account_id);

CREATE TABLE history_transfer_parts (
  link_id TEXT NOT NULL REFERENCES history_transfers (link_id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK (part_number > 0),
  etag TEXT NOT NULL,
  PRIMARY KEY (link_id, part_number)
) STRICT;
