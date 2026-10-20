-- Linked non-phone devices (decision 0064, #299): a browser session becomes an
-- MLS device only after an active phone of the same account approves its link
-- request by signing the new device's Ed25519 key with its own device key.
--
-- A linked device is marked `kind = 'web'`, is bound to the enrolling
-- `session_id`, holds the server's 32-byte half of the browser's two-part
-- store key (`store_key_share`, handed only to its live session and wiped as
-- soon as the device or session ends), and expires after 45 days without use
-- (`last_seen_at`).

ALTER TABLE devices ADD COLUMN kind TEXT NOT NULL DEFAULT 'phone'
  CHECK (kind IN ('phone', 'web'));

ALTER TABLE devices ADD COLUMN last_seen_at INTEGER;

ALTER TABLE devices ADD COLUMN store_key_share BLOB;

CREATE INDEX devices_by_linked_activity ON devices (last_seen_at)
  WHERE kind != 'phone' AND revoked_at IS NULL;

CREATE TABLE device_link_requests (
  link_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions (session_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  device_key BLOB NOT NULL,
  history_key BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_by_device_id TEXT REFERENCES devices (device_id) ON DELETE CASCADE,
  approval_signature BLOB,
  approved_at INTEGER
) STRICT;

CREATE INDEX device_link_requests_by_expiry ON device_link_requests (expires_at);
