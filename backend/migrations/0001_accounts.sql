-- Accounts, their devices and the devices' KeyPackages (decisions 0014, 0017).
-- Times are Unix milliseconds. No column holds a kennitala in clear: only its
-- HMAC under a Worker secret (decision 0008).

CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  -- From Kenni at registration; null until the Kenni client exists.
  display_name TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  kennitala_hmac TEXT UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  -- Ed25519 public key, also the device's MLS credential key (decision 0002).
  device_key BLOB NOT NULL,
  -- Hex SHA-256 of the device token; the token itself is never stored.
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

CREATE INDEX devices_by_account ON devices (account_id) WHERE revoked_at IS NULL;

CREATE TABLE key_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices (device_id) ON DELETE CASCADE,
  key_package BLOB NOT NULL,
  -- The one package a claim hands out when nothing else is left, and never deletes.
  last_resort INTEGER NOT NULL DEFAULT 0 CHECK (last_resort IN (0, 1)),
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX key_packages_by_device ON key_packages (device_id, last_resort, id);
CREATE UNIQUE INDEX one_last_resort ON key_packages (device_id) WHERE last_resort = 1;
