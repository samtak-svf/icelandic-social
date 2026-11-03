-- Direct transfers from an exporter under the Data Transfer Initiative's standard (decision 0129).
-- Only new tables. A transfer's import is an import_sources row of kind 'page': that check
-- cannot be widened without rebuilding import_sources, and dropping it would cascade into
-- every table that references it. transfer_imports is what tells a transfer apart.

-- An authorization request waiting for the person's consent, for ten minutes.
CREATE TABLE transfer_requests (
  request_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  state TEXT,
  code_challenge TEXT,
  expires_at INTEGER NOT NULL
) STRICT;

-- What a person allowed an exporter to do. Revoked, every token of it stops working.
CREATE TABLE transfer_grants (
  grant_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

CREATE INDEX transfer_grants_account ON transfer_grants (account_id, created_at);

-- A grant's codes and tokens, by the SHA-256 of their value; the value itself is never kept.
CREATE TABLE transfer_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES transfer_grants (grant_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  redirect_uri TEXT,
  code_challenge TEXT,
  expires_at INTEGER,
  used_at INTEGER
) STRICT, WITHOUT ROWID;

CREATE INDEX transfer_tokens_grant ON transfer_tokens (grant_id);

-- The one standing import of a person from an exporter, which every transfer adds to.
CREATE TABLE transfer_imports (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  import_id TEXT NOT NULL UNIQUE REFERENCES import_sources (import_id) ON DELETE CASCADE,
  -- Items taken in, which a person's room for transfers is counted in.
  items INTEGER NOT NULL DEFAULT 0,
  -- Items acknowledged and not brought in: videos (decision 0120), files past the limit.
  left_behind INTEGER NOT NULL DEFAULT 0,
  last_item_at INTEGER,
  PRIMARY KEY (account_id, client_id)
) STRICT;

-- An album as the exporter named it, which its photos are grouped under.
CREATE TABLE transfer_albums (
  import_id TEXT NOT NULL REFERENCES import_sources (import_id) ON DELETE CASCADE,
  album_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  PRIMARY KEY (import_id, album_id)
) STRICT, WITHOUT ROWID;

-- A photo staged in R2 until its album has gone quiet and is gathered into posts. A photo
-- carries no id of its own, so it is known by the SHA-256 of its bytes.
CREATE TABLE transfer_photos (
  import_id TEXT NOT NULL REFERENCES import_sources (import_id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL,
  album_id TEXT,
  taken_at INTEGER NOT NULL,
  caption TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  posted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (import_id, photo_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX transfer_photos_waiting ON transfer_photos (received_at) WHERE posted = 0;
